"""Environment-based configuration for the analytics service."""
from __future__ import annotations

import os
from dataclasses import dataclass, field


def _bool(name: str, default: bool) -> bool:
    return os.getenv(name, str(default)).strip().lower() in {"1", "true", "yes"}


@dataclass(frozen=True)
class Config:
    # Shared secret the Node API sends in X-Internal-Api-Key. Empty = auth disabled (local dev only).
    internal_api_key: str = field(default_factory=lambda: os.getenv("INTERNAL_API_KEY", ""))
    max_upload_mb: int = field(default_factory=lambda: int(os.getenv("MAX_UPLOAD_MB", "5")))
    max_rows: int = field(default_factory=lambda: int(os.getenv("MAX_ROWS", "200000")))
    top_n_salespeople: int = field(default_factory=lambda: int(os.getenv("TOP_N_SALESPEOPLE", "10")))
    enable_png_export: bool = field(default_factory=lambda: _bool("ENABLE_PNG_EXPORT", True))
    # Only needed if a browser calls this service directly (normally it goes through the Node API)
    cors_origins: list[str] = field(
        default_factory=lambda: [o.strip() for o in os.getenv("CORS_ORIGINS", "").split(",") if o.strip()]
    )
    log_level: str = field(default_factory=lambda: os.getenv("LOG_LEVEL", "INFO").upper())
