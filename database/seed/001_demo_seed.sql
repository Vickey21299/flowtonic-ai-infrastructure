-- Flownetic — demo seed (all data fictional; USD millions, monthly periods).
--
-- Re-runnable: clears every table, then reseeds in one transaction.
-- Only raw facts are typed in here (companies, imported rows, rules, workflow records).
-- KPI results, exceptions and company status are CALCULATED from the observations.
--
-- The three spec companies (flowtonic.txt §13) keep the exact Sep 2026 figures used by
-- frontend/src/demo/seed.ts. The other five companies and Jul/Aug are extra demo data.
-- Built-in edge cases:
--   * Meridian Sep revenue was corrected (17.9 → 18.1) by a later import: the old row is superseded.
--   * Ridgeway Sep EBITDA plan is missing        → not calculable → insufficient_data.
--   * Vantage has a negative EBITDA plan         → sign-ambiguous % → insufficient_data.
--   * Sterling breached in Aug, recovered in Sep → Aug exception resolved (condition cleared).
--   * The Sep file had one invalid row (Harbor Logistics, ebitda_actual = "n/a").

begin;

truncate audit_events, impact_observations, actions, investigations, exceptions, rules,
         rule_configurations, kpi_results, kpi_observations, import_row_errors, import_jobs,
         data_sources, portfolio_companies cascade;

-- ---------- Companies ----------

insert into portfolio_companies (id, name, sector, currency, created_at, updated_at) values
  ('northstar-components',  'Northstar Components',      'Industrial components', 'USD', '2026-08-04T09:00:00Z', '2026-08-04T09:00:00Z'),
  ('apex-field-services',   'Apex Field Services',       'Field services',        'USD', '2026-08-04T09:00:00Z', '2026-08-04T09:00:00Z'),
  ('meridian-distribution', 'Meridian Distribution',     'Distribution',          'USD', '2026-08-04T09:00:00Z', '2026-08-04T09:00:00Z'),
  ('cobalt-software',       'Cobalt Software',           'Software',              'USD', '2026-08-04T09:00:00Z', '2026-08-04T09:00:00Z'),
  ('lumen-healthcare',      'Lumen Healthcare Services', 'Healthcare services',   'USD', '2026-08-04T09:00:00Z', '2026-08-04T09:00:00Z'),
  ('ridgeway-foods',        'Ridgeway Foods',            'Food production',       'USD', '2026-08-04T09:00:00Z', '2026-08-04T09:00:00Z'),
  ('sterling-packaging',    'Sterling Packaging',        'Packaging',             'USD', '2026-08-04T09:00:00Z', '2026-08-04T09:00:00Z'),
  ('vantage-retail',        'Vantage Retail Group',      'Specialty retail',      'USD', '2026-08-04T09:00:00Z', '2026-08-04T09:00:00Z');

-- ---------- Source & import jobs ----------

insert into data_sources (id, name, kind, updated_at) values
  ('src-mgmt-accounts', 'Monthly management accounts (fictional)', 'csv', '2026-10-03T00:00:00Z');

insert into import_jobs (id, source_id, file_name, file_hash, status, rows_total, rows_imported, rows_invalid, imported_at, imported_by,
                         created_at, committed_at, created_by)
select id, 'src-mgmt-accounts', file_name, encode(sha256(convert_to(file_name, 'UTF8')), 'hex'),
       'committed', rows_total, rows_imported, rows_invalid, imported_at::timestamptz, 'Demo User',
       imported_at::timestamptz, imported_at::timestamptz, 'Demo User'
from (values
  ('JOB-0001', 'portfolio_2026-07.csv',            8, 8, 0, '2026-08-04T09:00:00Z'),
  ('JOB-0002', 'portfolio_2026-08.csv',            8, 8, 0, '2026-09-03T09:00:00Z'),
  ('JOB-0003', 'portfolio_2026-09.csv',            9, 8, 1, '2026-10-05T09:30:00Z'),
  ('JOB-0004', 'meridian_correction_2026-09.csv',  1, 1, 0, '2026-10-07T14:10:00Z')
) as j (id, file_name, rows_total, rows_imported, rows_invalid, imported_at);

insert into import_row_errors (import_job_id, source_row, field, raw_value, reason) values
  ('JOB-0003', 10, 'ebitda_actual', 'n/a', 'Not a number. Expected a plain number in USD millions.');

-- ---------- Observations (one row per company + period from the CSVs, unpivoted) ----------

with src (company_id, period, job, source_row, imported_at, rev_a, rev_p, ebitda_a, ebitda_p) as (values
  -- Jul 2026 (JOB-0001)
  ('northstar-components',  '2026-07', 'JOB-0001', 2, '2026-08-04T09:00:00Z', 23.9, 23.5,  3.10,  3.05),
  ('apex-field-services',   '2026-07', 'JOB-0001', 3, '2026-08-04T09:00:00Z', 11.0, 11.0,  1.80,  1.85),
  ('meridian-distribution', '2026-07', 'JOB-0001', 4, '2026-08-04T09:00:00Z', 18.5, 18.6,  2.33,  2.36),
  ('cobalt-software',       '2026-07', 'JOB-0001', 5, '2026-08-04T09:00:00Z',  6.4,  6.2,  1.45,  1.40),
  ('lumen-healthcare',      '2026-07', 'JOB-0001', 6, '2026-08-04T09:00:00Z', 14.2, 14.5,  2.10,  2.20),
  ('ridgeway-foods',        '2026-07', 'JOB-0001', 7, '2026-08-04T09:00:00Z', 21.0, 20.8,  1.60,  1.55),
  ('sterling-packaging',    '2026-07', 'JOB-0001', 8, '2026-08-04T09:00:00Z',  9.8,  9.9,  1.25,  1.28),
  ('vantage-retail',        '2026-07', 'JOB-0001', 9, '2026-08-04T09:00:00Z',  7.2,  7.0, -0.30, -0.40),
  -- Aug 2026 (JOB-0002)
  ('northstar-components',  '2026-08', 'JOB-0002', 2, '2026-09-03T09:00:00Z', 24.2, 23.8,  3.15,  3.08),
  ('apex-field-services',   '2026-08', 'JOB-0002', 3, '2026-09-03T09:00:00Z', 10.9, 11.1,  1.72,  1.88),
  ('meridian-distribution', '2026-08', 'JOB-0002', 4, '2026-09-03T09:00:00Z', 18.3, 18.7,  2.25,  2.35),
  ('cobalt-software',       '2026-08', 'JOB-0002', 5, '2026-09-03T09:00:00Z',  6.6,  6.4,  1.52,  1.46),
  ('lumen-healthcare',      '2026-08', 'JOB-0002', 6, '2026-09-03T09:00:00Z', 13.6, 14.6,  1.95,  2.22),
  ('ridgeway-foods',        '2026-08', 'JOB-0002', 7, '2026-09-03T09:00:00Z', 21.3, 21.0,  1.62,  1.58),
  ('sterling-packaging',    '2026-08', 'JOB-0002', 8, '2026-09-03T09:00:00Z',  9.7,  9.9,  1.20,  1.28),
  ('vantage-retail',        '2026-08', 'JOB-0002', 9, '2026-09-03T09:00:00Z',  7.4,  7.2, -0.20, -0.35),
  -- Sep 2026 (JOB-0003) — spec §13 values for the first three
  ('northstar-components',  '2026-09', 'JOB-0003', 2, '2026-10-05T09:30:00Z', 24.6, 24.0,  3.20,  3.12),
  ('apex-field-services',   '2026-09', 'JOB-0003', 3, '2026-10-05T09:30:00Z', 10.8, 11.2,  1.62,  1.90),
  ('meridian-distribution', '2026-09', 'JOB-0003', 4, '2026-10-05T09:30:00Z', 18.1, 18.8,  2.17,  2.35),
  ('cobalt-software',       '2026-09', 'JOB-0003', 5, '2026-10-05T09:30:00Z',  6.9,  6.6,  1.60,  1.50),
  ('lumen-healthcare',      '2026-09', 'JOB-0003', 6, '2026-10-05T09:30:00Z', 13.4, 14.7,  1.88,  2.25),
  ('ridgeway-foods',        '2026-09', 'JOB-0003', 7, '2026-10-05T09:30:00Z', 21.5, 21.2,  1.66,  null),
  ('sterling-packaging',    '2026-09', 'JOB-0003', 8, '2026-10-05T09:30:00Z',  9.9, 10.0,  1.27,  1.30),
  ('vantage-retail',        '2026-09', 'JOB-0003', 9, '2026-10-05T09:30:00Z',  7.5,  7.6, -0.25, -0.30)
)
insert into kpi_observations (id, company_id, import_job_id, source_row, metric_key, actual_value, plan_value,
                              reporting_period, validation_status, imported_at)
select s.company_id || ':' || s.period || ':' || m.metric_key,
       s.company_id, s.job, s.source_row, m.metric_key, m.actual, m.plan, s.period,
       case when m.actual is null or m.plan is null then 'warning' else 'valid' end,
       s.imported_at::timestamptz
from src s
cross join lateral (values
  ('revenue', s.rev_a::numeric,    s.rev_p::numeric),
  ('ebitda',  s.ebitda_a::numeric, s.ebitda_p::numeric)
) as m (metric_key, actual, plan);

-- Correction: Meridian Sep revenue was first imported as 17.9, later corrected to 18.1.
-- The seed rows above already hold the corrected value, so add the original as superseded history.
update kpi_observations set import_job_id = 'JOB-0004', source_row = 2, imported_at = '2026-10-07T14:10:00Z'
where id = 'meridian-distribution:2026-09:revenue';

insert into kpi_observations (id, company_id, import_job_id, source_row, metric_key, actual_value, plan_value,
                              reporting_period, validation_status, is_current, superseded_by, imported_at)
values ('meridian-distribution:2026-09:revenue:v1', 'meridian-distribution', 'JOB-0003', 4, 'revenue',
        17.9, 18.8, '2026-09', 'valid', false, 'meridian-distribution:2026-09:revenue', '2026-10-05T09:30:00Z');

-- ---------- Rules (one active configuration, v1 — same as the frontend demo) ----------

insert into rule_configurations (id, version, is_active, activated_at) values
  ('rulecfg-v1', 1, true, '2026-08-01T00:00:00Z');

insert into rules (id, configuration_id, rule_key, label, kpi_key, comparator, threshold, severity, enabled) values
  ('rule-ebitda-high', 'rulecfg-v1', 'EBITDA_VAR_HIGH', 'EBITDA variance — high priority', 'ebitda_variance_pct',  'lte', -10, 'high',    true),
  ('rule-ebitda-warn', 'rulecfg-v1', 'EBITDA_VAR_WARN', 'EBITDA variance — warning',       'ebitda_variance_pct',  'lte',  -5, 'warning', true),
  ('rule-revenue',     'rulecfg-v1', 'REVENUE_VAR',     'Revenue variance',                'revenue_variance_pct', 'lte',  -5, 'medium',  true);

-- ---------- KPI results (calculated from current observations) ----------

insert into kpi_results (company_id, observation_id, kpi_key, value, calc_status, calc_reason, reporting_period, calculated_at)
select f.company_id,
       case when k.kpi_key like 'revenue%' then f.rev_obs else f.ebitda_obs end,
       k.kpi_key, k.value, k.calc_status, k.calc_reason, f.reporting_period, f.imported_at
from (
  select company_id, reporting_period,
         max(id)           filter (where metric_key = 'revenue') as rev_obs,
         max(id)           filter (where metric_key = 'ebitda')  as ebitda_obs,
         max(actual_value) filter (where metric_key = 'revenue') as ra,
         max(plan_value)   filter (where metric_key = 'revenue') as rp,
         max(actual_value) filter (where metric_key = 'ebitda')  as ea,
         max(plan_value)   filter (where metric_key = 'ebitda')  as ep,
         max(imported_at) as imported_at
  from kpi_observations
  where is_current
  group by company_id, reporting_period
) f
cross join lateral calc_kpis(f.ra, f.rp, f.ea, f.ep) k;

-- ---------- Exceptions (rules evaluated against KPI results) ----------
-- Per company, period and KPI only the most severe matching rule raises an exception.

insert into exceptions (id, company_id, observation_id, kpi_result_id, rule_id, metric_key, kpi_key,
                        reporting_period, severity, threshold, variance_value, created_at)
select 'EXC-' || lpad((row_number() over (order by w.reporting_period, w.company_id, w.kpi_key))::text, 4, '0'),
       w.company_id, w.observation_id, w.kpi_result_id, w.rule_id,
       split_part(w.kpi_key, '_variance', 1), w.kpi_key, w.reporting_period,
       w.severity, w.threshold, w.value, w.calculated_at
from (
  select distinct on (r.company_id, r.reporting_period, r.kpi_key)
         r.company_id, r.observation_id, r.id as kpi_result_id, r.kpi_key, r.reporting_period,
         r.value, r.calculated_at, ru.id as rule_id, ru.severity, ru.threshold
  from kpi_results r
  join rules ru on ru.kpi_key = r.kpi_key and ru.enabled
  join rule_configurations c on c.id = ru.configuration_id and c.is_active
  where r.calc_status = 'ok' and r.value <= ru.threshold
  order by r.company_id, r.reporting_period, r.kpi_key,
           case ru.severity when 'high' then 3 when 'medium' then 2 else 1 end desc, ru.threshold
) w;

insert into audit_events (entity_type, entity_id, change, detail, actor, created_at)
select 'exception', e.id,
       'Exception created by rule ' || ru.rule_key,
       e.kpi_key || ' = ' || round(e.variance_value, 4) || ' under rule configuration v1. Triggered by import.',
       'System (rules engine)', e.created_at
from exceptions e join rules ru on ru.id = e.rule_id;

-- ---------- Workflow state (looked up by business key, not by generated id) ----------

-- Earlier-period exceptions that were triaged.
update exceptions set status = 'acknowledged', owner = 'Priya Shah'
where company_id = 'apex-field-services' and reporting_period = '2026-08';

update exceptions set status = 'acknowledged', owner = 'Daniel Okafor'
where company_id = 'lumen-healthcare' and reporting_period = '2026-08';

update exceptions set status = 'resolved', owner = 'Maria Lindqvist',
       resolution_reason = 'condition_cleared',
       resolution_note = 'EBITDA back within 5% of plan in Sep 2026 (−2.3%).',
       resolved_at = '2026-10-06T11:00:00Z'
where company_id = 'sterling-packaging' and reporting_period = '2026-08';

-- Current period.
update exceptions set status = 'in_review', owner = 'Priya Shah'
where company_id = 'apex-field-services' and reporting_period = '2026-09' and kpi_key = 'ebitda_variance_pct';

update exceptions set status = 'acknowledged', owner = 'Daniel Okafor'
where company_id = 'lumen-healthcare' and reporting_period = '2026-09';

insert into audit_events (entity_type, entity_id, change, detail, actor, created_at)
select 'exception', id,
       'Status changed: open → ' || status,
       coalesce(resolution_note, 'Owner: ' || owner),
       coalesce(owner, 'Demo User'),
       coalesce(resolved_at, created_at + interval '1 day')
from exceptions where status <> 'open';

-- Mock investigation for Apex Sep EBITDA (no causal claims; evidence gaps named).
insert into investigations (id, exception_id, mode, status, findings, hypotheses, missing_evidence,
                            suggested_actions, model_metadata, analyst_notes, review_status, created_at)
select 'INV-0001', e.id, 'mock', 'completed',
       jsonb_build_array(
         'EBITDA actual 1.62 vs plan 1.90 (−14.7368%).',
         'Revenue actual 10.8 vs plan 11.2 (−3.5714%).',
         'EBITDA margin 15.0000% vs planned 16.9643% (−1.9643 pp).',
         'EBITDA was also below plan in Aug 2026 (−8.5106%).'),
       '[
          {"id":"exp-volume","statement":"Lower sales volume could contribute to the variance, but sales-volume data has not been supplied.","evidence_strength":"weak"},
          {"id":"exp-pricing","statement":"Lower average pricing could contribute to the variance, but pricing data has not been supplied.","evidence_strength":"weak"},
          {"id":"exp-costs","statement":"Operating costs above plan could contribute to the variance, but operating-expense data has not been supplied.","evidence_strength":"weak"}
        ]'::jsonb,
       '[
          {"id":"sales_volume","type":"Sales volume","why_needed":"Separates a change in jobs completed from a change in price."},
          {"id":"operating_expenses","type":"Operating expenses","why_needed":"Shows which cost lines moved against plan."}
        ]'::jsonb,
       '[
          {"title":"Request supporting operating data from management"},
          {"title":"Schedule a variance review with the management team"}
        ]'::jsonb,
       '{"provider":"none (mock)","model":"Deterministic template — not an AI model","prompt_version":"mock-template-v1"}'::jsonb,
       'Second consecutive month below plan. Data requested before drawing conclusions.',
       'reviewed', '2026-10-06T10:15:00Z'
from exceptions e
where e.company_id = 'apex-field-services' and e.reporting_period = '2026-09' and e.kpi_key = 'ebitda_variance_pct';

-- Actions.
insert into actions (id, exception_id, investigation_id, title, description, priority, owner, due_date, status,
                     completion_notes, evidence_reference, created_at, updated_at)
select a.id, e.id, a.investigation_id, a.title, a.description, a.priority, a.owner, a.due_date::date, a.status,
       a.completion_notes, a.evidence_reference, a.created_at::timestamptz, a.updated_at::timestamptz
from (values
  ('ACT-0001', 'apex-field-services', '2026-09', 'ebitda_variance_pct', 'INV-0001',
   'Request supporting operating data from management',
   'Ask Apex for jobs completed, average rates and an opex breakdown against plan for Aug and Sep.',
   'high', 'Priya Shah', '2026-10-24', 'in_progress', null, null,
   '2026-10-06T10:30:00Z', '2026-10-07T09:00:00Z'),
  ('ACT-0002', 'apex-field-services', '2026-09', 'ebitda_variance_pct', 'INV-0001',
   'Schedule a variance review with the management team',
   'Review call with the Apex CEO and CFO once the requested data is received.',
   'medium', 'Priya Shah', '2026-10-31', 'approved', null, null,
   '2026-10-06T10:30:00Z', '2026-10-06T10:45:00Z'),
  ('ACT-0003', 'lumen-healthcare', '2026-08', 'ebitda_variance_pct', null,
   'Agree a cost-reduction plan with the Lumen CFO',
   'Target agency staffing costs, which management flagged as above plan.',
   'high', 'Daniel Okafor', '2026-09-30', 'outcome_verification',
   'Plan agreed on 2026-09-26: agency hours capped, two clinics consolidated.',
   'Board pack Sep 2026, p. 14',
   '2026-09-08T13:00:00Z', '2026-10-06T16:00:00Z'),
  ('ACT-0004', 'meridian-distribution', '2026-09', 'ebitda_variance_pct', null,
   'Confirm freight cost assumptions in the plan',
   null, 'low', null, null, 'proposed', null, null,
   '2026-10-08T08:30:00Z', '2026-10-08T08:30:00Z')
) as a (id, company_id, period, kpi_key, investigation_id, title, description, priority, owner, due_date, status,
        completion_notes, evidence_reference, created_at, updated_at)
join exceptions e on e.company_id = a.company_id and e.reporting_period = a.period and e.kpi_key = a.kpi_key;

insert into audit_events (entity_type, entity_id, change, actor, created_at)
select 'action', id, 'Action created (' || status || ')', coalesce(owner, 'Demo User'), created_at from actions;

-- Impact records: one not yet measurable, one awaiting verification.
insert into impact_observations (action_id, metric_key, baseline_value, baseline_period, target_value, target_period,
                                 observed_value, observation_period, measurement_source, verification_status,
                                 reviewer, notes, created_at) values
  ('ACT-0001', 'ebitda', 1.62, '2026-09', 1.85, '2026-11', null, null, null,
   'not_yet_measurable', null, 'First measurable period is Nov 2026.', '2026-10-06T10:35:00Z'),
  ('ACT-0003', 'ebitda', 1.95, '2026-08', 2.15, '2026-10', 1.88, '2026-09',
   'Monthly management accounts (fictional)', 'unverified', null,
   'Sep EBITDA still below baseline; plan took effect late in the month. Awaiting Oct figures.',
   '2026-10-06T16:00:00Z');

-- ---------- Company status (derived from open exceptions and KPI completeness, latest period) ----------

with latest as (select max(reporting_period) as p from kpi_observations where is_current),
st as (
  select c.id,
         case
           when exists (select 1 from exceptions e, latest
                        where e.company_id = c.id and e.reporting_period = latest.p
                          and e.status <> 'resolved' and e.severity in ('high', 'medium')) then 'exception'
           when exists (select 1 from exceptions e, latest
                        where e.company_id = c.id and e.reporting_period = latest.p
                          and e.status <> 'resolved' and e.severity = 'warning') then 'warning'
           when (select count(*) from kpi_results r, latest
                 where r.company_id = c.id and r.reporting_period = latest.p and r.calc_status = 'ok') < 7
             then 'insufficient_data'
           else 'on_track'
         end as status
  from portfolio_companies c
)
update portfolio_companies c set status = st.status, updated_at = '2026-10-07T14:10:00Z'
from st where st.id = c.id;

commit;
