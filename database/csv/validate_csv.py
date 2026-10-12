"""Check the sample CSVs against the import rules (spec §6, mirroring frontend/src/demo/import.demo.ts).

Read-only. Company IDs are checked against the database via API_DATABASE_URL (backend/.env).
Exit code 1 if the valid file has any error or any invalid-file row is NOT flagged.

    backend/.venv/Scripts/python database/csv/validate_csv.py
"""

import csv
import re
import sys
from datetime import date
from pathlib import Path

import psycopg

HERE = Path(__file__).resolve().parent
ENV_FILE = HERE.parents[1] / "backend" / ".env"

COLUMNS = [
    "company_id", "company_name", "sector", "reporting_period",
    "revenue_actual", "revenue_plan", "ebitda_actual", "ebitda_plan",
    "source_name", "source_updated_at",
]
REQUIRED = ["company_id", "company_name", "reporting_period", "revenue_actual", "ebitda_actual"]
NUMERIC = ["revenue_actual", "revenue_plan", "ebitda_actual", "ebitda_plan"]
PERIOD_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
NUMBER_RE = re.compile(r"^[-+]?(\d+(\.\d*)?|\.\d+)$")
UNIT_RE = re.compile(r"[$€£¥%,]|\b(usd|eur|gbp)\b|\d\s*(m|mm|mn|k|bn|b)$", re.I)

# Columns that must be present (IMPORT_SCHEMA required=true). Plan VALUES may be blank (warning).
REQUIRED_COLUMNS = REQUIRED + ["revenue_plan", "ebitda_plan"]
# Column mapping: normalised header text -> schema field. Mirrors the mapping step of the import wizard.
ALIASES = {
    "company_id": {"companyid", "id"},
    "company_name": {"companyname", "company", "name"},
    "sector": {"sector", "industry"},
    "reporting_period": {"reportingperiod", "period", "month"},
    "revenue_actual": {"revenueactual", "revenue", "actualrevenue"},
    "revenue_plan": {"revenueplan", "planrevenue", "revenuebudget"},
    "ebitda_actual": {"ebitdaactual", "ebitda", "actualebitda"},
    "ebitda_plan": {"ebitdaplan", "planebitda", "ebitdabudget"},
    "source_name": {"sourcename", "source"},
    "source_updated_at": {"sourceupdatedat", "sourceupdated", "sourcedate"},
}


def norm(h: str) -> str:
    return re.sub(r"[^a-z0-9]", "", h.lower())


def map_columns(header: list[str]) -> dict[str, int]:
    """Schema field -> column index. Each column maps to at most one field."""
    mapping: dict[str, int] = {}
    used: set[int] = set()
    for field in COLUMNS:
        for i, h in enumerate(header):
            if i not in used and norm(h) in ALIASES[field]:
                mapping[field] = i
                used.add(i)
                break
    return mapping


def companies() -> dict[str, str]:
    url = re.search(r'^API_DATABASE_URL\s*=\s*"?([^"\n]+)"?', ENV_FILE.read_text(encoding="utf-8"), re.M).group(1)
    with psycopg.connect(url) as conn:
        return dict(conn.execute("select id, name from portfolio_companies").fetchall())


def check(path: Path, known: dict[str, str]) -> dict[int, list[tuple[str, str, str]]]:
    """Returns {row_number: [(severity, field, message)]}; row 1 is the header."""
    with path.open(newline="", encoding="utf-8") as f:
        rows = list(csv.reader(f))
    header, body = rows[0], rows[1:]
    cols = map_columns(header)
    missing = [f for f in REQUIRED_COLUMNS if f not in cols]
    if missing:
        return {1: [("error", "header", f"required column not found / not mappable: {', '.join(missing)}")]}

    issues: dict[int, list] = {}
    keys: dict[tuple[str, str], list[int]] = {}
    for n, cells in enumerate(body, start=2):
        out = issues.setdefault(n, [])
        err = lambda fld, msg: out.append(("error", fld, msg))  # noqa: E731
        warn = lambda fld, msg: out.append(("warning", fld, msg))  # noqa: E731
        if len(cells) != len(header):
            err("row", f"{len(cells)} values but the header has {len(header)} columns")
        v = {c: (cells[cols[c]].strip() if c in cols and cols[c] < len(cells) else "") for c in COLUMNS}

        for fld in REQUIRED:
            if not v[fld]:
                err(fld, "missing required value")
        if v["reporting_period"] and not PERIOD_RE.match(v["reporting_period"]):
            err("reporting_period", f'"{v["reporting_period"]}" is not YYYY-MM')

        num: dict[str, float | None] = {}
        for fld in NUMERIC:
            s = v[fld]
            num[fld] = None
            if not s:
                continue
            if UNIT_RE.search(s):
                err(fld, f'"{s}" contains a currency, unit or thousands symbol')
            elif not NUMBER_RE.match(s):
                err(fld, f'"{s}" is not a number')
            else:
                num[fld] = float(s)

        for m in ("revenue", "ebitda"):
            p = v[f"{m}_plan"]
            if not p:
                warn(f"{m}_plan", f"{m} plan missing: {m} variance % will be not calculable")
            elif num[f"{m}_plan"] == 0:
                warn(f"{m}_plan", f"{m} plan is zero: {m} variance % will be not calculable")
            elif m == "ebitda" and (num["ebitda_plan"] or 0) < 0:
                warn("ebitda_plan", "EBITDA plan is negative: sign of EBITDA variance % is ambiguous")
        for fld in ("revenue_actual", "revenue_plan"):
            if (num[fld] or 0) < 0:
                err(fld, "revenue cannot be negative")
        ra, ea = num["revenue_actual"], num["ebitda_actual"]
        if ra is not None and ra > 0 and ea is not None and ea > ra:
            err("ebitda_actual", f"EBITDA ({ea}) exceeds revenue ({ra}) — inconsistent values [proposed rule]")

        if v["source_updated_at"]:
            try:
                date.fromisoformat(v["source_updated_at"][:10])
            except ValueError:
                err("source_updated_at", f'"{v["source_updated_at"]}" is not an ISO 8601 date')

        cid = v["company_id"]
        if cid and cid not in known:
            warn("company_id", f'unknown company "{cid}": it will be created on import')
        elif cid and v["company_name"] and v["company_name"] != known[cid]:
            warn("company_name", f'differs from stored name "{known[cid]}"')

        if cid and v["reporting_period"]:
            keys.setdefault((cid, v["reporting_period"]), []).append(n)

    for (cid, p), ns in keys.items():
        if len(ns) > 1:
            for n in ns:
                issues[n].append(("error", "company_id", f"duplicate company and period {cid} {p} (rows {ns})"))
    return issues


def main() -> int:
    known = companies()
    ok = True

    for name, expect_error in (("company_monthly_metrics_mapped_headers.csv", False),
                               ("company_monthly_metrics_missing_column.csv", True)):
        res = check(HERE / name, known)
        errs = [f"row {n} {fld}: {msg}" for n, its in res.items() for sev, fld, msg in its if sev == "error"]
        print(f"{name}: {'file rejected' if 1 in res else f'{len(res)} rows'}, {len(errs)} errors"
              + (f" — {errs[0]}" if errs else ""))
        ok &= bool(errs) == expect_error
    print()

    valid = check(HERE / "company_monthly_metrics.csv", known)
    errors = [(n, i) for n, its in valid.items() for i in its if i[0] == "error"]
    warnings = [(n, i) for n, its in valid.items() for i in its if i[0] == "warning"]
    ids = {r[0] for r in csv.reader((HERE / "company_monthly_metrics.csv").open(encoding="utf-8"))} - {"company_id"}
    print(f"company_monthly_metrics.csv: {len(valid)} rows, {len(ids)} companies, "
          f"{len(errors)} errors, {len(warnings)} warnings; all company IDs exist: {ids <= set(known)}")
    for n, (_, fld, msg) in warnings:
        print(f"  row {n} warning {fld}: {msg}")
    for n, (_, fld, msg) in errors:
        print(f"  row {n} ERROR {fld}: {msg}")
    ok &= not errors and ids <= set(known)

    invalid = check(HERE / "company_monthly_metrics_invalid.csv", known)
    print(f"\ncompany_monthly_metrics_invalid.csv: {len(invalid)} rows")
    for n, its in invalid.items():
        flagged = [f"{sev} {fld}: {msg}" for sev, fld, msg in its]
        print(f"  row {n}: " + (" | ".join(flagged) if flagged else "NOT FLAGGED"))
        ok &= bool(its)
    print("\nRESULT:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
