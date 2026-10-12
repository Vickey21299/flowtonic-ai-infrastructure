-- Write role used ONLY by the FastAPI import endpoints (spec phase 2).
-- INSERT/UPDATE on the tables an import touches; SELECT on everything it reads.
-- No DELETE, no TRUNCATE, no DDL. Does not change any table, column or row. Re-runnable.
-- Applied by backend/scripts/create_api_roles.py (password placeholder substituted there).

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'flownetic_api_rw') then
    create role flownetic_api_rw login noinherit nobypassrls password '__PASSWORD__';
  else
    alter role flownetic_api_rw login noinherit nobypassrls password '__PASSWORD__';
  end if;
end $$;

alter role flownetic_api_rw set statement_timeout = '30s';

grant usage on schema public to flownetic_api_rw;

do $$
declare t text;
begin
  -- Read-only for this role.
  foreach t in array array['rule_configurations', 'rules', 'investigations', 'actions', 'impact_observations'] loop
    execute format('grant select on %I to flownetic_api_rw', t);
    execute format('drop policy if exists "api rw select" on %I', t);
    execute format('create policy "api rw select" on %I for select to flownetic_api_rw using (true)', t);
  end loop;

  -- Written by an import.
  foreach t in array array[
    'portfolio_companies', 'data_sources', 'import_jobs', 'import_row_errors',
    'kpi_observations', 'kpi_results', 'exceptions', 'audit_events'
  ] loop
    execute format('grant select, insert, update on %I to flownetic_api_rw', t);
    execute format('drop policy if exists "api rw select" on %I', t);
    execute format('drop policy if exists "api rw insert" on %I', t);
    execute format('drop policy if exists "api rw update" on %I', t);
    execute format('create policy "api rw select" on %I for select to flownetic_api_rw using (true)', t);
    execute format('create policy "api rw insert" on %I for insert to flownetic_api_rw with check (true)', t);
    execute format('create policy "api rw update" on %I for update to flownetic_api_rw using (true) with check (true)', t);
  end loop;
end $$;
