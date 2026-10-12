"""Display text and static metadata. Formatting only: no value here is calculated from data.

Labels and formulas mirror frontend/src/demo/seed.ts, kpi.ts and engine.ts so the UI reads the same.
"""

from datetime import date, datetime, timezone
from decimal import ROUND_HALF_UP, Decimal

MINUS = "−"
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

METRIC_LABELS = {"revenue": "Revenue", "ebitda": "EBITDA", "ebitda_margin": "EBITDA margin"}

KPI_KEYS = [
    "revenue_variance",
    "revenue_variance_pct",
    "ebitda_variance",
    "ebitda_variance_pct",
    "ebitda_margin_actual_pct",
    "ebitda_margin_plan_pct",
    "ebitda_margin_variance_pp",
]

KPI_DEFINITIONS = {
    "revenue_variance": ("Revenue variance", "Revenue actual − Revenue plan", "currency"),
    "revenue_variance_pct": ("Revenue variance %", "(Revenue actual − Revenue plan) / Revenue plan × 100", "pct"),
    "ebitda_variance": ("EBITDA variance", "EBITDA actual − EBITDA plan", "currency"),
    "ebitda_variance_pct": ("EBITDA variance %", "(EBITDA actual − EBITDA plan) / EBITDA plan × 100", "pct"),
    "ebitda_margin_actual_pct": ("Actual EBITDA margin", "EBITDA actual / Revenue actual × 100", "pct"),
    "ebitda_margin_plan_pct": ("Planned EBITDA margin", "EBITDA plan / Revenue plan × 100", "pct"),
    "ebitda_margin_variance_pp": ("EBITDA margin variance", "Actual EBITDA margin − Planned EBITDA margin", "pp"),
}

SEVERITY_RANK = {"high": 3, "medium": 2, "warning": 1}


def iso(v: datetime | date | None) -> str:
    if v is None:
        return ""
    if isinstance(v, datetime):
        return v.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    return v.isoformat()


def num(v: Decimal | float | None) -> float | None:
    return None if v is None else float(v)


def period_label(key: str) -> str:
    try:
        y, m = key.split("-")
        return f"{MONTHS[int(m) - 1]} {y}"
    except (ValueError, IndexError):
        return key


def with_minus(s: str) -> str:
    return MINUS + s[1:] if s.startswith("-") else s


def plain(v: Decimal | float | None) -> str:
    """Stored number as text without trailing zeros, e.g. 1.900000 → 1.9."""
    if v is None:
        return "—"
    d = Decimal(str(v)).normalize()
    return with_minus(format(d, "f"))


def fixed(v: Decimal | float, dp: int) -> str:
    r = Decimal(str(v)).quantize(Decimal(1).scaleb(-dp), rounding=ROUND_HALF_UP)
    return f"{MINUS}{abs(r)}" if r < 0 else str(abs(r))


def signed(v: Decimal | float, dp: int) -> str:
    s = fixed(v, dp)
    return s if s.startswith(MINUS) or Decimal(str(v)).quantize(Decimal(1).scaleb(-dp)) == 0 else f"+{s}"


def pct_text(v) -> str:
    return "—" if v is None else f"{signed(v, 2)}%"


def pp_text(v) -> str:
    return "—" if v is None else f"{signed(v, 2)} pp"


def plain_pct(v) -> str:
    return "—" if v is None else f"{fixed(v, 2)}%"


def kpi_value_text(kpi_key: str, v) -> str:
    if v is None:
        return "—"
    unit = KPI_DEFINITIONS[kpi_key][2]
    return f"{fixed(v, 4)}%" if unit == "pct" else f"{fixed(v, 4)} pp" if unit == "pp" else fixed(v, 4)


def rule_condition_label(kpi_key: str, threshold) -> str:
    t = plain(threshold)
    metric = "Revenue" if kpi_key.startswith("revenue") else "EBITDA"
    if kpi_key in ("revenue_variance_pct", "ebitda_variance_pct"):
        return f"{metric} variance ≤ {t}%"
    if kpi_key in ("revenue_variance", "ebitda_variance"):
        return f"{metric} variance ≤ {t} (USD m)"
    if kpi_key == "ebitda_margin_actual_pct":
        return f"Actual EBITDA margin ≤ {t}%"
    if kpi_key == "ebitda_margin_plan_pct":
        return f"Planned EBITDA margin ≤ {t}%"
    return f"EBITDA margin variance ≤ {t} pp"


def calculation_text(kpi_key: str, ra, rp, ea, ep, value, calc_status: str, calc_reason: str | None) -> dict:
    """Formula with the STORED inputs substituted, and the STORED result formatted."""
    ra, rp, ea, ep = plain(ra), plain(rp), plain(ea), plain(ep)
    substituted, result = {
        "revenue_variance": (f"{ra} − {rp}", "" if value is None else signed(value, 2)),
        "ebitda_variance": (f"{ea} − {ep}", "" if value is None else signed(value, 2)),
        "revenue_variance_pct": (f"({ra} − {rp}) / {rp} × 100", pct_text(value)),
        "ebitda_variance_pct": (f"({ea} − {ep}) / {ep} × 100", pct_text(value)),
        "ebitda_margin_actual_pct": (f"{ea} / {ra} × 100", plain_pct(value)),
        "ebitda_margin_plan_pct": (f"{ep} / {rp} × 100", plain_pct(value)),
        "ebitda_margin_variance_pp": (f"({ea} / {ra} × 100) − ({ep} / {rp} × 100)", pp_text(value)),
    }[kpi_key]
    if calc_status == "not_calculable":
        result = f"Not calculable — {calc_reason or 'missing input'}"
    elif calc_status == "sign_ambiguous":
        result = f"{result} (sign ambiguous — {calc_reason or ''})"
    return {"formula": KPI_DEFINITIONS[kpi_key][1], "substituted": substituted, "result": result}
