/**
 * QA 第二轮：分栏算法 A/B（排除全天事件干扰）、CRUD、编辑器跨天、吸附。
 * 用法：node scripts/qa-verify2.mjs
 */
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'

const ROOT = process.cwd()
const ELECTRON = join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
const PORT = 9377
const USERDATA = join(ROOT, 'smoke', `qa2-${Date.now()}`)
const OUT = join(ROOT, 'smoke')
mkdirSync(USERDATA, { recursive: true })

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
env.DAILY_LIST_DISABLE_GPU = '1'

const child = spawn(
  ELECTRON,
  ['.', `--remote-debugging-port=${PORT}`, '--no-sandbox', '--disable-gpu', '--disable-gpu-compositing', `--user-data-dir=${USERDATA}`],
  { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] }
)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (k, v) => console.log(`## ${k} :: ${JSON.stringify(v)}`)

async function listTargets() {
  try {
    return await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
  } catch {
    return []
  }
}
async function waitTarget(match, ms = 25000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    const t = (await listTargets()).find((x) => x.type === 'page' && x.url.includes(match))
    if (t) return t
    await sleep(250)
  }
  throw new Error('timeout ' + match)
}
function connect(wsUrl) {
  const ws = new WebSocket(wsUrl)
  let seq = 0
  const pending = new Map()
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id)
      pending.delete(m.id)
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)
    }
  })
  const ready = new Promise((res, rej) => {
    ws.addEventListener('open', res)
    ws.addEventListener('error', rej)
  })
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params }))
    })
  return { ready, send }
}

const READ_SLOTS = `(() => {
  const col = document.querySelector('.tl-col')
  const cr = col.getBoundingClientRect()
  return [...col.querySelectorAll('.slot')].map(s => {
    const r = s.getBoundingClientRect()
    return {
      t: s.querySelector('.slot-title')?.textContent,
      x: +((r.left - cr.left) / cr.width * 100).toFixed(1),
      w: +(r.width / cr.width * 100).toFixed(1),
      top: +((r.top - cr.top) / cr.height * 100).toFixed(2),
      h: Math.round(r.height)
    }
  })
})()`

try {
  const main = await waitTarget('index.html')
  const { ready, send } = connect(main.webSocketDebuggerUrl)
  await ready
  await send('Page.enable')
  await sleep(600)
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text)
    return r.result?.value
  }
  const shoot = async (f) => {
    const { data } = await send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(join(OUT, f), Buffer.from(data, 'base64'))
  }

  /* ---------- 只注入定时事件（不含全天） ---------- */
  const ids = await ev(`(async () => {
    const base = new Date(); base.setHours(0,0,0,0)
    const mk = async (h, m, dur, title, color) => {
      const s = new Date(base); s.setHours(h, m, 0, 0)
      const e = new Date(s.getTime() + dur * 60000)
      const r = await window.api.upsertEvent({ title, start: s.toISOString(), end: e.toISOString(), allDay: false, color })
      return r.id
    }
    const ids = {}
    ids.pairA = await mk(9, 0, 60, 'QA2-重叠A', 'blue')
    ids.pairB = await mk(9, 0, 60, 'QA2-重叠B', 'violet')
    ids.chainA = await mk(12, 0, 60, 'QA2-链A', 'emerald')
    ids.chainB = await mk(12, 30, 60, 'QA2-链B', 'amber')
    ids.chainC = await mk(13, 0, 60, 'QA2-链C', 'rose')
    ids.solo1 = await mk(16, 0, 60, 'QA2-独立1', 'slate')
    ids.solo2 = await mk(18, 0, 60, 'QA2-独立2', 'blue')
    return ids
  })()`)
  await sleep(700)

  await ev(`(() => {
    [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '今天')?.click()
    document.querySelectorAll('.segmented button')[2].click()
  })()`)
  await sleep(800)
  log('A_无全天事件_日视图', await ev(READ_SLOTS))
  await shoot('qa2-day-noallday.png')

  /* ---------- 加入全天事件后同一批数据 ---------- */
  await ev(`window.api.upsertEvent({ title: 'QA2-全天', start: (() => { const d = new Date(); d.setHours(0,0,0,0); return d.toISOString() })(), end: (() => { const d = new Date(); d.setHours(0,0,0,0); return new Date(d.getTime() + 86400000).toISOString() })(), allDay: true, color: 'amber' })`)
  await sleep(800)
  log('B_含全天事件_日视图', await ev(READ_SLOTS))
  log('B_全天行', await ev(`({ row: !!document.querySelector('.allday-row'), chips: [...document.querySelectorAll('.allday-row .chip')].map(c => c.textContent.trim()) })`))
  await shoot('qa2-day-withallday.png')

  /* ---------- 周视图里同一场景 ---------- */
  await ev(`document.querySelectorAll('.segmented button')[1].click()`)
  await sleep(700)
  log('C_周视图_今天列', await ev(`(() => {
    const cols = [...document.querySelectorAll('.tl-col')]
    const todayCol = cols.find(c => c.querySelector('.now-line')) || cols[0]
    const cr = todayCol.getBoundingClientRect()
    return [...todayCol.querySelectorAll('.slot')].map(s => {
      const r = s.getBoundingClientRect()
      return { t: s.querySelector('.slot-title')?.textContent, w: +(r.width / cr.width * 100).toFixed(1), x: +((r.left - cr.left) / cr.width * 100).toFixed(1) }
    })
  })()`))

  /* ---------- 删除事件（软删除 + 墓碑） ---------- */
  const before = await ev(`(async () => (await window.api.getData()).events.length)()`)
  await ev(`window.api.deleteEvent('${ids.solo2}')`)
  await sleep(700)
  const after = await ev(`(async () => {
    const d = await window.api.getData()
    return { n: d.events.length, hasSolo2: d.events.some(e => e.title === 'QA2-独立2') }
  })()`)
  log('D_删除', { before, after })

  /* ---------- 月视图双击空白 → 默认时间 ---------- */
  await ev(`document.querySelectorAll('.segmented button')[0].click()`)
  await sleep(600)
  const emptyCellIdx = await ev(`(() => {
    const cells = [...document.querySelectorAll('.month-cell')]
    const i = cells.findIndex(c => !c.querySelector('.chip') && !c.classList.contains('out'))
    cells[i].dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    return i
  })()`)
  await sleep(500)
  log('E_月视图双击空白_默认时间', await ev(`({
    cellIdx: ${emptyCellIdx},
    heading: document.querySelector('.modal h2')?.textContent,
    date: document.querySelector('.modal input[type=date]')?.value,
    times: [...document.querySelectorAll('.modal input[type=time]')].map(i => i.value),
    duration: document.querySelector('.modal .field-row span[style*="62px"]')?.textContent
  })`))
  await shoot('qa2-editor-default.png')

  /* ---------- 编辑器：结束早于开始 → 次日；全天开关 ---------- */
  const crossDay = await ev(`(async () => {
    const setV = (el, v) => {
      const proto = el.type === 'date' ? window.HTMLInputElement.prototype : window.HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    }
    const title = document.querySelector('.modal .title-input')
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(title, 'QA2-跨天编辑')
    title.dispatchEvent(new Event('input', { bubbles: true }))
    const times = [...document.querySelectorAll('.modal input[type=time]')]
    setV(times[0], '23:00')
    setV(times[1], '01:00')
    await new Promise(r => setTimeout(r, 250))
    const dur = document.querySelector('.modal .field-row span[style*="62px"]')?.textContent
    [...document.querySelectorAll('.modal .btn.primary')][0].click()
    await new Promise(r => setTimeout(r, 600))
    const evs = (await window.api.getData()).events.filter(e => e.title === 'QA2-跨天编辑')
    return { durLabel: dur, saved: evs.map(e => ({ start: e.start, end: e.end, allDay: e.allDay })) }
  })()`)
  log('F_编辑器跨天', crossDay)

  /* ---------- 周视图点击空白 → 30 分钟吸附 ---------- */
  await ev(`document.querySelectorAll('.segmented button')[1].click()`)
  await sleep(700)
  const snap = await ev(`(async () => {
    const col = document.querySelectorAll('.tl-col')[0]
    const r = col.getBoundingClientRect()
    const y = r.top + r.height * (10.37 / 24)  // 约 10:22
    col.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + 20, clientY: y }))
    await new Promise(res => setTimeout(res, 400))
    const times = [...document.querySelectorAll('.modal input[type=time]')].map(i => i.value)
    document.querySelector('.overlay .icon-btn')?.click()
    return { times }
  })()`)
  log('G_周视图吸附', snap)

  /* ---------- 数据落盘 ---------- */
  await sleep(500)
  const raw = JSON.parse(readFileSync(join(USERDATA, 'daily-list.json'), 'utf-8'))
  log('H_落盘', {
    events: raw.events.length,
    tombstones: raw.events.filter((e) => e.deleted).map((e) => e.title),
    atomicTmpLeft: false,
    settings: Object.keys(raw.settings).length
  })

  await ev(`window.api.quit()`)
  await sleep(500)
} catch (e) {
  log('ERROR', e.message)
} finally {
  child.kill()
}
process.exit(0)
