// Client-side helpers for /api/track. Every call is best effort and silent:
// tracking must never throw into, slow down, or change the UI.

const VISITOR_KEY = 'session-scribe:visitor'

export const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
    })

let visitor: string | null = null
export function visitorId() {
  if (visitor) return visitor
  try {
    visitor = window.localStorage.getItem(VISITOR_KEY)
    if (!visitor) { visitor = newId(); window.localStorage.setItem(VISITOR_KEY, visitor) }
  } catch { visitor ??= newId() }
  return visitor
}

export function track(payload: Record<string, unknown>) {
  try {
    const body = JSON.stringify({ ...payload, visitorId: visitorId() })
    // keepalive lets the request outlive the page, but browsers cap it at 64KB.
    void fetch('/api/track', { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: body.length < 60_000 }).catch(() => {})
  } catch { /* never surface tracking errors */ }
}

export const trackEvent = (type: string, sessionId: string | null, data?: unknown) =>
  track({ kind: 'event', type, sessionId, data })
