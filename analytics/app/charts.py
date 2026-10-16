"""Plotly chart builders + Kaleido PNG export."""
from __future__ import annotations

import base64
import json
import logging

import plotly.graph_objects as go
import plotly.io as pio

log = logging.getLogger(__name__)

PALETTE = ["#2563eb", "#0d9488", "#f59e0b", "#dc2626", "#7c3aed", "#db2777", "#16a34a", "#ea580c"]
FONT = dict(family="Inter, Segoe UI, Arial, sans-serif", size=13, color="#1f2937")


def _layout(title: str, **extra) -> dict:
    return dict(
        title=dict(text=title, x=0.02, font=dict(size=17)),
        font=FONT,
        paper_bgcolor="white",
        plot_bgcolor="white",
        margin=dict(l=60, r=30, t=60, b=50),
        **extra,
    )


def revenue_by_region_chart(rows: list[dict]) -> go.Figure:
    fig = go.Figure(
        go.Bar(
            x=[r["region"] for r in rows],
            y=[r["revenue"] for r in rows],
            marker_color=[PALETTE[i % len(PALETTE)] for i in range(len(rows))],
            text=[f"{r['share']}%" for r in rows],
            textposition="outside",
            cliponaxis=False,
            customdata=[[r["deals"], r["salespeople"]] for r in rows],
            hovertemplate="<b>%{x}</b><br>Revenue: %{y:,.0f}<br>Deals: %{customdata[0]}"
            "<br>Salespeople: %{customdata[1]}<extra></extra>",
        )
    )
    top = max((r["revenue"] for r in rows), default=0)
    fig.update_layout(**_layout("Revenue by Region",
                                yaxis=dict(title="Revenue", gridcolor="#e5e7eb", tickformat=",.0f", range=[0, top * 1.15 or 1]),
                                xaxis=dict(title="Region")))
    return fig


def top_salespeople_chart(rows: list[dict]) -> go.Figure:
    ordered = list(reversed(rows))  # largest on top in a horizontal bar chart
    fig = go.Figure(
        go.Bar(
            x=[r["revenue"] for r in ordered],
            y=[r["salesperson"] for r in ordered],
            orientation="h",
            marker_color=PALETTE[0],
            text=[f"{r['revenue']:,.0f}" for r in ordered],
            textposition="auto",
            customdata=[[r["deals"], ", ".join(r["regions"])] for r in ordered],
            hovertemplate="<b>%{y}</b><br>Revenue: %{x:,.0f}<br>Deals: %{customdata[0]}"
            "<br>Regions: %{customdata[1]}<extra></extra>",
        )
    )
    fig.update_layout(**_layout(f"Top {len(rows)} Salespeople by Revenue",
                                xaxis=dict(title="Revenue", gridcolor="#e5e7eb", tickformat=",.0f"),
                                height=max(320, 60 + 36 * len(rows))))
    return fig


def figure_to_json(fig: go.Figure) -> dict:
    """Plotly figure as plain JSON the React app renders with plotly.js."""
    return json.loads(pio.to_json(fig, validate=False))


def figure_to_png(fig: go.Figure, width: int = 1000, height: int | None = None) -> bytes:
    """Static PNG via Kaleido (bonus requirement)."""
    return pio.to_image(fig, format="png", engine="kaleido", width=width,
                        height=height or fig.layout.height or 500, scale=2)


def figure_to_png_b64(fig: go.Figure) -> str | None:
    try:
        return base64.b64encode(figure_to_png(fig)).decode("ascii")
    except Exception:  # noqa: BLE001 - PNG is optional; never fail the analysis because of it
        log.exception("PNG export failed (is kaleido installed?)")
        return None
