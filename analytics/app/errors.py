"""Error types and JSON error handlers (same envelope as the Node API)."""
from __future__ import annotations

import logging

from flask import Flask, g, jsonify
from werkzeug.exceptions import HTTPException, RequestEntityTooLarge

log = logging.getLogger(__name__)


class AnalyticsError(Exception):
    status_code = 400
    code = "ANALYTICS_ERROR"

    def __init__(self, message: str, details: object | None = None):
        super().__init__(message)
        self.message = message
        self.details = details


class InvalidCsvError(AnalyticsError):
    status_code = 422
    code = "INVALID_CSV"


class UnauthorizedError(AnalyticsError):
    status_code = 401
    code = "UNAUTHORIZED"


def _body(code: str, message: str, details: object | None = None):
    payload = {"code": code, "message": message, "requestId": getattr(g, "request_id", None)}
    if details is not None:
        payload["details"] = details
    return {"error": payload}


def register_error_handlers(app: Flask) -> None:
    @app.errorhandler(AnalyticsError)
    def _analytics(err: AnalyticsError):
        log.info("request rejected: %s %s", err.code, err.message)
        return jsonify(_body(err.code, err.message, err.details)), err.status_code

    @app.errorhandler(RequestEntityTooLarge)
    def _too_large(_err):
        mb = app.config["MAX_CONTENT_LENGTH"] // (1024 * 1024)
        return jsonify(_body("FILE_TOO_LARGE", f"File exceeds the {mb} MB limit")), 413

    @app.errorhandler(HTTPException)
    def _http(err: HTTPException):
        return jsonify(_body(err.name.upper().replace(" ", "_"), err.description or err.name)), err.code

    @app.errorhandler(Exception)
    def _unexpected(err: Exception):
        log.exception("unhandled error")
        return jsonify(_body("INTERNAL_ERROR", "An unexpected error occurred")), 500
