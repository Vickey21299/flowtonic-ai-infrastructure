"""Regenerate company_monthly_metrics.csv from the CURRENT observations in the database.

Read-only: connects with API_DATABASE_URL (role flownetic_api_ro) from backend/.env.
The invalid fixture is hand-written and is not touched by this script.

    backend/.venv/Scripts/python database/csv/generate_from_db.py
"""

import csv
import re
from decimal import Decimal
from pathlib import Path

import psycopg

HERE = Path(__file__).resolve().parent
ENV_FILE = HERE.parents[1] / "backend" / ".env"
OUT = HERE / "company_monthly_metrics.csv"

# Column order of the documented import schema (spec §6; frontend/src/demo/seed.ts IMPORT_SCHEMA).
COLUMNS = [
    "company_id", "company_name", "sector", "reporting_period",
    "revenue_actual", "revenue_plan", "ebitda_actual", "ebitda_plan",
    "source_name", "source_updated_at",
]


def api_url() -> str:
    m = re.search(r'^API_DATABASE_URL\s*=\s*"?([^"\n]+)"?', ENV_FILE.read_text(encoding="utf-8"), re.M)
    if not m:
        raise SystemExit("API_DATABASE_URL is missing in backend/.env")
    return m.group(1)


def fmt(v: Decimal | None, dp: int) -> str:
    """USD millions as a plain number: revenue 1 dp, EBITDA 2 dp; empty when missing."""
    return "" if v is None else f"{v:.{dp}f}"


def main() -> None:
    sql = """
        select c.id, c.name, c.sector, o.reporting_period,
               max(o.actual_value) filter (where o.metric_key = 'revenue') as ra,
               max(o.plan_value)   filter (where o.metric_key = 'revenue') as rp,
               max(o.actual_value) filter (where o.metric_key = 'ebitda')  as ea,
               max(o.plan_value)   filter (where o.metric_key = 'ebitda')  as ep,
               max(s.name) as source_name, max(s.updated_at) as source_updated_at
        from kpi_observations o
        join portfolio_companies c on c.id = o.company_id
        join import_jobs j on j.id = o.import_job_id
        join data_sources s on s.id = j.source_id
        where o.is_current
        group by c.id, c.name, c.sector, o.reporting_period
        order by o.reporting_period, c.id
    """
    with psycopg.connect(api_url()) as conn:
        rows = conn.execute(sql).fetchall()

    with OUT.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(COLUMNS)
        for cid, name, sector, period, ra, rp, ea, ep, src, src_at in rows:
            w.writerow([cid, name, sector, period, fmt(ra, 1), fmt(rp, 1), fmt(ea, 2), fmt(ep, 2),
                        src, src_at.date().isoformat() if src_at else ""])
    print(f"Wrote {len(rows)} rows to {OUT.relative_to(HERE.parents[1])}")


if __name__ == "__main__":
    main()
