FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app
# Kaleido's bundled Chromium needs a few shared libs + fonts for chart text
RUN apt-get update && apt-get install -y --no-install-recommends libnss3 libexpat1 fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY app ./app
COPY wsgi.py gunicorn.conf.py ./
RUN useradd --create-home appuser
USER appuser
EXPOSE 5001
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request,sys;sys.exit(0 if urllib.request.urlopen('http://localhost:5001/health').status==200 else 1)"
CMD ["gunicorn", "-c", "gunicorn.conf.py", "wsgi:app"]
