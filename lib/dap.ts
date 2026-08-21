// Deterministic DAP note generation. No network, no API key, no model.
// Every claim is either a verbatim excerpt or a counted signal, and every
// item carries the exact transcript line indices it came from.

export type Speaker = 'Client' | 'Therapist'
export type Line = { t: number; speaker: Speaker; text: string }
export type Severity = 'low' | 'moderate' | 'high'
export type NoteItem = { label: string; detail?: string; src: number[]; severity?: Severity }
export type Section = { text: string; src: number[] }

export type Note = {
  presentation: Section
  data: Section
  dataPoints: NoteItem[]
  assessment: Section
  plan: Section
  themes: NoteItem[]
  interventions: NoteItem[]
  homework: NoteItem[]
  risk: NoteItem[]
  followups: NoteItem[]
  meta: { lines: number; client: number; therapist: number; duration: number }
}

type Lexicon = { key: string; label: string; detail: string; pattern: RegExp }

const THEMES: Lexicon[] = [
  { key: 'sleep', label: 'Sleep disruption', detail: 'Sleep, waking, or rest was raised', pattern: /\b(sleep|asleep|awake|wakes?|waking|woke|insomnia|nightmare|rested?|tired|exhaust\w*)\b|نیند|سونا|جاگ|بیدار|تھک|آرام/i },
  { key: 'anxiety', label: 'Anxiety', detail: 'Anxious affect or apprehension was described', pattern: /\b(anxious|anxiety|panic|worry|worried|worrying|nervous|on edge|dread|racing|tense)\b|پریشان|گھبراہٹ|بے چین|فکر|ڈر|خوف|اضطراب/i },
  { key: 'somatic', label: 'Somatic symptoms', detail: 'Bodily sensations were reported', pattern: /\b(chest|tight\w*|shak\w+|breath\w*|stomach|nausea|nauseous|headache|dizzy|heart)\b|سینے|سینہ|سانس|دل|پیٹ|سردرد|چکر|کپکپ/i },
  { key: 'appetite', label: 'Appetite and eating', detail: 'Eating patterns or meals were discussed', pattern: /\b(eat|eating|ate|breakfast|lunch|dinner|meal|appetite|food|hungry|yogurt)\b|کھانا|ناشتہ|بھوک|کھا|دوپہر|رات کا کھانا/i },
  { key: 'rumination', label: 'Rumination', detail: 'Repetitive or spiralling thought was described', pattern: /\b(overthink\w*|spinning|spiral\w*|racing thoughts?|ruminat\w+|keep thinking|can.?t stop thinking|the list)\b|سوچ|خیال|بار بار|دماغ|الجھ/i },
  { key: 'mood', label: 'Low mood', detail: 'Depressed or flattened affect was described', pattern: /\b(sad|down|low|depress\w*|hopeless|numb|empty|crying|tearful|unmotivated)\b|اداس|افسردہ|مایوس|رونا|خالی|دل نہیں/i },
  { key: 'work', label: 'Occupational stress', detail: 'Work demands were raised', pattern: /\b(work|working|job|email|boss|deadline|meeting|office|shift|colleague)\b|کام|نوکری|دفتر|باس|ای میل|ڈیڈ لائن/i },
  { key: 'relationships', label: 'Relationships', detail: 'Interpersonal content was raised', pattern: /\b(partner|husband|wife|spouse|friends?|family|mother|father|mom|dad|kids?|children|lonely|alone)\b|شوہر|بیوی|دوست|گھر|والدہ|والد|امی|ابو|بچے|تنہا/i },
  { key: 'coping', label: 'Coping strategies', detail: 'A coping skill was referenced or practised', pattern: /\b(breathing exercise|breathing|grounding|meditat\w*|journal\w*|walk\w*|exercise|coping|strateg\w+|technique|reminder|cue)\b|ورزش|سانس کی مشق|چہل قدمی|مراقبہ|ڈائری|طریقہ/i },
  { key: 'avoidance', label: 'Avoidance', detail: 'Avoidant or deferring behaviour was described', pattern: /\b(avoid\w*|put off|putting off|procrastinat\w+|cancel\w*|skip\w*|isolat\w+)\b|بچنا|ٹال|چھوڑ|منسوخ|دور/i },
  { key: 'morning', label: 'Morning routine', detail: 'Time-of-day pattern was identified', pattern: /\b(morning|mornings|wake up|get up|start of the day|before work)\b|صبح|سویرے|دن کا آغاز/i },
]

// Conservative, explicit-language only. Screening aid, never a determination.
const RISK: { severity: Severity; label: string; pattern: RegExp }[] = [
  { severity: 'high', label: 'Explicit suicidal statement', pattern: /\b(kill myself|killing myself|end my life|ending my life|take my own life|suicid\w*|better off dead|don.?t want to be here|not want to be here|overdose)\b|خودکشی|جان دے|مر جاؤں|زندہ نہیں رہنا|مرنا چاہتا/i },
  { severity: 'moderate', label: 'Self-harm language', pattern: /\b(hurt myself|harm myself|self.?harm|cutting myself|hurting myself)\b|خود کو نقصان|خود کو تکلیف|کاٹ/i },
  { severity: 'moderate', label: 'Hopelessness', pattern: /\b(hopeless|no point|nothing matters|give up|giving up|can.?t go on|no way out)\b|ناامید|کوئی فائدہ نہیں|ہار مان|برداشت نہیں/i },
  { severity: 'low', label: 'Self-critical or burden language', pattern: /\b(worthless|burden|hate myself|failure|trapped)\b/i },
]

const INTERVENTIONS: Lexicon[] = [
  { key: 'open-question', label: 'Open question', detail: 'Invited elaboration rather than a yes/no answer', pattern: /^(what|how|when|where|who|tell me|say more|can you describe)\b|^کیا|^کیسے|^کب|^کہاں|^کون|^بتائیں|^مجھے بتائیں/i },
  { key: 'reflection', label: 'Reflection', detail: 'Restated the client’s experience back to them', pattern: /^(you are|you’re|you were|it sounds like|so you|i hear|that sounds)\b|^آپ |^ایسا لگتا|^تو آپ/i },
  { key: 'linking', label: 'Linking / pattern identification', detail: 'Connected two elements the client reported', pattern: /\b(link|connection|between|pattern|notice|noticing|relationship between)\b|تعلق|ربط|سلسلہ|نوٹ کر|محسوس کر/i },
  { key: 'directive', label: 'Directive / task setting', detail: 'Proposed a specific between-session action', pattern: /\b(let us|let’s|let's|please|try|practice|i.?d like you to|we will|we’ll|build on)\b|آئیے|کوشش کریں|لکھ لیں|مشق کریں|شامل کریں/i },
  { key: 'validation', label: 'Validation', detail: 'Normalised or affirmed the client’s experience', pattern: /\b(that makes sense|understandable|of course|no wonder|makes sense that)\b|سمجھ آتا|قدرتی بات|فطری بات|ٹھیک محسوس/i },
  { key: 'agenda', label: 'Agenda setting / review', detail: 'Oriented the session in time', pattern: /\b(check in|checking in|next week|next session|last met|since we|last time)\b|اگلے ہفتے|اگلی نشست|پچھلی ملاقات|پچھلی بار/i },
]

const CLIENT_COMMITMENT = /\b(i can do that|i can try|i will|i’ll|i'll|that feels doable|i might|i think i|i could|sounds doable|i’ll try)\b|میں کر سکتا|میں کر سکتی|کوشش کروں|ٹھیک ہے میں|کر لوں گا|کر لوں گی/i
const THERAPIST_ASSIGNMENT = /\b(let us|let’s|let's|please note|please try|try to|practice|before|this week|between now and|homework|build on)\b|آئیے|کوشش کریں|لکھ لیں|اس ہفتے|مشق کریں/i
const NEXT_SESSION = /\b(next week|next session|next time|when we meet|come back to)\b|اگلے ہفتے|اگلی نشست|اگلی بار/i

export function formatTime(seconds: number) {
  const mins = Math.floor(seconds / 60).toString().padStart(2, '0')
  const secs = Math.floor(seconds % 60).toString().padStart(2, '0')
  return `${mins}:${secs}`
}

const words = (text: string) => text.trim().split(/\s+/).filter(Boolean)
const trim = (text: string) => text.replace(/\s+/g, ' ').trim()

function excerpt(text: string, max = 150) {
  const clean = trim(text)
  if (clean.length <= max) return clean
  return clean.slice(0, clean.lastIndexOf(' ', max)) + '…'
}

function listPhrase(items: string[]) {
  if (items.length === 0) return ''
  if (items.length === 1) return items[0]
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`
}

export function buildNote(lines: Line[]): Note {
  const clientIdx: number[] = []
  const therapistIdx: number[] = []
  lines.forEach((line, index) => (line.speaker === 'Client' ? clientIdx : therapistIdx).push(index))

  const duration = lines.length ? Math.max(...lines.map((line) => line.t)) : 0

  // ---- Themes: counted across every line, sourced exactly -------------------
  const themes: NoteItem[] = THEMES
    .map((theme) => {
      const src = lines.map((line, index) => (theme.pattern.test(line.text) ? index : -1)).filter((index) => index >= 0)
      return { label: theme.label, detail: theme.detail, src }
    })
    .filter((theme) => theme.src.length > 0)
    .sort((a, b) => b.src.length - a.src.length)

  // ---- Risk: client statements only, explicit language only -----------------
  const risk: NoteItem[] = []
  for (const index of clientIdx) {
    for (const rule of RISK) {
      if (rule.pattern.test(lines[index].text)) {
        const existing = risk.find((item) => item.label === rule.label)
        if (existing) existing.src.push(index)
        else risk.push({ label: rule.label, detail: `Client language at ${formatTime(lines[index].t)}. Screening flag only — requires clinician review.`, severity: rule.severity, src: [index] })
      }
    }
  }

  // ---- Interventions: therapist turns ---------------------------------------
  const interventions: NoteItem[] = []
  for (const index of therapistIdx) {
    const text = trim(lines[index].text)
    for (const rule of INTERVENTIONS) {
      const isQuestion = /[?\u061F]$/.test(text)
      if (rule.key === 'open-question' && !isQuestion) continue
      if (rule.pattern.test(text)) {
        const existing = interventions.find((item) => item.label === rule.label)
        if (existing) existing.src.push(index)
        else interventions.push({ label: rule.label, detail: rule.detail, src: [index] })
      }
    }
  }
  interventions.sort((a, b) => b.src.length - a.src.length)

  // ---- Homework: therapist assignments + client commitments -----------------
  const homework: NoteItem[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const text = trim(line.text)
    const assigned = line.speaker === 'Therapist' && THERAPIST_ASSIGNMENT.test(text)
    const committed = line.speaker === 'Client' && CLIENT_COMMITMENT.test(text)
    if (!assigned && !committed) continue
    homework.push({
      label: excerpt(text, 130),
      detail: assigned ? 'Proposed by therapist' : 'Client agreement',
      src: [index],
    })
  }

  // ---- Data: verbatim client report, tagged by theme ------------------------
  const dataPoints: NoteItem[] = clientIdx
    .map((index) => {
      const text = lines[index].text
      const tags = THEMES.filter((theme) => theme.pattern.test(text)).map((theme) => theme.label)
      return { label: excerpt(text, 190), detail: tags.slice(0, 3).join(' · '), src: [index], weight: tags.length * 10 + words(text).length }
    })
    .filter((point) => point.weight > 0)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 6)
    .sort((a, b) => a.src[0] - b.src[0])
    .map(({ label, detail, src }) => ({ label, detail, src }))

  // ---- Follow-ups: unresolved threads ---------------------------------------
  const followups: NoteItem[] = []
  for (const index of therapistIdx) {
    const text = trim(lines[index].text)
    if (!/[?\u061F]$/.test(text)) continue
    const reply = lines[index + 1]
    if (reply && reply.speaker === 'Client' && words(reply.text).length < 8) {
      followups.push({ label: excerpt(text, 120), detail: `Answered in ${words(reply.text).length} words — worth revisiting`, src: [index, index + 1] })
    }
  }
  for (const index of therapistIdx) {
    if (NEXT_SESSION.test(lines[index].text)) {
      followups.push({ label: excerpt(lines[index].text, 120), detail: 'Explicitly deferred to a future session', src: [index] })
    }
  }
  for (const theme of themes) {
    if (theme.src.length === 1) {
      followups.push({ label: `${theme.label} was raised once and not explored`, detail: 'Single mention across the session', src: theme.src })
    }
  }

  // ---- Narrative sections (templated, never paraphrased) --------------------
  const topThemes = themes.slice(0, 3).map((theme) => theme.label.toLowerCase())
  const presentationSrc = clientIdx.slice(0, 2)
  const presentation: Section = {
    text: lines.length
      ? `Client participated across ${clientIdx.length} of ${lines.length} recorded turns over ${formatTime(duration)}. ${topThemes.length ? `Session content centred on ${listPhrase(topThemes)}.` : 'No recurring clinical themes were detected in the transcript.'}${risk.length ? ' Risk language was detected and is flagged below.' : ''}`
      : '',
    src: presentationSrc,
  }

  const data: Section = {
    text: dataPoints.length
      ? `Client reported the following, quoted from the session record. ${dataPoints.length} statement${dataPoints.length === 1 ? '' : 's'} carried clinical content across ${listPhrase(topThemes) || 'the session'}.`
      : 'No client statements in this transcript matched the clinical content lexicon.',
    src: dataPoints.flatMap((point) => point.src),
  }

  const engagement: string[] = []
  if (homework.some((item) => item.detail === 'Client agreement')) engagement.push('agreed to a between-session task')
  if (themes.some((theme) => theme.label === 'Coping strategies')) engagement.push('referenced use of a coping strategy')
  if (clientIdx.length && words(clientIdx.map((index) => lines[index].text).join(' ')).length / clientIdx.length > 12) engagement.push('gave extended rather than minimal responses')

  const assessment: Section = {
    text: [
      topThemes.length ? `Transcript signals: ${listPhrase(topThemes)}.` : 'No recurring transcript signals detected.',
      engagement.length ? `Observable engagement: client ${listPhrase(engagement)}.` : '',
      risk.length ? `Risk language present — see flags below; clinician determination required.` : 'No explicit risk language detected in client turns.',
      'This is a scaffold assembled from transcript signals only. Clinical impression, formulation, and diagnosis are the clinician’s to write.',
    ].filter(Boolean).join(' '),
    src: themes.slice(0, 3).flatMap((theme) => theme.src.slice(0, 2)),
  }

  const planItems = homework.slice(0, 4)
  const deferred = therapistIdx.filter((index) => NEXT_SESSION.test(lines[index].text))
  const plan: Section = {
    text: [
      planItems.length ? `${planItems.length} between-session item${planItems.length === 1 ? '' : 's'} were discussed and are listed below.` : 'No between-session actions were identified in the transcript.',
      deferred.length ? 'A future-session check-in was named explicitly.' : '',
    ].filter(Boolean).join(' '),
    src: [...planItems.flatMap((item) => item.src), ...deferred].slice(0, 8),
  }

  return {
    presentation,
    data,
    dataPoints,
    assessment,
    plan,
    themes,
    interventions,
    homework,
    risk,
    followups: followups.slice(0, 6),
    meta: { lines: lines.length, client: clientIdx.length, therapist: therapistIdx.length, duration },
  }
}

export function noteToText(note: Note): string {
  const block = (title: string, body: string) => (body ? `${title}\n${body}\n` : '')
  const bullets = (items: NoteItem[]) => items.map((item) => `  • ${item.label}${item.detail ? ` (${item.detail})` : ''}  [${item.src.join(', ')}]`).join('\n')

  return [
    block('PRESENTATION', note.presentation.text),
    block('DATA', [note.data.text, bullets(note.dataPoints)].filter(Boolean).join('\n')),
    block('ASSESSMENT', note.assessment.text),
    block('PLAN', [note.plan.text, bullets(note.homework)].filter(Boolean).join('\n')),
    note.themes.length ? block('THEMES', bullets(note.themes)) : '',
    note.interventions.length ? block('INTERVENTIONS', bullets(note.interventions)) : '',
    note.risk.length ? block('RISK FLAGS (screening only)', bullets(note.risk)) : '',
    note.followups.length ? block('FOLLOW-UPS', bullets(note.followups)) : '',
    `\nGenerated locally from ${note.meta.lines} transcript lines. Numbers in brackets are transcript line indices. Draft only — becomes a record when reviewed and signed.`,
  ].filter(Boolean).join('\n')
}

export function noteToMarkdown(note: Note, lines: Line[]): string {
  const bullets = (items: NoteItem[]) =>
    items.map((item) => `- ${item.label}${item.detail ? ` — _${item.detail}_` : ''} <sub>${item.src.map((index) => `[${index}]`).join('')}</sub>`).join('\n')

  const parts = [
    `# Session note`,
    `_${note.meta.lines} transcript lines · ${formatTime(note.meta.duration)} · generated on device_`,
    ``,
    `## Presentation`, note.presentation.text, ``,
    `## Data`, note.data.text, ``, bullets(note.dataPoints), ``,
    `## Assessment`, note.assessment.text, ``,
    `## Plan`, note.plan.text, ``, bullets(note.homework), ``,
  ]
  if (note.themes.length) parts.push(`## Themes`, bullets(note.themes), ``)
  if (note.interventions.length) parts.push(`## Interventions`, bullets(note.interventions), ``)
  if (note.risk.length) parts.push(`## Risk flags (screening only)`, bullets(note.risk), ``)
  if (note.followups.length) parts.push(`## Follow-ups`, bullets(note.followups), ``)

  parts.push(
    `---`, ``, `## Transcript`, ``,
    ...lines.map((line, index) => `\`[${index}]\` **${formatTime(line.t)} ${line.speaker}** — ${line.text}`),
    ``, `---`, `_Draft only. Becomes a record when reviewed and signed._`,
  )
  return parts.filter((part) => part !== undefined).join('\n')
}

export function talkStats(lines: Line[]) {
  const count = (speaker: Speaker) =>
    lines.filter((line) => line.speaker === speaker).reduce((total, line) => total + words(line.text).length, 0)
  const client = count('Client')
  const therapist = count('Therapist')
  const total = client + therapist
  return {
    client,
    therapist,
    total,
    clientShare: total ? Math.round((client / total) * 100) : 0,
    therapistShare: total ? Math.round((therapist / total) * 100) : 0,
  }
}

// The model is instructed to return the Note shape, but a draft must never
// crash the UI. Coerce every field and drop line indices that don't exist.
export function normalise(payload: any, fallback: Note): Note {
  const maxIndex = fallback.meta.lines - 1
  const srcOf = (value: any): number[] =>
    Array.isArray(value)
      ? Array.from(new Set(value.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= maxIndex)))
      : []

  const sectionOf = (value: any, backup: Section): Section =>
    value && typeof value.text === 'string' && value.text.trim()
      ? { text: trim(value.text), src: srcOf(value.src) }
      : backup

  const itemsOf = (value: any): NoteItem[] => {
    if (!Array.isArray(value)) return []
    return value
      .map((entry: any): NoteItem | null => {
        if (typeof entry === 'string') return entry.trim() ? { label: trim(entry), src: [] } : null
        if (!entry || typeof entry.label !== 'string' || !entry.label.trim()) return null
        const severity = ['low', 'moderate', 'high'].includes(entry.severity) ? (entry.severity as Severity) : undefined
        return {
          label: trim(entry.label),
          detail: typeof entry.detail === 'string' && entry.detail.trim() ? trim(entry.detail) : undefined,
          severity,
          src: srcOf(entry.src),
        }
      })
      .filter((item): item is NoteItem => item !== null)
      .slice(0, 12)
  }

  const themes = itemsOf(payload?.themes)
  const dataPoints = itemsOf(payload?.dataPoints)

  return {
    presentation: sectionOf(payload?.presentation, fallback.presentation),
    data: sectionOf(payload?.data, fallback.data),
    dataPoints: dataPoints.length ? dataPoints : fallback.dataPoints,
    assessment: sectionOf(payload?.assessment, fallback.assessment),
    plan: sectionOf(payload?.plan, fallback.plan),
    themes: themes.length ? themes : fallback.themes,
    interventions: itemsOf(payload?.interventions),
    homework: itemsOf(payload?.homework),
    risk: itemsOf(payload?.risk),
    followups: itemsOf(payload?.followups),
    meta: fallback.meta,
  }
}

const URDU_RANGE = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/

export function isRtl(text: string): boolean {
  const rtl = (text.match(new RegExp(URDU_RANGE, 'g')) || []).length
  const letters = (text.match(/\p{L}/gu) || []).length
  return letters > 0 && rtl / letters > 0.3
}
