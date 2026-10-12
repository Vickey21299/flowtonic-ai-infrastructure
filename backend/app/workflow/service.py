"""Workflow writes: exception status (spec §8), actions (§10), impact (§11), rule thresholds (§17).

Same rules as the frontend demo (src/demo/*.demo.ts). Every change writes an audit_events row.
"""

import json
import re
import uuid
from datetime import datetime, timezone

from psycopg import Connection

from .. import display as d
from .. import repository as repo
from ..errors import ApiError, not_found
from ..imports.service import ID_LOCK, _evaluate_exceptions, _next_id, _refresh_company_status
from ..logs import info, step

RESOLUTION_REASONS = ("action_verified", "data_corrected", "condition_cleared", "not_material", "other")
PRIORITIES = ("high", "medium", "low")
TERMINAL = ("verified", "cancelled")
COMMITTED = ("approved", "in_progress", "completed", "outcome_verification", "reopened")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
PERIOD_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
MEASUREMENT_FIELDS = ("observed_value", "observation_period", "measurement_source", "evidence_reference")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _fail(errors: list[dict]) -> None:
    if errors:
        raise ApiError(422, "validation_error", errors[0]["message"], {"fieldErrors": errors})


def _audit(conn: Connection, entity_type: str, entity_id: str, change: str, actor: str,
           detail: str | None = None) -> None:
    conn.execute("insert into audit_events (entity_type, entity_id, change, detail, actor) values (%s,%s,%s,%s,%s)",
                 [entity_type, entity_id, change, detail, actor])


def _show(v) -> str:
    return "—" if v is None or v == "" else str(v)


def _invalid_transition(kind: str, frm: str, to: str, allowed: list[str]) -> ApiError:
    return ApiError(409, "invalid_transition", f"An {kind} cannot move from {frm} to {to}.",
                    {"allowedTransitions": allowed})


# ---------- Exceptions ----------


def transition_exception(conn: Connection, exc_id: str, to: str, owner: str | None, reason: str | None,
                         note: str | None, actor: str) -> dict:
    with step("workflow", 1, 1, f"exception {exc_id} → {to}") as r:
        with conn.transaction():
            e = conn.execute("select * from exceptions where id = %s for update", [exc_id]).fetchone()
            if not e:
                raise not_found("Exception", exc_id)
            frm = e["status"]
            allowed = repo.EXCEPTION_TRANSITIONS[frm]
            if to not in allowed:
                raise _invalid_transition("exception", frm, to, allowed)
            owner = (owner or "").strip() or None
            note = (note or "").strip() or None
            errors = []
            if to == "in_review" and not owner and not e["owner"]:
                errors.append({"field": "owner", "message": "Assign an owner to put the exception in review."})
            if to == "resolved":
                if not reason:
                    errors.append({"field": "reason", "message": "A resolution reason is required."})
                elif reason not in RESOLUTION_REASONS:
                    errors.append({"field": "reason", "message": f'Unknown resolution reason "{reason}".'})
            _fail(errors)

            if owner and owner != e["owner"]:
                conn.execute("update exceptions set owner = %s where id = %s", [owner, exc_id])
                _audit(conn, "exception", exc_id, f"Owner assigned: {_show(e['owner'])} → {owner}", actor)
            if to == "resolved":
                conn.execute("""update exceptions set status = 'resolved', resolved_at = now(), resolution_reason = %s,
                                    resolution_note = %s where id = %s""", [reason, note, exc_id])
            else:
                conn.execute("""update exceptions set status = %s, resolved_at = null, resolution_reason = null,
                                    resolution_note = null where id = %s""", [to, exc_id])
            detail = ". ".join(x for x in (f"Reason: {reason}" if to == "resolved" else None,
                                           f"Note: {note}" if note else None) if x) or None
            _audit(conn, "exception", exc_id, f"Status changed: {frm} → {to}", actor, detail)
            if to == "resolved" or frm == "resolved":
                _refresh_company_status(conn, _now())
        r["out"] = f"{frm} → {to}"
    return repo.exception_detail(conn, exc_id)


# ---------- Actions ----------


def _load_action(conn: Connection, action_id: str) -> dict:
    a = conn.execute("select * from actions where id = %s for update", [action_id]).fetchone()
    if not a:
        raise not_found("Action", action_id)
    return a


def _check_action_fields(patch: dict, errors: list[dict]) -> None:
    if "title" in patch and patch["title"] is not None and not patch["title"].strip():
        errors.append({"field": "title", "message": "A title is required."})
    if patch.get("priority") is not None and patch["priority"] not in PRIORITIES:
        errors.append({"field": "priority", "message": "Priority must be high, medium or low."})
    if patch.get("due_date") and not DATE_RE.match(patch["due_date"]):
        errors.append({"field": "dueDate", "message": "Use a date in YYYY-MM-DD format."})


def create_action(conn: Connection, data: dict, actor: str) -> dict:
    with step("workflow", 1, 1, f"creating an action for {data['exception_id']}") as r:
        with conn.transaction():
            errors = []
            e = conn.execute("select id from exceptions where id = %s", [data["exception_id"]]).fetchone()
            if not e:
                errors.append({"field": "exceptionId", "message": "Select the exception this action addresses."})
            inv_id = data.get("investigation_id")
            if inv_id:
                inv = conn.execute("select exception_id from investigations where id = %s", [inv_id]).fetchone()
                if not inv:
                    errors.append({"field": "investigationId", "message": f'Investigation "{inv_id}" was not found.'})
                elif inv["exception_id"] != data["exception_id"]:
                    errors.append({"field": "investigationId",
                                   "message": "The investigation belongs to a different exception."})
            if not (data.get("title") or "").strip():
                errors.append({"field": "title", "message": "A title is required."})
            _check_action_fields({"priority": data.get("priority"), "due_date": data.get("due_date")}, errors)
            _fail(errors)

            conn.execute("select pg_advisory_xact_lock(%s)", [ID_LOCK])
            action_id = _next_id(conn, "actions", "ACT")
            conn.execute(
                """insert into actions (id, exception_id, investigation_id, title, description, priority, owner,
                       due_date, status) values (%s, %s, %s, %s, %s, %s, %s, %s, 'proposed')""",
                [action_id, data["exception_id"], inv_id or None, data["title"].strip(),
                 (data.get("description") or "").strip(), data["priority"],
                 (data.get("owner") or "").strip() or None, data.get("due_date") or None])
            _audit(conn, "action", action_id, "Action created with status proposed", actor,
                   f"From investigation {inv_id}" if inv_id else "Created manually")
            _audit(conn, "exception", data["exception_id"], f"Action {action_id} proposed: {data['title'].strip()}",
                   actor)
        r["out"] = f"{action_id} status=proposed"
    return repo.action_detail(conn, action_id)


def update_action(conn: Connection, action_id: str, patch: dict, actor: str) -> dict:
    labels = {"title": "Title", "description": "Description", "priority": "Priority", "owner": "Owner",
              "due_date": "Due date"}
    with step("workflow", 1, 1, f"editing {action_id} ({', '.join(patch) or 'no fields'})") as r:
        with conn.transaction():
            a = _load_action(conn, action_id)
            if a["status"] in TERMINAL:
                raise ApiError(409, "conflict", f"A {a['status']} action can no longer be edited.")
            errors = []
            _check_action_fields(patch, errors)
            if a["status"] in COMMITTED:
                state = a["status"].replace("_", " ")
                if "owner" in patch and not (patch["owner"] or "").strip():
                    errors.append({"field": "owner", "message": f"An {state} action must keep an owner."})
                if "due_date" in patch and not patch["due_date"]:
                    errors.append({"field": "dueDate", "message": f"An {state} action must keep a due date."})
            _fail(errors)

            changed = []
            for key, label in labels.items():
                if key not in patch:
                    continue
                new = patch[key].strip() if isinstance(patch[key], str) else patch[key]
                if key in ("owner", "due_date") and new == "":
                    new = None
                prev = d.iso(a[key]) or None if key == "due_date" else a[key]
                if new == prev:
                    continue
                conn.execute(f"update actions set {key} = %s, updated_at = now() where id = %s", [new, action_id])
                _audit(conn, "action", action_id, "Description edited" if key == "description"
                       else f"{label} changed: {_show(prev)} → {_show(new)}", actor)
                changed.append(key)
        r["out"] = f"changed: {', '.join(changed) or 'nothing'}"
    return repo.action_detail(conn, action_id)


def transition_action(conn: Connection, action_id: str, to: str, completion_notes: str | None,
                      reason: str | None, actor: str) -> dict:
    with step("workflow", 1, 1, f"action {action_id} → {to}") as r:
        with conn.transaction():
            a = _load_action(conn, action_id)
            frm = a["status"]
            allowed = repo.ACTION_TRANSITIONS[frm]
            if to not in allowed:
                raise _invalid_transition("action", frm, to, allowed)
            impacts = [i["verification_status"] for i in conn.execute(
                "select verification_status from impact_observations where action_id = %s", [action_id]).fetchall()]
            reason = (reason or "").strip() or None
            notes = (completion_notes or "").strip() or a["completion_notes"]
            has_evidence = bool(a["evidence"]) or bool(a["evidence_reference"])
            errors = []
            if to == "approved":
                if not a["owner"]:
                    errors.append({"field": "owner", "message": "Assign an owner before approving."})
                if not a["due_date"]:
                    errors.append({"field": "dueDate", "message": "Set a due date before approving."})
            elif to == "completed":
                if not notes:
                    errors.append({"field": "completionNotes", "message": "Completion notes are required."})
                if not has_evidence:
                    errors.append({"field": "evidence",
                                   "message": "Record at least one evidence item before completing."})
            elif to == "outcome_verification" and not impacts:
                errors.append({"field": "impacts", "message": "Add at least one impact record before outcome verification."})
            elif to == "verified" and "verified" not in impacts:
                errors.append({"field": "impacts", "message": "At least one impact record must be verified first."})
            elif to in ("cancelled", "reopened") and not reason:
                errors.append({"field": "reason", "message": f"A reason is required to mark the action {to}."})
            _fail(errors)

            conn.execute(
                """update actions set status = %s, updated_at = now(),
                          completion_notes = case when %s = 'completed' then %s else completion_notes end,
                          cancel_reason = case when %s = 'cancelled' then %s else cancel_reason end
                   where id = %s""", [to, to, notes, to, reason, action_id])
            detail = f"Completion notes: {notes}" if to == "completed" else f"Reason: {reason}" if reason else None
            _audit(conn, "action", action_id, f"Status changed: {frm} → {to}", actor, detail)
        r["out"] = f"{frm} → {to}"
    return repo.action_detail(conn, action_id)


def add_action_note(conn: Connection, action_id: str, text: str, actor: str) -> dict:
    t = text.strip()
    _fail([] if t else [{"field": "text", "message": "The note cannot be empty."}])
    with step("workflow", 1, 1, f"adding a progress note to {action_id}"):
        with conn.transaction():
            _load_action(conn, action_id)
            note = {"id": f"NOTE-{uuid.uuid4().hex[:8]}", "at": d.iso(_now()), "author": actor, "text": t}
            conn.execute("update actions set notes = notes || %s::jsonb, updated_at = now() where id = %s",
                         [json.dumps([note]), action_id])
            _audit(conn, "action", action_id, "Progress note added", actor)
    return repo.action_detail(conn, action_id)


def add_action_evidence(conn: Connection, action_id: str, kind: str, description: str,
                        reference: str | None, actor: str) -> dict:
    description, reference = (description or "").strip(), (reference or "").strip()
    errors = []
    if kind not in ("note", "document_ref", "link"):
        errors.append({"field": "kind", "message": "Unknown evidence type."})
    if not description:
        errors.append({"field": "description", "message": "Describe the evidence."})
    if kind != "note" and not reference:
        errors.append({"field": "reference", "message": "A reference is required for documents and links."})
    _fail(errors)
    with step("workflow", 1, 1, f"recording evidence on {action_id} ({kind})"):
        with conn.transaction():
            _load_action(conn, action_id)
            item = {"id": f"EVD-{uuid.uuid4().hex[:8]}", "at": d.iso(_now()), "kind": kind, "description": description}
            if reference:
                item["reference"] = reference
            conn.execute("update actions set evidence = evidence || %s::jsonb, updated_at = now() where id = %s",
                         [json.dumps([item]), action_id])
            _audit(conn, "action", action_id, f"Evidence recorded: {description}", actor)
    return repo.action_detail(conn, action_id)


# ---------- Impact ----------


def _check_number(field: str, v, errors: list[dict]) -> None:
    if v is not None and not isinstance(v, (int, float)):
        errors.append({"field": field, "message": "Enter a number or leave it empty."})


def _check_period(field: str, v, required: bool, errors: list[dict]) -> None:
    if v in (None, ""):
        if required:
            errors.append({"field": field, "message": "A period (YYYY-MM) is required."})
    elif not isinstance(v, str) or not PERIOD_RE.match(v):
        errors.append({"field": field, "message": "Use the YYYY-MM format, e.g. 2026-12."})


def _impact(conn: Connection, impact_id: str) -> dict:
    rows = repo.list_impacts(conn, impact_id=impact_id)
    if not rows:
        raise not_found("Impact record", impact_id)
    return rows[0]


def create_impact(conn: Connection, data: dict, actor: str) -> dict:
    with step("workflow", 1, 1, f"adding an impact record to {data['action_id']}") as r:
        with conn.transaction():
            errors = []
            a = conn.execute("select id, status from actions where id = %s", [data["action_id"]]).fetchone()
            if not a:
                errors.append({"field": "actionId", "message": "Select the related action."})
            elif a["status"] == "cancelled":
                errors.append({"field": "actionId", "message": "A cancelled action cannot get impact records."})
            if data["metric_key"] not in d.METRIC_LABELS:
                errors.append({"field": "metricKey", "message": "Select a metric."})
            _check_period("baselinePeriod", data.get("baseline_period"), True, errors)
            _check_period("targetPeriod", data.get("target_period"), True, errors)
            _fail(errors)

            conn.execute("select pg_advisory_xact_lock(%s)", [ID_LOCK])
            imp_id = _next_id(conn, "impact_observations", "IMP")
            conn.execute(
                """insert into impact_observations (id, action_id, metric_key, baseline_value, baseline_period,
                       target_value, target_period, estimated_value, notes, verification_status, updated_at)
                   values (%s, %s, %s, %s, %s, %s, %s, %s, %s, 'not_yet_measurable', now())""",
                [imp_id, data["action_id"], data["metric_key"], data.get("baseline_value"), data["baseline_period"],
                 data.get("target_value"), data["target_period"], data.get("estimated_value"),
                 (data.get("notes") or "").strip()])
            _audit(conn, "impact", imp_id, "Impact record created — not yet measurable", actor)
            _audit(conn, "action", data["action_id"],
                   f"Impact record {imp_id} added ({d.METRIC_LABELS[data['metric_key']]})", actor)
        r["out"] = f"{imp_id} status=not_yet_measurable"
    return _impact(conn, imp_id)


def update_impact(conn: Connection, impact_id: str, patch: dict, actor: str) -> dict:
    errors = []
    for f in ("target_value", "estimated_value", "observed_value"):
        _check_number(f, patch.get(f), errors)
    if "target_period" in patch:
        _check_period("targetPeriod", patch["target_period"], True, errors)
    _check_period("observationPeriod", patch.get("observation_period"), False, errors)
    _fail(errors)
    with step("workflow", 1, 1, f"editing impact {impact_id} ({', '.join(patch) or 'no fields'})") as r:
        with conn.transaction():
            row = conn.execute("select * from impact_observations where id = %s for update", [impact_id]).fetchone()
            if not row:
                raise not_found("Impact record", impact_id)
            measurement_changed = False
            current = {k: (d.num(v) if k.endswith("_value") else v) for k, v in row.items()}
            for key, new in patch.items():
                if isinstance(new, str):
                    new = new.strip()
                if new == "" and key != "notes":
                    new = None
                if new == current[key]:
                    continue
                conn.execute(f"update impact_observations set {key} = %s, updated_at = now() where id = %s",
                             [new, impact_id])
                _audit(conn, "impact", impact_id, "Notes edited" if key == "notes"
                       else f"{key} changed: {_show(current[key])} → {_show(new)}", actor)
                current[key] = new
                measurement_changed |= key in MEASUREMENT_FIELDS

            prev = row["verification_status"]
            nxt = prev
            if current["observed_value"] is None:
                nxt = "not_yet_measurable"
            elif prev == "not_yet_measurable":
                nxt = "unverified"
            elif measurement_changed and prev in ("verified", "rejected"):
                nxt = "unverified"
            if nxt != prev:
                clear = prev in ("verified", "rejected")
                conn.execute(f"""update impact_observations set verification_status = %s
                                 {", reviewer = null, verification_rationale = null" if clear else ""}
                                 where id = %s""", [nxt, impact_id])
                _audit(conn, "impact", impact_id, f"Verification status: {prev} → {nxt}", actor,
                       "No observed value recorded." if nxt == "not_yet_measurable"
                       else "The measurement changed and must be reviewed again.")
        r["out"] = f"verification {prev} → {nxt}"
    return _impact(conn, impact_id)


def verify_impact(conn: Connection, impact_id: str, decision: str, reviewer: str, rationale: str,
                  evidence_reference: str | None, actor: str) -> dict:
    with step("workflow", 1, 1, f"impact {impact_id} → {decision}") as r:
        with conn.transaction():
            row = conn.execute("select * from impact_observations where id = %s for update", [impact_id]).fetchone()
            if not row:
                raise not_found("Impact record", impact_id)
            reviewer, rationale = (reviewer or "").strip(), (rationale or "").strip()
            evidence = (evidence_reference or "").strip() or row["evidence_reference"]
            errors = []
            if decision == "verified":
                if row["observed_value"] is None:
                    errors.append({"field": "observedValue", "message": "Record the observed value first."})
                if not row["observation_period"]:
                    errors.append({"field": "observationPeriod", "message": "Record the observation period first."})
                if not row["measurement_source"]:
                    errors.append({"field": "measurementSource", "message": "Record the measurement source first."})
                if not evidence:
                    errors.append({"field": "evidenceReference",
                                   "message": "An evidence reference is required to verify."})
            if not reviewer:
                errors.append({"field": "reviewer", "message": "A reviewer is required."})
            if not rationale:
                errors.append({"field": "rationale", "message": "A rationale is required."})
            _fail(errors)

            conn.execute("""update impact_observations set verification_status = %s, reviewer = %s,
                                verification_rationale = %s, evidence_reference = %s, updated_at = now()
                            where id = %s""", [decision, reviewer, rationale, evidence, impact_id])
            _audit(conn, "impact", impact_id, f"Verification status: {row['verification_status']} → {decision}",
                   reviewer, f"Rationale: {rationale}" + (f". Evidence: {evidence}" if evidence else ""))
            _audit(conn, "action", row["action_id"], f"Impact record {impact_id} {decision}", actor)
            conn.execute("update actions set updated_at = now() where id = %s", [row["action_id"]])
        r["out"] = f"{row['verification_status']} → {decision} by {reviewer}"
    return _impact(conn, impact_id)


# ---------- Settings (rule thresholds) ----------


def get_settings(conn: Connection, settings, ai_mode: str) -> dict:
    cfg = conn.execute("select * from rule_configurations where is_active").fetchone()
    rules = conn.execute("select * from rules where configuration_id = %s order by id", [cfg["id"]]).fetchall()
    return {
        "environment": "production" if settings.app_profile == "production" else "demo",
        "rule_configuration": {
            "version": cfg["version"],
            "activated_at": d.iso(cfg["activated_at"]),
            "rules": [{"id": r["id"], "key": r["rule_key"], "label": r["label"], "kpi_key": r["kpi_key"],
                       "comparator": r["comparator"], "threshold": d.num(r["threshold"]), "severity": r["severity"],
                       "enabled": r["enabled"]} for r in rules],
        },
        "ai_mode": ai_mode,
        "live_ai_available": bool(settings.gemini_api_key),
    }


def update_rules(conn: Connection, updates: list[dict], actor: str) -> int | None:
    """Applies threshold/enabled changes as a new configuration version and re-evaluates every stored
    company-period with the same function the import uses. Returns the new version, or None if unchanged."""
    with conn.transaction():
        cfg = conn.execute("select * from rule_configurations where is_active for update").fetchone()
        rules = {r["id"]: r for r in conn.execute(
            "select * from rules where configuration_id = %s for update", [cfg["id"]]).fetchall()}
        errors = []
        for n, u in enumerate(updates):
            if u["id"] not in rules:
                errors.append({"field": f"rules.{n}.id", "message": f'Unknown rule "{u["id"]}".'})
            elif not -100 <= u["threshold"] <= 100:
                errors.append({"field": f"rules.{n}.threshold", "message": "The threshold must be between −100 and 100."})
        _fail(errors)

        changes = []
        for u in updates:
            old = rules[u["id"]]
            if d.num(old["threshold"]) != u["threshold"] or old["enabled"] != u["enabled"]:
                changes.append(f"{old['rule_key']}: {d.plain(old['threshold'])}% {'on' if old['enabled'] else 'off'}"
                               f" → {d.plain(u['threshold'])}% {'on' if u['enabled'] else 'off'}")
                conn.execute("update rules set threshold = %s, enabled = %s where id = %s",
                             [u["threshold"], u["enabled"], u["id"]])
        if not changes:
            info("settings", "no rule changes")
            return None

        version = cfg["version"] + 1
        at = _now()
        conn.execute("update rule_configurations set version = %s, activated_at = %s where id = %s",
                     [version, at, cfg["id"]])
        _audit(conn, "rule_configuration", cfg["id"], f"Rule configuration v{cfg['version']} → v{version}", actor,
               "; ".join(changes))
        info("settings", "rules changed: %s", "; ".join(changes))

        with step("settings", 1, 2, "re-evaluating exceptions for every stored company-period") as r:
            touched = {(k["company_id"], k["reporting_period"]) for k in conn.execute(
                "select distinct company_id, reporting_period from kpi_results").fetchall()}
            ev = _evaluate_exceptions(conn, touched, at, f"rule configuration change to v{version}", "settings")
            r["out"] = (f"{len(touched)} company-periods: created {ev['created']}, updated {ev['updated']} "
                        f"(condition cleared {ev['cleared']})")
        with step("settings", 2, 2, "refreshing stored company status"):
            _refresh_company_status(conn, at)
    return version
