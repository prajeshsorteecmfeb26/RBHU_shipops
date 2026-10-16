import base64
import io

import pytest

from app import create_app
from app.analysis import parse_sales_csv
from app.config import Config
from app.errors import InvalidCsvError

SAMPLE = b"salesperson,revenue,region\nJohn,10000,East\nJane,15000,West\nJohn,5000,West\nAmit,\"7,500\",north\n"


@pytest.fixture()
def client():
    app = create_app(Config(internal_api_key="test-key", log_level="WARNING"))
    return app.test_client()


def post(client, data: bytes, name="sales.csv", query="", key="test-key"):
    return client.post(
        f"/analyze{query}",
        data={"file": (io.BytesIO(data), name)},
        content_type="multipart/form-data",
        headers={"X-Internal-Api-Key": key} if key else {},
    )


def test_health_is_public(client):
    assert client.get("/health").json["status"] == "ok"


def test_requires_internal_key(client):
    assert post(client, SAMPLE, key=None).status_code == 401
    assert post(client, SAMPLE, key="wrong").status_code == 401


def test_analyze_happy_path(client):
    res = post(client, SAMPLE)
    assert res.status_code == 200
    body = res.json
    s = body["summary"]
    assert s["totalRevenue"] == 37500
    assert s["validRows"] == 4
    assert s["salespeopleCount"] == 3
    assert s["topSalesperson"] == "John"  # 10000 + 5000 aggregated
    assert s["topRegion"] == "West"
    assert body["revenueByRegion"][0] == {"region": "West", "revenue": 20000.0, "share": 53.33, "deals": 2, "salespeople": 2}
    assert [p["salesperson"] for p in body["topSalespeople"]] == ["John", "Jane", "Amit"]
    assert body["charts"]["revenueByRegion"]["data"][0]["type"] == "bar"
    assert "png" not in body


def test_invalid_rows_are_skipped_with_warning(client):
    data = b"salesperson,revenue,region\nJohn,10000,East\n,500,West\nJane,abc,West\nRavi,-5,South\n"
    body = post(client, data).json
    assert body["summary"]["validRows"] == 1
    assert body["summary"]["skippedRows"] == 3
    assert "line(s) 3, 4, 5" in body["warnings"][0]


@pytest.mark.parametrize(
    "data,code",
    [
        (b"", "INVALID_CSV"),
        (b"name,amount\nJohn,1\n", "INVALID_CSV"),
        (b"salesperson,revenue,region\n", "INVALID_CSV"),
    ],
)
def test_bad_files_return_422(client, data, code):
    res = post(client, data)
    assert res.status_code == 422
    assert res.json["error"]["code"] == code


def test_rejects_non_csv(client):
    assert post(client, SAMPLE, name="sales.xlsx").status_code == 400


def test_headers_are_case_insensitive_and_bom_tolerant():
    parsed = parse_sales_csv("﻿ Salesperson , Revenue ,REGION\nA,1,x\n".encode("utf-8"), 100)
    assert list(parsed.df.columns) == ["salesperson", "revenue", "region"]


def test_row_limit():
    with pytest.raises(InvalidCsvError):
        parse_sales_csv(b"salesperson,revenue,region\n" + b"A,1,E\n" * 11, 10)


def test_png_export(client):
    body = post(client, SAMPLE, query="?include_png=true").json
    png = base64.b64decode(body["png"]["revenueByRegion"])
    assert png[:8] == b"\x89PNG\r\n\x1a\n"

    res = client.post(
        "/analyze/png/top_salespeople",
        data={"file": (io.BytesIO(SAMPLE), "s.csv")},
        content_type="multipart/form-data",
        headers={"X-Internal-Api-Key": "test-key"},
    )
    assert res.status_code == 200 and res.mimetype == "image/png"
