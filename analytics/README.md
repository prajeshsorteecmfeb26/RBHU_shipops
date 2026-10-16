# ShipOps Sales Analytics Service

Python 3.10+ · Flask · Pandas · Plotly · Kaleido

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
INTERNAL_API_KEY=dev-internal-key-change-me flask --app wsgi run -p 5001
pytest
```

```bash
curl -s -X POST "http://localhost:5001/analyze?include_png=true" \
  -H "X-Internal-Api-Key: dev-internal-key-change-me" \
  -F file=@../sample-data/sales.csv | jq .summary

# Bonus: download a chart as PNG (Kaleido)
curl -s -X POST http://localhost:5001/analyze/png/revenue_by_region \
  -H "X-Internal-Api-Key: dev-internal-key-change-me" \
  -F file=@../sample-data/sales.csv -o revenue_by_region.png
```

Input: CSV with `salesperson,revenue,region` (headers case-insensitive; revenue may contain `,`/currency symbols). Output: summary statistics, revenue by region, top salespeople, Plotly figure JSON for both charts, optional base64 PNGs, and warnings for skipped rows.

`app/analysis.py` holds the pure data logic, `app/charts.py` the Plotly figures, `app/routes.py` the HTTP layer. Production runs under gunicorn (`gunicorn -c gunicorn.conf.py wsgi:app`).
