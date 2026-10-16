"""
Pure data functions: parse + validate a sales CSV and compute statistics.
No Flask imports here, so the logic is trivially unit-testable.
"""
from __future__ import annotations

import io
from dataclasses import dataclass

import pandas as pd

from .errors import InvalidCsvError

REQUIRED_COLUMNS = ("salesperson", "revenue", "region")
MAX_WARNINGS = 20


@dataclass
class ParsedSales:
    df: pd.DataFrame
    total_rows: int
    warnings: list[str]


def _clean_revenue(series: pd.Series) -> pd.Series:
    """Accepts 10000, 10,000, '$10,000.50', '₹ 1,00,000' -> float. Invalid -> NaN."""
    cleaned = series.astype(str).str.replace(r"[^\d.\-]", "", regex=True).replace("", None)
    return pd.to_numeric(cleaned, errors="coerce")


def parse_sales_csv(raw: bytes, max_rows: int) -> ParsedSales:
    if not raw or not raw.strip():
        raise InvalidCsvError("The uploaded file is empty")

    try:
        df = pd.read_csv(
            io.BytesIO(raw),
            encoding="utf-8-sig",  # tolerate Excel's BOM
            dtype=str,
            skipinitialspace=True,
            nrows=max_rows + 1,
            on_bad_lines="error",
        )
    except UnicodeDecodeError as exc:
        raise InvalidCsvError("File must be UTF-8 encoded CSV") from exc
    except (pd.errors.ParserError, pd.errors.EmptyDataError) as exc:
        raise InvalidCsvError(f"Could not parse CSV: {exc}") from exc

    if len(df) > max_rows:
        raise InvalidCsvError(f"Too many rows (max {max_rows})")

    # Normalise headers: case/whitespace-insensitive
    df.columns = [str(c).strip().lower() for c in df.columns]
    missing = [c for c in REQUIRED_COLUMNS if c not in df.columns]
    if missing:
        raise InvalidCsvError(
            f"Missing required column(s): {', '.join(missing)}",
            {"expectedColumns": list(REQUIRED_COLUMNS), "foundColumns": list(df.columns)},
        )

    df = df[list(REQUIRED_COLUMNS)].copy()
    total_rows = len(df)
    if total_rows == 0:
        raise InvalidCsvError("The CSV has a header but no data rows")

    df["salesperson"] = df["salesperson"].fillna("").str.strip()
    df["region"] = df["region"].fillna("").str.strip().str.title()
    df["revenue"] = _clean_revenue(df["revenue"])

    warnings: list[str] = []
    invalid = df["salesperson"].eq("") | df["region"].eq("") | df["revenue"].isna() | (df["revenue"] < 0)
    if invalid.any():
        bad_rows = (df.index[invalid] + 2).tolist()  # +2 = 1-based + header line
        shown = ", ".join(map(str, bad_rows[:MAX_WARNINGS]))
        more = f" (+{len(bad_rows) - MAX_WARNINGS} more)" if len(bad_rows) > MAX_WARNINGS else ""
        warnings.append(f"Skipped {len(bad_rows)} invalid row(s) at line(s) {shown}{more}: "
                        "salesperson/region must be non-empty and revenue a non-negative number")
    df = df[~invalid]
    if df.empty:
        raise InvalidCsvError("No valid rows found", {"warnings": warnings})

    return ParsedSales(df=df.reset_index(drop=True), total_rows=total_rows, warnings=warnings)


def _r(x: float) -> float:
    return round(float(x), 2)


def revenue_by_region(df: pd.DataFrame) -> list[dict]:
    total = df["revenue"].sum()
    grouped = (
        df.groupby("region")
        .agg(revenue=("revenue", "sum"), deals=("revenue", "size"), salespeople=("salesperson", "nunique"))
        .sort_values("revenue", ascending=False)
    )
    return [
        {
            "region": region,
            "revenue": _r(row.revenue),
            "share": round(float(row.revenue / total) * 100, 2) if total else 0.0,
            "deals": int(row.deals),
            "salespeople": int(row.salespeople),
        }
        for region, row in grouped.iterrows()
    ]


def top_salespeople(df: pd.DataFrame, n: int) -> list[dict]:
    grouped = (
        df.groupby("salesperson")
        .agg(revenue=("revenue", "sum"), deals=("revenue", "size"), regions=("region", lambda s: sorted(set(s))))
        .sort_values(["revenue", "deals"], ascending=[False, False])
        .head(n)
    )
    return [
        {"rank": i + 1, "salesperson": name, "revenue": _r(row.revenue), "deals": int(row.deals), "regions": row.regions}
        for i, (name, row) in enumerate(grouped.iterrows())
    ]


def summary_statistics(parsed: ParsedSales, by_region: list[dict], top: list[dict]) -> dict:
    rev = parsed.df["revenue"]
    return {
        "totalRows": parsed.total_rows,
        "validRows": int(len(parsed.df)),
        "skippedRows": parsed.total_rows - int(len(parsed.df)),
        "totalRevenue": _r(rev.sum()),
        "averageRevenue": _r(rev.mean()),
        "medianRevenue": _r(rev.median()),
        "minRevenue": _r(rev.min()),
        "maxRevenue": _r(rev.max()),
        # Sample std is undefined for a single row
        "stdDevRevenue": _r(rev.std()) if len(rev) > 1 else 0.0,
        "percentile25": _r(rev.quantile(0.25)),
        "percentile75": _r(rev.quantile(0.75)),
        "salespeopleCount": int(parsed.df["salesperson"].nunique()),
        "regionCount": int(parsed.df["region"].nunique()),
        "topRegion": by_region[0]["region"] if by_region else None,
        "topSalesperson": top[0]["salesperson"] if top else None,
    }
