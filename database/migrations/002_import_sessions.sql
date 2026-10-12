-- Flownetic — CSV import support (spec §6). Additive only: no table is dropped or recreated,
-- no existing row is changed except where a new column gets its default.
--
-- Why each change is needed:
--   import_jobs.*            An import is a multi-step session (upload → map → confirm) that must
--                            survive a browser refresh, so its file, mapping and preview are stored.
--   import_jobs.source_id    Unknown until the import is committed (the source comes from the rows).
--   file_hash uniqueness     Only COMMITTED imports block a re-import of the same file; a cancelled
--                            or expired upload must be retryable.
--   kpi_observations.original_values
--                            Spec §6 provenance: "original value where appropriate" (raw CSV strings).
--   exceptions.condition_active / evaluated_at
--                            A later import can clear a breach. Business rule: the exception is then
--                            flagged "condition cleared — review", not auto-resolved (frontend demo engine).

begin;

-- ---------- Import sessions ----------

alter table import_jobs
  add column created_at       timestamptz not null default now(),
  add column created_by       text,
  add column raw_content      text,
  add column detected_columns jsonb not null default '[]',
  add column mapping          jsonb not null default '{}',
  add column file_errors      jsonb not null default '[]',
  add column rows             jsonb not null default '[]',
  add column summary          jsonb,
  add column committed_at     timestamptz,
  add column expires_at       timestamptz,
  add column updated_at       timestamptz not null default now();

-- Existing (seeded) jobs are committed imports.
update import_jobs set created_at = imported_at, committed_at = imported_at, created_by = imported_by
where status = 'committed';

alter table import_jobs alter column source_id drop not null;
alter table import_jobs add constraint import_jobs_committed_has_source
  check (status <> 'committed' or (source_id is not null and committed_at is not null));

alter table import_jobs drop constraint import_jobs_file_hash_key;
create unique index import_jobs_committed_file_hash_uq on import_jobs (file_hash) where status = 'committed';
create index import_jobs_file_hash_idx on import_jobs (file_hash);

-- ---------- Provenance ----------

alter table kpi_observations add column original_values jsonb not null default '{}';

-- ---------- Exception condition state ----------

alter table exceptions
  add column condition_active boolean not null default true,
  add column evaluated_at     timestamptz;

update exceptions set evaluated_at = created_at;
alter table exceptions alter column evaluated_at set not null;
alter table exceptions alter column evaluated_at set default now();

commit;
