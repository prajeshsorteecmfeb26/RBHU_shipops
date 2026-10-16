import os

bind = f"0.0.0.0:{os.getenv('PORT', '5001')}"
# CSV parsing + chart rendering is CPU-bound: one sync worker per core, plus headroom
workers = int(os.getenv("WEB_CONCURRENCY", "2"))
threads = int(os.getenv("GUNICORN_THREADS", "2"))
timeout = 120  # Kaleido PNG rendering can take a few seconds on cold start
accesslog = "-"
errorlog = "-"
