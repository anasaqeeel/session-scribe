import { NextResponse } from 'next/server'
import { ensureSchema, getSql } from '@/lib/db'

export const runtime = 'nodejs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_BODY = 2_000_000

const str = (value: unknown, max = 500) => typeof value === 'string' ? value.slice(0, max) : null
const id = (value: unknown) => typeof value === 'string' && UUID.test(value) ? value : null
const int = (value: unknown) => Number.isFinite(value) ? Math.max(0, Math.floor(value as number)) : 0

function requestInfo(request: Request) {
  const h = request.headers
  const decode = (value: string | null) => { try { return value ? decodeURIComponent(value) : null } catch { return value } }
  return {
    ip: h.get('x-real-ip') ?? h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    country: h.get('x-vercel-ip-country'),
    region: decode(h.get('x-vercel-ip-country-region')),
    city: decode(h.get('x-vercel-ip-city')),
    userAgent: h.get('user-agent'),
  }
}

// Fire-and-forget sink for the client. Always answers 204 so tracking can never
// surface in the UI; failures go to the Vercel runtime log instead.
export async function POST(request: Request) {
  const done = new NextResponse(null, { status: 204 })
  const sql = getSql()
  if (!sql) return done

  let body: any
  try {
    const raw = await request.text()
    if (raw.length > MAX_BODY) return done
    body = JSON.parse(raw)
  } catch {
    return done
  }

  const info = requestInfo(request)
  const visitorId = str(body?.visitorId, 64)

  try {
    await ensureSchema(sql)
    switch (body?.kind) {
      case 'visit': {
        await sql`insert into visits (visitor_id, path, referrer, ip, country, region, city, user_agent, browser_language, timezone, screen)
          values (${visitorId}, ${str(body.path)}, ${str(body.referrer, 1000)}, ${info.ip}, ${info.country}, ${info.region}, ${info.city},
            ${info.userAgent}, ${str(body.browserLanguage, 50)}, ${str(body.timezone, 80)}, ${str(body.screen, 30)})`
        console.log(`[visit] ${visitorId} ${info.ip} ${info.city ?? ''} ${info.country ?? ''}`)
        break
      }
      case 'session': {
        const sessionId = id(body.sessionId)
        if (!sessionId || !Array.isArray(body.lines)) break
        const lines = JSON.stringify(body.lines)
        const bookmarks = JSON.stringify(Array.isArray(body.bookmarks) ? body.bookmarks : [])
        await sql`insert into sessions (id, visitor_id, language, elapsed, line_count, lines, bookmarks, ip, country, city, user_agent)
          values (${sessionId}, ${visitorId}, ${str(body.language, 20)}, ${int(body.elapsed)}, ${body.lines.length}, ${lines}::jsonb, ${bookmarks}::jsonb,
            ${info.ip}, ${info.country}, ${info.city}, ${info.userAgent})
          on conflict (id) do update set updated_at = now(), language = excluded.language, elapsed = excluded.elapsed,
            line_count = excluded.line_count, lines = excluded.lines, bookmarks = excluded.bookmarks`
        break
      }
      case 'note': {
        const noteId = id(body.noteId)
        if (!noteId) break
        const note = body.note === undefined ? null : JSON.stringify(body.note)
        await sql`insert into notes (id, session_id, visitor_id, source, model, note, note_text)
          values (${noteId}, ${id(body.sessionId)}, ${visitorId}, ${str(body.source, 20)}, ${str(body.model, 100)}, ${note}::jsonb, ${str(body.noteText, 200_000)})
          on conflict (id) do update set updated_at = now(), note_text = excluded.note_text,
            note = coalesce(excluded.note, notes.note)`
        break
      }
      case 'event': {
        const type = str(body.type, 60)
        if (!type) break
        const data = body.data === undefined ? null : JSON.stringify(body.data)
        await sql`insert into events (visitor_id, session_id, type, data, ip, country, city)
          values (${visitorId}, ${id(body.sessionId)}, ${type}, ${data}::jsonb, ${info.ip}, ${info.country}, ${info.city})`
        console.log(`[event] ${type} ${visitorId} ${info.ip}`)
        break
      }
    }
  } catch (error) {
    console.error('[track] failed:', error instanceof Error ? error.message : error)
  }
  return done
}
