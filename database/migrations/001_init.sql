-- Flownetic — initial schema (PostgreSQL / Supabase).
-- Follows database/system.md. Money and percentages are numeric, never float.
-- IDs are opaque text so seeds can use stable, readable identifiers.

begin;

-- ---------- Companies & sources ----------

create table portfolio_companies (
  id          text primary key default gen_random_uuid()::text,
  name        text not null unique,
  sector      text,
  currency    char(3) not null default 'USD',
  status      text not null default 'insufficient_data'
              check (status in ('on_track', 'warning', 'exception', 'insufficient_data')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table data_sources (
  id          text primary key default gen_random_uuid()::text,
  name        text not null unique,
  kind        text not null check (kind in ('csv', 'manual', 'api')),
  updated_at  timestamptz
);

create table import_jobs (
  id             text primary key default gen_random_uuid()::text,
  source_id      text not null references data_sources (id),
  file_name      text not null,
  file_hash      text not null unique,          -- re-importing the same file adds nothing
  status         text not null
                 check (status in ('uploaded', 'validated', 'committed', 'cancelled', 'failed')),
  rows_total     int not null default 0 check (rows_total >= 0),
  rows_imported  int not null default 0 check (rows_imported >= 0),
  rows_invalid   int not null default 0 check (rows_invalid >= 0),
  imported_at    timestamptz not null default now(),
  imported_by    text not null,
  check (rows_imported + rows_invalid <= rows_total)
);

-- Invalid rows are never silently dropped: row number, field and reason are kept.
create table import_row_errors (
  id             text primary key default gen_random_uuid()::text,
  import_job_id  text not null references import_jobs (id) on delete cascade,
  source_row     int not null check (source_row >= 2),
  field          text not null,
  raw_value      text,
  reason         text not null
);

-- ---------- Observations & KPI results ----------

create table kpi_observations (
  id                 text primary key default gen_random_uuid()::text,
  company_id         text not null references portfolio_companies (id),
  import_job_id      text not null references import_jobs (id),
  source_row         int,
  metric_key         text not null check (metric_key in ('revenue', 'ebitda')),
  actual_value       numeric(18, 6),
  plan_value         numeric(18, 6),
  reporting_period   text not null check (reporting_period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  validation_status  text not null check (validation_status in ('valid', 'warning', 'invalid')),
  is_current         boolean not null default true,
  superseded_by      text references kpi_observations (id),
  imported_at        timestamptz not null default now()
);

-- One current value per company, metric and period. Corrections supersede, never overwrite.
create unique index kpi_observations_current_uq
  on kpi_observations (company_id, metric_key, reporting_period) where is_current;

create table kpi_results (
  id                text primary key default gen_random_uuid()::text,
  company_id        text not null references portfolio_companies (id),
  observation_id    text references kpi_observations (id),
  kpi_key           text not null check (kpi_key in (
                      'revenue_variance', 'revenue_variance_pct',
                      'ebitda_variance', 'ebitda_variance_pct',
                      'ebitda_margin_actual_pct', 'ebitda_margin_plan_pct',
                      'ebitda_margin_variance_pp')),
  value             numeric(20, 10),
  calc_status       text not null check (calc_status in ('ok', 'not_calculable', 'sign_ambiguous')),
  calc_reason       text,
  reporting_period  text not null check (reporting_period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  calculated_at     timestamptz not null default now(),
  unique (company_id, reporting_period, kpi_key),
  check ((calc_status = 'not_calculable') = (value is null))
);

-- ---------- Rules ----------

create table rule_configurations (
  id            text primary key default gen_random_uuid()::text,
  version       int not null unique check (version > 0),
  is_active     boolean not null default false,
  activated_at  timestamptz
);

-- Only one active configuration.
create unique index rule_configurations_one_active_uq
  on rule_configurations (is_active) where is_active;

create table rules (
  id                text primary key default gen_random_uuid()::text,
  configuration_id  text not null references rule_configurations (id) on delete cascade,
  rule_key          text not null,
  label             text not null,
  kpi_key           text not null,
  comparator        text not null default 'lte' check (comparator in ('lte')),
  threshold         numeric(12, 4) not null,
  severity          text not null check (severity in ('high', 'medium', 'warning')),
  enabled           boolean not null default true,
  unique (configuration_id, rule_key)
);

-- ---------- Exceptions & investigations ----------

create table exceptions (
  id                 text primary key default gen_random_uuid()::text,
  company_id         text not null references portfolio_companies (id),
  observation_id     text references kpi_observations (id),
  kpi_result_id      text references kpi_results (id),
  rule_id            text not null references rules (id),
  metric_key         text not null check (metric_key in ('revenue', 'ebitda', 'ebitda_margin')),
  kpi_key            text not null,
  reporting_period   text not null,
  severity           text not null check (severity in ('high', 'medium', 'warning')),
  threshold          numeric(12, 4) not null,
  variance_value     numeric(20, 10),
  status             text not null default 'open'
                     check (status in ('open', 'acknowledged', 'in_review', 'resolved')),
  owner              text,
  resolution_reason  text check (resolution_reason in
                       ('action_verified', 'data_corrected', 'condition_cleared', 'not_material', 'other')),
  resolution_note    text,
  created_at         timestamptz not null default now(),
  resolved_at        timestamptz,
  -- Prevents duplicate exceptions when an import runs twice.
  unique (company_id, reporting_period, metric_key, rule_id),
  check ((status = 'resolved') = (resolved_at is not null and resolution_reason is not null))
);

create table investigations (
  id                 text primary key default gen_random_uuid()::text,
  exception_id       text not null references exceptions (id) on delete cascade,
  mode               text not null check (mode in ('live', 'mock')),
  status             text not null check (status in ('running', 'completed', 'failed')),
  findings           jsonb not null default '[]',
  hypotheses         jsonb not null default '[]',
  missing_evidence   jsonb not null default '[]',
  suggested_actions  jsonb not null default '[]',
  model_metadata     jsonb not null default '{}',
  analyst_notes      text,
  review_status      text not null default 'unreviewed' check (review_status in ('unreviewed', 'reviewed')),
  created_at         timestamptz not null default now()
);

-- ---------- Actions & impact ----------

create table actions (
  id                  text primary key default gen_random_uuid()::text,
  exception_id        text not null references exceptions (id) on delete cascade,
  investigation_id    text references investigations (id),
  title               text not null,
  description         text,
  priority            text not null default 'medium' check (priority in ('high', 'medium', 'low')),
  owner               text,
  due_date            date,
  status              text not null default 'proposed' check (status in (
                        'proposed', 'approved', 'in_progress', 'completed',
                        'outcome_verification', 'verified', 'reopened', 'cancelled')),
  completion_notes    text,
  evidence_reference  text,
  cancel_reason       text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  -- Approval needs an owner and a due date; cancelling needs a reason.
  check (status in ('proposed', 'cancelled') or (owner is not null and due_date is not null)),
  check (status <> 'cancelled' or cancel_reason is not null)
);

create table impact_observations (
  id                   text primary key default gen_random_uuid()::text,
  action_id            text not null references actions (id) on delete cascade,
  metric_key           text not null check (metric_key in ('revenue', 'ebitda', 'ebitda_margin')),
  baseline_value       numeric(18, 6) not null,
  baseline_period      text not null,
  target_value         numeric(18, 6) not null,
  target_period        text not null,
  observed_value       numeric(18, 6),
  observation_period   text,
  measurement_source   text,
  verification_status  text not null default 'unverified'
                       check (verification_status in ('not_yet_measurable', 'unverified', 'verified', 'rejected')),
  reviewer             text,
  notes                text,
  created_at           timestamptz not null default now(),
  -- Verified only with an observed value, its source and a reviewer.
  check (verification_status <> 'verified'
         or (observed_value is not null and measurement_source is not null and reviewer is not null))
);

-- ---------- Audit ----------

create table audit_events (
  id           text primary key default gen_random_uuid()::text,
  entity_type  text not null,
  entity_id    text not null,
  change       text not null,
  detail       text,
  actor        text not null,
  created_at   timestamptz not null default now()
);

create index audit_events_entity_idx on audit_events (entity_type, entity_id, created_at);

-- ---------- KPI formulas (spec §7; mirrors frontend/src/demo/kpi.ts) ----------

create or replace function calc_kpis(ra numeric, rp numeric, ea numeric, ep numeric)
returns table (kpi_key text, value numeric, calc_status text, calc_reason text)
language plpgsql immutable as $$
declare
  k text; lbl text; a numeric; p numeric; miss text;
  ma_ok boolean; mp_ok boolean; ma_r text; mp_r text;
begin
  foreach k in array array['revenue', 'ebitda'] loop
    if k = 'revenue' then lbl := 'Revenue'; a := ra; p := rp;
    else lbl := 'EBITDA'; a := ea; p := ep; end if;

    miss := case
      when a is null and p is null then lbl || ' actual and plan are missing'
      when a is null then lbl || ' actual is missing'
      when p is null then lbl || ' plan is missing'
    end;

    if miss is not null then
      kpi_key := k || '_variance';     value := null; calc_status := 'not_calculable'; calc_reason := miss; return next;
      kpi_key := k || '_variance_pct'; return next;
      continue;
    end if;

    kpi_key := k || '_variance'; value := round(a - p, 10); calc_status := 'ok'; calc_reason := null; return next;

    kpi_key := k || '_variance_pct';
    if p = 0 then
      value := null; calc_status := 'not_calculable'; calc_reason := lbl || ' plan is zero';
    else
      value := round((a - p) * 100 / p, 10);
      if p < 0 then
        calc_status := 'sign_ambiguous';
        calc_reason := lbl || ' plan is negative, so the sign of the percentage variance is ambiguous';
      else
        calc_status := 'ok'; calc_reason := null;
      end if;
    end if;
    return next;
  end loop;

  ma_r := case when ra is null then 'Revenue actual is missing'
               when ea is null then 'EBITDA actual is missing'
               when ra = 0 then 'Revenue actual is zero' end;
  mp_r := case when rp is null then 'Revenue plan is missing'
               when ep is null then 'EBITDA plan is missing'
               when rp = 0 then 'Revenue plan is zero' end;
  ma_ok := ma_r is null;
  mp_ok := mp_r is null;

  kpi_key := 'ebitda_margin_actual_pct';
  if ma_ok then value := round(ea * 100 / ra, 10); calc_status := 'ok'; calc_reason := null;
  else value := null; calc_status := 'not_calculable'; calc_reason := ma_r; end if;
  return next;

  kpi_key := 'ebitda_margin_plan_pct';
  if mp_ok then value := round(ep * 100 / rp, 10); calc_status := 'ok'; calc_reason := null;
  else value := null; calc_status := 'not_calculable'; calc_reason := mp_r; end if;
  return next;

  kpi_key := 'ebitda_margin_variance_pp';
  if ma_ok and mp_ok then
    value := round(100 * (ea * rp - ep * ra) / (ra * rp), 10); calc_status := 'ok'; calc_reason := null;
  else
    value := null; calc_status := 'not_calculable';
    calc_reason := 'Requires both margins: ' || concat_ws('; ', ma_r, mp_r);
  end if;
  return next;
end;
$$;

-- ---------- Row-level security ----------
-- RLS on everywhere. The publishable (anon) key may only READ; all writes go through
-- the backend (service role / direct connection), which bypasses RLS.

do $$
declare t text;
begin
  foreach t in array array[
    'portfolio_companies', 'data_sources', 'import_jobs', 'import_row_errors',
    'kpi_observations', 'kpi_results', 'rule_configurations', 'rules', 'exceptions',
    'investigations', 'actions', 'impact_observations', 'audit_events'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy "read for anon and authenticated" on %I for select to anon, authenticated using (true)', t);
  end loop;
end $$;

commit;
