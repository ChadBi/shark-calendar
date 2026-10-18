/**
 * QA：TZID 时区换算（含 DST）、UI 路径「忽略此次」、以及无超时挂起验证。
 * 用法：node scripts/qa-subscription-edge2.mjs
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'

const ROOT = process.cwd()
const ELECTRON = join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
const OUT = join(ROOT, 'smoke')
const USERDATA = join(OUT, `edge2-${Date.now()}`)
mkdirSync(USERDATA, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (k, v) => console.log(`## ${k} :: ${JSON.stringify(v)}`)

const TZ_ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//QA//TZ//CN
BEGIN:VEVENT
UID:tz-ambiguous
DTSTART;TZID=America/New_York:20261101T013000
DTEND;TZID=America/New_York:20261101T023000
SUMMARY:TZ-纽约-歧义时刻
END:VEVENT
BEGIN:VEVENT
UID:tz-winter
DTSTART;TZID=America/New_York:20261215T100000
DTEND;TZID=America/New_York:20261215T110000
SUMMARY:TZ-纽约-冬令时
END:VEVENT
BEGIN:VEVENT
UID:tz-summer
DTSTART;TZID=America/New_York:20270715T100000
DTEND;TZID=America/New_York:20270715T110000
SUMMARY:TZ-纽约-夏令时
END:VEVENT
BEGIN:VEVENT
UID:tz-sh
DTSTART;TZID=Asia/Shanghai:20261020T100000
DTEND;TZID=Asia/Shanghai:20261020T110000
SUMMARY:TZ-上海
END:VEVENT
BEGIN:VEVENT
UID:tz-gap
DTSTART;TZID=America/New_York:20270314T023000
DTEND;TZID=America/New_York:20270314T033000
SUMMARY:TZ-纽约-不存在的时刻
END:VEVENT
BEGIN:VEVENT
UID:tz-utc
DTSTART:20261021T080000Z
DTEND:20261021T090000Z
SUMMARY:TZ-UTC
END:VEVENT
BEGIN:VEVENT
UID:tz-local
DTSTART:20261022T080000
DTEND:20261022T090000
SUMMARY:TZ-无时区(本地)
END:VEVENT
END:VCALENDAR
`

const OK_ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//QA//E2//CN
BEGIN:VEVENT
UID:rec-1
DTSTAMP:20261001T000000Z
DTSTART:20261019T020000Z
DTEND:20261019T030000Z
RRULE:FREQ=DAILY;COUNT=5
SUMMARY:重复会议
END:VEVENT
END:VCALENDAR
`

let hanging = []
const server = createServer((req, res) => {
  const u = req.url ?? ''
  if (u.startsWith('/tz.ics')) {
    res.writeHead(200, { 'Content-Type': 'text/calendar; charset=utf-8' })
    res.end(TZ_ICS)
  } else if (u.startsWith('/ok.ics')) {
    res.writeHead(200, { 'Content-Type': 'text/calendar' })
    res.end(OK_ICS)
  } else if (u.startsWith('/slow')) {
    hanging.push(res) // 永不响应
  } else {
    res.writeHead(404)
    res.end('nf')
  }
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const PORT = server.address().port
const BASE = `http://127.0.0.1:${PORT}`
log('服务', BASE)

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
env.DAILY_LIST_DISABLE_GPU = '1'
const child = spawn(
  ELECTRON,
  ['.', '--remote-debugging-port=9461', '--no-sandbox', '--disable-gpu', '--disable-gpu-compositing', `--user-data-dir=${USERDATA}`],
  { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] }
)

try {
  let target = null
  for (let i = 0; i < 120 && !target; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:9461/json/list')).json()
      target = list.find((t) => t.type === 'page' && t.url.includes('index.html'))
    } catch {
      /* retry */
    }
    if (!target) await sleep(200)
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  let seq = 0
  const pending = new Map()
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) {
      pending.get(m.id).resolve(m.result)
      pending.delete(m.id)
    }
  })
  await new Promise((r) => ws.addEventListener('open', r))
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++seq
      pending.set(id, { resolve })
      ws.send(JSON.stringify({ id, method, params }))
    })
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception?.description || '').split('\n')[0])
    return r.result?.value
  }
  await send('Page.enable')
  await sleep(1200)

  /* ---------- D3：TZID 时区换算 ---------- */
  log(
    'D3_时区换算',
    await ev(`(async () => {
      const r = await window.api.addSource({ name: '时区', url: '${BASE}/tz.ics' })
      const d = await window.api.getData()
      const tz = d.events.filter(e => e.sourceId && e.title.startsWith('TZ-'))
        .map(e => ({ t: e.title, start: e.start, end: e.end }))
      return { ok: r.result.ok, added: r.result.added, events: tz, localOffsetMin: new Date().getTimezoneOffset() }
    })()`)
  )

  /* ---------- UI 路径「忽略此次」---------- */
  const uiHide = await ev(`(async () => {
    const r = await window.api.addSource({ name: '重复', url: '${BASE}/ok.ics' })
    const d = await window.api.getData()
    const inst = d.events.find(e => e.sourceId && e.title === '重复会议')
    return { added: r.result.added, instId: inst?.id, instStart: inst?.start, ext: inst?.externalId }
  })()`)
  log('UI隐藏_准备', uiHide)

  // 切到日视图，找到该事件并点开
  const clicked = await ev(`(async () => {
    const d = await window.api.getData()
    const inst = d.events.find(e => e.sourceId && e.title === '重复会议')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    return 'ok'
  })()`)
  await sleep(300)
  const modal = await ev(`(async () => {
    // 直接用 openEvent 通道打开（等价于点悬浮窗/侧栏），再点「忽略此次」
    const d = await window.api.getData()
    const inst = d.events.find(e => e.sourceId && e.title === '重复会议')
    const before = d.events.filter(e => e.sourceId && e.title === '重复会议').length
    return { before, id: inst.id, start: inst.start, ext: inst.externalId }
  })()`)
  // 通过 store 打开编辑器：点击月视图里的 chip 更真实
  const opened = await ev(`(async () => {
    document.querySelectorAll('.segmented button')[0].click()
    await new Promise(r => setTimeout(r, 500))
    const d = await window.api.getData()
    const inst = d.events.find(e => e.sourceId && e.title === '重复会议')
    window.api.openEvent(inst.id)
    await new Promise(r => setTimeout(r, 800))
    const h2 = document.querySelector('.modal h2')?.textContent
    const banner = document.querySelector('.readonly-banner')?.textContent?.trim()
    const footBtns = [...document.querySelectorAll('.modal-foot button')].map(b => b.textContent.trim())
    return { h2, banner, footBtns }
  })()`)
  log('UI隐藏_只读弹窗', opened)

  const hid = await ev(`(async () => {
    const btn = [...document.querySelectorAll('.modal-foot button')].find(b => b.textContent.trim() === '忽略此次')
    if (!btn) return { error: 'no button' }
    btn.click()
    await new Promise(r => setTimeout(r, 900))
    const d = await window.api.getData()
    const left = d.events.filter(e => e.sourceId && e.title === '重复会议').length
    const src = d.sources.find(s => s.name === '重复')
    return { left, hidden: (src?.hidden ?? []).length, toast: document.querySelector('.toast')?.textContent ?? null }
  })()`)
  log('UI隐藏_点击后', hid)

  const afterSync = await ev(`(async () => {
    const d0 = await window.api.getData()
    const src = d0.sources.find(s => s.name === '重复')
    await window.api.syncSources(src.id)
    await new Promise(r => setTimeout(r, 500))
    const d = await window.api.getData()
    return { left: d.events.filter(e => e.sourceId && e.title === '重复会议').length }
  })()`)
  log('UI隐藏_再同步后', afterSync)

  /* ---------- B13 重做：无超时挂起 ---------- */
  const slow = await Promise.race([
    ev(`(async () => {
      const t0 = Date.now()
      const r = await window.api.addSource({ name: '挂起', url: '${BASE}/slow' })
      return { ms: Date.now() - t0, ok: r.result.ok, error: r.result.error ?? null }
    })()`),
    sleep(8000).then(() => ({ timeout: true, note: '8 秒未返回：fetchIcs 没有超时控制，addSource 会一直挂起' }))
  ])
  log('B13_挂起请求', slow)
} catch (e) {
  log('ERROR', e.message)
} finally {
  child.kill()
  for (const h of hanging) {
    try {
      h.destroy()
    } catch {
      /* ignore */
    }
  }
  try {
    server.close()
  } catch {
    /* ignore */
  }
}
process.exit(0)
