"""AI-assisted investigation (spec §9): evidence → live (Gemini) or labelled mock output → validate → store.

The evidence list is built here from stored rows, so every number the output may cite is deterministic.
The model only organises that evidence into facts, hypotheses and missing data.
"""

import json
import uuid
from datetime import datetime, timezone

from psycopg import Connection
from pydantic import ValidationError

from .. import display as d
from .. import repository as repo
from ..errors import ApiError, not_found
from ..logs import info, log, step
from ..schemas import InvestigationOutput
from . import gemini

ID_LOCK = 4_211_003  # sequential INV- ids
MOCK_METADATA = {"provider": "none (mock)", "model": "Deterministic template — not an AI model",
                 "prompt_version": "mock-template-v1"}

MISSING = [
    ("sales_volume", "Sales volume", "Separates a change in units sold or jobs completed from a change in price."),
    ("pricing", "Pricing", "Shows whether average prices or rates moved against plan."),
    ("operating_expenses", "Operating expenses", "Shows whether costs moved against plan and which cost lines changed."),
    ("customer_data", "Customer data", "Shows whether customer mix, losses or new contracts differ from plan."),
]
EXPLANATIONS = [
    ("exp-volume", "Lower sales volume could contribute to the variance, but sales-volume data has not been supplied.",
     "sales_volume", "revenue"),
    ("exp-pricing", "Lower average pricing could contribute to the variance, but pricing data has not been supplied.",
     "pricing", "revenue"),
    ("exp-costs", "Operating costs above plan could contribute to the variance, but operating-expense data has not "
     "been supplied.", "operating_expenses", "margin"),
    ("exp-customers", "A change in customer mix or customer losses could contribute to the variance, but customer "
     "data has not been supplied.", "customer_data", None),
]
ALL_EXP = [x[0] for x in EXPLANATIONS]
MOCK_QUESTIONS = [
    {"question": "How did sales volume (units sold or jobs completed) compare with plan this month?",
     "explanations": ["exp-volume"]},
    {"question": "Did average prices or rates differ from the plan assumptions?", "explanations": ["exp-pricing"]},
    {"question": "Which operating-expense lines differed most from plan, and why?", "explanations": ["exp-costs"]},
    {"question": "Were there any customer losses, new contracts or changes in customer mix during the month?",
     "explanations": ["exp-customers"]},
]
MOCK_STEPS = [
    {"step": "Request monthly sales-volume and pricing data for the period.", "type": "data_request"},
    {"step": "Request an operating-expense breakdown against plan.", "type": "data_request"},
    {"step": "Request customer-level revenue for the period and the prior months.", "type": "data_request"},
    {"step": "Compare the requested data with plan to test each explanation.", "type": "analysis"},
    {"step": "Hold a review call with company management once the data is received.", "type": "meeting"},
]
MOCK_ACTIONS = [
    {"title": "Request supporting operating data from management",
     "rationale": "The supplied data cannot distinguish between the possible explanations. Volume, pricing, cost and "
                  "customer data are needed first.", "explanations": ALL_EXP},
    {"title": "Schedule a variance review with the management team",
     "rationale": "Management can confirm or rule out each explanation once the data is available.",
     "explanations": ALL_EXP},
]


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _vs_plan(v: float, unit: str) -> str:
    a = d.fixed(abs(v), 2)
    return "in line with plan" if float(a) == 0 else f"{a}{unit} {'below' if v < 0 else 'above'} plan"


# ---------- Evidence ----------


def _context(conn: Connection, exception_id: str) -> dict:
    e = repo._get_exception_row(conn, exception_id)
    company = conn.execute("select name, sector from portfolio_companies where id = %s", [e["company_id"]]).fetchone()
    kpis: dict[str, dict[str, dict]] = {}
    for k in conn.execute("select reporting_period, kpi_key, value, calc_status, calc_reason from kpi_results "
                          "where company_id = %s order by reporting_period", [e["company_id"]]).fetchall():
        kpis.setdefault(k["reporting_period"], {})[k["kpi_key"]] = k
    obs = {o["metric_key"]: o for o in repo.observations(
        conn, "o.company_id = %s and o.reporting_period = %s and o.is_current", [e["company_id"], e["reporting_period"]])}
    return {"e": e, "company": company, "kpis": kpis, "obs": obs}


def _kpi(c: dict, period: str, key: str) -> tuple[float | None, str]:
    k = c["kpis"].get(period, {}).get(key)
    if not k:
        return None, "No stored KPI result"
    if k["calc_status"] != "ok" or k["value"] is None:
        return None, k["calc_reason"] or k["calc_status"]
    return d.num(k["value"]), ""


def _kid(c: dict, key: str) -> str:
    return f"kpi:{c['e']['company_id']}:{key}"


def build_evidence(c: dict) -> tuple[list[dict], list[dict]]:
    """Returns (evidence refs, confirmed observations) for the exception's company and period."""
    e = c["e"]
    period, pl, cid = e["reporting_period"], d.period_label(e["reporting_period"]), e["company_id"]
    evidence, observations = [], []

    for metric, label, var_key in (("revenue", "Revenue", "revenue_variance_pct"),
                                   ("ebitda", "EBITDA", "ebitda_variance_pct")):
        o = c["obs"].get(metric)
        if o:
            evidence.append({"id": f"obs:{o['id']}", "label": f"{label} actual vs plan ({pl}, USD m)",
                             "value": f"{d.plain(o['actual_value'])} vs {d.plain(o['plan_value'])}"})
        v, why = _kpi(c, period, var_key)
        evidence.append({"id": _kid(c, var_key), "label": f"{label} variance % ({pl})",
                         "value": d.pct_text(v) if v is not None else f"Not calculable — {why}"})
        if v is not None and o:
            observations.append({
                "statement": f"{label} was {_vs_plan(v, '%')} in {pl} ({d.plain(o['actual_value'])} vs "
                             f"{d.plain(o['plan_value'])} USD m).",
                "evidence_ids": [f"obs:{o['id']}", _kid(c, var_key)]})

    mv, why = _kpi(c, period, "ebitda_margin_variance_pp")
    ma, _ = _kpi(c, period, "ebitda_margin_actual_pct")
    mp, _ = _kpi(c, period, "ebitda_margin_plan_pct")
    evidence.append({"id": _kid(c, "ebitda_margin_variance_pp"), "label": f"EBITDA margin actual vs plan ({pl})",
                     "value": f"{d.plain_pct(ma)} vs {d.plain_pct(mp)} ({d.pp_text(mv)})" if mv is not None
                     else f"Not calculable — {why}"})
    if mv is not None:
        observations.append({"statement": f"EBITDA margin was {d.plain_pct(ma)} against a planned {d.plain_pct(mp)} "
                                          f"({d.pp_text(mv)}).",
                             "evidence_ids": [_kid(c, "ebitda_margin_variance_pp")]})

    cond = d.rule_condition_label(e["kpi_key"], e["threshold"])
    version = e["rule_configuration_version"]
    evidence.append({"id": f"rule:{e['rule_key']}", "label": "Triggered rule",
                     "value": f"{cond} ({e['severity']}, configuration v{version})"})
    observations.append({"statement": f'The rule "{cond}" ({e["severity"]} severity) was triggered under rule '
                                      f"configuration v{version}.",
                         "evidence_ids": [f"rule:{e['rule_key']}", _kid(c, e["kpi_key"])]})

    src = c["obs"].get("ebitda") or c["obs"].get("revenue")
    if src:
        evidence.append({"id": f"src:{src['import_job_id']}", "label": "Source and freshness",
                         "value": f"{src['source_name']}, source updated {src['source_updated_at'][:10]}; imported "
                                  f"{src['imported_at'][:10]} from {src['file_name']}, row {src['source_row']}"})

    others = [p for p in c["kpis"] if p != period]
    for p in others:
        rv, _ = _kpi(c, p, "revenue_variance_pct")
        ev, _ = _kpi(c, p, "ebitda_variance_pct")
        evidence.append({"id": f"hist:{cid}:{p}", "label": f"Revenue / EBITDA variance % ({d.period_label(p)})",
                         "value": f"{d.pct_text(rv)} / {d.pct_text(ev)}"})
    if not others:
        evidence.append({"id": f"hist:{cid}", "label": "Stored reporting periods", "value": f"1 ({pl})"})
        observations.append({"statement": f"Only one reporting period ({pl}) is stored for {e['company_name']}, so "
                                          "no trend can be assessed.", "evidence_ids": [f"hist:{cid}"]})
    return evidence, observations


# ---------- Output ----------


def mock_output(c: dict, observations: list[dict]) -> dict:
    e, period = c["e"], c["e"]["reporting_period"]
    rv, _ = _kpi(c, period, "revenue_variance_pct")
    mv, _ = _kpi(c, period, "ebitda_margin_variance_pp")
    below = {"revenue": rv is not None and rv < 0, "margin": mv is not None and mv < 0}
    support = {"revenue": _kid(c, "revenue_variance_pct"), "margin": _kid(c, "ebitda_margin_variance_pp")}
    types = {m[0]: m[1] for m in MISSING}
    explanations = [
        {"id": x, "statement": s, "supporting_evidence_ids": [support[by]] if by and below[by] else [],
         "missing_evidence": [types[miss]], "evidence_strength": "weak" if by and below[by] else "none"}
        for x, s, miss, by in EXPLANATIONS
    ]
    v, _ = _kpi(c, period, e["kpi_key"])
    cond = d.rule_condition_label(e["kpi_key"], e["threshold"])
    var = "outside its plan" if v is None else _vs_plan(v, " pp" if e["kpi_key"].endswith("_pp") else "%")
    return {
        "executive_summary": (
            f'{d.METRIC_LABELS[e["metric_key"]]} at {e["company_name"]} was {var} in {d.period_label(period)}, '
            f'which triggered the rule "{cond}". The supplied data confirms the size of the variance but not its '
            "cause. Additional evidence is needed before any explanation can be assessed: sales volume, pricing, "
            "operating expenses and customer data. "
            "MOCK INVESTIGATION — generated from a deterministic template, not by an AI model."),
        "confirmed_observations": observations,
        "potential_explanations": explanations,
        "missing_evidence": [{"type": t, "why_needed": w,
                              "explanations": [x[0] for x in EXPLANATIONS if x[2] == mid]} for mid, t, w in MISSING],
        "management_questions": MOCK_QUESTIONS,
        "next_steps": MOCK_STEPS,
        "suggested_actions": MOCK_ACTIONS,
        "overall_assessment": {
            "cause_determination": "undetermined",
            "evidence_strength": "weak" if any(x["evidence_strength"] == "weak" for x in explanations) else "none",
            "rationale": "The data shows the size of the variance but contains nothing that distinguishes between "
                         "the possible explanations. No cause can be determined until the missing evidence is "
                         "supplied and reviewed."},
        "data_limitations": [
            "Only the reporting periods stored in the workspace are available.",
            "No sales-volume, pricing, operating-expense or customer data has been supplied.",
            "Plan figures are taken as provided by the source and have not been independently verified.",
            "This is a deterministic mock output, not generated by an AI model."],
    }


def validate_output(raw: dict, evidence_ids: set[str]) -> tuple[dict, int]:
    """Schema check, then guardrails: unknown evidence ids are dropped, and an explanation without supporting
    evidence cannot claim any strength. Returns (output, number of corrections)."""
    try:
        out = InvestigationOutput.model_validate(raw).model_dump()
    except ValidationError as e:
        raise gemini.AiError("invalid_response", "The AI response did not match the investigation schema "
                                                 f"({e.error_count()} problem(s)).") from e
    if not out["executive_summary"].strip():
        raise gemini.AiError("invalid_response", "The AI response has an empty executive summary.")
    fixes = 0
    for o in out["confirmed_observations"]:
        keep = [i for i in o["evidence_ids"] if i in evidence_ids]
        fixes += len(o["evidence_ids"]) - len(keep)
        o["evidence_ids"] = keep
    for x in out["potential_explanations"]:
        keep = [i for i in x["supporting_evidence_ids"] if i in evidence_ids]
        fixes += len(x["supporting_evidence_ids"]) - len(keep)
        x["supporting_evidence_ids"] = keep
        if not keep and x["evidence_strength"] != "none":
            x["evidence_strength"] = "none"
            fixes += 1
    assessment = out["overall_assessment"]
    if assessment["cause_determination"] != "undetermined" and not any(
            x["supporting_evidence_ids"] for x in out["potential_explanations"]):
        assessment["cause_determination"] = "undetermined"
        fixes += 1
    return out, fixes


# ---------- Persistence ----------


def _audit(conn: Connection, exception_id: str, change: str, detail: str | None, actor: str) -> None:
    conn.execute("insert into audit_events (entity_type, entity_id, change, detail, actor) "
                 "values ('exception', %s, %s, %s, %s)", [exception_id, change, detail, actor])


def _load(conn: Connection, inv_id: str, for_update: bool = False) -> dict:
    i = conn.execute("select * from investigations where id = %s" + (" for update" if for_update else ""),
                     [inv_id]).fetchone()
    if not i:
        raise not_found("Investigation", inv_id)
    return i


def generate(conn: Connection, settings, exception_id: str, mode: str, actor: str) -> dict:
    total = 5 if mode == "live" else 4
    info("investig", "exception %s, mode=%s, requested by %s", exception_id, mode, actor)
    if mode == "live" and not settings.gemini_api_key:
        raise ApiError(409, "provider_unavailable",
                       "No AI provider is configured (GEMINI_API_KEY is missing). Use the mock investigation.")
    with step("investig", 1, total, "loading exception, KPI results and observations") as r:
        c = _context(conn, exception_id)
        e = c["e"]
        r["out"] = (f"{e['company_name']} {e['reporting_period']} {e['kpi_key']} ({e['severity']}), "
                    f"{len(c['kpis'])} period(s) of KPIs")
    with step("investig", 2, total, "building the evidence list") as r:
        evidence, observations = build_evidence(c)
        r["out"] = f"{len(evidence)} evidence items, {len(observations)} confirmed observations"

    output, error, status, meta = None, None, "completed", MOCK_METADATA
    if mode == "mock":
        with step("investig", 3, total, "building the labelled mock output (no AI call)") as r:
            output = mock_output(c, observations)
            r["out"] = f"{len(output['potential_explanations'])} explanations"
    else:
        meta = {"provider": "Google Gemini", "model": settings.gemini_model, "prompt_version": gemini.PROMPT_VERSION}
        context = {
            "company": {"name": e["company_name"], "sector": c["company"]["sector"] if c["company"] else None},
            "exception": {"metric": d.METRIC_LABELS[e["metric_key"]], "kpi": e["kpi_key"],
                          "reporting_period": d.period_label(e["reporting_period"]), "severity": e["severity"],
                          "rule": d.rule_condition_label(e["kpi_key"], e["threshold"])},
            "units": "USD millions; variances in % of plan; margin variance in percentage points",
            "evidence": evidence,
        }
        try:
            with step("investig", 3, total,
                      f"calling {settings.gemini_model} (timeout {settings.ai_timeout_seconds:.0f} s)") as r:
                raw, usage = gemini.generate(settings.gemini_api_key, settings.gemini_model,
                                             settings.ai_timeout_seconds, context)
                r["out"] = f"finish={usage['finish']}, tokens in={usage['in']} out={usage['out']}"
            with step("investig", 4, total, "validating the response against the schema and the evidence ids") as r:
                output, fixes = validate_output(raw, {x["id"] for x in evidence})
                r["out"] = (f"{len(output['confirmed_observations'])} observations, "
                            f"{len(output['potential_explanations'])} explanations, "
                            f"cause={output['overall_assessment']['cause_determination']}, "
                            f"{fixes} guardrail correction(s)")
        except gemini.AiError as err:
            log.warning("  ✗ investig AI call failed: %s — %s", err.category, err.message)
            status, error = "failed", {"category": err.category, "message": err.message}

    with step("investig", total, total, "saving the investigation and audit history") as r:
        with conn.transaction():
            conn.execute("select pg_advisory_xact_lock(%s)", [ID_LOCK])
            n = conn.execute(r"select coalesce(max(substring(id from '^INV-(\d+)$')::int), 0) + 1 as n "
                             "from investigations").fetchone()["n"]
            inv_id = f"INV-{n:04d}"
            previous = conn.execute("select count(*) as n from investigations where exception_id = %s",
                                    [exception_id]).fetchone()["n"]
            now = _now()
            conn.execute(
                """insert into investigations (id, exception_id, mode, status, output, evidence, error, model_metadata,
                       input_reference, created_by, created_at, updated_at)
                   values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                [inv_id, exception_id, mode, status, json.dumps(output) if output else None, json.dumps(evidence),
                 json.dumps(error) if error else None, json.dumps(meta),
                 json.dumps({"company_id": e["company_id"], "period": e["reporting_period"],
                             "evidence_ids": [x["id"] for x in evidence]}), actor, now, now])
            what = "Mock investigation" if mode == "mock" else "AI investigation"
            verb = "failed" if error else "regenerated" if previous else "generated"
            detail = error["message"] if error else f"{meta['provider']} · {meta['model']}"
            if previous and not error:
                detail += f" · run {previous + 1}; earlier runs are kept"
            _audit(conn, exception_id, f"{what} {inv_id} {verb}", detail, actor)
        r["out"] = f"{inv_id} status={status}"
    return repo.investigation_detail(conn, inv_id)


def add_note(conn: Connection, inv_id: str, text: str, actor: str) -> dict:
    t = text.strip()
    if not t:
        raise ApiError(422, "validation_error", "The note cannot be empty.",
                       {"fieldErrors": [{"field": "text", "message": "The note cannot be empty."}]})
    with step("investig", 1, 1, f"adding a note to {inv_id}"):
        _load(conn, inv_id)
        note = {"id": f"NOTE-{uuid.uuid4().hex[:8]}", "at": d.iso(_now()), "author": actor, "text": t}
        conn.execute("update investigations set notes = notes || %s::jsonb, updated_at = now() where id = %s",
                     [json.dumps([note]), inv_id])
    return repo.investigation_detail(conn, inv_id)


def save_edit(conn: Connection, inv_id: str, edited: dict, actor: str) -> dict:
    with step("investig", 1, 1, f"saving the analyst edit of {inv_id}") as r:
        with conn.transaction():
            i = _load(conn, inv_id, for_update=True)
            if i["status"] != "completed":
                raise ApiError(409, "conflict", "Only a completed investigation can be edited.")
            conn.execute("""update investigations set edited_output = %s, review_status = 'unreviewed',
                                reviewed_by = null, reviewed_at = null, updated_at = now() where id = %s""",
                         [json.dumps(edited), inv_id])
            _audit(conn, i["exception_id"], f"Investigation {inv_id} edited by analyst",
                   "The original output is kept; the edit needs a fresh review.", actor)
        r["out"] = "review reset to unreviewed"
    return repo.investigation_detail(conn, inv_id)


def mark_reviewed(conn: Connection, inv_id: str, actor: str) -> dict:
    with step("investig", 1, 1, f"marking {inv_id} reviewed"):
        with conn.transaction():
            i = _load(conn, inv_id, for_update=True)
            if i["status"] != "completed":
                raise ApiError(409, "conflict", "Only a completed investigation can be marked reviewed.")
            conn.execute("""update investigations set review_status = 'reviewed', reviewed_by = %s,
                                reviewed_at = now(), updated_at = now() where id = %s""", [actor, inv_id])
            _audit(conn, i["exception_id"], f"Investigation {inv_id} marked reviewed", None, actor)
    return repo.investigation_detail(conn, inv_id)
