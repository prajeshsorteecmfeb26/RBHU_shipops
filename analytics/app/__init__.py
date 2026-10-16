"""ShipOps sales analytics microservice (Flask application factory)."""
from __future__ import annotations

import json
import logging
import sys
import uuid

from flask import Flask, g, request

from .config import Config
from .errors import register_error_handlers
from .routes import bp


class JsonFormatter(logging.Formatter):
    """One JSON object per line -> easy to query in Log Analytics."""

    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "level": record.levelname.lower(),
            "logger": record.name,
            "msg": record.getMessage(),
            "service": "shipops-analytics",
        }
        rid = getattr(record, "request_id", None)
        if rid:
            payload["requestId"] = rid
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload)


def _configure_logging(level: str) -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level)


def create_app(config: Config | None = None) -> Flask:
    cfg = config or Config()
    _configure_logging(cfg.log_level)

    app = Flask(__name__)
    app.config["ANALYTICS"] = cfg
    app.config["MAX_CONTENT_LENGTH"] = cfg.max_upload_mb * 1024 * 1024
    app.json.sort_keys = False

    if cfg.cors_origins:
        from flask_cors import CORS

        CORS(app, origins=cfg.cors_origins, methods=["GET", "POST"])

    @app.before_request
    def _request_id():
        g.request_id = request.headers.get("X-Request-Id") or str(uuid.uuid4())

    @app.after_request
    def _headers(resp):
        resp.headers["X-Request-Id"] = g.get("request_id", "")
        resp.headers["X-Content-Type-Options"] = "nosniff"
        return resp

    app.register_blueprint(bp)
    register_error_handlers(app)
    return app
