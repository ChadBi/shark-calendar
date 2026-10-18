/**
 * QA：打包产物（release/win-unpacked/日程.exe）启动验证。
 * 用法：node scripts/qa-packaged.mjs
 */
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'

const ROOT = process.cwd()
const EXE = join(ROOT, 'release', 'win-unpacked', '日程.exe')
const PORT = 9411
const USERDATA = join(ROOT, 'smoke', `qa-pkg-${Date.now()}`)
mkdirSync(USERDATA, { recursive: true })

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
env.DAILY_LIST_DISABLE_GPU = '1'

const logs = []
const child = spawn(EXE, [`--remote-debugging-port=${PORT}`, '--no-sandbox', '--disable-gpu', '--disable-gpu-compositing', `--user-data-dir=${USERDATA}`], {
  cwd: join(ROOT, 'release', 'win-unpacked'),
  env,
  stdio: ['ignore', 'pipe', 'pipe']
})
child.stdout.on('data', (d) => logs.push(String(d)))
child.stderr.on('data', (d) => logs.push(String(d)))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (k, v) => console.log(`## ${k} :: ${JSON.stringify(v)}`)

try {
  let target = null
  for (let i = 0; i < 100 && !target; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      target = list.find((t) => t.type === 'page' && t.url.includes('index.html'))
    } catch {
      /* retry */
    }
    if (!target) await sleep(250)
  }
  if (!target) throw new Error('打包版未能启动（无渲染进程）')
  log('渲染进程', target.url)

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
  await send('Page.enable')
  await sleep(1500)

  const r = await send('Runtime.evaluate', {
    expression: `(async () => {
      const d = await window.api.getData()
      return {
        appShell: !!document.querySelector('.app-shell'),
        cells: document.querySelectorAll('.month-cell').length,
        events: d.events.length,
        settings: Object.keys(d.settings).length,
        version: d.schemaVersion,
        widgetApi: typeof window.api.toggleWidget
      }
    })()`,
    returnByValue: true,
    awaitPromise: true
  })
  log('打包版启动', r.result?.value)

  const { data } = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(ROOT, 'smoke', 'qa-packaged.png'), Buffer.from(data, 'base64'))

  await send('Runtime.evaluate', { expression: 'window.api.quit()' })
  await sleep(600)
  log('数据目录文件', readdirSync(USERDATA).filter((f) => f.includes('daily-list')))
  log('启动日志异常', logs.join('').split('\n').filter((l) => /error|Error|FATAL/.test(l)).slice(0, 5))
} catch (e) {
  log('ERROR', e.message)
  log('日志', logs.join('').slice(-600))
} finally {
  child.kill()
}
process.exit(0)
