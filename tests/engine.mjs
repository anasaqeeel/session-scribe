// Engine tests. Run: pnpm test:engine  (compiles lib/dap.ts first)
import { buildNote, noteToText, noteToMarkdown, normalise, isRtl, talkStats } from '../.test-build/dap.js'

let pass = 0, fail = 0
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('  PASS', name, detail && `- ${detail}`) }
  else { fail++; console.log('  FAIL', name, detail && `- ${detail}`) }
}
const themesOf = (text, speaker = 'Client') =>
  buildNote([{ t: 5, speaker, text }]).themes.map((t) => t.label)

console.log('\nnegation and inability')
ok('plain symptom detected', themesOf('I feel hopeless.').includes('Low mood'))
ok('negated state suppressed', themesOf('I do not feel hopeless anymore.').length === 0)
ok('"never feel sad" suppressed', themesOf('I never feel sad these days.').length === 0)
ok('inability asserts symptom', themesOf('I could not sleep and my chest felt tight.').includes('Sleep disruption'))
ok('"cannot stop worrying" is anxiety', themesOf('I cannot stop worrying at night.').includes('Anxiety'))
ok('"unable to eat" is appetite', themesOf('I am unable to eat breakfast.').includes('Appetite and eating'))
ok('resolution language suppresses', themesOf('I sleep fine now, no problems at all.').length === 0)
ok('post-keyword negation suppresses', themesOf('My chest does not hurt anymore, it is better.').length === 0)

console.log('\nlexicon precision (regressions found in review)')
ok('"slow down" is not low mood', !themesOf('I did the breathing exercise and it helped me slow down.').includes('Low mood'))
ok('"writing it down" is not low mood', !themesOf('I think writing it down might keep it from spinning.').includes('Low mood'))
ok('"breathing exercise" is coping not somatic', themesOf('I tried the breathing exercise twice.').includes('Coping strategies'))
ok('"skip breakfast" is not avoidance', !themesOf('I skip breakfast, then I feel shaky.').includes('Avoidance'))
ok('genuine low mood still detected', themesOf('I have been feeling really down and empty for weeks.').includes('Low mood'))
ok('"short of breath" still somatic', themesOf('I get short of breath when the panic starts.').includes('Somatic symptoms'))

console.log('\nrisk screening (never suppressed, both languages)')
const risk = (t) => buildNote([{ t: 5, speaker: 'Client', text: t }]).risk
ok('explicit statement flags high', risk('Some days I think about ending my life.')[0]?.severity === 'high')
ok('negated risk still flags (safe direction)', risk('I never think about suicide.').length === 1)
ok('risk flag quotes the sentence', /“.+”/.test(risk('I feel hopeless.')[0]?.label ?? ''))
ok('urdu risk parity', risk('مجھے لگتا ہے کہ خودکشی کر لوں۔')[0]?.severity === 'high')
ok('therapist speech never flags', buildNote([{ t: 1, speaker: 'Therapist', text: 'Do you think about suicide?' }]).risk.length === 0)

console.log('\nurdu and rtl')
ok('rtl detected', isRtl('صبح کے وقت میرا سینہ بھاری ہو جاتا ہے۔'))
ok('ltr not misdetected', !isRtl('the mornings are hard'))
ok('urdu themes found', themesOf('صبح کے وقت میرا سینہ بھاری ہو جاتا ہے اور نیند پوری نہیں ہوتی۔').length >= 2)
ok('urdu question mark parses', buildNote([{ t: 1, speaker: 'Therapist', text: 'آپ نے سانس کی مشق کی؟' }]).interventions.length > 0)

console.log('\nrobustness')
ok('empty transcript', buildNote([]).meta.lines === 0)
ok('non-finite timestamp', buildNote([{ t: NaN, speaker: 'Client', text: 'I feel anxious' }]).meta.duration === 0)
ok('sources are unique', (() => {
  const n = buildNote(Array.from({ length: 12 }, (_, i) => ({ t: i * 9, speaker: i % 2 ? 'Client' : 'Therapist', text: 'The mornings are hard and I cannot sleep.' })))
  return [n.presentation, n.data, n.assessment, n.plan].every((s) => new Set(s.src).size === s.src.length)
})())
ok('normalise survives garbage', normalise({ presentation: 'nope', themes: 'nope' }, buildNote([{ t: 1, speaker: 'Client', text: 'I feel sad' }])).themes.length >= 1)
ok('normalise drops out-of-range src', JSON.stringify(normalise({ presentation: { text: 'x', src: [0, 99, -1, 'a'] } }, buildNote([{ t: 1, speaker: 'Client', text: 'I feel sad' }])).presentation.src) === '[0]')
ok('normalise survives null', normalise(null, buildNote([{ t: 1, speaker: 'Client', text: 'I feel sad' }])).meta.lines === 1)
ok('talkStats no divide-by-zero', talkStats([]).clientShare === 0)
ok('exports render for empty note', (() => { const n = buildNote([]); noteToText(n); noteToMarkdown(n, []); return true })())
ok('500 lines under 1.5s', (() => {
  const lines = Array.from({ length: 500 }, (_, i) => ({ t: i * 5, speaker: i % 2 ? 'Client' : 'Therapist', text: 'I could not sleep and my chest felt tight this morning.' }))
  const started = Date.now(); const n = buildNote(lines)
  return Date.now() - started < 1500 && n.themes.length > 0
})())

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
