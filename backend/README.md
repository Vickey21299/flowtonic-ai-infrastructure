# Backend

The Flowtonic server: FastAPI over the Supabase PostgreSQL database.

- Read endpoints for every screen (read-only role).
- **CSV import** (spec phase 2): upload → map → validate → confirm, which saves observations,
  recalculates KPIs and updates exceptions in one transaction (write role). Deterministic code only, no AI.
- Not yet: exception/action workflow, investigation generation, AI (see [system.md](system.md)).

## Stack

- Python 3.14, FastAPI, psycopg 3 with connection pools
- PostgreSQL on Supabase. Schema and seed live in [../database](../database/system.md).
- Database tooling (migrate/seed) is a small Node script: `scripts/db-setup.mjs`

## Layout

```
backend/
├── app/
│   ├── main.py        # app factory, lifespan (pools open/close), CORS
│   ├── config.py      # settings from .env (incl. import limits)
│   ├── db.py          # read + write pools, per-request connections (503 when DB is down)
│   ├── errors.py      # { code, message, details, request_id } for every error
│   ├── routes.py      # GET endpoints under /api
│   ├── repository.py  # SQL queries → response dicts (stored values only)
│   ├── display.py     # labels, formulas, number formatting (no calculations)
│   ├── schemas.py     # response models (mirror frontend/src/api/types.ts, camelCase)
│   └── imports/       # CSV import
│       ├── schema.py      # import schema (spec §6) and header aliases
│       ├── parser.py      # CSV parsing, auto-mapping, file hash
│       ├── validation.py  # row rules + new/unchanged/changed/invalid classification
│       ├── service.py     # sessions and the confirm transaction
│       └── routes.py      # /api/imports endpoints
├── scripts/
│   ├── create_api_roles.py       # creates flownetic_api_ro / flownetic_api_rw, writes their URLs to .env
│   └── db-setup.mjs              # migrations + seed (admin connection)
└── tests/test_api.py
```

## Environment (`backend/.env`, see `.env.example`)

| Variable | Used by | Purpose |
|---|---|---|
| `API_DATABASE_URL` | FastAPI reads | Read-only role `flownetic_api_ro` (SELECT only, read-only sessions) |
| `API_WRITE_DATABASE_URL` | FastAPI imports | Write role `flownetic_api_rw` (INSERT/UPDATE on import tables, no DELETE/DDL) |
| `DATABASE_URL` | scripts only | Admin connection for migrations, seed and creating the API roles |
| `SUPABASE_URL`, `SUPABASE_KEY` | db-setup check | Project URL and publishable key |
| `CORS_ORIGINS` | FastAPI | Optional, JSON list. Default: Vite dev server on port 5173 |

The frontend never sees any of these. It only knows the API URL.

## Run locally

```
# one-time
py -3.14 -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt
.venv/Scripts/python scripts/create_api_roles.py        # only if the API_*_DATABASE_URL values are missing

# API on http://localhost:8000 (OpenAPI docs at /docs)
.venv/Scripts/uvicorn app.main:app --reload --port 8000

# tests (read endpoints, real seeded database, read-only)
.venv/Scripts/python -m pytest
```

Database tooling (admin connection; do not run the seed against data you want to keep — it resets everything,
including import history):

```
npm install
npm run db:migrate
npm run db:seed
```

## Endpoints

| Path | Returns |
|---|---|
| `GET /api/health` | Database reachability and the connected role |
| `GET /api/workspace` | Header info: periods, last import, source |
| `GET /api/dashboard/kpis` | Overview: cards, company rows, chart series (`period, sector, status, attention, search`) |
| `GET /api/companies`, `/api/companies/{id}` | Company rows with stored KPI results; detail with history, exceptions, actions, observations |
| `GET /api/exceptions`, `/api/exceptions/{id}`, `/api/exceptions/{id}/trace` | Exceptions with filters; detail and rule → KPI → observation → import trace |
| `GET /api/investigations`, `/api/investigations/{id}` | Stored investigations |
| `GET /api/actions`, `/api/actions/{id}` | Actions with filters; detail with impact records and history |
| `GET /api/impacts` | Impact records |
| `POST /api/imports` | Upload `{name, text}` → import job (`uploaded`, columns auto-mapped) |
| `GET /api/imports/{id}` | Current job (resume after refresh; 404 when unknown or expired after 24 h) |
| `PUT /api/imports/{id}/mapping` | `{mapping}` → rows validated and classified (`validated`) |
| `POST /api/imports/{id}/confirm` | `{acknowledgeInvalidRows}` → one transaction; `committed` + summary. Re-confirm returns the same result |
| `POST /api/imports/{id}/cancel` | `cancelled`; nothing saved |

Errors: `404 not_found`, `409 conflict` (wrong job state), `413 payload_too_large` (5 MB / 5000 rows),
`422 validation_error`, `503 database_unavailable`, `500 internal_error`.

## Import rules (summary)

- Row checks as in `database/csv/README.md`: required values, `YYYY-MM`, plain numbers (no `$ , m`),
  max 6 decimals, revenue ≥ 0, EBITDA ≤ revenue, ISO dates, duplicate company-period in the file.
  Missing/zero/negative plans, very large values and unknown companies are warnings (unknown companies are created).
- Classification against stored current observations: `new`, `unchanged`, `changed`, `invalid`.
- Changed values supersede the old observation (`is_current = false`, `superseded_by`); nothing is overwritten.
  Raw CSV strings are kept in `kpi_observations.original_values`; invalid rows in `import_row_errors`.
- KPIs are recalculated with the database function `calc_kpis()` for the affected company-periods only
  (there are no rolling/YTD KPIs that depend on other periods).
- Exceptions: most severe matching rule per KPI; re-evaluated when values change; a breach that no longer
  holds is flagged *condition cleared — review* (never auto-resolved); a returning breach reactivates and
  reopens it. Unique per company + period + metric + rule, so re-imports never duplicate.
- Company status is derived per period from open exceptions and KPI results; the stored
  `portfolio_companies.status` is refreshed for the latest period on every import.
- Concurrency: confirms are serialised (advisory lock + `FOR UPDATE` on the job); a committed file hash
  cannot be imported again. Any failure rolls the whole confirm back and the job stays `validated`.
