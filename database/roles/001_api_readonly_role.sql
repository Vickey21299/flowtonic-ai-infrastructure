-- Read-only login role used by the FastAPI backend (phase 1: data fetching only).
-- Does not change any table, column or row. Re-runnable.
-- Applied by backend/scripts/create_readonly_role.py, which substitutes the password
-- placeholder below with a generated one and stores the connection string in backend/.env.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'flownetic_api_ro') then
    create role flownetic_api_ro login noinherit nobypassrls password '__PASSWORD__';
  else
    alter role flownetic_api_ro login noinherit nobypassrls password '__PASSWORD__';
  end if;
end $$;

-- Every session of this role is read-only by default.
alter role flownetic_api_ro set default_transaction_read_only = on;
alter role flownetic_api_ro set statement_timeout = '10s';

grant usage on schema public to flownetic_api_ro;

-- SELECT only, on exactly the application tables; plus a matching RLS read policy,
-- because RLS is enabled on every table (see migrations/001_init.sql).
do $$
declare t text;
begin
  foreach t in array array[
    'portfolio_companies', 'data_sources', 'import_jobs', 'import_row_errors',
    'kpi_observations', 'kpi_results', 'rule_configurations', 'rules', 'exceptions',
    'investigations', 'actions', 'impact_observations', 'audit_events'
  ] loop
    execute format('grant select on %I to flownetic_api_ro', t);
    execute format('drop policy if exists "read for api role" on %I', t);
    execute format('create policy "read for api role" on %I for select to flownetic_api_ro using (true)', t);
  end loop;
end $$;
