"""Tests against the real (seeded) Supabase database, through the read-only role.

    .venv/Scripts/python -m pytest
"""

import psycopg
import pytest
from fastapi.testclient import TestClient
from psycopg_pool import ConnectionPool

from app.config import get_settings
from app.main import app


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def assert_error_shape(body: dict, code: str):
    assert set(body) == {"code", "message", "details", "request_id"}
    assert body["code"] == code
    assert body["request_id"].startswith("req_")


# ---------- Database connectivity & role ----------


def test_health_connects_as_read_only_role(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "database": "ok", "databaseRole": "flownetic_api_ro", "latestPeriod": "2026-09"}


def test_api_role_cannot_write_even_in_a_read_write_transaction():
    with psycopg.connect(get_settings().api_database_url) as conn:
        conn.execute("set transaction read write")
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            conn.execute("update portfolio_companies set name = name")


def test_api_role_sessions_are_read_only_by_default():
    with psycopg.connect(get_settings().api_database_url) as conn:
        with pytest.raises(psycopg.errors.ReadOnlySqlTransaction):
            conn.execute("create table should_not_exist (i int)")


# ---------- Responses return stored values ----------


def test_companies_list(client):
    rows = client.get("/api/companies").json()
    assert len(rows) == 8
    assert [r["name"] for r in rows] == sorted(r["name"] for r in rows)
    apex = next(r for r in rows if r["id"] == "apex-field-services")
    assert apex["period"] == "2026-09"
    assert apex["status"] == "exception"
    assert apex["financials"]["ebitda"] == {"actual": 1.62, "plan": 1.9}
    assert set(apex["kpis"]) == {
        "revenue_variance", "revenue_variance_pct", "ebitda_variance", "ebitda_variance_pct",
        "ebitda_margin_actual_pct", "ebitda_margin_plan_pct", "ebitda_margin_variance_pp",
    }


def test_kpis_match_stored_kpi_results(client):
    with psycopg.connect(get_settings().api_database_url) as conn:
        stored = conn.execute(
            """select kpi_key, value, calc_status from kpi_results
               where company_id = 'vantage-retail' and reporting_period = '2026-09'"""
        ).fetchall()
    kpis = next(r for r in client.get("/api/companies").json() if r["id"] == "vantage-retail")["kpis"]
    for key, value, status in stored:
        assert kpis[key]["status"] == status
        assert kpis[key]["value"] == (None if value is None else float(value))
    assert kpis["ebitda_variance_pct"]["status"] == "sign_ambiguous"


def test_company_filters(client):
    rows = client.get("/api/companies", params={"attention": "true"}).json()
    assert {r["id"] for r in rows} == {"apex-field-services", "lumen-healthcare", "meridian-distribution"}
    assert [r["id"] for r in client.get("/api/companies", params={"search": "cobalt"}).json()] == ["cobalt-software"]


def test_dashboard_kpis(client):
    body = client.get("/api/dashboard/kpis").json()
    assert body["period"] == {"key": "2026-09", "label": "Sep 2026", "type": "month"}
    assert body["cards"]["companies"] == 8
    assert body["cards"]["openHighExceptions"] == 2
    assert len(body["rows"]) == 8
    assert sum(s["count"] for s in body["charts"]["statusDistribution"]) == 8


def test_company_detail(client):
    body = client.get("/api/companies/meridian-distribution").json()
    assert [h["period"] for h in body["history"]] == ["2026-07", "2026-08", "2026-09"]
    # The superseded (corrected) observation is kept in the data history.
    assert any(not o["isCurrent"] for o in body["dataHistory"])
    assert [e["id"] for e in body["exceptions"]] == ["EXC-0008"]


def test_exceptions_list_and_detail(client):
    rows = client.get("/api/exceptions").json()
    assert len(rows) == 8
    assert rows[-1]["status"] == "resolved"  # unresolved first
    assert [r["id"] for r in client.get("/api/exceptions", params={"status": "not_resolved"}).json()].count("EXC-0004") == 0

    d = client.get("/api/exceptions/EXC-0005").json()
    assert d["companyId"] == "apex-field-services"
    assert d["variancePct"] == pytest.approx(-14.7368421053)
    assert d["source"]["fileName"] == "portfolio_2026-09.csv"
    assert d["allowedTransitions"] == []
    assert [a["id"] for a in d["actions"]] == ["ACT-0002", "ACT-0001"]
    assert len(d["history"]) >= 2

    trace = client.get("/api/exceptions/EXC-0005/trace").json()
    assert [t["kind"] for t in trace] == ["rule", "evaluation", "kpi", "observation", "import"]


def test_investigations(client):
    rows = client.get("/api/investigations").json()
    assert [r["id"] for r in rows] == ["INV-0001"]
    d = client.get("/api/investigations/INV-0001").json()
    assert d["mode"] == "mock" and d["reviewStatus"] == "reviewed"
    assert len(d["output"]["confirmedObservations"]) == 4
    assert d["modelMetadata"]["promptVersion"] == "mock-template-v1"


def test_actions_and_impacts(client):
    actions = client.get("/api/actions").json()
    assert len(actions) == 4
    assert [a["id"] for a in client.get("/api/actions", params={"status": "awaiting_verification"}).json()] == ["ACT-0003"]
    d = client.get("/api/actions/ACT-0003").json()
    assert d["verificationStatus"] == "unverified"
    assert d["impacts"][0]["observedValue"] == 1.88
    assert len(client.get("/api/impacts").json()) == 2


# ---------- Error handling ----------


@pytest.mark.parametrize("path", ["/api/companies/nope", "/api/exceptions/nope", "/api/exceptions/nope/trace",
                                  "/api/investigations/nope", "/api/actions/nope", "/api/unknown"])
def test_not_found(client, path):
    r = client.get(path)
    assert r.status_code == 404
    assert_error_shape(r.json(), "not_found")


@pytest.mark.parametrize("path", ["/api/exceptions?severity=bogus", "/api/companies?period=2026-13",
                                  "/api/actions?overdue=maybe"])
def test_invalid_parameters(client, path):
    r = client.get(path)
    assert r.status_code == 422
    assert_error_shape(r.json(), "validation_error")
    assert r.json()["details"]["fieldErrors"]


def test_writes_are_not_exposed(client):
    r = client.post("/api/companies", json={"name": "x"})
    assert r.status_code == 405
    assert_error_shape(r.json(), "method_not_allowed")


def test_database_unavailable_returns_503():
    with TestClient(app) as c:
        real = app.state.pool
        dead = ConnectionPool("postgresql://nobody:x@127.0.0.1:1/none", min_size=0, max_size=1, timeout=1, open=False)
        dead.open(wait=False)
        app.state.pool = dead
        try:
            r = c.get("/api/companies")
        finally:
            app.state.pool = real
            dead.close()
    assert r.status_code == 503
    assert_error_shape(r.json(), "database_unavailable")
