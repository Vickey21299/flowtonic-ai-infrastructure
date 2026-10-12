"""CSV import workflow: upload → map/validate → confirm (one transaction) or cancel.

Confirm, in ONE transaction (all or nothing):
  1. save new/changed observations (changed values supersede the old row; nothing is overwritten)
  2. record invalid rows in import_row_errors
  3. recalculate KPI results for the affected company-periods with the database function calc_kpis()
  4. evaluate the active rules → create / update exceptions (business rules of the frontend demo engine)
  5. refresh stored company status, write audit history, mark the job committed

Concurrency: confirms are serialised with a transaction-level advisory lock and the job row is
locked FOR UPDATE. Re-confirming a committed job returns it unchanged (idempotent retries).
"""

from datetime import datetime, timedelta, timezone
from decimal import Decimal

from psycopg import Connection
from psycopg.types.json import Jsonb

from .. import display as d
from ..errors import ApiError
from ..logs import info, step
from .parser import auto_map, file_hash, parse_csv
from .schema import IMPORT_SCHEMA, METRIC_COLUMNS
from .validation import Row, mapping_errors, validate_rows

IMPORT_LOCK = 4_211_001  # pg_advisory_xact_lock key: one import confirm at a time
ID_LOCK = 4_211_002  # sequential JOB-/EXC- ids
SYSTEM_ACTOR = "System (rules engine)"
OPEN_JOB_STATUSES = ("uploaded", "validated")
KPI_METRIC = {
    "revenue_variance": "revenue", "revenue_variance_pct": "revenue",
    "ebitda_variance": "ebitda", "ebitda_variance_pct": "ebitda",
    "ebitda_margin_actual_pct": "ebitda_margin", "ebitda_margin_plan_pct": "ebitda_margin",
    "ebitda_margin_variance_pp": "ebitda_margin",
}


def conflict(message: str) -> ApiError:
    return ApiError(409, "conflict", message)


def invalid(field: str, message: str, more: list[dict] | None = None) -> ApiError:
    errors = more or [{"field": field, "message": message}]
    return ApiError(422, "validation_error", message, {"fieldErrors": errors})


# ---------- Helpers ----------


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _next_id(conn: Connection, table: str, prefix: str) -> str:
    n = conn.execute(
        f"select coalesce(max(substring(id from '^{prefix}-(\\d+)$')::int), 0) + 1 as n from {table}"
    ).fetchone()["n"]
    return f"{prefix}-{n:04d}"


def _view(job: dict) -> dict:
    return {
        "id": job["id"],
        "fileName": job["file_name"],
        "status": job["status"],
        "createdAt": d.iso(job["created_at"]),
        "detectedColumns": job["detected_columns"],
        "schema": IMPORT_SCHEMA,
        "mapping": job["mapping"],
        "rows": job["rows"],
        "fileErrors": job["file_errors"],
        "summary": job["summary"],
    }


def _load(conn: Connection, job_id: str, for_update: bool = False) -> dict:
    job = conn.execute(
        "select * from import_jobs where id = %s" + (" for update" if for_update else ""), [job_id]
    ).fetchone()
    if not job:
        raise ApiError(404, "not_found", f'Import job "{job_id}" was not found.')
    if job["status"] in OPEN_JOB_STATUSES and job["expires_at"] and job["expires_at"] < _now():
        raise ApiError(404, "not_found", f"Import {job_id} has expired. Start a new import.")
    return job


def _companies(conn: Connection) -> dict[str, str]:
    return {r["id"]: r["name"] for r in conn.execute("select id, name from portfolio_companies").fetchall()}


def _current(conn: Connection) -> dict[tuple[str, str, str], tuple[Decimal | None, Decimal | None]]:
    rows = conn.execute(
        "select company_id, reporting_period, metric_key, actual_value, plan_value from kpi_observations where is_current"
    ).fetchall()
    return {(r["company_id"], r["reporting_period"], r["metric_key"]): (r["actual_value"], r["plan_value"]) for r in rows}


def _validate(conn: Connection, job: dict, mapping: dict) -> list[Row]:
    parsed = parse_csv(job["raw_content"] or "")
    return validate_rows(parsed.header, parsed.records, mapping, _companies(conn), _current(conn))


def _log_rows(action: str, rows: list[Row]) -> None:
    counts = {c: sum(r.classification == c for r in rows) for c in ("new", "changed", "unchanged", "invalid")}
    info(action, "rows: %d read → new %d, changed %d, unchanged %d, invalid %d",
         len(rows), counts["new"], counts["changed"], counts["unchanged"], counts["invalid"])
    for r in rows:
        for i in r.issues:
            info(action, "  row %-3d %-7s %-18s %s", r.row_number, i["severity"], i["field"], i["message"])


def _committed_duplicate(conn: Connection, digest: str, exclude_id: str | None = None) -> dict | None:
    return conn.execute(
        "select id, committed_at from import_jobs where file_hash = %s and status = 'committed' and id <> %s",
        [digest, exclude_id or ""],
    ).fetchone()


def _duplicate_message(dup: dict) -> str:
    return (f"This file was already imported as {dup['id']} on {d.iso(dup['committed_at'])[:10]}. "
            "Importing it again would not change anything; to correct values, upload a file with the new values.")


# ---------- Upload / mapping / get / cancel ----------


def upload(conn: Connection, settings, name: str, text: str, actor: str) -> dict:
    info("upload", 'file "%s" (%.1f KB) from %s', name, len(text.encode("utf-8")) / 1024, actor)
    if len(text.encode("utf-8")) > settings.import_max_bytes:
        raise ApiError(413, "payload_too_large",
                       f"The file is larger than {settings.import_max_bytes // (1024 * 1024)} MB.")
    name = (name or "").strip() or "upload.csv"
    with step("upload", 1, 3, "parsing CSV") as out:
        parsed = parse_csv(text)
        out["out"] = f"{len(parsed.header)} columns, {len(parsed.records)} data rows" + (
            f", parse error: {parsed.error}" if parsed.error else "")
    if len(parsed.records) > settings.import_max_rows:
        raise ApiError(413, "payload_too_large", f"The file has more than {settings.import_max_rows} data rows.")

    errors: list[str] = []
    if not name.lower().endswith(".csv"):
        errors.append(f'"{name}" is not a .csv file.')
    if parsed.error:
        errors.append(parsed.error)
    elif not parsed.header:
        errors.append("The file is empty.")
    elif not parsed.records:
        errors.append("The file has a header row but no data rows.")
    dupes = sorted({h for h in parsed.header if h and parsed.header.count(h) > 1})
    if dupes:
        errors.append(f"Duplicate column names: {', '.join(dupes)}.")
    with step("upload", 2, 3, "checking file and earlier imports of the same file (sha256)") as out:
        digest = file_hash(text)
        dup = _committed_duplicate(conn, digest)
        if dup:
            errors.append(_duplicate_message(dup))
        out["out"] = f"hash {digest[:12]}…, " + (f"{len(errors)} file error(s)" if errors else "no file errors")
    for e in errors:
        info("upload", "  file error: %s", e)

    with step("upload", 3, 3, "saving import session") as out:
        with conn.transaction():
            conn.execute("select pg_advisory_xact_lock(%s)", [ID_LOCK])
            job_id = _next_id(conn, "import_jobs", "JOB")
            job = conn.execute(
                """insert into import_jobs (id, file_name, file_hash, status, rows_total, imported_by, created_by,
                                            raw_content, detected_columns, mapping, file_errors, rows, expires_at)
                   values (%s, %s, %s, 'uploaded', %s, %s, %s, %s, %s, %s, %s, '[]', %s)
                   returning *""",
                [job_id, name, digest, len(parsed.records), actor, actor, text, Jsonb(parsed.header),
                 Jsonb(auto_map(parsed.header)), Jsonb(errors),
                 _now() + timedelta(hours=settings.import_session_hours)],
            ).fetchone()
        mapped = sum(1 for v in job["mapping"].values() if v)
        out["out"] = f"{job_id} status=uploaded, auto-mapped {mapped}/{len(job['mapping'])} fields"
    for f in IMPORT_SCHEMA:
        col = job["mapping"].get(f["field"])
        info("upload", "  map %-18s ← %s", f["field"], f'"{col}"' if col else "(no matching column)")
    return _view(job)


def set_mapping(conn: Connection, job_id: str, mapping: dict) -> dict:
    with conn.transaction():
        with step("mapping", 1, 3, f"loading {job_id}") as out:
            job = _load(conn, job_id, for_update=True)
            out["out"] = f"status={job['status']}, file={job['file_name']}"
        if job["status"] not in OPEN_JOB_STATUSES:
            raise conflict(f"Import {job_id} is {job['status']}; the mapping can no longer change.")
        with step("mapping", 2, 3, "checking mapping, validating every row against stored data") as out:
            clean, map_errors = mapping_errors(job["detected_columns"], mapping)
            file_errors = [e for e in job["file_errors"] if not e.startswith("Mapping: ")] + map_errors
            rows = _validate(conn, job, clean)
            out["out"] = f"{len(map_errors)} mapping error(s), {len(rows)} rows validated"
        for e in file_errors:
            info("mapping", "  file error: %s", e)
        _log_rows("mapping", rows)
        with step("mapping", 3, 3, "saving validated preview") as out:
            job = conn.execute(
                """update import_jobs set mapping = %s, file_errors = %s, rows = %s, status = 'validated',
                          updated_at = now() where id = %s returning *""",
                [Jsonb(clean), Jsonb(file_errors), Jsonb([r.view() for r in rows]), job_id],
            ).fetchone()
            out["out"] = f"{job_id} status=validated"
    return _view(job)


def get(conn: Connection, job_id: str) -> dict:
    job = _load(conn, job_id)
    info("resume", "%s status=%s, file=%s", job_id, job["status"], job["file_name"])
    return _view(job)


def cancel(conn: Connection, job_id: str) -> dict:
    with conn.transaction():
        job = _load(conn, job_id, for_update=True)
        if job["status"] == "committed":
            raise conflict(f"Import {job_id} is already committed and cannot be cancelled.")
        if job["status"] != "cancelled":
            job = conn.execute(
                "update import_jobs set status = 'cancelled', updated_at = now() where id = %s returning *", [job_id]
            ).fetchone()
    info("cancel", "%s status=cancelled — no data changed", job_id)
    return _view(job)


# ---------- Confirm ----------


def confirm(conn: Connection, job_id: str, acknowledge_invalid_rows: bool, actor: str) -> dict:
    T = 10
    with conn.transaction():
        with step("confirm", 1, T, f"waiting for the import lock, loading {job_id}") as out:
            conn.execute("select pg_advisory_xact_lock(%s)", [IMPORT_LOCK])
            job = _load(conn, job_id, for_update=True)
            out["out"] = (f"status={job['status']}, file={job['file_name']}, "
                          f"acknowledgeInvalidRows={acknowledge_invalid_rows}")
        if job["status"] == "committed":
            info("confirm", "already committed → returning the stored result, nothing written again")
            return _view(job)  # idempotent retry: nothing is written again
        if job["status"] == "uploaded":
            raise invalid("mapping", "Apply a column mapping and review the validation results first.")
        if job["status"] != "validated":
            raise conflict(f"Import {job_id} is already {job['status']}.")
        if job["file_errors"]:
            raise invalid("file", job["file_errors"][0], [{"field": "file", "message": m} for m in job["file_errors"]])
        with step("confirm", 2, T, "checking for an earlier committed import of the same file"):
            dup = _committed_duplicate(conn, job["file_hash"], job_id)
        if dup:
            raise invalid("file", _duplicate_message(dup))

        with step("confirm", 3, T, "re-validating rows against the data as it is now") as out:
            rows = _validate(conn, job, job["mapping"])
            bad = [r for r in rows if r.classification == "invalid"]
            out["out"] = f"{len(rows)} rows, {len(bad)} invalid"
        _log_rows("confirm", rows)
        if bad and not acknowledge_invalid_rows:
            raise invalid("acknowledgeInvalidRows",
                          f"{len(bad)} invalid row(s) will not be imported. Confirm that you have reviewed them.")

        at = _now()
        with step("confirm", 4, T, "recording the data source") as out:
            source_id = _upsert_source(conn, job, rows, at)
            out["out"] = f"source id {source_id}"
        with step("confirm", 5, T, "saving new/changed observations (old values superseded, not overwritten)") as out:
            companies_created, touched = _save_observations(conn, job, rows, actor, at)
            out["out"] = f"{len(touched)} company-period(s) touched, {companies_created} company(ies) created"
        with step("confirm", 6, T, "recording invalid rows in import_row_errors") as out:
            _record_invalid_rows(conn, job_id, bad)
            out["out"] = f"{sum(1 for r in bad for i in r.issues if i['severity'] == 'error')} error(s) stored"
        with step("confirm", 7, T, "recalculating KPIs with calc_kpis() for touched company-periods") as out:
            _recalculate_kpis(conn, touched, at)
            out["out"] = f"{len(touched) * len(d.KPI_KEYS)} KPI results upserted"
        with step("confirm", 8, T, "evaluating active rules → exceptions") as out:
            ev = _evaluate_exceptions(conn, touched, at, f"import {job_id} ({job['file_name']})")
            out["out"] = f"created {ev['created']}, updated {ev['updated']} (condition cleared {ev['cleared']})"
        with step("confirm", 9, T, "refreshing stored company status for the latest period"):
            _refresh_company_status(conn, at)

        count = lambda c: sum(r.classification == c for r in rows)  # noqa: E731
        summary = {
            "rowsRead": len(rows),
            "imported": count("new") + count("changed"),
            "unchanged": count("unchanged"),
            "superseded": count("changed"),
            "invalid": len(bad),
            "companiesCreated": companies_created,
            "kpisRecalculated": len(touched) * len(d.KPI_KEYS),
            "exceptionsCreated": ev["created"],
            "exceptionsUpdated": ev["updated"],
            "exceptionsConditionCleared": ev["cleared"],
        }
        with step("confirm", 10, T, "marking the job committed, writing audit history") as out:
            job = conn.execute(
                """update import_jobs set status = 'committed', source_id = %s, rows_total = %s, rows_imported = %s,
                          rows_invalid = %s, imported_at = %s, imported_by = %s, committed_at = %s, rows = %s,
                          summary = %s, updated_at = %s
                   where id = %s returning *""",
                [source_id, len(rows), summary["imported"], len(bad), at, actor, at,
                 Jsonb([r.view() for r in rows]), Jsonb(summary), at, job_id],
            ).fetchone()
            _audit(conn, "import_job", job_id, "Import committed",
                   f"{summary['imported']} imported, {summary['unchanged']} unchanged, {summary['invalid']} invalid; "
                   f"{ev['created']} exceptions created, {ev['updated']} updated.", actor, at)
            out["out"] = f"{job_id} status=committed"
    info("confirm", "transaction committed ✓ summary: %s", ", ".join(f"{k}={v}" for k, v in summary.items()))
    return _view(job)


def _audit(conn: Connection, entity_type: str, entity_id: str, change: str, detail: str | None, actor: str,
           at: datetime) -> None:
    conn.execute(
        "insert into audit_events (entity_type, entity_id, change, detail, actor, created_at) values (%s,%s,%s,%s,%s,%s)",
        [entity_type, entity_id, change, detail, actor, at],
    )


def _upsert_source(conn: Connection, job: dict, rows: list[Row], at: datetime) -> str:
    valid = [r for r in rows if r.classification != "invalid"]
    name = next((r.values.get("source_name") for r in valid if r.values.get("source_name")), None) or job["file_name"]
    dates = sorted(r.values["source_updated_at"] for r in valid if r.values.get("source_updated_at"))
    updated = datetime.fromisoformat(dates[-1].replace("Z", "+00:00")) if dates else at
    if updated.tzinfo is None:
        updated = updated.replace(tzinfo=timezone.utc)
    return conn.execute(
        """insert into data_sources (name, kind, updated_at) values (%s, 'csv', %s)
           on conflict (name) do update set updated_at = greatest(data_sources.updated_at, excluded.updated_at)
           returning id""",
        [name, updated],
    ).fetchone()["id"]


def _save_observations(conn: Connection, job: dict, rows: list[Row], actor: str,
                       at: datetime) -> tuple[int, set[tuple[str, str]]]:
    created = 0
    touched: set[tuple[str, str]] = set()
    for r in rows:
        if r.classification not in ("new", "changed"):
            continue
        cid, period = r.values["company_id"], r.values["reporting_period"]
        inserted = conn.execute(
            """insert into portfolio_companies (id, name, sector, currency, created_at, updated_at)
               values (%s, %s, %s, 'USD', %s, %s) on conflict (id) do nothing returning id""",
            [cid, r.values["company_name"], r.values.get("sector") or "Unassigned", at, at],
        ).fetchone()
        if inserted:
            created += 1
            info("confirm", "  + company %s created (row %d)", cid, r.row_number)
            _audit(conn, "company", cid, "Company created by import", f"From {job['id']} row {r.row_number}.", actor, at)
        conn.execute("update portfolio_companies set updated_at = %s where id = %s", [at, cid])

        for m in r.changed_metrics:
            cols = METRIC_COLUMNS[m]
            new_id = f"{cid}:{period}:{m}:{job['id']}"
            old = conn.execute(
                """update kpi_observations set is_current = false
                   where company_id = %s and reporting_period = %s and metric_key = %s and is_current
                   returning id, actual_value, plan_value""",
                [cid, period, m],
            ).fetchone()
            conn.execute(
                """insert into kpi_observations (id, company_id, import_job_id, source_row, metric_key, actual_value,
                       plan_value, reporting_period, validation_status, is_current, imported_at, original_values)
                   values (%s, %s, %s, %s, %s, %s, %s, %s, %s, true, %s, %s)""",
                [new_id, cid, job["id"], r.row_number, m, r.parsed[cols["actual"]], r.parsed[cols["plan"]], period,
                 "warning" if r.has_warnings else "valid", at,
                 Jsonb({"company_id": cid, "reporting_period": period,
                        cols["actual"]: r.values.get(cols["actual"], ""), cols["plan"]: r.values.get(cols["plan"], "")})],
            )
            info("confirm", "  row %-3d %s %s %-7s actual %s, plan %s%s", r.row_number, cid, period, m,
                 d.plain(r.parsed[cols["actual"]]), d.plain(r.parsed[cols["plan"]]),
                 f"  (supersedes actual {d.plain(old['actual_value'])}, plan {d.plain(old['plan_value'])})"
                 if old else "  (new)")
            if old:
                conn.execute("update kpi_observations set superseded_by = %s where id = %s", [new_id, old["id"]])
                _audit(conn, "observation", old["id"], "Observation superseded",
                       f"{m} {period}: actual {d.plain(old['actual_value'])} → {d.plain(r.parsed[cols['actual']])}, "
                       f"plan {d.plain(old['plan_value'])} → {d.plain(r.parsed[cols['plan']])} by {job['id']} "
                       f"row {r.row_number}.", actor, at)
        touched.add((cid, period))
    return created, touched


def _record_invalid_rows(conn: Connection, job_id: str, bad: list[Row]) -> None:
    for r in bad:
        for i in r.issues:
            if i["severity"] == "error":
                conn.execute(
                    """insert into import_row_errors (import_job_id, source_row, field, raw_value, reason)
                       values (%s, %s, %s, %s, %s)""",
                    [job_id, r.row_number, i["field"], r.values.get(i["field"]), i["message"]],
                )


def _recalculate_kpis(conn: Connection, touched: set[tuple[str, str]], at: datetime) -> None:
    """Same formulas as the seed: the database function calc_kpis(). One row per company, period and KPI."""
    for cid, period in sorted(touched):
        conn.execute(
            """insert into kpi_results (company_id, observation_id, kpi_key, value, calc_status, calc_reason,
                                        reporting_period, calculated_at)
               select f.company_id, case when k.kpi_key like 'revenue%%' then f.rev_obs else f.ebitda_obs end,
                      k.kpi_key, k.value, k.calc_status, k.calc_reason, f.reporting_period, %s
               from (select company_id, reporting_period,
                            max(id)           filter (where metric_key = 'revenue') as rev_obs,
                            max(id)           filter (where metric_key = 'ebitda')  as ebitda_obs,
                            max(actual_value) filter (where metric_key = 'revenue') as ra,
                            max(plan_value)   filter (where metric_key = 'revenue') as rp,
                            max(actual_value) filter (where metric_key = 'ebitda')  as ea,
                            max(plan_value)   filter (where metric_key = 'ebitda')  as ep
                     from kpi_observations
                     where is_current and company_id = %s and reporting_period = %s
                     group by company_id, reporting_period) f
               cross join lateral calc_kpis(f.ra, f.rp, f.ea, f.ep) k
               on conflict (company_id, reporting_period, kpi_key) do update
                 set value = excluded.value, calc_status = excluded.calc_status, calc_reason = excluded.calc_reason,
                     observation_id = excluded.observation_id, calculated_at = excluded.calculated_at""",
            [at, cid, period],
        )


def _evaluate_exceptions(conn: Connection, touched: set[tuple[str, str]], at: datetime, trigger: str, log_as: str = "confirm") -> dict:
    """Per company, period and KPI only the most severe matching rule raises an exception.
    A rule that no longer matches flags its exception "condition cleared — review" (never auto-resolved);
    a rule that matches again re-activates the exception and reopens it if it was resolved."""
    result = {"created": 0, "updated": 0, "cleared": 0}
    rules = conn.execute(
        """select r.*, c.version from rules r join rule_configurations c on c.id = r.configuration_id
           where c.is_active order by r.id"""
    ).fetchall()
    rank = {"high": 3, "medium": 2, "warning": 1}

    for cid, period in sorted(touched):
        kpis = {k["kpi_key"]: k for k in conn.execute(
            "select * from kpi_results where company_id = %s and reporting_period = %s", [cid, period]).fetchall()}
        for kpi_key in sorted({r["kpi_key"] for r in rules}):
            kv = kpis.get(kpi_key)
            kpi_rules = [r for r in rules if r["kpi_key"] == kpi_key]
            ok = kv is not None and kv["calc_status"] == "ok" and kv["value"] is not None
            matching = [r for r in kpi_rules if r["enabled"] and ok and kv["value"] <= r["threshold"]]
            winner = min(matching, key=lambda r: (-rank[r["severity"]], r["threshold"])) if matching else None
            value = kv["value"] if kv else None
            value_text = d.kpi_value_text(kpi_key, value)
            metric = KPI_METRIC[kpi_key]

            for rule in kpi_rules:
                condition = d.rule_condition_label(kpi_key, rule["threshold"])
                detail = (f"{kpi_key} = {value_text} under rule configuration v{rule['version']}. "
                          f"Triggered by {trigger}.")
                existing = conn.execute(
                    """select * from exceptions where company_id = %s and reporting_period = %s
                       and metric_key = %s and rule_id = %s for update""",
                    [cid, period, metric, rule["id"]],
                ).fetchone()

                if winner and rule["id"] == winner["id"]:
                    if not existing:
                        conn.execute("select pg_advisory_xact_lock(%s)", [ID_LOCK])
                        exc_id = _next_id(conn, "exceptions", "EXC")
                        conn.execute(
                            """insert into exceptions (id, company_id, observation_id, kpi_result_id, rule_id,
                                   metric_key, kpi_key, reporting_period, severity, threshold, variance_value,
                                   status, created_at, evaluated_at, condition_active)
                               values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'open', %s, %s, true)""",
                            [exc_id, cid, kv["observation_id"], kv["id"], rule["id"], metric, kpi_key, period,
                             rule["severity"], rule["threshold"], value, at, at],
                        )
                        _audit(conn, "exception", exc_id, f"Exception created by rule {rule['rule_key']}: {condition}",
                               detail, SYSTEM_ACTOR, at)
                        result["created"] += 1
                        info(log_as, "  + %s created  %s %s %s = %s (%s, %s)", exc_id, cid, period, kpi_key,
                             value_text, rule["severity"], condition)
                        continue

                    changed = False
                    reopen = False
                    if not existing["condition_active"]:
                        _audit(conn, "exception", existing["id"], f"Condition re-triggered: {condition}", detail,
                               SYSTEM_ACTOR, at)
                        changed = True
                        reopen = existing["status"] == "resolved"
                    elif existing["threshold"] != rule["threshold"] or existing["variance_value"] != value:
                        _audit(conn, "exception", existing["id"], f"Re-evaluated: {condition}", detail, SYSTEM_ACTOR, at)
                        changed = True
                    conn.execute(
                        """update exceptions set condition_active = true, threshold = %s, severity = %s,
                                  variance_value = %s, kpi_result_id = %s, observation_id = %s, evaluated_at = %s
                           where id = %s""",
                        [rule["threshold"], rule["severity"], value, kv["id"], kv["observation_id"], at,
                         existing["id"]],
                    )
                    if reopen:
                        conn.execute(
                            """update exceptions set status = 'open', resolved_at = null, resolution_reason = null,
                                      resolution_note = null where id = %s""", [existing["id"]])
                        _audit(conn, "exception", existing["id"], "Status changed: resolved → open",
                               "Reopened because the condition is active again.", SYSTEM_ACTOR, at)
                    if changed:
                        result["updated"] += 1
                        info(log_as, "  ~ %s updated  %s %s %s = %s%s", existing["id"], cid, period, kpi_key,
                             value_text, " (re-triggered, reopened)" if reopen else
                             " (re-triggered)" if not existing["condition_active"] else "")
                    continue

                if existing and existing["condition_active"]:
                    if not rule["enabled"]:
                        why = f"rule {rule['rule_key']} is disabled"
                    elif not ok:
                        why = f"{kpi_key} is {kv['calc_status'].replace('_', ' ') if kv else 'missing'}" + (
                            f" ({kv['calc_reason']})" if kv and kv["calc_reason"] else "")
                    elif winner and rule in matching:
                        why = f"superseded by the more severe rule {winner['rule_key']}"
                    else:
                        why = f"{kpi_key} = {value_text} no longer meets {condition}"
                    conn.execute(
                        """update exceptions set condition_active = false, variance_value = %s, evaluated_at = %s
                           where id = %s""",
                        [value, at, existing["id"]],
                    )
                    _audit(conn, "exception", existing["id"], "Condition cleared — review required",
                           f"Under rule configuration v{rule['version']}: {why}. Triggered by {trigger}.",
                           SYSTEM_ACTOR, at)
                    result["updated"] += 1
                    result["cleared"] += 1
                    info(log_as, "  - %s condition cleared  %s %s: %s", existing["id"], cid, period, why)
    return result


def _refresh_company_status(conn: Connection, at: datetime) -> None:
    """Stored status for the latest reporting period (same rule as the seed, open = unresolved AND active)."""
    conn.execute(
        """with latest as (select max(reporting_period) as p from kpi_observations where is_current),
           st as (
             select c.id,
                    case
                      when exists (select 1 from exceptions e, latest where e.company_id = c.id
                                   and e.reporting_period = latest.p and e.status <> 'resolved' and e.condition_active
                                   and e.severity in ('high', 'medium')) then 'exception'
                      when exists (select 1 from exceptions e, latest where e.company_id = c.id
                                   and e.reporting_period = latest.p and e.status <> 'resolved' and e.condition_active
                                   and e.severity = 'warning') then 'warning'
                      when (select count(*) from kpi_results r, latest where r.company_id = c.id
                            and r.reporting_period = latest.p and r.calc_status = 'ok') < 7 then 'insufficient_data'
                      else 'on_track'
                    end as status
             from portfolio_companies c)
           update portfolio_companies c set status = st.status, updated_at = %s
           from st where st.id = c.id and c.status is distinct from st.status""",
        [at],
    )
