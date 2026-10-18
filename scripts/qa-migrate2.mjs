/**
 * QA：迁移提示（app:migrated → toast）是否真的送达渲染进程。
 * 做法：尽早通过 CDP 注册监听器，同时轮询 .toast，并与「订阅失败 toast」做对照。
 * 用法：node scripts/qa-migrate2.mjs
 */
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'

const ROOT = process.cwd()
const ELECTRON = join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
const USERDATA = join(ROOT, 'smoke', `mig-toast-${Date.now()}`)
mkdirSync(USERDATA, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (k, v) => console.log(`## ${k} :: ${JSON.stringify(v)}`)

writeFileSync(
  join(USERDATA, 'daily-list.json'),
  JSON.stringify(
    {
      schemaVersion: 1,
      events: [],
      settings: { closeToTray: true, widgetAlwaysOnTop: true, widgetOpacity: 0.92, weekStartsOn: 1, defaultView: 'month', hour24: true, launchAtLogin: false, minimizeToTray: false, widgetBounds: null, showWidgetOnStart: false }
    },
    null,
    2
  )
)

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
env.DAILY_LIST_DISABLE_GPU = '1'
const child = spawn(
  ELECTRON,
  ['.', '--remote-debugging-port=9441', '--no-sandbox', '--disable-gpu', '--disable-gpu-compositing', `--user-data-dir=${USERDATA}`],
  { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] }
)

try {
  let target = null
  for (let i = 0; i < 120 && !target; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:9441/json/list')).json()
      target = list.find((t) => t.type === 'page' && t.url.includes('index.html'))
    } catch {
      /* retry */
    }
    if (!target) await sleep(100)
  }
  if (!target) throw new Error('未启动')
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
  await new Promise((res) => ws.addEventListener('open', res))
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++seq
      pending.set(id, { resolve })
      ws.send(JSON.stringify({ id, method, params }))
    })
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
    return r.result?.value
  }

  // 尽早注册一个监听器（早于 React 的 useEffect）
  const early = await ev(`(() => {
    if (!window.api) return 'api-missing'
    window.__migEvents = []
    window.api.onMigrated((v) => window.__migEvents.push(v))
    return 'listener-installed'
  })()`)
  log('早期监听器', early)

  // 同时轮询 toast
  const toasts = []
  for (let i = 0; i < 30; i++) {
    const t = await ev(`document.querySelector('.toast')?.textContent ?? null`).catch(() => null)
    if (t && !toasts.includes(t)) toasts.push(t)
    await sleep(150)
  }
  log('迁移期间 toast', toasts)
  log('早期监听器收到的事件', await ev(`window.__migEvents ?? 'undefined'`))
  log('数据状态', await ev(`(async () => { const d = await window.api.getData(); return { v: d.schemaVersion, onTop: d.settings.widgetAlwaysOnTop } })()`))

  // 对照：走 UI 触发一个「订阅失败」toast，验证 toast 通道本身可用
  const ctrl = await ev(`(async () => {
    [...document.querySelectorAll('button')].find(b => b.title === '设置')?.click()
    await new Promise(r => setTimeout(r, 500))
    const addBtn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '添加')
    addBtn?.click()
    await new Promise(r => setTimeout(r, 300))
    const inputs = [...document.querySelectorAll('.source-form input')]
    if (inputs.length < 2) return { error: 'no form', inputs: inputs.length }
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(inputs[1], '这不是链接')
    inputs[1].dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 200))
    const submit = [...document.querySelectorAll('.source-form button')].find(b => b.textContent.includes('添加'))
    submit?.click()
    await new Promise(r => setTimeout(r, 1200))
    return { toast: document.querySelector('.toast')?.textContent ?? null }
  })()`)
  log('对照toast(订阅失败)', ctrl)

  await send('Runtime.evaluate', { expression: 'window.api.quit()' }).catch(() => {})
  await sleep(400)
} catch (e) {
  log('ERROR', e.message)
} finally {
  child.kill()
}
process.exit(0)
