# Flowtonic: Path to Production

**Status:** sales prototype (demo), built on fictional data only.
**Purpose:** the work that remains between the current prototype and a product that can hold confidential private-equity data. It covers spec §18 (production requirements) in four main sections, **Error handling**, **Observability**, **Security** and **RBAC**, followed by a checklist that maps every §18 item to its section.

> The prototype must not be presented as production-ready, and it must not be loaded with real client data until every item in the §18 checklist (section 5) is done and verified (spec §18, §20).

---

## 0. Where the prototype stands

| Area | What exists today | Production-relevant notes |
|---|---|---|
| Frontend | React + TypeScript, TanStack Query, Recharts | No login, no role awareness |
| API | FastAPI, two Postgres connection pools | Every request acts as "Demo User" |
| Database | Supabase Postgres, 13 tables, RLS enabled, migrations 001–004 | Two API roles: read-only `flownetic_api_ro`, write `flownetic_api_rw` |
| KPI engine | Deterministic SQL function `calc_kpis()` | No AI in any official number (spec §7) |
| Import | Upload → map → validate → confirm in one transaction, advisory lock, duplicate-file check | Raw CSV text is stored in `import_jobs` |
| AI investigation | Google Gemini over REST, schema-validated, evidence-id guardrails, labelled mock mode | Fictional data is sent to an external provider |
| Workflow | Exception status, actions, impact and verification, rule thresholds | Every change written to `audit_events` |
| Logging | Console logs with request id and step timings | Not structured, not shipped anywhere |

---

## 1. Error handling

### 1.1 Current behaviour
- One error shape for every API failure: `{ code, message, details, request_id }` (`backend/app/errors.py`).
- Codes in use: `validation_error` (422, with `fieldErrors`), `not_found` (404), `conflict` and `invalid_transition` (409), `provider_unavailable` (409), `database_unavailable` (503), `internal_error` (500).
- Unexpected exceptions are caught: the client gets a generic message plus the request id, never a stack trace.
- Writes are transactional: an import confirm, a workflow transition or a threshold change either fully applies or not at all.
- The AI call has its own categories (`timeout`, `rate_limited`, `provider_error`, `invalid_response`, `provider_unavailable`). A failed run is stored with `status = failed`, and the UI offers retry or the mock.

### 1.2 Work required

| # | Item | Why |
|---|---|---|
| E1 | **Error catalogue.** Every `code` with its HTTP status, retryable flag and user-facing text, in one module shared by the API, the tests and the frontend. | Consistent handling; support can map a code to a cause |
| E2 | **Idempotency keys on all writes** (`Idempotency-Key` header, stored per user for 24 h). The import confirm is already idempotent; action create, impact create and investigation generate are not. | A double-click or network retry must not duplicate actions or pay for two AI calls |
| E3 | **Retry policy.** The frontend retries only retryable codes (503, 429, timeouts), with backoff and a cap. Gemini gets one retry on 429/5xx with jitter, then fails visibly. | Transient failures recover without hiding real errors |
| E4 | **Ordered timeouts.** Browser 60 s for writes, then the API request budget, Postgres `statement_timeout` (30 s on the write role) and Gemini 45 s. Each inner timeout fires before the outer one. | No endless spinners and no orphaned work |
| E5 | **Optimistic concurrency.** Edits to actions, impact and exceptions send `updated_at`; a stale write is rejected with 409. | Today two analysts editing one action means last write wins silently |
| E6 | **Frontend error boundaries** per page plus a global fallback; mutation errors show the request id. | A rendering error must not blank the app |
| E7 | **Import failure states.** Stream-parse, enforce limits before reading the body, and leave a failed confirm in a recoverable `failed` state with its reason. | Large or malformed files fail cleanly |
| E8 | **Database error mapping.** Unique and check violations become clear 409/422 responses; pool exhaustion becomes 503 with `Retry-After`. | Today an unexpected constraint hit surfaces as a generic 500 |
| E9 | **AI output safety.** Keep schema validation and evidence-id guardrails; add a causal-wording check on the summary and an output size limit. | Spec §9: validate the response before rendering or saving |
| E10 | **Clear AI limitations in the UI.** Every investigation shows provider, model, prompt version and an "AI-generated, requires human review" label; mock runs stay labelled as mock. | Spec §18: clear limitations for AI-generated analysis |

---

## 2. Observability

### 2.1 Current behaviour
- Human-readable console logs: `→` request in, `←` status and duration, numbered step lines for imports, investigations and workflow changes, each with a request id (`backend/app/logs.py`).
- The request id is returned in the `X-Request-Id` header and in every error body.
- AI calls log model, duration, finish reason and token counts, and no financial content.
- `GET /api/health` checks database connectivity and the database role.
- Business history lives in `audit_events`. This is the product audit trail, not operational telemetry.

Nothing is collected centrally, nothing alerts, and logs are lost on restart.

### 2.2 Work required

**Logs**
| # | Item |
|---|---|
| O1 | **Structured JSON logs**: timestamp, level, request_id, user_id, workspace_id, route, status, duration_ms, step, error code. Keep the readable format for local development only. |
| O2 | Ship logs to a central store with retention and access control (for example through an OpenTelemetry Collector). |
| O3 | **Redaction by default**: never log CSV content, financial values, prompts, model output or secrets. Today's step lines print company names and KPI values; move these behind a debug flag that is off in production. |

**Metrics**
| # | Item |
|---|---|
| O4 | **Per-route RED metrics**: request rate, error rate by code, latency p50/p95/p99. |
| O5 | **Pipeline and business metrics**: imports started, confirmed, failed and cancelled; rows imported vs invalid; confirm duration; exceptions created, updated and cleared; overdue actions. |
| O6 | **AI metrics**: calls by outcome, latency, input/output tokens, estimated cost per workspace per day, guardrail corrections per run. |
| O7 | **Database metrics**: pool usage and wait per pool, slow queries, advisory-lock wait on import confirm, connection errors. |

**Traces and frontend**
| # | Item |
|---|---|
| O8 | **OpenTelemetry traces** from browser to API to Postgres to Gemini, correlated by the existing request id. Each import or investigation step becomes a span (the `step()` helper already marks the boundaries). |
| O9 | **Browser error monitoring**: unhandled errors, failed API calls with request id, slow page loads, with source maps uploaded at build time. |

**Health, alerts and response**
| # | Item |
|---|---|
| O10 | Split **liveness** (process up) from **readiness** (both pools connected, migrations at the expected version, AI provider reachable or deliberately disabled). |
| O11 | **Alerts with owners and runbooks**: 5xx rate, p95 latency, database unavailable, import confirm failures, AI failure rate or daily cost over budget, backup failed, certificate or secret near expiry, and repeated authorisation failures (from section 3). |
| O12 | **Service level objectives** for read API and import confirm availability and latency, with a monthly error-budget review. |
| O13 | **Dashboards**: operations (traffic, errors, latency, pools) and product (imports, exceptions, actions, AI usage). |
| O14 | **Incident process**: on-call rota, severity levels, client communication and post-incident reviews. |

---

## 3. Security

### 3.1 Current behaviour
- Secrets live only in `backend/.env` on the server; the Gemini key never reaches the browser.
- The API uses two least-privilege database roles: read-only for GET endpoints, and a write role with no DELETE or DDL rights.
- RLS is enabled on every table; all queries are parameterised; the `db_search_path` setting is validated.
- CORS is limited to the local frontend origins and to GET, POST and PUT.
- Uploads have size and row limits (5 MB, 5,000 rows) and are parsed as text, never executed.
- Every material change is written to `audit_events`.

### 3.2 Known issues to fix first

| # | Issue | Fix |
|---|---|---|
| S0a | **Supabase REST is readable with the publishable key.** `backend/scripts/db-setup.mjs` reads `portfolio_companies` successfully. | Remove `anon`/`authenticated` select policies, or disable the Data API for the schema, so that only the FastAPI roles can read data. |
| S0b | `demo_reset()` is a `SECURITY DEFINER` function that truncates every table. | Never install it in production; the setup script must skip it outside the demo profile. |
| S0c | No identity: every write is attributed to "Demo User". | Section 3.3. |

### 3.3 Work required

| # | Area (§18) | Item |
|---|---|---|
| S1 | Authentication and sessions | SSO through OIDC/SAML (the firm's identity provider) or Supabase Auth; MFA enforced; short-lived access tokens with refresh rotation; server-side revocation; idle and absolute session timeouts; secure, HttpOnly, SameSite cookies if cookies are used. |
| S2 | Server-side authorisation | Every endpoint checks the authenticated user's role and workspace before touching data (section 4). The frontend hides controls, but never enforces anything. |
| S3 | Workspace and tenant isolation | Add `workspace_id` to every table. Enforce it in the API (every query filtered) **and** in Postgres RLS (policies keyed on the session's workspace), so one missed filter cannot leak data. Separate demo and production environments; never load demo seed data into a client workspace (spec §14). |
| S4 | Encryption | TLS on every hop (browser to API to database to AI provider); HSTS; confirm encryption at rest for the database, backups and any file storage on the chosen plan. |
| S5 | Secrets management | Move `.env` secrets to a secret manager; rotate database role passwords and the Gemini key on a schedule and on staff change; keep the admin `DATABASE_URL` out of the runtime and use it only in the migration pipeline. |
| S6 | Audit logs | Keep `audit_events` append-only (no UPDATE or DELETE grants for any role); add **data-access** events (who viewed which company, export, AI run) alongside the existing change events; retain per contract. |
| S7 | Secure file upload and storage | Content-type and encoding checks, malware scan, size limits enforced before reading the body, CSV formula-injection neutralising on any export, storage of raw files in an encrypted bucket with a retention period instead of a database column. |
| S8 | Backup and recovery | Point-in-time recovery enabled; daily backups kept off the primary; a written recovery procedure with target recovery time and point; a restore drill at least quarterly. |
| S9 | Rate limiting and abuse protection | Per-user and per-workspace limits, stricter on AI generation and upload; 429 with `Retry-After`; request body size limits; bot and brute-force protection on sign-in. |
| S10 | Data retention and deletion | Retention rules for raw CSV content, expired import sessions, investigation outputs and audit history; a scheduled cleanup job; per-client export and verified deletion on offboarding. |
| S11 | Privacy, contractual and AI-provider controls | Data processing agreements with Supabase and the AI provider; a no-training and zero-retention setting; regional processing where required; per-client consent before any data is sent to an external model, with mock mode as the default until consent is recorded; an allow-list of fields sent (today, the evidence list only). |
| S12 | Security testing | Dependency and secret scanning in CI, static analysis, an authorisation test matrix (every role × every endpoint × another workspace's data), and an external penetration test before the first client. |
| S13 | Application hardening | Security headers (CSP, frame-ancestors, referrer policy), strict CORS for the production origin only, no debug endpoints in production. |

---

## 4. RBAC (role-based access control)

### 4.1 Roles

| Role | Purpose |
|---|---|
| **Viewer** | Read dashboards, companies, exceptions, investigations, actions and impact. No changes. |
| **Analyst** | Import data, generate investigations, add notes, create and edit actions and impact records. |
| **Operating Partner** | Everything an Analyst can do, plus approve actions, resolve exceptions and verify impact. |
| **Workspace Admin** | Manage users and roles, change rule thresholds and AI settings for the workspace. |
| **Platform Admin** (vendor staff) | Operate the platform; no access to client data without a recorded, time-limited support grant. |

Roles are assigned **per workspace**, so one person can be Analyst in one fund and Viewer in another.

### 4.2 Permission matrix

| Action (endpoint) | Viewer | Analyst | Op. Partner | Ws. Admin |
|---|:-:|:-:|:-:|:-:|
| Read any page (`GET /api/...`) | ✓ | ✓ | ✓ | ✓ |
| Upload, map, confirm, cancel an import (`/api/imports/*`) | | ✓ | ✓ | ✓ |
| Generate an investigation (`POST /api/investigations`), add note, edit | | ✓ | ✓ | ✓ |
| Mark an investigation reviewed | | | ✓ | ✓ |
| Acknowledge or put an exception in review | | ✓ | ✓ | ✓ |
| Resolve or reopen an exception | | | ✓ | ✓ |
| Create or edit an action, add notes and evidence, move it through in progress and completed | | ✓ | ✓ | ✓ |
| Approve, cancel, verify or reopen an action | | | ✓ | ✓ |
| Create or edit an impact record | | ✓ | ✓ | ✓ |
| Verify or reject an impact record | | | ✓ | ✓ |
| Change rule thresholds or AI mode (`PUT /api/settings`) | | | | ✓ |
| Manage users and roles | | | | ✓ |

### 4.3 Enforcement
- **API layer:** a dependency resolves the user, workspace and role from the token on every request; each route declares the permission it needs; a missing permission returns 403 with code `forbidden` and writes an audit event.
- **Database layer:** RLS policies keyed on the session's workspace (set per request), so data from another workspace is unreachable even if an API check is missed. The API keeps separate read and write roles.
- **Frontend:** reads the user's permissions from the API and hides or disables controls. This is for usability only, never for security.

### 4.4 Human review of important decisions (§18)
- **Separation of duties:** the person who records an impact's observed value cannot verify it; the person who generated an investigation cannot be the only reviewer when its suggested actions are approved.
- **AI output is advisory:** an action created from an investigation always starts as `proposed` and needs an Operating Partner to approve it. No AI output changes data on its own (already true today).
- **Threshold changes** are versioned (v1 → v2 …), audited, and could require a second admin's approval for large changes.

---

## 5. Spec §18 checklist

| # | §18 requirement | Today | Where it is addressed |
|---|---|---|---|
| 1 | Authentication and secure session management | None (Demo User) | 3.3 S1 |
| 2 | Role-based access control | None | 4 |
| 3 | Workspace and tenant isolation | Single workspace | 3.3 S3, 4.3 |
| 4 | Server-side authorisation on every sensitive request | Database roles only | 3.3 S2, 4.3 |
| 5 | Encryption in transit and at rest | TLS to Supabase; at rest per plan, not verified | 3.3 S4 |
| 6 | Secure secrets management | `.env` file on the server | 3.3 S5 |
| 7 | Audit logs for data access and material changes | Material changes only | 3.3 S6 |
| 8 | Secure file upload, validation and storage | Size and row limits, validation | 1.2 E7, 3.3 S7 |
| 9 | Backup and recovery procedures | Supabase defaults, untested | 3.3 S8 |
| 10 | Error monitoring and operational alerts | Console logs only | 1, 2 (O9, O11) |
| 11 | Rate limiting and abuse protection | None | 3.3 S9 |
| 12 | Data retention and deletion controls | None (sessions never cleaned) | 3.3 S10 |
| 13 | Privacy, contractual and AI-provider controls | None | 3.3 S11 |
| 14 | Integration tests and security testing | None automated | 3.3 S12, 6 |
| 15 | Documented deployment and rollback procedure | Manual, local | 6 |
| 16 | Clear limitations for AI-generated analysis | Mock labelled; live shows provider and model | 1.2 E9–E10 |
| 17 | Human review of important decisions | Review and verify steps exist, no roles | 4.4 |

---

## 6. Remaining engineering work

| Area | Work |
|---|---|
| Testing | Unit tests for KPI formulas and validation rules; integration tests against a disposable Postgres per run (migrations + seed); API contract tests from the TypeScript types; end-to-end tests of the spec §16 workflow; the RBAC test matrix from S12. |
| Deployment and rollback | CI pipeline (lint, type check, tests, migration dry-run); container images; dev, staging and production environments; migrations applied by the pipeline in a backward-compatible way; a documented deployment **and rollback** procedure. |
| Configuration | Move the runtime AI mode (in memory today, reset on restart) and workspace settings into the database per workspace. |
| Data | Scheduled cleanup of expired import sessions; multiple data sources per import; reporting periods beyond months; accounting/ERP integrations scoped separately and claimed only once built and tested (spec §18). |
| Time | Use the workspace timezone for "overdue" and period boundaries (the server date is used today). |
| Product | Spec §19 Phase 5: confirm real customer workflows, choose integrations and define access requirements before estimating production scope. |

---

## 7. Suggested order

1. **Close the known issues** (S0a–S0c), then **authentication, tenant isolation and RBAC** (S1–S3, section 4). Nothing else matters until these are done.
2. **Observability foundations** (O1–O3, O4, O10, O11), so the following work can be monitored.
3. **Error handling hardening** (E1–E5, E8) and **rate limiting** (S9).
4. **Secrets, encryption, AI-provider controls and data lifecycle** (S4–S5, S7, S10–S11), then a restore drill (S8).
5. **Testing and deployment pipeline** (section 6), then the external security test (S12).
6. **Production discovery** with a design partner, then a separately estimated production scope.

Each step ends with a review against the §18 checklist (section 5) before the next one starts.
