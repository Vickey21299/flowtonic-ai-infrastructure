"""The documented import schema (spec §6). Mirrors frontend/src/demo/seed.ts IMPORT_SCHEMA."""

import re

IMPORT_SCHEMA = [
    {"field": "company_id", "label": "Company ID", "required": True,
     "description": "Stable identifier of the portfolio company."},
    {"field": "company_name", "label": "Company name", "required": True,
     "description": "Display name of the company."},
    {"field": "sector", "label": "Sector", "required": False,
     "description": "Sector used for filtering."},
    {"field": "reporting_period", "label": "Reporting period", "required": True,
     "description": "Month in YYYY-MM format, e.g. 2026-09."},
    {"field": "revenue_actual", "label": "Revenue actual", "required": True,
     "description": "Plain number in USD millions, no symbols."},
    {"field": "revenue_plan", "label": "Revenue plan", "required": True,
     "description": "Plain number in USD millions. Zero or empty makes revenue variance % not calculable."},
    {"field": "ebitda_actual", "label": "EBITDA actual", "required": True,
     "description": "Plain number in USD millions, no symbols."},
    {"field": "ebitda_plan", "label": "EBITDA plan", "required": True,
     "description": "Plain number in USD millions. Zero or empty makes EBITDA variance % not calculable."},
    {"field": "source_name", "label": "Source name", "required": False,
     "description": "Where the figures come from. Defaults to the file name."},
    {"field": "source_updated_at", "label": "Source updated at", "required": False,
     "description": "ISO 8601 date the source was last updated."},
]

FIELDS = [f["field"] for f in IMPORT_SCHEMA]
REQUIRED_FIELDS = [f["field"] for f in IMPORT_SCHEMA if f["required"]]
LABELS = {f["field"]: f["label"] for f in IMPORT_SCHEMA}

# Metric ↔ import columns.
METRIC_COLUMNS = {
    "revenue": {"actual": "revenue_actual", "plan": "revenue_plan"},
    "ebitda": {"actual": "ebitda_actual", "plan": "ebitda_plan"},
}

# Header names recognised by automatic mapping (normalised: lowercase, letters and digits only).
# The exact schema field name always wins; the user can change any mapping in the wizard.
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


def norm(header: str) -> str:
    return re.sub(r"[^a-z0-9]", "", header.lower())
