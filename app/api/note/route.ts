import OpenAI from 'openai'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 60

const MODEL = process.env.OPENAI_MODEL ?? 'gpt-4o'

const systemPrompt = `You are a documentation assistant for a licensed psychotherapist. You receive a timestamped transcript of one session. Each line is prefixed with its index in square brackets.

Absolute rules:
- Every claim must be grounded in the transcript. Never infer, embellish, or add clinical content that was not said.
- Never invent quotes.
- For every item, list the transcript line indices it came from in "src". Indices must be integers that actually exist in the transcript.
- If something is absent, return an empty array or empty string rather than plausible filler.
- Plain clinical language. No hedging, no praise, no meta commentary.
- Risk flags are a screening aid only, drawn from explicit client language. Never assert a clinical determination.

Return ONLY valid JSON matching exactly this shape:
{
 "presentation": {"text": "1-2 sentences on how the client presented", "src": [0]},
 "data": {"text": "2-4 sentences summarising what was reported and what occurred", "src": [0]},
 "dataPoints": [{"label": "a specific reported detail", "detail": "short theme tag", "src": [0]}],
 "assessment": {"text": "2-4 sentences of clinical impression drawn only from session content", "src": [0]},
 "plan": {"text": "2-3 sentences on agreed next steps", "src": [0]},
 "themes": [{"label": "short theme name", "detail": "one sentence", "src": [0]}],
 "interventions": [{"label": "what the therapist did", "detail": "technique name", "src": [0]}],
 "homework": [{"label": "between-session action discussed", "detail": "Proposed by therapist | Client agreement", "src": [0]}],
 "risk": [{"label": "risk indicator explicitly present", "detail": "context", "severity": "low", "src": [0]}],
 "followups": [{"label": "question worth returning to next session", "detail": "why", "src": [0]}]
}`

function providerError(status: number, message: string) {
  return NextResponse.json({ error: message }, { status })
}

export async function POST(request: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return providerError(503, process.env.NODE_ENV === 'production'
      ? 'Model drafting is not configured on this deployment. Using the on-device draft instead.'
      : 'OPENAI_API_KEY is not set. Add it to .env.local and restart the dev server.')
  }

  let transcript: unknown
  let meta: unknown
  try {
    const body = await request.json()
    transcript = body?.transcript
    meta = body?.meta
  } catch {
    return providerError(400, 'Request body must be JSON.')
  }
  if (typeof transcript !== 'string' || !transcript.trim()) {
    return providerError(400, 'A non-empty transcript is required.')
  }

  const client = new OpenAI()

  try {
    const completion = await client.chat.completions.create({
      model: MODEL,
      response_format: { type: 'json_object' },
      temperature: 0.2,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: transcript },
      ],
    })

    const raw = completion.choices[0]?.message?.content ?? ''
    if (!raw.trim()) return providerError(502, 'The model returned an empty response.')

    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(raw)
    } catch {
      return providerError(502, 'The model did not return valid JSON.')
    }

    return NextResponse.json({ ...parsed, meta, source: 'llm', model: MODEL })
  } catch (error) {
    if (error instanceof OpenAI.APIError) {
      if (error.status === 401) return providerError(401, 'OpenAI rejected the API key.')
      if (error.status === 429) {
        const quota = /quota|billing/i.test(error.message)
        return providerError(quota ? 402 : 429, quota
          ? 'Your OpenAI account is out of quota. Add credit at platform.openai.com/billing, then retry.'
          : 'Rate limited by OpenAI. Try again in a moment.')
      }
      if (error.status === 404) return providerError(502, `Model "${MODEL}" is not available on this key. Set OPENAI_MODEL in .env.local to one you have access to.`)
      return providerError(502, `OpenAI error ${error.status}: ${error.message}`)
    }
    return providerError(500, error instanceof Error ? error.message : 'Unknown error.')
  }
}
