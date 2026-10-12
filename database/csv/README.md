# Sample CSV files — company monthly metrics

Fixtures for testing the **future CSV import** feature (spec §6, flowtonic.txt). All data is fictional.
Nothing here has been imported into the database; these files are inputs only.

| File | Purpose |
|---|---|
| `company_monthly_metrics.csv` | **Valid** import: 24 rows (8 companies × Jul–Sep 2026). Generated from the current database. |
| `company_monthly_metrics_invalid.csv` | **Invalid** import: 18 rows, each with one deliberate problem (16 error rows, including the duplicate pair 13–14, plus 2 warning-only rows: 12 and 19). |
| `company_monthly_metrics_mapped_headers.csv` | **Column mapping** test: the 8 Sep 2026 rows with human-style headers (`Period`, `Company ID`, `Revenue (actual)` …) in a different order. Valid once mapped. |
| `company_monthly_metrics_missing_column.csv` | **Required column** test: the 8 Sep 2026 rows without the `ebitda_plan` column. The whole file must be rejected before any row is imported. |
| `company_monthly_metrics_2026-10_new_period.csv` | **Full write path**: Oct 2026 for the 8 companies plus 2 new ones (`harbor-logistics`, `quartz-analytics`). Creates companies, KPIs and new exceptions. |
| `company_monthly_metrics_2026-09_restatement.csv` | **Restatement**: Sep 2026 with 4 changed rows (Cobalt, Lumen, Meridian, Ridgeway) and 4 unchanged. Supersedes old values; raises, escalates and clears exceptions. |
| `generate_from_db.py` | Regenerates the valid file from the database (read-only role). |
| `validate_csv.py` | Checks all four files against the import rules and the stored company IDs. |

## Format

- One row per **company and reporting period** (this is the import schema in spec §6 and
  `frontend/src/demo/seed.ts` `IMPORT_SCHEMA`). On import, each row becomes two `kpi_observations`
  rows (`revenue`, `ebitda`) — see `database/migrations/001_init.sql`.
- UTF-8, comma-separated, header on row 1, LF line endings. Row numbers in this document count the header as row 1.
- **KPI results are not included.** Variances and margins are calculated by the system from the raw
  actual/plan values (`calc_kpis()` in the migration), so the CSV carries raw inputs only.

## Columns

| Column | Required | Type / format | Meaning | Stored in |
|---|---|---|---|---|
| `company_id` | yes | text, lowercase slug | Stable company identifier; must match `portfolio_companies.id` | `kpi_observations.company_id` |
| `company_name` | yes | text | Display name. If it differs from the stored name, the stored name is kept (warning) | `portfolio_companies.name` |
| `sector` | no | text | Sector for filtering | `portfolio_companies.sector` |
| `reporting_period` | yes | `YYYY-MM` (month 01–12) | Reporting month | `kpi_observations.reporting_period` |
| `revenue_actual` | yes | plain decimal, USD millions | Reported revenue | `actual_value` (metric `revenue`) |
| `revenue_plan` | yes\* | plain decimal, USD millions | Planned revenue | `plan_value` (metric `revenue`) |
| `ebitda_actual` | yes | plain decimal, USD millions (may be negative) | Reported EBITDA | `actual_value` (metric `ebitda`) |
| `ebitda_plan` | yes\* | plain decimal, USD millions (may be negative) | Planned EBITDA | `plan_value` (metric `ebitda`) |
| `source_name` | no | text | Where the figures come from; defaults to the file name | `data_sources.name` |
| `source_updated_at` | no | ISO 8601 date, e.g. `2026-10-03` | When the source was last updated | `data_sources.updated_at` |

\* The column is required, but an **empty or zero plan value is accepted with a warning**: the row
imports, and the variance % for that metric is stored as *not calculable* (spec §6, §7).

**Units and currency:** all money values are **USD millions** as plain numbers — `24.6` means
USD 24.6 m. No currency symbols, thousands separators or unit suffixes (`$`, `,`, `m`, `USD`, `%`).
Revenue is written with 1 decimal place and EBITDA with 2. Revenue may not be negative; EBITDA may.

## Valid file — what it covers

The values equal the current (non-superseded) observations in the database, so importing this file
should report every row as **unchanged** and create no duplicates. This makes it a repeatable fixture
for idempotency (`import_jobs.file_hash` is unique too).

| Scenario | Rows (company, period) | Expected result |
|---|---|---|
| On or above plan | Northstar, Cobalt (all months) | No exception |
| Warning (EBITDA −5% to −10%) | Apex Aug, Sterling Aug, Meridian Sep | `EBITDA_VAR_WARN` |
| High (EBITDA ≤ −10%) | Lumen Aug + Sep, Apex Sep | `EBITDA_VAR_HIGH` |
| Revenue miss (≤ −5%) | Lumen Aug + Sep | `REVENUE_VAR` |
| Recovery | Sterling Sep (−2.3% after −6.25% in Aug) | No new exception |
| Missing plan | Ridgeway Sep, `ebitda_plan` empty (row 23) | Warning; EBITDA % not calculable |
| Negative plan | Vantage, all months (rows 9, 17, 25) | Warning; sign-ambiguous, no alert |
| Corrected value | Meridian Sep revenue `18.1` (corrected from 17.9 in the DB) | Unchanged vs current value |

The 4 rows marked *Warning* in the table are **intended**: they are valid rows that import with a warning.

## Invalid file — row by row

Rows use the existing companies and **future periods** (2026-10, 2026-11) so that, apart from the
intended problem, they never collide with stored data or with each other.

| Row | Company | Problem | Rule (spec §6) | Severity |
|---|---|---|---|---|
| 2 | *(blank)* | `company_id` missing | Missing required value | error |
| 3 | cobalt-software | `company_name` missing | Missing required value | error |
| 4 | apex-field-services | `reporting_period` missing | Missing required value | error |
| 5 | meridian-distribution | `reporting_period` = `2026-13` | Valid period format | error |
| 6 | lumen-healthcare | `reporting_period` = `Oct 2026` | Valid period format | error |
| 7 | ridgeway-foods | `revenue_actual` empty | Missing required value | error |
| 8 | sterling-packaging | `revenue_actual` = `n/a` | Numeric values in numeric columns | error |
| 9 | vantage-retail | `ebitda_actual` = `$-0.22` | Unexpected currency convention | error (+ negative-plan warning, as for all Vantage rows) |
| 10 | northstar-components | `revenue_actual` = `"24,900"` | Unexpected unit convention (thousands separator / not millions) | error |
| 11 | cobalt-software | `ebitda_actual` = `1.66m` | Unexpected unit convention | error |
| 12 | harbor-logistics | Unknown company, no sector | Unknown company ID | **warning only** — the company is created on import (sector "Unassigned") |
| 13–14 | apex-field-services 2026-11 | Same company and period twice | Duplicate company-period records | error (both rows) |
| 15 | meridian-distribution | `revenue_actual` = `-18.2` | Invalid value: revenue cannot be negative | error |
| 16 | lumen-healthcare | `source_updated_at` = `2026-12-32` | Invalid date | error |
| 17 | ridgeway-foods | 11 values for 10 columns | Malformed row | error |
| 18 | sterling-packaging | EBITDA `12.40` > revenue `10.0` | Inconsistent metric values | error **(proposed rule, not yet in the spec)** |
| 19 | northstar-components | `revenue_plan` = `0` | Plan zero when calculating % | **warning only** — row imports, revenue variance % not calculable |

## Coverage of spec §6 (Data import and validation)

| Requirement | Covered by | Notes |
|---|---|---|
| CSV parsing | all files | UTF-8 (ASCII only), comma-separated, LF, no BOM, quoted field in invalid row 10 |
| Preview of uploaded rows | all files | Row numbers are stable (header = row 1) |
| Column mapping | `…_mapped_headers.csv` | Different header names and order |
| Required columns | `…_missing_column.csv` | File-level error, nothing imported |
| Valid reporting-period format | invalid rows 4, 5, 6 | Missing, month 13, `Oct 2026` |
| Numeric values in numeric columns | invalid rows 7, 8 | Empty, `n/a` |
| Duplicate company-period records | invalid rows 13–14 | Both rows reported |
| Missing required values | invalid rows 2, 3, 4, 7 | |
| Invalid or unsupported values | invalid rows 12, 15, 16, 17, 18 | Unknown company, negative revenue, bad date, extra column, EBITDA > revenue |
| Unexpected currency or unit conventions | invalid rows 9, 10, 11 | `$`, thousands separator, `m` suffix |
| Plan zero or missing for percentages | invalid row 19; valid rows 9, 17, 23, 25 | Warnings, not errors: rows import, % not calculable / sign-ambiguous |
| Never silently discard invalid records | invalid file | Every row has an expected message (`validate_csv.py` fails if a row is not flagged) |
| Errors with row number, field, explanation | `validate_csv.py` output | Same shape the import screen must show |
| Prevent accidental duplicate imports | valid file uploaded twice | Same file hash → `import_jobs.file_hash` is unique; values equal stored data → all rows *unchanged* |
| Cancel an import | any file | UI behaviour; nothing to encode in a CSV |
| Visibly fictional company names / sample files | all files | Source is labelled "(fictional)" |
| Provenance (source, timestamp, period, user, validation status) | stored by the import itself | ⚠ **Original value**: the CSV keeps the raw strings, but the current schema has no column for them — needed before the import is built |

## Inspect locally

```
# view
type database\csv\company_monthly_metrics.csv          (PowerShell: Get-Content / Import-Csv)
python -c "import csv; [print(r) for r in csv.DictReader(open('database/csv/company_monthly_metrics.csv'))]"

# check all four files against the rules and the database company IDs (read-only)
backend\.venv\Scripts\python database\csv\validate_csv.py

# regenerate the valid file from the current database (read-only)
backend\.venv\Scripts\python database\csv\generate_from_db.py
```

Opening the files in Excel may reformat numbers (e.g. drop `1.80` → `1.8`) or periods (`2026-07` → a
date). Don't save them back from Excel.

## Using these files to test the import feature

1. **Valid file:** upload → map columns (headers match the schema 1:1) → preview shows 24 rows, 0 errors,
   4 warnings → confirm. Expect all rows *unchanged*, no new observations, KPI results or exceptions.
   Upload again: the duplicate-file check should prevent a second import.
2. **Invalid file:** upload → preview must list every row above with **row number, field and reason**;
   no row may be dropped silently. Confirming (with the acknowledgement) imports rows 12 and 19 only:
   it **creates the company Harbor Logistics** (2026-10) and adds Northstar 2026-11, which makes
   2026-11 the latest period. Everything else is recorded in `import_row_errors` and not imported.
   These writes are real; `npm run db:seed` in `backend/` restores the demo data (and clears import history).
3. **Mapped headers file:** the mapping step must offer/accept the 10 schema fields for the renamed
   columns; after mapping, the preview equals the Sep 2026 rows of the valid file (all *unchanged*).
4. **Missing column file:** confirmation must be blocked with a file-level error naming `ebitda_plan`.
5. To test **updates/corrections**, copy the valid file and change one value (e.g. Apex 2026-09
   `ebitda_actual` 1.62 → 1.70): the old observation should become superseded, not overwritten.

## Assumptions

- **Column set** is the documented schema from spec §6 / `IMPORT_SCHEMA`; nothing was added.
- **Unknown companies (row 12):** decided for the import feature: unknown IDs are **created** on import
  (with a warning), matching the import summary's "companies created" count.
- **EBITDA > revenue (row 18)** is not in the spec's rule list; it is included as a proposed
  consistency check.
- **`source_updated_at`** is the single date stored on the data source (`2026-10-03`), so all valid rows share it.
