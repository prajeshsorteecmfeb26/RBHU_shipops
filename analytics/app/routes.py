"""HTTP endpoints of the analytics microservice."""
from __future__ import annotations

import hmac
import logging
import time

from flask import Blueprint, Response, current_app, jsonify, request

from . import charts
from .analysis import parse_sales_csv, revenue_by_region, summary_statistics, top_salespeople
from .config import Config
from .errors import AnalyticsError, UnauthorizedError

log = logging.getLogger(__name__)
bp = Blueprint("analytics", __name__)

CHART_BUILDERS = {
    "revenue_by_region": lambda by_region, _top: charts.revenue_by_region_chart(by_region),
    "top_salespeople": lambda _by_region, top: charts.top_salespeople_chart(top),
}


def _cfg() -> Config:
    return current_app.config["ANALYTICS"]


@bp.before_request
def _require_internal_key():
    """Service-to-service auth: only the Node API (holding the shared key) may call /analyze."""
    if request.endpoint in {"analytics.health"}:
        return
    expected = _cfg().internal_api_key
    if not expected:
        return  # local dev without a key
    provided = request.headers.get("X-Internal-Api-Key", "")
    if not hmac.compare_digest(provided.encode(), expected.encode()):
        raise UnauthorizedError("Missing or invalid internal API key")


def _read_upload() -> bytes:
    file = request.files.get("file")
    if file is None or not file.filename:
        raise AnalyticsError("Attach a CSV file in the 'file' form field")
    if not file.filename.lower().endswith(".csv"):
        raise AnalyticsError("Only .csv files are accepted")
    return file.read()


def _analyze(raw: bytes):
    cfg = _cfg()
    parsed = parse_sales_csv(raw, cfg.max_rows)
    by_region = revenue_by_region(parsed.df)
    top = top_salespeople(parsed.df, cfg.top_n_salespeople)
    return parsed, by_region, top


@bp.get("/health")
def health():
    return jsonify(status="ok", service="shipops-analytics")


@bp.post("/analyze")
def analyze():
    """
    Input : multipart/form-data with `file` = CSV (salesperson,revenue,region)
    Query : include_png=true -> also return base64 PNG renders (Kaleido)
    Output: summary statistics, aggregated tables, Plotly figure JSON for both charts.
    """
    started = time.perf_counter()
    raw = _read_upload()
    parsed, by_region, top = _analyze(raw)

    figs = {name: build(by_region, top) for name, build in CHART_BUILDERS.items()}
    body = {
        "summary": summary_statistics(parsed, by_region, top),
        "revenueByRegion": by_region,
        "topSalespeople": top,
        "charts": {
            "revenueByRegion": charts.figure_to_json(figs["revenue_by_region"]),
            "topSalespeople": charts.figure_to_json(figs["top_salespeople"]),
        },
        "warnings": parsed.warnings,
    }

    include_png = request.args.get("include_png", "false").lower() == "true"
    if include_png and _cfg().enable_png_export:
        body["png"] = {
            "revenueByRegion": charts.figure_to_png_b64(figs["revenue_by_region"]),
            "topSalespeople": charts.figure_to_png_b64(figs["top_salespeople"]),
        }

    log.info("analyzed %s rows (%s valid) in %.0f ms", parsed.total_rows, len(parsed.df),
             (time.perf_counter() - started) * 1000)
    return jsonify(body)


@bp.post("/analyze/png/<chart>")
def analyze_png(chart: str):
    """Bonus: returns a single chart as a downloadable PNG (image/png) rendered with Kaleido."""
    if chart not in CHART_BUILDERS:
        raise AnalyticsError(f"Unknown chart '{chart}'", {"available": list(CHART_BUILDERS)})
    if not _cfg().enable_png_export:
        raise AnalyticsError("PNG export is disabled")
    _, by_region, top = _analyze(_read_upload())
    png = charts.figure_to_png(CHART_BUILDERS[chart](by_region, top))
    return Response(png, mimetype="image/png",
                    headers={"Content-Disposition": f'attachment; filename="{chart}.png"'})
