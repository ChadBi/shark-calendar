/**
 * QA 第三轮：编辑器跨天/全天、周视图吸附、设置面板、悬浮窗长标题。
 * 用法：node scripts/qa-verify3.mjs
 */
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'

const ROOT = process.cwd()
const ELECTRON = join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
const PORT = 9399
const USERDATA = join(ROOT, 'smoke', `qa3-${Date.now()}`)
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
      pending.get(m.id).resolve(m.result)
      pending.delete(m.id)
    }
  })
  const ready = new Promise((res) => ws.addEventListener('open', res))
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++seq
      pending.set(id, { resolve })
      ws.send(JSON.stringify({ id, method, params }))
    })
  return { ready, send }
}

try {
  const main = await waitTarget('index.html')
  const { ready, send } = connect(main.webSocketDebuggerUrl)
  await ready
  await send('Page.enable')
  await sleep(600)
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) {
      throw new Error((r.exceptionDetails.exception?.description || r.exceptionDetails.text || '').split('\n')[0])
    }
    return r.result?.value
  }
  const shoot = async (f) => {
    const { data } = await send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(join(OUT, f), Buffer.from(data, 'base64'))
  }

  /* ---------- 新建 → 跨天（23:00–01:00） ---------- */
  await ev(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '新建')?.click()`)
  await sleep(500)
  const durBefore = await ev(`[...document.querySelectorAll('.modal .field-row span')].map(s => s.textContent.trim()).filter(Boolean)`)
  log('编辑器字段', durBefore)

  log(
    'F_跨天编辑',
    await ev(`(async () => {
      const setV = (el, v) => {
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, v)
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
      }
      const title = document.querySelector('.modal .title-input')
      setV(title, 'QA3-跨天编辑')
      const times = [...document.querySelectorAll('.modal input[type=time]')]
      setV(times[0], '23:00')
      setV(times[1], '01:00')
      await new Promise(r => setTimeout(r, 300))
      const labels = [...document.querySelectorAll('.modal .field-row span')].map(s => s.textContent.trim()).filter(Boolean)
      document.querySelector('.modal .btn.primary').click()
      await new Promise(r => setTimeout(r, 700))
      const evs = (await window.api.getData()).events.filter(e => e.title === 'QA3-跨天编辑')
      return { labels, saved: evs.map(e => ({ start: e.start, end: e.end })) }
    })()`)
  )

  /* ---------- 全天开关 ---------- */
  log(
    '全天开关',
    await ev(`(async () => {
      [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '新建')?.click()
      await new Promise(r => setTimeout(r, 400))
      const before = [...document.querySelectorAll('.modal input[type=time]')].length
      document.querySelector('.modal .switch').click()
      await new Promise(r => setTimeout(r, 250))
      const after = [...document.querySelectorAll('.modal input[type=time]')].length
      const on = document.querySelector('.modal .switch').getAttribute('aria-pressed')
      document.querySelector('.overlay .icon-btn').click()
      return { timeInputsBefore: before, timeInputsAfter: after, ariaPressed: on }
    })()`)
  )

  /* ---------- 周视图点击空白 → 吸附 ---------- */
  await ev(`document.querySelectorAll('.segmented button')[1].click()`)
  await sleep(700)
  log(
    'G_周视图吸附',
    await ev(`(async () => {
      const col = document.querySelectorAll('.tl-col')[2]
      const r = col.getBoundingClientRect()
      const out = []
      for (const hourFloat of [10.37, 10.61, 14.02]) {
        col.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + 15, clientY: r.top + r.height * (hourFloat / 24) }))
        await new Promise(res => setTimeout(res, 300))
        out.push({
          at: hourFloat,
          times: [...document.querySelectorAll('.modal input[type=time]')].map(i => i.value)
        })
        document.querySelector('.overlay .icon-btn')?.click()
        await new Promise(res => setTimeout(res, 200))
      }
      return out
    })()`)
  )

  /* ---------- 长标题 + emoji ---------- */
  await ev(`(async () => {
    const s = new Date(); s.setHours(10,0,0,0)
    await window.api.upsertEvent({ title: '长' + '标题'.repeat(100), start: s.toISOString(), end: new Date(s.getTime()+3600000).toISOString(), allDay: false, color: 'blue' })
    await window.api.upsertEvent({ title: '🎉🎉 emoji 标题 🚀 特殊 <script>alert(1)</script> & "quote"', start: new Date(s.getTime()+3600000).toISOString(), end: new Date(s.getTime()+7200000).toISOString(), allDay: false, color: 'rose' })
    return 'ok'
  })()`)
  await sleep(800)
  log(
    'H_长标题',
    await ev(`(() => {
      const slots = [...document.querySelectorAll('.slot')]
      const long = slots.find(s => (s.textContent || '').includes('长长'))
      const emoji = slots.find(s => (s.textContent || '').includes('🎉'))
      const col = document.querySelector('.tl-col')
      const cr = col.getBoundingClientRect()
      return {
        slotCount: slots.length,
        longOverflow: long ? +(long.getBoundingClientRect().right - cr.right).toFixed(1) : null,
        longTextEllipsis: long ? { sw: long.scrollWidth, cw: long.clientWidth } : null,
        emojiText: emoji?.querySelector('.slot-title')?.textContent?.slice(0, 40) ?? null,
        scriptInjected: !!document.querySelector('.slot script'),
        docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
      }
    })()`)
  )
  await shoot('qa3-week-longtitle.png')

  /* ---------- 设置面板 ---------- */
  log(
    'I_设置面板',
    await ev(`(async () => {
      [...document.querySelectorAll('button')].find(b => b.title === '设置')?.click()
      await new Promise(r => setTimeout(r, 400))
      const panel = document.querySelector('.settings') || document.querySelector('.overlay')
      return {
        opened: !!panel,
        switches: document.querySelectorAll('.overlay .switch').length,
        labels: [...document.querySelectorAll('.overlay .field-row span')].map(s => s.textContent.trim()).filter(Boolean).slice(0, 12),
        opacityRange: !!document.querySelector('.overlay input[type=range]')
      }
    })()`)
  )
  await shoot('qa3-settings.png')
  await ev(`document.querySelector('.overlay .icon-btn')?.click()`)

  /* ---------- 悬浮窗长标题 ---------- */
  await ev(`window.api.toggleWidget(true)`)
  const wt = await waitTarget('widget.html', 12000)
  const w = connect(wt.webSocketDebuggerUrl)
  await w.ready
  await sleep(1200)
  const wev = async (e) => (await w.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.value
  log(
    'J_悬浮窗',
    await wev(`({
      h: window.innerHeight,
      items: [...document.querySelectorAll('.wg-item')].map(i => ({ t: i.querySelector('.wg-title')?.textContent?.slice(0, 12), sw: i.querySelector('.wg-title')?.scrollWidth, cw: i.querySelector('.wg-title')?.clientWidth })),
      listScroll: (() => { const l = document.querySelector('.wg-list'); return l ? { sh: l.scrollHeight, ch: l.clientHeight } : null })(),
      docOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth
    })`)
  )
  const { data } = await w.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(OUT, 'qa3-widget.png'), Buffer.from(data, 'base64'))

  await ev(`window.api.quit()`)
  await sleep(400)
} catch (e) {
  log('ERROR', e.message)
} finally {
  child.kill()
}
process.exit(0)
