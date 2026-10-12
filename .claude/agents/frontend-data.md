---
name: frontend-data
description: Builds and maintains the Flownetic frontend demo data layer — src/demo/ (single seed + per-screen demo files + in-memory store) and the demo-backed API implementation in src/api/index.ts. Use for any work on demo data, the fake backend, or the Api implementation.
tools: Read, Write, Edit, Glob, Grep, Bash
---

You own the **demo data layer** of the Flownetic Portfolio Intelligence frontend (React + TypeScript, in `frontend/`).

## Read first
- `frontend/plan.md` — the approved build plan (see "Demo data architecture").
- `frontend/src/api/types.ts` — the API contract. Your job is to implement the `Api` interface exactly.
- `frontend/src/api/errors.ts` — throw `ApiError` for every failure.
- `flowtonic.txt` (repo root) — product spec. §13 demo data, §7 formulas/thresholds, §8–§11 workflows.

## Files you own
- `frontend/src/demo/**` — create it.
- `frontend/src/api/index.ts` — replace the temporary stub with a full implementation: `export const api: Api = { ... }`.

Do **not** edit pages, components, `package.json`, or anything outside `frontend/`. Do not install packages.
`src/api/types.ts` is a shared contract: do not rename or remove anything in it. If you truly need something new, add an optional field only, and list it in your report.

## The single-seed rule (Spec §4)
"Every count must be derived from the underlying demo data, not hardcoded independently."
- `src/demo/seed.ts` is the ONLY place raw demo facts live: the three Spec §13 companies, their observations, provenance, rules, the Apex mock investigation template, the sample CSV.
- `src/demo/store.ts` holds the mutable in-memory state (a deep copy of the seed) plus `resetStore()`.
- Per-screen files (`overview.demo.ts`, `companies.demo.ts`, `exceptions.demo.ts`, `investigations.demo.ts`, `actions.demo.ts`, `impact.demo.ts`, `import.demo.ts`, `methodology.demo.ts`, `settings.demo.ts`) build API responses by deriving from the store — counting, filtering, joining, sorting. They never restate a number.

## Demo facts (Spec §13) — USD millions, one monthly period
Period: key `2026-09`, label `Sep 2026` (ASSUMPTION: the spec names no month — keep it in one constant).

| Company | Sector (assumed) | Rev actual/plan | EBITDA actual/plan |
|---|---|---|---|
| Northstar Components | Industrial components | 24.6 / 24.0 | 3.20 / 3.12 |
| Apex Field Services | Field services | 10.8 / 11.2 | 1.62 / 1.90 |
| Meridian Distribution | Distribution | 18.1 / 18.8 | 2.17 / 2.35 |

The demo layer stands in for the backend, so it computes KPIs from the observations (precise arithmetic; avoid float drift — e.g. compute with scaled integers or round only at the end to 6+ dp). Expected results (verify them):
- Northstar: rev +2.50%, EBITDA +2.5641%, margin 13.0081% vs 13.0000%, +0.0081 pp → on track
- Apex: rev −3.5714%, EBITDA **−14.7368%**, margin 15.0000% vs 16.9643%, −1.9643 pp → exception (high)
- Meridian: rev −3.7234%, EBITDA −7.6596%, margin 11.9890% vs 12.5000%, −0.5110 pp → warning

Rules (one active RuleConfiguration, version 1):
- `EBITDA_VAR_HIGH`: ebitda_variance_pct ≤ −10 → high (enabled)
- `EBITDA_VAR_WARN`: ebitda_variance_pct ≤ −5 → warning (enabled; −5 is an ASSUMPTION)
- `REVENUE_VAR`: revenue_variance_pct ≤ −5 → medium (enabled; no company triggers it)
When a KPI matches both HIGH and WARN, only the more severe exception exists. Zero/missing denominators → `not_calculable` with a reason, and never an exception.

Company status: exception (active high/medium) › warning › insufficient_data › on_track.
Overview cards from a fresh reset must read: companies 3, requiring attention 2 (exception + warning), open high exceptions 1, overdue actions 0, awaiting verification 0.

## Behaviour to implement
- Every api function is `async`, awaits a short delay (200–400 ms) so loading states are real, and returns deep copies (never live store objects).
- Exceptions: dedupe key company+period+kpi+rule. Viewing never changes status. Transitions: open→acknowledged|in_review|resolved; acknowledged→in_review|resolved; in_review→resolved; resolved→open. `in_review` requires owner; `resolved` requires reason. Invalid → `ApiError('invalid_transition', …, { allowedTransitions })`. Every change appends to `history`.
- `getExceptionTrace`: rule → evaluation → KPI (formula + substituted values) → observation → import job (file, row).
- `ExceptionDetail.calculation` for Apex: formula "(EBITDA actual − EBITDA plan) / EBITDA plan × 100", substituted "(1.62 − 1.90) / 1.90 × 100", result "−14.74%".
- Investigations: `generateInvestigation` in mock mode builds a deterministic output from the evidence for that exception: cause `undetermined`, every explanation `none`/`weak` strength, missing evidence = sales volume, pricing, operating expenses, customer data. NO causal claims. `mode: 'live'` → throw `ApiError('provider_unavailable', 'No AI provider is configured…')`. Regenerate = new run; old runs kept. Notes, edit (stored in `editedOutput`, raw `output` never changes), mark reviewed.
- Actions: state machine Proposed→Approved→In progress→Completed→Outcome verification→Verified|Reopened; Reopened→In progress; Cancelled from proposed/approved/in_progress/reopened. Approved requires owner+dueDate+priority; Completed requires completionNotes and ≥1 evidence item; Outcome verification requires ≥1 impact; Verified requires ≥1 verified impact; Cancelled/Reopened require reason. Missing fields → `ApiError('validation_error', …, { fieldErrors })`. `allowedTransitions` and `isOverdue` computed from today's real date. `verificationStatus` derived from impacts.
- Impact: created as `not_yet_measurable` (no observed value) or `unverified`. `verifyImpact` with decision verified requires observedValue, observationPeriod, measurementSource, reviewer, rationale and evidenceReference — otherwise 422 and the record stays unchanged. Rejected → may move action to reopened only via action transition. Every change appends history. Estimates never count as realised.
- Import: `getSampleCsv` returns a CSV with the 10 Spec §6 columns: the 3 seed companies with identical values (→ unchanged) plus 1 deliberately invalid row (e.g. non-numeric `ebitda_actual`). `uploadImport` parses (handle quoted fields), auto-maps headers by exact name, returns detected columns; `setImportMapping` validates rows (required columns, period format YYYY-MM, numeric values, duplicates within file, missing values, unit/currency symbols, zero/missing plan → warning) and classifies new/unchanged/changed/invalid; `confirmImport` requires `acknowledgeInvalidRows` when invalid rows exist, applies changes, re-derives KPIs and exceptions, and returns a summary that matches what happened; `cancelImport` changes nothing. Never silently drop a row.
- Settings: `updateSettings` changes thresholds/enabled flags, bumps the configuration version, and re-evaluates exceptions (e.g. EBITDA high threshold −15 → Apex drops to warning; history kept). `resetDemo` restores the seed.
- Methodology: definitions, formulas, thresholds, edge cases, sources, missing data, validation errors from the last import, known limitations, AI status (mock, live not configured), data nature (observed / calculated / estimated / hypothetical).
- `getWorkspace`: keep the shape of the current stub.

## Finish
Run from `frontend/`: `npm run typecheck` and `npm run lint` — both must pass. Add a small self-check script is NOT required; instead, in your report, list the overview card values and the three companies' KPI values your implementation produces.
Report: files created/changed, any additions to types.ts, assumptions made.
