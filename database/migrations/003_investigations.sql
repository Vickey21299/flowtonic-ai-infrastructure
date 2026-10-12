-- Investigations: store the full structured output, analyst edits, notes and review, and let the
-- API write role create and update investigations. Additive; existing rows keep their legacy columns.

alter table investigations
  add column if not exists output          jsonb,                         -- raw model / mock output, never edited
  add column if not exists edited_output   jsonb,                         -- analyst edit, kept separately
  add column if not exists evidence        jsonb not null default '[]',   -- what the output may cite
  add column if not exists notes           jsonb not null default '[]',   -- [{id, at, author, text}]
  add column if not exists error           jsonb,                         -- {category, message} when failed
  add column if not exists input_reference jsonb,                         -- company, period, KPI ids sent
  add column if not exists created_by      text,
  add column if not exists reviewed_by     text,
  add column if not exists reviewed_at     timestamptz,
  add column if not exists updated_at      timestamptz;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'flownetic_api_rw') then
    grant select, insert, update on investigations to flownetic_api_rw;
    drop policy if exists "api rw insert" on investigations;
    drop policy if exists "api rw update" on investigations;
    create policy "api rw insert" on investigations for insert to flownetic_api_rw with check (true);
    create policy "api rw update" on investigations for update to flownetic_api_rw using (true) with check (true);
  end if;
end $$;
