"""Deterministic row validation and classification (spec §6). Pure functions, no database access.

Rules mirror frontend/src/demo/import.demo.ts, plus server-side checks for company IDs,
decimal precision, magnitude, ISO dates and EBITDA > revenue.
"""

import re
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal, InvalidOperation

from .schema import IMPORT_SCHEMA, METRIC_COLUMNS, REQUIRED_FIELDS

PERIOD_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
NUMBER_RE = re.compile(r"^[-+]?(\d+(\.\d*)?|\.\d+)$")
UNIT_RE = re.compile(r"[$€£¥%,]|\b(usd|eur|gbp)\b|\d\s*(m|mm|mn|k|bn|b)$", re.I)
COMPANY_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,62}$")
NUMERIC_FIELDS = ["revenue_actual", "revenue_plan", "ebitda_actual", "ebitda_plan"]
MAX_DECIMALS = 6  # kpi_observations values are numeric(18, 6)
MAX_ABS = Decimal("1e12")
UNIT_WARNING_ABS = Decimal("1000")  # USD 1 bn in one month: probably not in USD millions


@dataclass
class Row:
    row_number: int
    values: dict[str, str]
    issues: list[dict] = field(default_factory=list)
    parsed: dict[str, Decimal | None] = field(default_factory=dict)
    classification: str = "new"
    changed_metrics: list[str] = field(default_factory=list)

    def err(self, fld: str, message: str) -> None:
        self.issues.append({"field": fld, "severity": "error", "message": message})

    def warn(self, fld: str, message: str) -> None:
        self.issues.append({"field": fld, "severity": "warning", "message": message})

    @property
    def has_warnings(self) -> bool:
        return any(i["severity"] == "warning" for i in self.issues)

    def view(self) -> dict:
        return {"rowNumber": self.row_number, "values": self.values,
                "classification": self.classification, "issues": self.issues}


def mapping_errors(header: list[str], mapping: dict) -> tuple[dict[str, str | None], list[str]]:
    """Cleans a user mapping and returns file-level 'Mapping: …' errors (they block confirmation)."""
    errors: list[str] = []
    clean: dict[str, str | None] = {}
    for f in IMPORT_SCHEMA:
        col = mapping.get(f["field"]) or None
        if col is not None and col not in header:
            errors.append(f'Mapping: column "{col}" for {f["label"]} is not in the file.')
            col = None
        clean[f["field"]] = col
        if f["required"] and not col:
            errors.append(f'Mapping: required field {f["label"]} ({f["field"]}) is not mapped to a column.')
    used = [c for c in clean.values() if c]
    twice = sorted({c for c in used if used.count(c) > 1})
    if twice:
        errors.append(f"Mapping: column(s) {', '.join(twice)} are mapped to more than one field.")
    return clean, errors


def parse_number(v: str) -> tuple[Decimal | None, str | None, str | None]:
    """(value, error, warning) for a numeric cell. Empty means missing (None), never zero."""
    if v == "":
        return None, None, None
    if UNIT_RE.search(v):
        return None, f'"{v}" contains a currency, unit or thousands symbol. Enter plain numbers in USD millions, e.g. 1.62.', None
    if not NUMBER_RE.match(v):
        return None, f'"{v}" is not a number.', None
    try:
        d = Decimal(v)
    except InvalidOperation:
        return None, f'"{v}" is not a number.', None
    if abs(d) >= MAX_ABS:
        return None, f'"{v}" is out of range.', None
    exponent = d.as_tuple().exponent
    if isinstance(exponent, int) and -exponent > MAX_DECIMALS:
        return None, f'"{v}" has more than {MAX_DECIMALS} decimal places.', None
    warning = (f'"{v}" is unusually large for USD millions; check the unit.' if abs(d) >= UNIT_WARNING_ABS else None)
    return d, None, warning


def _iso_date_ok(s: str) -> bool:
    try:
        datetime.fromisoformat(s.replace("Z", "+00:00"))
        return True
    except ValueError:
        return False


def validate_rows(
    header: list[str],
    records: list[tuple[int, list[str]]],
    mapping: dict[str, str | None],
    companies: dict[str, str],
    current: dict[tuple[str, str, str], tuple[Decimal | None, Decimal | None]],
) -> list[Row]:
    """Validates and classifies every data row. `current` maps (company, period, metric) → (actual, plan)."""
    index = {f: header.index(c) for f, c in mapping.items() if c and c in header}
    rows: list[Row] = []

    for line, cells in records:
        r = Row(line, {f: (cells[i].strip() if i < len(cells) else "") for f, i in index.items()})
        v = r.values
        if len(cells) != len(header):
            r.err("row", f"The row has {len(cells)} values but the header has {len(header)} columns.")

        for f in REQUIRED_FIELDS:
            if f in ("revenue_plan", "ebitda_plan"):
                continue  # an empty plan is a warning (variance % not calculable)
            if not v.get(f):
                r.err(f, "Missing required value." if mapping.get(f) else "Column is not mapped.")

        cid = v.get("company_id", "")
        if cid and not COMPANY_ID_RE.match(cid):
            r.err("company_id", f'"{cid}" is not a supported company ID. Use lowercase letters, digits and hyphens.')

        period = v.get("reporting_period", "")
        if period and not PERIOD_RE.match(period):
            r.err("reporting_period", f'"{period}" is not a valid period. Use YYYY-MM, e.g. 2026-09.')

        for f in NUMERIC_FIELDS:
            value, error, warning = parse_number(v.get(f, ""))
            if error:
                r.err(f, error)
            if warning:
                r.warn(f, warning)
            r.parsed[f] = value

        for m, label in (("revenue", "Revenue"), ("ebitda", "EBITDA")):
            plan_col = METRIC_COLUMNS[m]["plan"]
            plan_raw, plan = v.get(plan_col, ""), r.parsed[plan_col]
            if not plan_raw:
                r.warn(plan_col, f"{label} plan is missing; {label} variance % will be shown as not calculable.")
            elif plan == 0:
                r.warn(plan_col, f"{label} plan is zero; {label} variance % will be shown as not calculable.")
            elif m == "ebitda" and plan is not None and plan < 0:
                r.warn(plan_col, "EBITDA plan is negative; the sign of EBITDA variance % is ambiguous "
                                 "and no alert will be raised from it.")

        for f in ("revenue_actual", "revenue_plan"):
            if (r.parsed[f] or 0) < 0:
                r.err(f, "Revenue cannot be negative.")
        ra, ea = r.parsed["revenue_actual"], r.parsed["ebitda_actual"]
        if ra == 0:
            r.warn("revenue_actual", "Revenue actual is zero; actual EBITDA margin will be not calculable.")
        if ra is not None and ra > 0 and ea is not None and ea > ra:
            r.err("ebitda_actual", f"EBITDA actual ({ea}) is greater than revenue actual ({ra}); check the figures.")

        src_at = v.get("source_updated_at", "")
        if src_at and not _iso_date_ok(src_at):
            r.err("source_updated_at", f'"{src_at}" is not a valid date. Use ISO 8601, e.g. 2026-10-03.')

        if cid in companies:
            if v.get("company_name") and v["company_name"] != companies[cid]:
                r.warn("company_name", f'Differs from the stored name "{companies[cid]}"; the stored name is kept.')
        elif cid and COMPANY_ID_RE.match(cid):
            r.warn("company_id", f'"{cid}" is not a known company; it will be created when the import is confirmed.')
            if not v.get("sector"):
                r.warn("sector", 'No sector given; the new company will be listed as "Unassigned".')
        rows.append(r)

    # Duplicate company-period records within the file: none of them is imported.
    groups: dict[tuple[str, str], list[Row]] = {}
    for r in rows:
        key = (r.values.get("company_id", ""), r.values.get("reporting_period", ""))
        if all(key):
            groups.setdefault(key, []).append(r)
    for group in groups.values():
        if len(group) > 1:
            for r in group:
                others = ", ".join(str(o.row_number) for o in group if o is not r)
                r.err("company_id", f"Duplicate company and period (also in row {others}). Duplicates are not "
                                    "imported; keep one row per company and period.")

    # Classification against the stored current observations.
    for r in rows:
        if any(i["severity"] == "error" for i in r.issues):
            r.classification = "invalid"
            continue
        cid, period = r.values["company_id"], r.values["reporting_period"]
        stored = {m: current.get((cid, period, m)) for m in METRIC_COLUMNS}
        r.changed_metrics = [
            m for m, cols in METRIC_COLUMNS.items()
            if stored[m] is None or stored[m] != (r.parsed[cols["actual"]], r.parsed[cols["plan"]])
        ]
        if all(s is None for s in stored.values()):
            r.classification = "new"
        else:
            r.classification = "changed" if r.changed_metrics else "unchanged"
    return rows

