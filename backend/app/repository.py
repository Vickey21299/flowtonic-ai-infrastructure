"""Read-only queries. Every value comes from a stored column; the only derivations are
joins, counts/filters over stored rows and display text (see display.py).

Not stored in the schema, so returned empty/null instead of invented:
original CSV strings of seeded rows, impact estimates and verification rationale.
Seeded investigations predate the output/evidence/notes columns and are mapped from the legacy columns.
Investigation writes live in investigations/service.py; other workflow transitions are not offered yet.
"""

from datetime import date

from psycopg import Connection

from . import display as d
from .errors import not_found

OPEN_ACTION_STATUSES = ("proposed", "approved", "in_progress", "completed", "outcome_verification", "reopened")
OVERDUE_STATUSES = ("proposed", "approved", "in_progress", "reopened")
COMPANY_STATUSES = ("on_track", "warning", "exception", "insufficient_data")
SEVERITIES = ("high", "medium", "warning")
EXCEPTION_TRANSITIONS = {
    "open": ["acknowledged", "in_review", "resolved"],
    "acknowledged": ["in_review", "resolved"],
    "in_review": ["resolved"],
    "resolved": ["open"],
}
ACTION_TRANSITIONS = {
    "proposed": ["approved", "cancelled"],
    "approved": ["in_progress", "cancelled"],
    "in_progress": ["completed", "cancelled"],
    "completed": ["outcome_verification"],
    "outcome_verification": ["verified", "reopened"],
    "verified": [],
    "reopened": ["in_progress", "cancelled"],
    "cancelled": [],
}


def _rows(conn: Connection, sql: str, params: list | tuple = ()) -> list[dict]:
    return conn.execute(sql, params).fetchall()


def _one(conn: Connection, sql: str, params: list | tuple = ()) -> dict | None:
    return conn.execute(sql, params).fetchone()


# ---------- Workspace ----------


def periods(conn: Connection) -> list[str]:
    return [
        r["p"]
        for r in _rows(
            conn, "select distinct reporting_period as p from kpi_observations where is_current order by 1 desc"
        )
    ]


def latest_period(conn: Connection) -> str | None:
    return (_one(conn, "select max(reporting_period) as p from kpi_observations where is_current") or {}).get("p")


def last_import_at(conn: Connection) -> str:
    r = _one(conn, "select max(imported_at) as t from import_jobs where status = 'committed'")
    return d.iso(r["t"] if r else None)


def workspace(conn: Connection, settings, ai_mode: str) -> dict:
    ps = periods(conn)
    src = _one(conn, "select name, updated_at from data_sources order by updated_at desc nulls last limit 1")
    return {
        "name": settings.workspace_name,
        "environment": "production" if settings.app_profile == "production" else "demo",
        "currency": settings.workspace_currency,
        "unit": settings.workspace_unit,
        "periods": [{"key": p, "label": d.period_label(p), "type": "month"} for p in ps],
        "current_period": ps[0] if ps else "",
        "last_import_at": last_import_at(conn),
        "source_name": src["name"] if src else "—",
        "source_updated_at": d.iso(src["updated_at"]) if src else "",
        "ai_mode": ai_mode,
        "demo_user": {"name": settings.workspace_user_name, "role": settings.workspace_user_role},
    }


# ---------- Companies ----------


def _missing_kpi() -> dict:
    return {"value": None, "status": "not_calculable", "reason": "No stored KPI result for this period"}


def _status(open_severities: list[str], kpis: dict) -> str:
    """Status for one period from its stored open exceptions and KPI results. Same rule the import uses
    to maintain portfolio_companies.status for the latest period."""
    if any(sev in ("high", "medium") for sev in open_severities):
        return "exception"
    if "warning" in open_severities:
        return "warning"
    if sum(k["calc_status"] == "ok" for k in kpis.values()) < len(d.KPI_KEYS):
        return "insufficient_data"
    return "on_track"


def company_rows(conn: Connection, period: str, sector=None, status=None, attention=None, search=None) -> list[dict]:
    companies = _rows(conn, "select * from portfolio_companies order by name")
    obs = _rows(
        conn,
        """select company_id, metric_key, actual_value, plan_value, imported_at
           from kpi_observations where is_current and reporting_period = %s""",
        [period],
    )
    kpis = _rows(
        conn,
        "select company_id, kpi_key, value, calc_status, calc_reason from kpi_results where reporting_period = %s",
        [period],
    )
    open_exc: dict[str, list[str]] = {}
    for r in _rows(
        conn,
        """select company_id, severity from exceptions
           where reporting_period = %s and status <> 'resolved' and condition_active""",
        [period],
    ):
        open_exc.setdefault(r["company_id"], []).append(r["severity"])
    open_act = {
        r["company_id"]: r["n"]
        for r in _rows(
            conn,
            """select e.company_id, count(*)::int as n from actions a join exceptions e on e.id = a.exception_id
               where a.status = any(%s) group by e.company_id""",
            [list(OPEN_ACTION_STATUSES)],
        )
    }

    rows = []
    for c in companies:
        cobs = {o["metric_key"]: o for o in obs if o["company_id"] == c["id"]}
        ckpis = {k["kpi_key"]: k for k in kpis if k["company_id"] == c["id"]}
        imported = sorted(o["imported_at"] for o in cobs.values())

        def ap(metric: str) -> dict:
            o = cobs.get(metric)
            return {"actual": d.num(o["actual_value"]) if o else None, "plan": d.num(o["plan_value"]) if o else None}

        rows.append(
            {
                "id": c["id"],
                "name": c["name"],
                "sector": c["sector"] or "",
                "currency": c["currency"],
                "period": period,
                "financials": {"revenue": ap("revenue"), "ebitda": ap("ebitda")},
                "kpis": {
                    k: (
                        {
                            "value": d.num(ckpis[k]["value"]),
                            "status": ckpis[k]["calc_status"],
                            "reason": ckpis[k]["calc_reason"],
                        }
                        if k in ckpis
                        else _missing_kpi()
                    )
                    for k in d.KPI_KEYS
                },
                "status": _status(open_exc.get(c["id"], []), ckpis),
                "open_exceptions": len(open_exc.get(c["id"], [])),
                "open_actions": open_act.get(c["id"], 0),
                "last_data_update": d.iso(imported[-1] if imported else c["updated_at"]),
            }
        )

    q = (search or "").strip().lower()
    return [
        r
        for r in rows
        if (not sector or r["sector"] == sector)
        and (not status or r["status"] == status)
        and (not attention or r["status"] in ("warning", "exception"))
        and (not q or q in r["name"].lower())
    ]


def company_detail(conn: Connection, company_id: str) -> dict:
    if not _one(conn, "select 1 from portfolio_companies where id = %s", [company_id]):
        raise not_found("Company", company_id)

    company_periods = [
        r["p"]
        for r in _rows(
            conn,
            """select distinct reporting_period as p from kpi_observations
               where company_id = %s and is_current order by 1""",
            [company_id],
        )
    ]
    period = company_periods[-1] if company_periods else (latest_period(conn) or "")
    company = next(r for r in company_rows(conn, period) if r["id"] == company_id)

    hist = _rows(
        conn,
        """select o.reporting_period as p,
                  max(o.actual_value) filter (where o.metric_key = 'revenue') as ra,
                  max(o.plan_value)   filter (where o.metric_key = 'revenue') as rp,
                  max(o.actual_value) filter (where o.metric_key = 'ebitda')  as ea,
                  max(o.plan_value)   filter (where o.metric_key = 'ebitda')  as ep,
                  (select value from kpi_results r where r.company_id = o.company_id
                     and r.reporting_period = o.reporting_period and r.kpi_key = 'ebitda_margin_actual_pct') as ma,
                  (select value from kpi_results r where r.company_id = o.company_id
                     and r.reporting_period = o.reporting_period and r.kpi_key = 'ebitda_margin_plan_pct') as mp
           from kpi_observations o
           where o.company_id = %s and o.is_current
           group by o.company_id, o.reporting_period order by o.reporting_period""",
        [company_id],
    )
    history = [
        {
            "period": h["p"],
            "period_label": d.period_label(h["p"]),
            "revenue": {"actual": d.num(h["ra"]), "plan": d.num(h["rp"])},
            "ebitda": {"actual": d.num(h["ea"]), "plan": d.num(h["ep"])},
            "margin_actual_pct": d.num(h["ma"]),
            "margin_plan_pct": d.num(h["mp"]),
        }
        for h in hist
    ]
    has = lambda m: any(h[m]["actual"] is not None or h[m]["plan"] is not None for h in history)  # noqa: E731
    metrics = [
        {"key": "revenue", "label": "Revenue", "unit": "currency",
         "description": "Reported revenue, actual vs plan (USD millions).", "has_data": has("revenue")},
        {"key": "ebitda", "label": "EBITDA", "unit": "currency",
         "description": "Reported EBITDA, actual vs plan (USD millions).", "has_data": has("ebitda")},
        {"key": "ebitda_margin", "label": "EBITDA margin", "unit": "pct",
         "description": "EBITDA / Revenue × 100, actual vs plan.",
         "has_data": any(h["margin_actual_pct"] is not None or h["margin_plan_pct"] is not None for h in history)},
    ]

    return {
        "company": company,
        "history": history,
        "metrics": metrics,
        "exceptions": list_exceptions(conn, company_id=company_id),
        "investigations": list_investigations(conn, company_id=company_id),
        "actions": list_actions(conn, company_id=company_id),
        "data_history": observations(conn, "o.company_id = %s", [company_id]),
    }


def overview(conn: Connection, period: str | None, **filters) -> dict:
    latest = latest_period(conn) or ""
    period = period or latest
    all_rows = company_rows(conn, period)
    rows = company_rows(conn, period, **filters)
    row_ids = {r["id"] for r in rows}
    open_exc = _rows(
        conn,
        """select company_id, severity from exceptions
           where reporting_period = %s and status <> 'resolved' and condition_active""",
        [period],
    )
    actions = list_actions(conn)
    return {
        "period": {"key": period, "label": d.period_label(period), "type": "month"},
        "cards": {
            "companies": len(all_rows),
            "requiring_attention": sum(r["status"] in ("exception", "warning") for r in all_rows),
            "open_high_exceptions": sum(e["severity"] == "high" for e in open_exc),
            "overdue_actions": sum(a["is_overdue"] for a in actions),
            "awaiting_verification": sum(a["status"] in ("completed", "outcome_verification") for a in actions),
        },
        "rows": rows,
        "sectors": sorted({r["sector"] for r in all_rows if r["sector"]}),
        "charts": {
            "revenue_by_company": [
                {"company_id": r["id"], "company_name": r["name"], **r["financials"]["revenue"]} for r in rows
            ],
            "ebitda_by_company": [
                {"company_id": r["id"], "company_name": r["name"], **r["financials"]["ebitda"]} for r in rows
            ],
            "status_distribution": [
                {"status": s, "count": sum(r["status"] == s for r in rows)} for s in COMPANY_STATUSES
            ],
            "exceptions_by_severity": [
                {"severity": s, "count": sum(e["severity"] == s and e["company_id"] in row_ids for e in open_exc)}
                for s in SEVERITIES
            ],
        },
        "freshness": {"latest_period": latest, "last_import_at": last_import_at(conn)},
    }


# ---------- Observations ----------


def observations(conn: Connection, where: str, params: list) -> list[dict]:
    rows = _rows(
        conn,
        f"""select o.*, j.file_name, j.imported_by, s.name as source_name, s.updated_at as source_updated_at
            from kpi_observations o
            join import_jobs j on j.id = o.import_job_id
            join data_sources s on s.id = j.source_id
            where {where}
            order by o.reporting_period desc, o.imported_at desc, o.metric_key""",
        params,
    )
    return [
        {
            "id": o["id"],
            "company_id": o["company_id"],
            "metric_key": o["metric_key"],
            "period": o["reporting_period"],
            "actual_value": d.num(o["actual_value"]),
            "plan_value": d.num(o["plan_value"]),
            "original_values": o["original_values"] or {},  # raw CSV strings (empty for seeded rows)
            "source_name": o["source_name"],
            "source_updated_at": d.iso(o["source_updated_at"]),
            "import_job_id": o["import_job_id"],
            "file_name": o["file_name"],
            "source_row": o["source_row"] or 0,
            "imported_at": d.iso(o["imported_at"]),
            "imported_by": o["imported_by"],
            "validation_status": o["validation_status"],
            "is_current": o["is_current"],
        }
        for o in rows
    ]


# ---------- Exceptions ----------

_EXCEPTION_SELECT = """
    select e.*, c.name as company_name, r.rule_key, r.label as rule_name, r.enabled as rule_enabled,
           r.threshold as rule_threshold, rc.version as rule_configuration_version,
           case when e.metric_key = 'ebitda_margin'
                then (select value from kpi_results k where k.company_id = e.company_id
                        and k.reporting_period = e.reporting_period and k.kpi_key = 'ebitda_margin_actual_pct')
                else o.actual_value end as actual_value,
           case when e.metric_key = 'ebitda_margin'
                then (select value from kpi_results k where k.company_id = e.company_id
                        and k.reporting_period = e.reporting_period and k.kpi_key = 'ebitda_margin_plan_pct')
                else o.plan_value end as plan_value
    from exceptions e
    join portfolio_companies c on c.id = e.company_id
    join rules r on r.id = e.rule_id
    join rule_configurations rc on rc.id = r.configuration_id
    left join kpi_observations o on o.id = e.observation_id
"""

_EXCEPTION_ORDER = """
    order by (e.status <> 'resolved' and e.condition_active) desc,
             case e.severity when 'high' then 3 when 'medium' then 2 else 1 end desc,
             e.created_at desc, e.id
"""


def _exception_summary(e: dict) -> dict:
    return {
        "id": e["id"],
        "company_id": e["company_id"],
        "company_name": e["company_name"],
        "period": e["reporting_period"],
        "metric_key": e["metric_key"],
        "kpi_key": e["kpi_key"],
        "metric_label": d.METRIC_LABELS[e["metric_key"]],
        "actual_value": d.num(e["actual_value"]),
        "plan_value": d.num(e["plan_value"]),
        "variance_pct": d.num(e["variance_value"]),
        "severity": e["severity"],
        "rule_key": e["rule_key"],
        "rule_label": d.rule_condition_label(e["kpi_key"], e["threshold"]),
        "threshold": d.num(e["threshold"]),
        "status": e["status"],
        "condition_active": e["condition_active"],
        "owner": e["owner"],
        "created_at": d.iso(e["created_at"]),
    }


def list_exceptions(conn: Connection, severity=None, company_id=None, metric_key=None, period=None,
                    status=None, owner=None) -> list[dict]:
    where, params = ["true"], []
    for col, val in (("e.severity", severity), ("e.company_id", company_id),
                     ("e.metric_key", metric_key), ("e.reporting_period", period)):
        if val:
            where.append(f"{col} = %s")
            params.append(val)
    if status == "not_resolved":
        where.append("e.status <> 'resolved'")
    elif status:
        where.append("e.status = %s")
        params.append(status)
    if owner and owner.strip():
        where.append("lower(coalesce(e.owner, '')) = lower(%s)")
        params.append(owner.strip())
    rows = _rows(conn, _EXCEPTION_SELECT + " where " + " and ".join(where) + _EXCEPTION_ORDER, params)
    return [_exception_summary(e) for e in rows]


def _get_exception_row(conn: Connection, exception_id: str) -> dict:
    e = _one(conn, _EXCEPTION_SELECT + " where e.id = %s", [exception_id])
    if not e:
        raise not_found("Exception", exception_id)
    return e


def _period_inputs(conn: Connection, company_id: str, period: str) -> dict:
    return _one(
        conn,
        """select max(actual_value) filter (where metric_key = 'revenue') as ra,
                  max(plan_value)   filter (where metric_key = 'revenue') as rp,
                  max(actual_value) filter (where metric_key = 'ebitda')  as ea,
                  max(plan_value)   filter (where metric_key = 'ebitda')  as ep
           from kpi_observations where company_id = %s and reporting_period = %s and is_current""",
        [company_id, period],
    ) or {"ra": None, "rp": None, "ea": None, "ep": None}


def _kpi_result(conn: Connection, e: dict) -> dict:
    sql = "select * from kpi_results where "
    if e["kpi_result_id"]:
        k = _one(conn, sql + "id = %s", [e["kpi_result_id"]])
    else:
        k = _one(conn, sql + "company_id = %s and reporting_period = %s and kpi_key = %s",
                 [e["company_id"], e["reporting_period"], e["kpi_key"]])
    return k or {"value": None, "calc_status": "not_calculable", "calc_reason": "No stored KPI result"}


def _history(conn: Connection, entity_type: str, entity_id: str) -> list[dict]:
    return [
        {"id": a["id"], "at": d.iso(a["created_at"]), "actor": a["actor"], "event": a["change"], "detail": a["detail"]}
        for a in _rows(
            conn,
            "select * from audit_events where entity_type = %s and entity_id = %s order by created_at, id",
            [entity_type, entity_id],
        )
    ]


def exception_detail(conn: Connection, exception_id: str) -> dict:
    e = _get_exception_row(conn, exception_id)
    k = _kpi_result(conn, e)
    inp = _period_inputs(conn, e["company_id"], e["reporting_period"])
    metrics = ["revenue", "ebitda"] if e["metric_key"] == "ebitda_margin" else [e["metric_key"]]
    related = observations(conn, "o.company_id = %s and o.metric_key = any(%s)", [e["company_id"], metrics])
    src = next((o for o in related if o["id"] == e["observation_id"]), None) or next(
        (o for o in related if o["period"] == e["reporting_period"] and o["is_current"]), None
    )
    return {
        **_exception_summary(e),
        "calculation": d.calculation_text(e["kpi_key"], inp["ra"], inp["rp"], inp["ea"], inp["ep"],
                                          k["value"], k["calc_status"], k["calc_reason"]),
        "source": {
            "source_name": src["source_name"] if src else "—",
            "source_updated_at": src["source_updated_at"] if src else "",
            "import_job_id": src["import_job_id"] if src else "—",
            "file_name": src["file_name"] if src else "—",
            "source_row": src["source_row"] if src else 0,
            "imported_at": src["imported_at"] if src else "",
        },
        "rule_configuration_version": e["rule_configuration_version"],
        "allowed_transitions": EXCEPTION_TRANSITIONS[e["status"]],
        "resolution_reason": e["resolution_reason"],
        "resolution_note": e["resolution_note"],
        "related_observations": related,
        "investigations": list_investigations(conn, exception_id=exception_id),
        "actions": list_actions(conn, exception_id=exception_id),
        "history": _history(conn, "exception", exception_id),
    }


def exception_trace(conn: Connection, exception_id: str) -> list[dict]:
    """rule → evaluation → KPI result → observation(s) → import job, all from stored rows."""
    e = _get_exception_row(conn, exception_id)
    k = _kpi_result(conn, e)
    inp = _period_inputs(conn, e["company_id"], e["reporting_period"])
    calc = d.calculation_text(e["kpi_key"], inp["ra"], inp["rp"], inp["ea"], inp["ep"],
                              k["value"], k["calc_status"], k["calc_reason"])
    f = lambda label, value: {"label": label, "value": value}  # noqa: E731
    value_text = d.kpi_value_text(e["kpi_key"], e["variance_value"])
    steps = [
        {"kind": "rule", "title": f"Rule {e['rule_key']}", "fields": [
            f("Rule", e["rule_name"]),
            f("Condition", f"{e['kpi_key']} ≤ {d.plain(e['threshold'])}"),
            f("Reads as", d.rule_condition_label(e["kpi_key"], e["threshold"])),
            f("Severity", e["severity"]),
            f("Rule configuration", f"v{e['rule_configuration_version']}"),
            f("Currently enabled", "Yes" if e["rule_enabled"] else "No"),
            f("Current threshold", d.plain(e["rule_threshold"])),
        ]},
        {"kind": "evaluation", "title": "Evaluation", "fields": [
            f("Evaluated at", d.iso(e["evaluated_at"])),
            f("Value", value_text),
            f("Test", f"{value_text} ≤ {d.plain(e['threshold'])} → "
                      + ("triggered" if e["condition_active"] else "not triggered (condition cleared)")),
            f("Condition active", "Yes" if e["condition_active"] else "No"),
            f("Exception status", e["status"]),
        ]},
        {"kind": "kpi", "title": f"KPI {d.KPI_DEFINITIONS[e['kpi_key']][0]} — {d.period_label(e['reporting_period'])}",
         "fields": [
            f("Formula", calc["formula"]),
            f("Substituted", calc["substituted"]),
            f("Result (display)", calc["result"]),
            f("Result (stored precision)", d.kpi_value_text(e["kpi_key"], k["value"])),
            f("Calculation status", k["calc_status"] + (f" — {k['calc_reason']}" if k["calc_reason"] else "")),
        ]},
    ]
    metrics = ["revenue", "ebitda"] if e["metric_key"] == "ebitda_margin" else [e["metric_key"]]
    obs = observations(
        conn,
        "o.company_id = %s and o.reporting_period = %s and o.metric_key = any(%s) and o.is_current",
        [e["company_id"], e["reporting_period"], metrics],
    )
    for o in obs:
        steps.append({"kind": "observation",
                      "title": f"Observation {o['id']} — {d.METRIC_LABELS[o['metric_key']]} {d.period_label(o['period'])}",
                      "fields": [
                          f("Actual", d.plain(o["actual_value"])),
                          f("Plan", d.plain(o["plan_value"])),
                          f("Validation", o["validation_status"]),
                          f("Current", "Yes" if o["is_current"] else "No (superseded)"),
                      ]})
    for o in {(o["import_job_id"], o["source_row"]): o for o in obs}.values():
        steps.append({"kind": "import", "title": f"Import {o['import_job_id']}", "fields": [
            f("File", o["file_name"]),
            f("Row", str(o["source_row"])),
            f("Imported at", o["imported_at"]),
            f("Imported by", o["imported_by"]),
            f("Source", o["source_name"]),
            f("Source updated at", o["source_updated_at"]),
        ]})
    return steps


# ---------- Investigations ----------

_INVESTIGATION_SELECT = """
    select i.*, e.company_id, e.metric_key, c.name as company_name
    from investigations i
    join exceptions e on e.id = i.exception_id
    join portfolio_companies c on c.id = e.company_id
"""


def _investigation_summary(i: dict) -> dict:
    return {
        "id": i["id"],
        "exception_id": i["exception_id"],
        "company_id": i["company_id"],
        "company_name": i["company_name"],
        "metric_label": d.METRIC_LABELS[i["metric_key"]],
        "mode": i["mode"],
        "status": i["status"],
        "review_status": i["review_status"],
        "created_at": d.iso(i["created_at"]),
    }


def list_investigations(conn: Connection, company_id=None, exception_id=None, review_status=None) -> list[dict]:
    where, params = ["true"], []
    for col, val in (("e.company_id", company_id), ("i.exception_id", exception_id),
                     ("i.review_status", review_status)):
        if val:
            where.append(f"{col} = %s")
            params.append(val)
    rows = _rows(conn, _INVESTIGATION_SELECT + " where " + " and ".join(where)
                 + " order by i.created_at desc, i.id desc", params)
    return [_investigation_summary(i) for i in rows]


def _as_list(v) -> list:
    return v if isinstance(v, list) else []


def _investigation_output(i: dict) -> dict | None:
    """Maps the stored JSON columns onto the output shape. Parts the schema does not store stay empty."""
    if i["status"] != "completed":
        return None
    strengths = [h.get("evidence_strength", "none") for h in _as_list(i["hypotheses"]) if isinstance(h, dict)]
    rank = ["none", "weak", "moderate", "strong"]
    return {
        "executive_summary": "",
        "confirmed_observations": [
            {"statement": s if isinstance(s, str) else str(s.get("statement", "")), "evidence_ids": []}
            for s in _as_list(i["findings"])
        ],
        "potential_explanations": [
            {"id": str(h.get("id", n)), "statement": h.get("statement", ""), "supporting_evidence_ids": [],
             "missing_evidence": [], "evidence_strength": h.get("evidence_strength", "none")}
            for n, h in enumerate(_as_list(i["hypotheses"])) if isinstance(h, dict)
        ],
        "missing_evidence": [
            {"type": m.get("type", ""), "why_needed": m.get("why_needed", ""), "explanations": []}
            for m in _as_list(i["missing_evidence"]) if isinstance(m, dict)
        ],
        "management_questions": [],
        "next_steps": [],
        "suggested_actions": [
            {"title": a.get("title", ""), "rationale": a.get("rationale", ""), "explanations": []}
            for a in _as_list(i["suggested_actions"]) if isinstance(a, dict)
        ],
        "overall_assessment": {
            "cause_determination": "undetermined",
            "evidence_strength": max(strengths, key=rank.index) if strengths else "none",
            "rationale": "No overall assessment is stored for this investigation.",
        },
        "data_limitations": [],
    }


def investigation_detail(conn: Connection, investigation_id: str) -> dict:
    i = _one(conn, _INVESTIGATION_SELECT + " where i.id = %s", [investigation_id])
    if not i:
        raise not_found("Investigation", investigation_id)
    meta = i["model_metadata"] if isinstance(i["model_metadata"], dict) else {}
    legacy_note = (
        [{"id": f"{i['id']}:notes", "at": d.iso(i["created_at"]), "author": "—", "text": i["analyst_notes"]}]
        if i["analyst_notes"] else []
    )
    return {
        **_investigation_summary(i),
        "evidence": _as_list(i["evidence"]),
        "output": i["output"] if i["output"] else _investigation_output(i),
        "edited_output": i["edited_output"],
        "analyst_notes": legacy_note + _as_list(i["notes"]),
        "error": i["error"],
        "model_metadata": (
            {"provider": meta.get("provider", "—"), "model": meta.get("model", "—"),
             "prompt_version": meta.get("prompt_version", "—")} if meta else None
        ),
        "reviewed_by": i["reviewed_by"],
        "reviewed_at": d.iso(i["reviewed_at"]) or None,
    }


# ---------- Actions ----------

_ACTION_SELECT = """
    select a.*, e.company_id, c.name as company_name,
           coalesce((select array_agg(im.verification_status) from impact_observations im
                     where im.action_id = a.id), '{}') as impact_statuses
    from actions a
    join exceptions e on e.id = a.exception_id
    join portfolio_companies c on c.id = e.company_id
"""


def _is_overdue(a: dict) -> bool:
    return a["due_date"] is not None and a["due_date"] < date.today() and a["status"] in OVERDUE_STATUSES


def _verification_status(statuses: list[str]) -> str:
    """Weakest impact status wins; 'none' when the action has no impact records."""
    for s in ("rejected", "unverified", "not_yet_measurable", "verified"):
        if s in statuses:
            return s
    return "none"


def _action_summary(a: dict) -> dict:
    return {
        "id": a["id"],
        "company_id": a["company_id"],
        "company_name": a["company_name"],
        "exception_id": a["exception_id"],
        "investigation_id": a["investigation_id"],
        "title": a["title"],
        "priority": a["priority"],
        "owner": a["owner"],
        "due_date": d.iso(a["due_date"]) or None,
        "status": a["status"],
        "is_overdue": _is_overdue(a),
        "verification_status": _verification_status(a["impact_statuses"]),
        "created_at": d.iso(a["created_at"]),
    }


def list_actions(conn: Connection, status=None, priority=None, owner=None, company_id=None,
                 overdue: bool | None = None, exception_id=None) -> list[dict]:
    where, params = ["true"], []
    if status == "awaiting_verification":
        where.append("a.status in ('completed', 'outcome_verification')")
    elif status:
        where.append("a.status = %s")
        params.append(status)
    for col, val in (("a.priority", priority), ("e.company_id", company_id), ("a.exception_id", exception_id)):
        if val:
            where.append(f"{col} = %s")
            params.append(val)
    if owner and owner.strip():
        where.append("lower(coalesce(a.owner, '')) = lower(%s)")
        params.append(owner.strip())
    rows = _rows(conn, _ACTION_SELECT + " where " + " and ".join(where) + " order by a.created_at desc, a.id desc",
                 params)
    out = [_action_summary(a) for a in rows]
    return out if overdue is None else [a for a in out if a["is_overdue"] == overdue]


def action_detail(conn: Connection, action_id: str) -> dict:
    a = _one(conn, _ACTION_SELECT + " where a.id = %s", [action_id])
    if not a:
        raise not_found("Action", action_id)
    legacy = (  # seeded actions store a single reference column
        [{"id": f"{a['id']}:evidence", "at": d.iso(a["updated_at"]), "kind": "document_ref",
          "description": a["evidence_reference"], "reference": a["evidence_reference"]}]
        if a["evidence_reference"] else []
    )
    evidence = legacy + list(a["evidence"] or [])
    return {
        **_action_summary(a),
        "description": a["description"] or "",
        "completion_notes": a["completion_notes"],
        "cancel_reason": a["cancel_reason"],
        "evidence": evidence,
        "notes": list(a["notes"] or []),
        "impacts": list_impacts(conn, action_id=action_id),
        "allowed_transitions": ACTION_TRANSITIONS[a["status"]],
        "history": _history(conn, "action", action_id),
        "updated_at": d.iso(a["updated_at"]),
    }


# ---------- Impact ----------


def list_impacts(conn: Connection, company_id=None, action_id=None, verification_status=None,
                 impact_id=None) -> list[dict]:
    where, params = ["true"], []
    for col, val in (("e.company_id", company_id), ("im.action_id", action_id), ("im.id", impact_id),
                     ("im.verification_status", verification_status)):
        if val:
            where.append(f"{col} = %s")
            params.append(val)
    rows = _rows(
        conn,
        """select im.*, a.title as action_title, e.company_id, c.name as company_name
           from impact_observations im
           join actions a on a.id = im.action_id
           join exceptions e on e.id = a.exception_id
           join portfolio_companies c on c.id = e.company_id
           where """ + " and ".join(where) + " order by im.created_at desc, im.id desc",
        params,
    )
    return [
        {
            "id": i["id"],
            "company_id": i["company_id"],
            "company_name": i["company_name"],
            "action_id": i["action_id"],
            "action_title": i["action_title"],
            "metric_key": i["metric_key"],
            "metric_label": d.METRIC_LABELS[i["metric_key"]],
            "unit": "pct" if i["metric_key"] == "ebitda_margin" else "currency",
            "baseline_value": d.num(i["baseline_value"]),
            "baseline_period": i["baseline_period"],
            "target_value": d.num(i["target_value"]),
            "target_period": i["target_period"],
            "estimated_value": d.num(i["estimated_value"]),
            "observed_value": d.num(i["observed_value"]),
            "observation_period": i["observation_period"],
            "measurement_source": i["measurement_source"],
            "verification_status": i["verification_status"],
            "reviewer": i["reviewer"],
            "verification_rationale": i["verification_rationale"],
            "evidence_reference": i["evidence_reference"],
            "notes": i["notes"] or "",
            "history": _history(conn, "impact", i["id"]),
        }
        for i in rows
    ]
