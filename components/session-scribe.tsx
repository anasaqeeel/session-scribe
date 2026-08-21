'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Bookmark, Check, Clipboard, Download, FileText, Mic, Pencil, Printer, RotateCcw, Search, Sparkles, StopCircle, Trash2, X } from 'lucide-react'
import { buildNote, formatTime, isRtl, normalise, noteToMarkdown, noteToText, talkStats, type Line, type Note, type NoteItem, type Speaker } from '@/lib/dap'

const STORAGE_KEY = 'session-scribe:draft-v1'

type BookmarkMark = { t: number }

const example: Line[] = [
  { t: 4, speaker: 'Therapist', text: 'How have things felt since we last met?' },
  { t: 18, speaker: 'Client', text: 'The mornings are still the hardest. I wake up already thinking about everything I need to do.' },
  { t: 37, speaker: 'Therapist', text: 'When that list starts running, what do you notice in your body?' },
  { t: 49, speaker: 'Client', text: 'My chest gets tight and I rush. I skip breakfast, then I feel shaky by ten.' },
  { t: 71, speaker: 'Therapist', text: 'You are noticing the link between rushing, not eating, and the shakiness.' },
  { t: 89, speaker: 'Client', text: 'Yes. I did try the breathing exercise twice, and it helped me slow down.' },
  { t: 108, speaker: 'Therapist', text: 'What made it possible to remember it those two times?' },
  { t: 122, speaker: 'Client', text: 'I put a note beside my coffee machine. Seeing it before work helped.' },
  { t: 145, speaker: 'Therapist', text: 'Let us build on that cue and add a small breakfast before opening email.' },
  { t: 161, speaker: 'Client', text: 'That feels doable. I usually have yogurt in the fridge.' },
  { t: 178, speaker: 'Therapist', text: 'We will check in on the morning routine next week. How is your sleep?' },
  { t: 192, speaker: 'Client', text: 'I fall asleep okay, but I wake around three and worry for an hour.' },
  { t: 214, speaker: 'Therapist', text: 'Please note what the worry says when you wake, without trying to solve it.' },
  { t: 231, speaker: 'Client', text: 'I can do that. I think writing it down might keep it from spinning.' },
]

function SourceChips({ src, onSource }: { src: number[]; onSource: (index: number) => void }) {
  if (!src?.length) return null
  const shown = src.slice(0, 6)
  return (
    <span className="source-chips">
      {shown.map((index) => (
        <button key={index} className="source-chip" onClick={() => onSource(index)} title={`Jump to transcript line ${index}`}>{index}</button>
      ))}
      {src.length > shown.length && <span className="source-more">+{src.length - shown.length}</span>}
    </span>
  )
}

export function SessionScribe() {
  const [lines, setLines] = useState<Line[]>([])
  const [speaker, setSpeaker] = useState<Speaker>('Client')
  const [language, setLanguage] = useState('en-US')
  const [recording, setRecording] = useState(false)
  const [interim, setInterim] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [bookmarks, setBookmarks] = useState<BookmarkMark[]>([])
  const [note, setNote] = useState<Note | null>(null)
  const [noteText, setNoteText] = useState('')
  const [activeTab, setActiveTab] = useState<'transcript' | 'note'>('transcript')
  const [highlighted, setHighlighted] = useState<number[]>([])
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<number | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [restored, setRestored] = useState(false)
  const [drafting, setDrafting] = useState(false)
  const [noteSource, setNoteSource] = useState<'llm' | 'local'>('llm')
  const recognitionRef = useRef<any>(null)
  const startedAt = useRef(0)
  const shouldRecord = useRef(false)
  // The recogniser's handlers outlive the render that created them, so read
  // live values through refs rather than the captured closure.
  const speakerRef = useRef(speaker)
  const languageRef = useRef(language)
  const startRef = useRef<() => void>(() => {})
  useEffect(() => { speakerRef.current = speaker }, [speaker])

  // Restore the last session so a refresh never costs work.
  useEffect(() => {
    try {
      if (new URLSearchParams(window.location.search).has('demo')) {
        setLines(example); setElapsed(243); setRestored(true); return
      }
      const saved = window.localStorage.getItem(STORAGE_KEY)
      if (!saved) { setRestored(true); return }
      const parsed = JSON.parse(saved)
      if (Array.isArray(parsed.lines) && parsed.lines.length) {
        setLines(parsed.lines)
        setElapsed(parsed.elapsed ?? 0)
        setBookmarks(Array.isArray(parsed.bookmarks) ? parsed.bookmarks : [])
        setToast('Restored your last session')
      }
    } catch { /* corrupt or unavailable storage — start fresh */ }
    setRestored(true)
  }, [])

  useEffect(() => {
    if (!restored) return
    try {
      if (lines.length) window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ lines, elapsed, bookmarks }))
      else window.localStorage.removeItem(STORAGE_KEY)
    } catch { /* quota or private mode — persistence is best effort */ }
  }, [lines, elapsed, bookmarks, restored])

  useEffect(() => {
    if (!recording) return
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedAt.current) / 1000)), 500)
    return () => window.clearInterval(timer)
  }, [recording])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 2200)
    return () => window.clearTimeout(timer)
  }, [toast])

  const stop = useCallback(() => {
    shouldRecord.current = false
    setRecording(false)
    recognitionRef.current?.stop()
  }, [])

  const start = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) {
      setError('Speech capture is not supported in this browser. Try Chrome on desktop or Safari on iPhone.')
      return
    }
    shouldRecord.current = true
    if (!startedAt.current) startedAt.current = Date.now()
    const recognition = new SpeechRecognition()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = languageRef.current
    recognition.onresult = (event: any) => {
      let nextInterim = ''
      const finalLines: Line[] = []
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const text = event.results[i][0].transcript.trim()
        if (event.results[i].isFinal && text) finalLines.push({ t: Math.floor((Date.now() - startedAt.current) / 1000), speaker: speakerRef.current, text })
        else nextInterim += text
      }
      if (finalLines.length) setLines((current) => [...current, ...finalLines])
      setInterim(nextInterim)
    }
    recognition.onend = () => {
      // Restart through the ref so a language change mid-session takes effect.
      if (shouldRecord.current) window.setTimeout(() => startRef.current(), 100)
    }
    recognition.onerror = (event: any) => {
      if (event.error !== 'no-speech' && event.error !== 'aborted') setError(`Microphone error: ${event.error}.`)
    }
    recognitionRef.current = recognition
    setRecording(true)
    recognition.start()
  }, [])

  useEffect(() => { startRef.current = start }, [start])

  // Switching language mid-session rebuilds the recogniser: `lang` is fixed at
  // construction, so the running instance can never change dialect in place.
  useEffect(() => {
    languageRef.current = language
    if (!recording) return
    setToast(`Listening in ${language === 'ur-PK' ? 'اردو' : language === 'en-IN' ? 'English (India)' : 'English (US)'}`)
    recognitionRef.current?.stop() // onend restarts it with the new language
  }, [language])

  useEffect(() => () => { shouldRecord.current = false; recognitionRef.current?.stop() }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable)) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (event.code === 'Space') { event.preventDefault(); recording ? stop() : start(); return }
      if (event.key === '/') { event.preventDefault(); document.getElementById('transcript-search')?.focus(); return }
      if (event.key.toLowerCase() === 'b') addBookmark()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const resetAll = (nextLines: Line[], nextElapsed: number) => {
    stop()
    setLines(nextLines); setElapsed(nextElapsed); setInterim(''); setError(''); setNote(null); setNoteText('')
    setBookmarks([]); setHighlighted([]); setActiveTab('transcript'); startedAt.current = 0
  }

  const loadExample = () => { resetAll(example, 243); setToast('Example session loaded') }
  const clearSession = () => { resetAll([], 0); setToast('Session cleared') }

  const applyNote = (built: Note, source: 'llm' | 'local') => {
    setNote(built)
    setNoteText(noteToText(built))
    setNoteSource(source)
    setActiveTab('note')
  }

  const draftNote = async () => {
    if (!lines.length) { setError('Record something or load the example before drafting.'); return }
    setError(''); setDrafting(true)
    const transcript = lines.map((line, index) => `[${index}] ${formatTime(line.t)} ${line.speaker.toUpperCase()}: ${line.text}`).join('\n')
    const local = buildNote(lines)
    try {
      const response = await fetch('/api/note', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ transcript, meta: local.meta }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload?.error ?? `Request failed (${response.status})`)
      applyNote(normalise(payload, local), 'llm')
      setToast('Note drafted')
    } catch (draftError) {
      applyNote(local, 'local')
      setError(`${draftError instanceof Error ? draftError.message : 'Draft failed.'} Showing the on-device draft instead.`)
    } finally {
      setDrafting(false)
    }
  }

  const copyNote = async () => { await navigator.clipboard.writeText(noteText); setToast('Note copied to clipboard') }

  const downloadNote = () => {
    const blob = new Blob([noteText], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `session-note-${new Date().toISOString().slice(0, 10)}.txt`
    anchor.click()
    URL.revokeObjectURL(url)
    setToast('Note downloaded')
  }

  const onSource = (index: number) => {
    setHighlighted([index])
    setActiveTab('transcript')
    window.setTimeout(() => document.getElementById(`line-${index}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60)
    window.setTimeout(() => setHighlighted([]), 2600)
  }

  const addBookmark = () => { setBookmarks((current) => [...current, { t: elapsed }]); setToast(`Bookmarked at ${formatTime(elapsed)}`) }
  const indexedLines = useMemo(() => lines.map((line, index) => ({ ...line, index })), [lines])
  const riskLevel = note?.risk.some((item) => item.severity === 'high') ? 'high' : note?.risk.length ? 'moderate' : 'none'

  return (
    <main className="scribe-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark"><FileText size={17} strokeWidth={2.2} /></div>
          <div>
            <p className="eyebrow">Clinical workspace</p>
            <h1>Session Scribe</h1>
          </div>
        </div>
        <div className="top-actions">
          <button className="quiet-button" onClick={loadExample}><Sparkles size={15} /> Example</button>
          <button className="quiet-button" onClick={clearSession} disabled={!lines.length}><Trash2 size={15} /> Clear</button>
          <span className="privacy" title="Nothing leaves this browser"><span className="status-dot" /> On-device</span>
        </div>
      </header>

      <section className="session-head">
        <div>
          <p className="eyebrow">Untitled session</p>
          <p className="session-meta">
            {lines.length ? `${lines.length} lines` : 'Ready to begin'}
            <span>·</span>{formatTime(elapsed)}
            {bookmarks.length > 0 && <><span>·</span>{bookmarks.length} bookmark{bookmarks.length === 1 ? '' : 's'}</>}
          </p>
        </div>
        <div className="session-controls">
          <label className="select-wrap">
            <span className="sr-only">Recognition language</span>
            <select value={language} onChange={(event) => setLanguage(event.target.value)}>
              <option value="en-US">English (US)</option>
              <option value="ur-PK">اردو (PK)</option>
              <option value="en-IN">English (India)</option>
            </select>
          </label>
          <button className={`speaker-toggle ${speaker === 'Therapist' ? 'is-therapist' : ''}`} onClick={() => setSpeaker(speaker === 'Client' ? 'Therapist' : 'Client')}>
            <span className="speaker-dot" />{speaker}
          </button>
          <button className="icon-button" onClick={addBookmark} title="Bookmark this moment" aria-label="Bookmark this moment"><Bookmark size={17} /></button>
        </div>
      </section>

      <nav className="mobile-tabs" aria-label="Workspace views">
        <button className={activeTab === 'transcript' ? 'active' : ''} onClick={() => setActiveTab('transcript')}>Transcript <span>{lines.length}</span></button>
        <button className={activeTab === 'note' ? 'active' : ''} onClick={() => setActiveTab('note')}>Note {note && <Check size={13} />}</button>
      </nav>

      <section className="workspace">
        <article className={`pane transcript-pane ${activeTab !== 'transcript' ? 'mobile-hidden' : ''}`}>
          <div className="pane-head">
            <div>
              <p className="eyebrow">Live transcript</p>
              <h2>{recording ? 'Listening now' : 'Session transcript'}</h2>
            </div>
            <div className={`live-label ${recording ? 'is-live' : ''}`}>
              {recording ? <span className="waveform" aria-hidden="true"><i /><i /><i /><i /><i /></span> : null}
              {recording ? 'LIVE' : 'PAUSED'}
            </div>
          </div>
          <div className={`timeline ${indexedLines.length === 0 && !interim ? "is-empty" : ""}`}>
            {indexedLines.length === 0 && !interim && (
              <div className="empty-state">
                <div className="empty-orb"><Mic size={22} /></div>
                <p>Press record to capture the session.</p>
                <button onClick={loadExample}>Load an example instead</button>
              </div>
            )}
            {indexedLines.map((line) => (
              <div key={`${line.index}-${line.t}`} className={`transcript-line ${highlighted.includes(line.index) ? 'is-highlighted' : ''}`} id={`line-${line.index}`}>
                <div className="time">{formatTime(line.t)}</div>
                <div className="rule-dot" />
                <div className="line-copy">
                  <div className={`speaker ${line.speaker === 'Therapist' ? 'therapist' : ''}`}>{line.speaker}</div>
                  <p dir={isRtl(line.text) ? 'rtl' : 'ltr'} className={isRtl(line.text) ? 'is-urdu' : ''}>{line.text}<sup>{line.index}</sup></p>
                </div>
              </div>
            ))}
            {bookmarks.map((mark, index) => (
              <div key={`mark-${index}`} className="bookmark-marker" style={{ top: `${Math.min(94, 12 + (mark.t / Math.max(elapsed || 240, 240)) * 78)}%` }} title={`Bookmark at ${formatTime(mark.t)}`}>
                <Bookmark size={13} fill="currentColor" />
              </div>
            ))}
            {interim && (
              <div className="transcript-line interim-line">
                <div className="time">{formatTime(elapsed)}</div>
                <div className="rule-dot" />
                <div className="line-copy">
                  <div className="speaker">{speaker}</div>
                  <p dir={isRtl(interim) ? 'rtl' : 'ltr'} className={isRtl(interim) ? 'is-urdu' : ''}>{interim}</p>
                </div>
              </div>
            )}
          </div>
        </article>

        <article className={`pane note-pane ${activeTab !== 'note' ? 'mobile-hidden' : ''}`}>
          <div className="pane-head">
            <div>
              <p className="eyebrow">DAP note</p>
              <h2>{note ? 'Editable draft' : 'No note drafted yet'}</h2>
            </div>
            {note && (
              <div className="note-actions">
                <button className="icon-button" onClick={copyNote} title="Copy plain text" aria-label="Copy plain text"><Clipboard size={16} /></button>
                <button className="icon-button" onClick={downloadNote} title="Download .txt" aria-label="Download note"><Download size={16} /></button>
              </div>
            )}
          </div>

          {error && <div className="notice is-error" role="status"><RotateCcw size={15} /> {error}</div>}

          {note ? (
            <div className="note-body">
              <div className="note-stats">
                <div className="stat"><span>{note.meta.lines}</span>lines</div>
                <div className="stat"><span>{note.themes.length}</span>themes</div>
                <div className="stat"><span>{note.interventions.length}</span>interventions</div>
                <div className={`stat ${riskLevel !== 'none' ? 'stat-risk' : ''}`}><span>{note.risk.length}</span>risk flags</div>
              </div>

              {note.risk.length > 0 && (
                <div className={`risk-banner sev-${riskLevel}`}>
                  <AlertTriangle size={16} />
                  <div>
                    <strong>Risk language detected — screening flag only.</strong>
                    <p>Matched on explicit client wording. This is not a clinical determination; review the sourced lines directly.</p>
                  </div>
                </div>
              )}

              <p className="draft-warning">
                {noteSource === 'llm'
                  ? 'Draft only. Generated from the transcript by a language model — verify every claim against its source line before signing.'
                  : 'Draft only. Assembled on this device from transcript text after the model call failed.'}
              </p>

              <NotePreview note={note} onSource={onSource} />

              <div className="editor-block">
                <label className="eyebrow" htmlFor="note-editor">Plain text — edit before signing</label>
                <textarea id="note-editor" className={`note-editor ${isRtl(noteText) ? 'is-urdu' : ''}`} dir={isRtl(noteText) ? 'rtl' : 'ltr'} value={noteText} onChange={(event) => setNoteText(event.target.value)} />
              </div>
            </div>
          ) : (
            <div className="note-empty">
              <div className="empty-orb"><FileText size={22} /></div>
              <p>Your DAP note will appear here.</p>
              <span>Built locally from the transcript. Every claim carries its source line.</span>
            </div>
          )}
        </article>
      </section>

      <footer className="control-bar">
        <div className="record-group">
          <button className={`record-button ${recording ? 'recording' : ''}`} onClick={recording ? stop : start} aria-label={recording ? 'Stop recording' : 'Start recording'}>
            {recording ? <StopCircle size={26} /> : <Mic size={26} />}
          </button>
          <span>{recording ? 'Tap to pause' : 'Tap to record'}</span>
        </div>
        <button className="draft-button" onClick={draftNote} disabled={!lines.length || drafting}>
          {drafting ? 'Drafting…' : 'Draft the note'}
          {drafting ? <span className="spinner" aria-hidden="true" /> : <Sparkles size={16} />}
        </button>
      </footer>

      {toast && <div className="toast" role="status"><Check size={14} /> {toast}</div>}
    </main>
  )
}

function ItemList({ items, onSource }: { items: NoteItem[]; onSource: (index: number) => void }) {
  return (
    <ul className="item-list">
      {items.map((item, index) => (
        <li key={index} className={item.severity ? `sev-${item.severity}` : ''}>
          <div className="item-main">
            <span className={`item-label ${isRtl(item.label) ? 'is-urdu' : ''}`} dir={isRtl(item.label) ? 'rtl' : 'ltr'}>{item.label}</span>
            <SourceChips src={item.src} onSource={onSource} />
          </div>
          {item.detail && <span className="item-detail">{item.detail}</span>}
        </li>
      ))}
    </ul>
  )
}

function NotePreview({ note, onSource }: { note: Note; onSource: (index: number) => void }) {
  return (
    <div className="note-preview">
      <section className="note-section">
        <h3>Presentation</h3>
        <p dir={isRtl(note.presentation.text) ? 'rtl' : 'ltr'} className={isRtl(note.presentation.text) ? 'is-urdu' : ''}>{note.presentation.text} <SourceChips src={note.presentation.src} onSource={onSource} /></p>
      </section>

      <section className="note-section">
        <h3>Data</h3>
        <p dir={isRtl(note.data.text) ? 'rtl' : 'ltr'} className={isRtl(note.data.text) ? 'is-urdu' : ''}>{note.data.text}</p>
        {note.dataPoints.length > 0 && <ItemList items={note.dataPoints} onSource={onSource} />}
      </section>

      <section className="note-section">
        <h3>Assessment</h3>
        <p dir={isRtl(note.assessment.text) ? 'rtl' : 'ltr'} className={isRtl(note.assessment.text) ? 'is-urdu' : ''}>{note.assessment.text} <SourceChips src={note.assessment.src} onSource={onSource} /></p>
      </section>

      <section className="note-section">
        <h3>Plan</h3>
        <p dir={isRtl(note.plan.text) ? 'rtl' : 'ltr'} className={isRtl(note.plan.text) ? 'is-urdu' : ''}>{note.plan.text}</p>
        {note.homework.length > 0 && <ItemList items={note.homework} onSource={onSource} />}
      </section>

      {note.themes.length > 0 && (
        <section className="note-section">
          <h3>Themes <em>{note.themes.length}</em></h3>
          <div className="theme-grid">
            {note.themes.map((theme, index) => (
              <button key={index} className="theme-chip" onClick={() => onSource(theme.src[0])} title={theme.detail}>
                {theme.label}<em>{theme.src.length}</em>
              </button>
            ))}
          </div>
        </section>
      )}

      {note.interventions.length > 0 && (
        <section className="note-section">
          <h3>Interventions <em>{note.interventions.length}</em></h3>
          <ItemList items={note.interventions} onSource={onSource} />
        </section>
      )}

      {note.risk.length > 0 && (
        <section className="note-section">
          <h3>Risk flags</h3>
          <ItemList items={note.risk} onSource={onSource} />
        </section>
      )}

      {note.followups.length > 0 && (
        <section className="note-section">
          <h3>Follow-ups <em>{note.followups.length}</em></h3>
          <ItemList items={note.followups} onSource={onSource} />
        </section>
      )}
    </div>
  )
}

export default SessionScribe
