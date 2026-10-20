import { neon, type NeonQueryFunction } from '@neondatabase/serverless'

// Server-side only. Created lazily so `next build` works without DATABASE_URL.
let client: NeonQueryFunction<false, false> | null = null
let schemaReady: Promise<void> | null = null

export function getSql() {
  const url = process.env.DATABASE_URL
  if (!url) return null
  client ??= neon(url)
  return client
}

// Idempotent; runs once per cold start so a fresh database needs no migration step.
export function ensureSchema(sql: NeonQueryFunction<false, false>) {
  schemaReady ??= (async () => {
    await sql`create table if not exists visits (
      id bigserial primary key,
      created_at timestamptz not null default now(),
      visitor_id text,
      path text,
      referrer text,
      ip text,
      country text,
      region text,
      city text,
      user_agent text,
      browser_language text,
      timezone text,
      screen text
    )`
    await sql`create table if not exists sessions (
      id uuid primary key,
      visitor_id text,
      started_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      language text,
      elapsed integer not null default 0,
      line_count integer not null default 0,
      lines jsonb not null default '[]',
      bookmarks jsonb not null default '[]',
      ip text,
      country text,
      city text,
      user_agent text
    )`
    await sql`create table if not exists notes (
      id uuid primary key,
      session_id uuid,
      visitor_id text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      source text,
      model text,
      note jsonb,
      note_text text
    )`
    await sql`create table if not exists events (
      id bigserial primary key,
      created_at timestamptz not null default now(),
      visitor_id text,
      session_id uuid,
      type text not null,
      data jsonb,
      ip text,
      country text,
      city text
    )`
    await sql`create index if not exists visits_created_at_idx on visits (created_at desc)`
    await sql`create index if not exists sessions_updated_at_idx on sessions (updated_at desc)`
    await sql`create index if not exists notes_session_id_idx on notes (session_id)`
    await sql`create index if not exists events_session_id_idx on events (session_id)`
  })().catch((error) => { schemaReady = null; throw error })
  return schemaReady
}
