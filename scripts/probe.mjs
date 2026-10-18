/**
 * 在真实运行的 Electron 渲染进程里执行 JS 并打印结果。
 * 用法：node scripts/probe.mjs "document.body.clientHeight"
 */
import { spawn } from 'node:child_process'
import { join } from 'node:path'

const ROOT = process.cwd()
const ELECTRON = join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
const PORT = 9345
const expr = process.argv[2] || 'document.title'

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
env.DAILY_LIST_DISABLE_GPU = '1'

const child = spawn(
  ELECTRON,
  [
    '.',
    `--remote-debugging-port=${PORT}`,
    '--no-sandbox',
    '--disable-gpu',
    '--disable-gpu-compositing',
    // 复用冒烟测试的数据，便于在真实数据下做断言
    `--user-data-dir=${join(ROOT, 'smoke', 'userdata')}`
  ],
  { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] }
)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitTarget() {
  for (let i = 0; i < 80; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const list = await res.json()
      const t = list.find((x) => x.type === 'page' && x.url.includes('index.html'))
      if (t) return t
    } catch {
      /* not ready */
    }
    await sleep(250)
  }
  throw new Error('目标未就绪')
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl)
  let seq = 0
  const pending = new Map()
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data)
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

try {
  const t = await waitTarget()
  const { ready, send } = connect(t.webSocketDebuggerUrl)
  await ready
  await sleep(1200)
  const res = await send('Runtime.evaluate', {
    expression: expr,
    returnByValue: true,
    awaitPromise: true
  })
  console.log(JSON.stringify(res.result?.value ?? res.result, null, 2))
  await send('Runtime.evaluate', { expression: 'window.api.quit()' }).catch(() => {})
  await sleep(400)
} catch (e) {
  console.error('probe 失败：', e.message)
}
child.kill()
process.exit(0)
