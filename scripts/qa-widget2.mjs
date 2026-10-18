/**
 * QA：悬浮窗置顶图钉 + 折叠回归；主窗口回归（含上轮 P0-1 全天事件分栏修复验证）。
 * 用法：node scripts/qa-widget2.mjs
 */
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'

const ROOT = process.cwd()
const ELECTRON = join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
const OUT = join(ROOT, 'smoke')
const USERDATA = join(OUT, `w2-${Date.now()}`)
mkdirSync(USERDATA, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (k, v) => console.log(`## ${k} :: ${JSON.stringify(v)}`)

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
env.DAILY_LIST_DISABLE_GPU = '1'
const child = spawn(
  ELECTRON,
  ['.', '--remote-debugging-port=9451', '--no-sandbox', '--disable-gpu', '--disable-gpu-compositing', `--user-data-dir=${USERDATA}`],
  { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] }
)

async function listTargets() {
  try {
    return await (await fetch('http://127.0.0.1:9451/json/list')).json()
  } catch {
    return []
  }
}
async function waitTarget(match, ms = 25000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    const t = (await listTargets()).find((x) => x.type === 'page' && x.url.includes(match))
    if (t) return t
    await sleep(200)
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
  const t0 = await waitTarget('index.html')
  const main = connect(t0.webSocketDebuggerUrl)
  await main.ready
  await sleep(900)
  const ev = async (expr) => {
    const r = await main.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception?.description || '').split('\n')[0])
    return r.result?.value
  }
  await main.send('Page.enable')

  /* ---------- 回归：全天事件不再进时间轴（上轮 P0-1）---------- */
  await ev(`(async () => {
    const base = new Date(); base.setHours(0,0,0,0)
    const mk = async (h, m, dur, title, color, allDay) => {
      const s = new Date(base); s.setHours(h, m, 0, 0)
      const e = allDay ? new Date(s.getTime() + 86400000) : new Date(s.getTime() + dur * 60000)
      await window.api.upsertEvent({ title, start: s.toISOString(), end: e.toISOString(), allDay: !!allDay, color })
    }
    await mk(0, 0, 0, '回归-全天', 'amber', true)
    await mk(9, 0, 60, '回归-重叠A', 'blue')
    await mk(9, 0, 60, '回归-重叠B', 'violet')
    await mk(16, 0, 60, '回归-独立', 'emerald')
    return 'ok'
  })()`)
  await sleep(800)
  await ev(`(() => { [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '今天')?.click(); document.querySelectorAll('.segmented button')[2].click() })()`)
  await sleep(800)
  log(
    '回归_日视图分栏',
    await ev(`(() => {
      const col = document.querySelector('.tl-col')
      const cr = col.getBoundingClientRect()
      const slots = [...col.querySelectorAll('.slot')].map(s => {
        const r = s.getBoundingClientRect()
        return { t: s.querySelector('.slot-title')?.textContent, w: +(r.width / cr.width * 100).toFixed(1), h: Math.round(r.height) }
      })
      return { slots, alldayRow: [...document.querySelectorAll('.allday-row .chip')].map(c => c.textContent.trim()) }
    })()`)
  )

  /* ---------- 回归：月/周视图 + 快速添加 ---------- */
  await ev(`document.querySelectorAll('.segmented button')[1].click()`)
  await sleep(600)
  const week = await ev(`({ cols: document.querySelectorAll('.tl-col').length, heads: document.querySelectorAll('.tl-head-day').length, nowLine: document.querySelectorAll('.now-line').length })`)
  await ev(`document.querySelectorAll('.segmented button')[0].click()`)
  await sleep(600)
  const month = await ev(`({ cells: document.querySelectorAll('.month-cell').length, chips: document.querySelectorAll('.chip').length })`)
  const parse = await ev(`(async () => {
    [...document.querySelectorAll('button')].find(b => b.textContent.includes('快速添加'))?.click()
    await new Promise(r => setTimeout(r, 300))
    const input = document.querySelector('.qa-input')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(input, '明天下午3点 回归测试 1小时')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 200))
    const preview = document.querySelector('.qa-preview')?.textContent.replace(/\\s+/g, ' ').trim()
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    return preview
  })()`)
  log('回归_周视图', week)
  log('回归_月视图', month)
  log('回归_快速添加', parse)

  /* ---------- 悬浮窗：图钉 / 折叠 ---------- */
  await ev(`window.api.toggleWidget(true)`)
  const wt = await waitTarget('widget.html')
  const w = connect(wt.webSocketDebuggerUrl)
  await w.ready
  await sleep(1200)
  const wev = async (expr) => {
    const r = await w.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
    return r.result?.value
  }
  await w.send('Page.enable')
  log(
    '悬浮窗_初始',
    await wev(`(() => {
      const pin = document.querySelectorAll('.wg-actions .wg-btn')[0]
      return { h: window.innerHeight, pinClass: pin.className, pinTitle: pin.title, items: document.querySelectorAll('.wg-item').length }
    })()`)
  )
  log('悬浮窗_设置值(初始)', await ev(`(async () => (await window.api.getData()).settings.widgetAlwaysOnTop)()`))

  await wev(`document.querySelectorAll('.wg-actions .wg-btn')[0].click()`)
  await sleep(700)
  log('悬浮窗_点图钉后', await wev(`(() => { const pin = document.querySelectorAll('.wg-actions .wg-btn')[0]; return { pinClass: pin.className, pinTitle: pin.title } })()`))
  log('悬浮窗_设置值(置顶)', await ev(`(async () => (await window.api.getData()).settings.widgetAlwaysOnTop)()`))

  await wev(`document.querySelectorAll('.wg-actions .wg-btn')[0].click()`)
  await sleep(700)
  log('悬浮窗_再点一次', {
    pin: await wev(`document.querySelectorAll('.wg-actions .wg-btn')[0].className`),
    setting: await ev(`(async () => (await window.api.getData()).settings.widgetAlwaysOnTop)()`)
  })

  // 折叠
  await wev(`document.querySelectorAll('.wg-actions .wg-btn')[1].click()`)
  await sleep(700)
  const collapsed = await wev(`({ h: window.innerHeight, hasList: !!document.querySelector('.wg-list') })`)
  await wev(`document.querySelectorAll('.wg-actions .wg-btn')[1].click()`)
  await sleep(700)
  const expanded = await wev(`({ h: window.innerHeight })`)
  log('悬浮窗_折叠', { collapsed, expanded })

  // 隐藏再显示（验证 moveTop 路径不炸）
  await ev(`window.api.toggleWidget(false)`)
  await sleep(500)
  await ev(`window.api.toggleWidget(true)`)
  await sleep(900)
  log('悬浮窗_隐藏再显示', await wev(`({ h: window.innerHeight, alive: true, items: document.querySelectorAll('.wg-item').length })`))

  const shot = await w.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(OUT, 'w2-widget.png'), Buffer.from(shot.data, 'base64'))

  await ev(`window.api.quit()`)
  await sleep(500)
} catch (e) {
  log('ERROR', e.message)
} finally {
  child.kill()
}
process.exit(0)
