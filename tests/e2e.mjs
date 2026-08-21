import puppeteer from 'puppeteer-core'

const BASE = process.env.BASE || 'http://localhost:3003'
const F = []
const add = (sev, area, msg) => { F.push({ sev, area, msg }); console.log(`[${sev}] ${area} :: ${msg}`) }
const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome', headless: true, protocolTimeout: 30000,
  args: ['--no-sandbox','--disable-gpu','--disable-dev-shm-usage'],
})
async function open(w, h, mobile, url = '/?demo=1') {
  const page = await browser.newPage()
  page.setDefaultTimeout(15000)
  await page.setViewport({ width: w, height: h, isMobile: mobile, hasTouch: mobile })
  const errs = []
  page.on('console', m => { if (m.type()==='error'||m.type()==='warning') errs.push(m.text()) })
  page.on('pageerror', e => errs.push('PAGEERROR '+e.message))
  await page.goto(BASE+url, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.scribe-shell', { timeout: 15000 })
  await new Promise(r => setTimeout(r, 900))
  return { page, errs }
}
const audit = () => ({
  hOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
    ? `${document.documentElement.scrollWidth}>${document.documentElement.clientWidth}` : null,
  clipped: [...new Set([...document.querySelectorAll('*')].filter(el => {
    const cs = getComputedStyle(el)
    return (cs.overflowY==='hidden'||cs.overflow==='hidden') && el.scrollHeight > el.clientHeight+2 && el.clientHeight > 40
  }).map(el => `${el.tagName}.${(el.className||'').toString().split(' ')[0]}(${el.scrollHeight}>${el.clientHeight})`))],
  small: [...new Set([...document.querySelectorAll('button,select,a')].filter(el => {
    const b = el.getBoundingClientRect(); return b.width>0 && (b.height<32||b.width<32)
  }).map(el => `${(el.textContent||el.getAttribute('aria-label')||'?').trim().slice(0,16)}:${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`))],
  lines: document.querySelectorAll('.transcript-line').length,
})

console.log('\n=== 1. LAYOUT ACROSS VIEWPORTS ===')
for (const [n,w,h,m] of [['iPhoneSE',375,667,1],['iPhone14',390,844,1],['Pixel7',412,915,1],['iPadMini',768,1024,1],['Laptop',1280,720,0],['Desktop',1920,1080,0]]) {
  const { page, errs } = await open(w,h,!!m)
  const r = await page.evaluate(audit)
  const lbl = `${n} ${w}x${h}`
  if (r.hOverflow) add('HIGH', lbl, 'horizontal overflow '+r.hOverflow)
  if (r.clipped.length) add('HIGH', lbl, 'clipped: '+r.clipped.join('; '))
  if (r.lines !== 14) add('HIGH', lbl, `rendered ${r.lines}/14 lines`)
  if (r.small.length) add('MED', lbl, 'small tap targets: '+r.small.slice(0,3).join(', '))
  const ae = [...new Set(errs.filter(e=>!/favicon|Download the React|preload/i.test(e)))]
  if (ae.length) add('HIGH', lbl, 'console: '+ae.slice(0,2).join(' | '))
  console.log(`  ok ${lbl}: lines=${r.lines} clipped=${r.clipped.length} small=${r.small.length} errs=${ae.length}`)
  await page.close()
}

console.log('\n=== 2. INTERACTION FLOW (390x844) ===')
{
  const { page, errs } = await open(390,844,true,'/')
  const click = async (sel) => { await page.click(sel); await new Promise(r=>setTimeout(r,450)) }
  const txt = (sel) => page.$eval(sel, e => e.textContent.trim()).catch(()=>null)

  // Example loads
  await click('.quiet-button')
  let n = await page.$$eval('.transcript-line', e=>e.length)
  if (n !== 14) add('HIGH','Example','loaded '+n+' lines, expected 14')

  // Draft
  await page.evaluate(() => [...document.querySelectorAll('button')].find(b=>/Draft the note/i.test(b.textContent))?.click())
  await new Promise(r=>setTimeout(r,6000))
  const hasNote = await page.$('.note-preview')
  if (!hasNote) add('HIGH','Draft','no note rendered after drafting')
  const stats = await page.$$eval('.stat', els => els.map(e=>e.textContent.trim()))
  console.log('  stats:', stats.join(' | '))

  // Source chip navigates back to transcript
  const chip = await page.$('.source-chip')
  if (!chip) add('HIGH','Sources','no source chips rendered')
  else {
    await chip.click(); await new Promise(r=>setTimeout(r,900))
    const hl = await page.$$eval('.transcript-line.is-highlighted', e=>e.length)
    if (hl !== 1) add('HIGH','Sources',`chip click highlighted ${hl} lines, expected 1`)
    const onTranscript = await page.$eval('.mobile-tabs button', b=>b.className.includes('active'))
    if (!onTranscript) add('MED','Sources','chip did not switch to the transcript tab')
  }

  // Persistence across reload
  await page.reload({ waitUntil:'domcontentloaded' }); await new Promise(r=>setTimeout(r,1200))
  const after = await page.$$eval('.transcript-line', e=>e.length)
  if (after !== 14) add('HIGH','Persistence',`after reload ${after}/14 lines restored`)

  // Clear empties everything, including storage
  await page.evaluate(() => [...document.querySelectorAll('.quiet-button')].find(b=>/Clear/i.test(b.textContent))?.click())
  await new Promise(r=>setTimeout(r,600))
  const cleared = await page.$$eval('.transcript-line', e=>e.length)
  const stored = await page.evaluate(() => window.localStorage.getItem('session-scribe:draft-v1'))
  if (cleared !== 0) add('HIGH','Clear',`${cleared} lines remain after Clear`)
  if (stored) add('HIGH','Clear','localStorage still holds a session after Clear')

  const ae = [...new Set(errs.filter(e=>!/favicon|Download the React|preload|402|Failed to load resource/i.test(e)))]
  if (ae.length) add('HIGH','Interaction','console: '+ae.slice(0,3).join(' | '))
  console.log('  interaction pass complete')
  await page.close()
}

console.log('\n=== 3. ACCESSIBILITY / SEMANTICS ===')
{
  const { page } = await open(1280,800,false,'/?demo=note')
  await new Promise(r=>setTimeout(r,6000))
  const a = await page.evaluate(() => ({
    unlabelled: [...document.querySelectorAll('button')].filter(b=>!b.textContent.trim() && !b.getAttribute('aria-label')).length,
    h1: document.querySelectorAll('h1').length,
    lang: document.documentElement.lang,
    imgNoAlt: [...document.querySelectorAll('img')].filter(i=>!i.alt).length,
    textareaLabel: !!document.querySelector('#note-editor')?.getAttribute('aria-label') || !!document.querySelector('label[for="note-editor"]'),
  }))
  if (a.unlabelled) add('MED','A11y', a.unlabelled+' button(s) with no accessible name')
  if (a.h1 !== 1) add('LOW','A11y', a.h1+' h1 elements')
  if (!a.lang) add('MED','A11y','no lang on <html>')
  if (!a.textareaLabel) add('MED','A11y','note editor has no label')
  console.log('  a11y:', JSON.stringify(a))
  await page.close()
}

console.log('\n=== SUMMARY ===')
console.log(F.length ? F.map(f=>`[${f.sev}] ${f.area}: ${f.msg}`).join('\n') : 'No findings.')
console.log(`total: ${F.length} (HIGH ${F.filter(f=>f.sev==='HIGH').length}, MED ${F.filter(f=>f.sev==='MED').length})`)
await browser.close()
