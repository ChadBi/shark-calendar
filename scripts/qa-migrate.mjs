/**
 * QA：v1 → v2 数据迁移复测（多次启动同一个 user-data-dir）。
 * 用法：node scripts/qa-migrate.mjs
 */
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'

const ROOT = process.cwd()
const ELECTRON = join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (k, v) => console.log(`## ${k} :: ${JSON.stringify(v)}`)

let port = 9420

async function listTargets(p) {
  try {
    return await (await fetch(`http://127.0.0.1:${p}/json/list`)).json()
  } catch {
    return []
  }
}

async function waitTarget(p, match, ms = 25000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    const t = (await listTargets(p)).find((x) => x.type === 'page' && x.url.includes(match))
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

/** 启动一次应用，执行 fn，然后退出 */
async function runApp(userdata, fn) {
  const p = ++port
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  env.DAILY_LIST_DISABLE_GPU = '1'
  const child = spawn(
    ELECTRON,
    ['.', `--remote-debugging-port=${p}`, '--no-sandbox', '--disable-gpu', '--disable-gpu-compositing', `--user-data-dir=${userdata}`],
    { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] }
  )
  const out = []
  child.stdout.on('data', (d) => out.push(String(d)))
  child.stderr.on('data', (d) => out.push(String(d)))

  const target = await waitTarget(p, 'index.html')
  const { ready, send } = connect(target.webSocketDebuggerUrl)
  await ready
  await sleep(300)
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception?.description || r.exceptionDetails.text || '').split('\n')[0])
    return r.result?.value
  }
  const res = await fn({ ev, send })
  await send('Runtime.evaluate', { expression: 'window.api.quit()' }).catch(() => {})
  await sleep(700)
  child.kill()
  await sleep(300)
  return { res, logs: out.join('') }
}

/** 启动后 3 秒内轮询 toast，用来判断迁移提示是否送达渲染进程 */
async function watchToast(ev) {
  const seen = []
  for (let i = 0; i < 20; i++) {
    try {
      const t = await ev(`document.querySelector('.toast')?.textContent ?? null`)
      if (t && !seen.includes(t)) seen.push(t)
    } catch {
      /* 页面还没就绪 */
    }
    await sleep(150)
  }
  return seen
}

const BASE_EVENTS = [
  {
    id: 'e1',
    title: '老数据-会议',
    start: '2026-10-20T01:00:00.000Z',
    end: '2026-10-20T02:00:00.000Z',
    allDay: false,
    color: 'blue',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    rev: 1,
    deleted: false
  },
  {
    id: 'e2',
    title: '老数据-全天',
    start: '2026-10-21T00:00:00.000Z',
    end: '2026-10-22T00:00:00.000Z',
    allDay: true,
    color: 'amber',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    rev: 1,
    deleted: false
  }
]

const V1_SETTINGS = {
  closeToTray: true,
  minimizeToTray: false,
  launchAtLogin: false,
  weekStartsOn: 1,
  defaultView: 'week',
  widgetOpacity: 0.8,
  widgetAlwaysOnTop: true,
  widgetBounds: { x: 100, y: 100, width: 340, height: 440 },
  showWidgetOnStart: false,
  hour24: false
}

try {
  /* ---------- A1：v1（schemaVersion=1，widgetAlwaysOnTop=true）---------- */
  const dirA = join(ROOT, 'smoke', `mig-a-${Date.now()}`)
  mkdirSync(dirA, { recursive: true })
  writeFileSync(join(dirA, 'daily-list.json'), JSON.stringify({ schemaVersion: 1, events: BASE_EVENTS, settings: V1_SETTINGS }, null, 2))

  const a1 = await runApp(dirA, async ({ ev }) => {
    const toasts = await watchToast(ev)
    const d = await ev(`(async () => {
      const d = await window.api.getData()
      return {
        schemaVersion: d.schemaVersion,
        onTop: d.settings.widgetAlwaysOnTop,
        opacity: d.settings.widgetOpacity,
        defaultView: d.settings.defaultView,
        hour24: d.settings.hour24,
        events: d.events.map(e => e.title).sort(),
        sources: Array.isArray(d.sources) ? d.sources.length : 'MISSING'
      }
    })()`)
    return { toasts, ...d }
  })
  log('A1_v1迁移', a1.res)
  const fileA1 = JSON.parse(readFileSync(join(dirA, 'daily-list.json'), 'utf-8'))
  log('A1_落盘', { schemaVersion: fileA1.schemaVersion, onTop: fileA1.settings.widgetAlwaysOnTop, events: fileA1.events.length, sources: fileA1.sources })

  /* ---------- A2：再启动一次（已是 v2，不应重复迁移/不应重复提示）---------- */
  const a2 = await runApp(dirA, async ({ ev }) => {
    const toasts = await watchToast(ev)
    return { toasts, d: await ev(`(async () => { const d = await window.api.getData(); return { v: d.schemaVersion, onTop: d.settings.widgetAlwaysOnTop, events: d.events.length } })()`) }
  })
  log('A2_二次启动', a2.res)

  /* ---------- A3：用户手动打开置顶后重启，不能被迁移改回去 ---------- */
  const a3 = await runApp(dirA, async ({ ev }) => {
    await ev(`window.api.patchSettings({ widgetAlwaysOnTop: true })`)
    await sleep(400)
    return { onTop: await ev(`(async () => (await window.api.getData()).settings.widgetAlwaysOnTop)()`) }
  })
  const a4 = await runApp(dirA, async ({ ev }) => {
    const toasts = await watchToast(ev)
    return { toasts, onTop: await ev(`(async () => (await window.api.getData()).settings.widgetAlwaysOnTop)()`) }
  })
  log('A3_用户开启置顶', a3.res)
  log('A4_重启后保持', a4.res)

  /* ---------- A5：极老数据（没有 schemaVersion 字段）---------- */
  const dirB = join(ROOT, 'smoke', `mig-b-${Date.now()}`)
  mkdirSync(dirB, { recursive: true })
  writeFileSync(join(dirB, 'daily-list.json'), JSON.stringify({ events: BASE_EVENTS, settings: { widgetAlwaysOnTop: true } }, null, 2))
  const a5 = await runApp(dirB, async ({ ev }) => {
    const toasts = await watchToast(ev)
    const d = await ev(`(async () => {
      const d = await window.api.getData()
      return { v: d.schemaVersion, onTop: d.settings.widgetAlwaysOnTop, events: d.events.length, closeToTray: d.settings.closeToTray }
    })()`)
    return { toasts, ...d }
  })
  log('A5_无版本号', a5.res)

  /* ---------- A6：v2 数据里用户自己开的置顶，不应被改 ---------- */
  const dirC = join(ROOT, 'smoke', `mig-c-${Date.now()}`)
  mkdirSync(dirC, { recursive: true })
  writeFileSync(
    join(dirC, 'daily-list.json'),
    JSON.stringify({ schemaVersion: 2, events: [], sources: [], settings: { ...V1_SETTINGS } }, null, 2)
  )
  const a6 = await runApp(dirC, async ({ ev }) => {
    const toasts = await watchToast(ev)
    return { toasts, onTop: await ev(`(async () => (await window.api.getData()).settings.widgetAlwaysOnTop)()`) }
  })
  log('A6_v2不迁移', a6.res)
} catch (e) {
  log('ERROR', e.message)
}
process.exit(0)
