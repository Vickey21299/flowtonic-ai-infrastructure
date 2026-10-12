-- Workflow writes (spec §8 exceptions, §10 actions, §11 impact, rule threshold changes). Additive.

alter table actions
  add column if not exists notes    jsonb not null default '[]',   -- [{id, at, author, text}]
  add column if not exists evidence jsonb not null default '[]';   -- [{id, at, kind, description, reference}]

-- A new impact record starts "not yet measurable"; baseline and target may be unknown at creation.
alter table impact_observations
  alter column baseline_value drop not null,
  alter column target_value drop not null,
  alter column verification_status set default 'not_yet_measurable',
  add column if not exists estimated_value        numeric(18, 6),  -- projection, never a realised result
  add column if not exists verification_rationale text,
  add column if not exists evidence_reference     text,
  add column if not exists updated_at             timestamptz;

do $$
declare t text;
begin
  if exists (select 1 from pg_roles where rolname = 'flownetic_api_rw') then
    foreach t in array array['actions', 'impact_observations', 'rules', 'rule_configurations'] loop
      execute format('grant select, insert, update on %I to flownetic_api_rw', t);
      execute format('drop policy if exists "api rw insert" on %I', t);
      execute format('drop policy if exists "api rw update" on %I', t);
      execute format('create policy "api rw insert" on %I for insert to flownetic_api_rw with check (true)', t);
      execute format('create policy "api rw update" on %I for update to flownetic_api_rw using (true) with check (true)', t);
    end loop;
  end if;
end $$;
