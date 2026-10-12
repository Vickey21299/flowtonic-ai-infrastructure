// Applies database/migrations/*.sql (once each) and, with --seed, database/seed/*.sql.
// Then checks the data is readable through the Supabase REST API with the publishable key.
//
//   npm run db:migrate          migrations only
//   npm run db:seed             migrations + demo seed (re-runnable; reseeds from scratch)
//
// Needs DATABASE_URL (Postgres connection string) in backend/.env — the publishable key
// cannot create tables.
import { readdir, readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'database')
const { DATABASE_URL, SUPABASE_URL, SUPABASE_KEY } = process.env
const withSeed = process.argv.includes('--seed')

if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set in backend/.env (Supabase → Connect → Session pooler).')
  process.exit(1)
}

const sqlFiles = async (dir) =>
  (await readdir(join(root, dir))).filter((f) => f.endsWith('.sql')).sort().map((f) => join(root, dir, f))

const client = new pg.Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } })
await client.connect()

try {
  await client.query(`create table if not exists schema_migrations (
    name text primary key, applied_at timestamptz not null default now())`)
  await client.query('alter table schema_migrations enable row level security')

  const { rows } = await client.query('select name from schema_migrations')
  const applied = new Set(rows.map((r) => r.name))

  for (const file of await sqlFiles('migrations')) {
    const name = file.split(/[\\/]/).pop()
    if (applied.has(name)) continue
    console.log(`migrate  ${name}`)
    await client.query(await readFile(file, 'utf8'))
    await client.query('insert into schema_migrations (name) values ($1)', [name])
  }

  if (withSeed) {
    for (const file of await sqlFiles('seed')) {
      console.log(`seed     ${file.split(/[\\/]/).pop()}`)
      await client.query(await readFile(file, 'utf8'))
    }
  }

  // demo_reset(): the seed wrapped in a SECURITY DEFINER function, so the API's write role can restore
  // the demo dataset ("Reset demo") without holding truncate rights or the admin connection string.
  const seedSql = (await Promise.all((await sqlFiles('seed')).map((f) => readFile(f, 'utf8'))))
    .join('\n')
    .replace(/^\s*(begin|commit);\s*$/gim, '')
  if (seedSql.includes('$seed$')) throw new Error('Seed SQL must not contain $seed$')
  await client.query(`create or replace function demo_reset() returns void
    language plpgsql security definer set search_path = public as $fn$
    begin
      execute $seed$${seedSql}$seed$;
    end $fn$`)
  await client.query('revoke all on function demo_reset() from public')
  await client.query(`do $$ begin
    if exists (select 1 from pg_roles where rolname = 'flownetic_api_rw') then
      grant execute on function demo_reset() to flownetic_api_rw;
    end if; end $$`)
  console.log('function demo_reset() installed')

  // Ask PostgREST to pick up the new tables right away.
  await client.query(`notify pgrst, 'reload schema'`)

  const counts = await client.query(`
    select 'portfolio_companies' as t, count(*)::int as n from portfolio_companies union all
    select 'kpi_observations', count(*) from kpi_observations union all
    select 'kpi_results', count(*) from kpi_results union all
    select 'exceptions', count(*) from exceptions union all
    select 'investigations', count(*) from investigations union all
    select 'actions', count(*) from actions union all
    select 'impact_observations', count(*) from impact_observations union all
    select 'audit_events', count(*) from audit_events`)
  console.table(counts.rows)
} finally {
  await client.end()
}

if (SUPABASE_URL && SUPABASE_KEY) {
  await new Promise((r) => setTimeout(r, 1500)) // schema cache reload
  const res = await fetch(`${SUPABASE_URL}/rest/v1/portfolio_companies?select=name,status&order=name`, {
    headers: { apikey: SUPABASE_KEY },
  })
  console.log(`REST check (publishable key): HTTP ${res.status}`)
  if (res.ok) console.table(await res.json())
  else console.log(await res.text())
}
