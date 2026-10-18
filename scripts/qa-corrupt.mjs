/**
 * QA：损坏数据文件恢复。写入非法 JSON 后启动，验证不白屏 + 生成备份。
 * 用法：node scripts/qa-corrupt.mjs
 */
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'

const ROOT = process.cwd()
const ELECTRON = join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
const PORT = 9388
const USERDATA = join(ROOT, 'smoke', `qa-corrupt-${Date.now()}`)
mkdirSync(USERDATA, { recursive: true })

const BAD = '{ "schemaVersion": 1, "events": [ { "id": "x", "title": "半截'
writeFileSync(join(USERDATA, 'daily-list.json'), BAD, 'utf-8')

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
env.DAILY_LIST_DISABLE_GPU = '1'

const logs = []
const child = spawn(
  ELECTRON,
  ['.', `--remote-debugging-port=${PORT}`, '--no-sandbox', '--disable-gpu', '--disable-gpu-compositing', `--user-data-dir=${USERDATA}`],
  { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] }
)
child.stdout.on('data', (d) => logs.push(String(d)))
child.stderr.on('data', (d) => logs.push(String(d)))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (k, v) => console.log(`## ${k} :: ${JSON.stringify(v)}`)

try {
  let target = null
  for (let i = 0; i < 80 && !target; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      target = list.find((t) => t.type === 'page' && t.url.includes('index.html'))
    } catch {
      /* retry */
    }
    if (!target) await sleep(250)
  }
  if (!target) throw new Error('应用未能启动')

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
  await sleep(1500)

  const r = await send('Runtime.evaluate', {
    expression: `({
      appShell: !!document.querySelector('.app-shell'),
      loading: document.body.textContent.includes('加载中'),
      cells: document.querySelectorAll('.month-cell').length,
      sidebarHint: document.querySelector('.empty-hint')?.textContent.replace(/\\s+/g,' ').trim() ?? null,
      bodyText: document.body.textContent.slice(0, 60)
    })`,
    returnByValue: true
  })
  log('启动结果', r.result?.value)

  const files = readdirSync(USERDATA).filter((f) => f.includes('daily-list'))
  log('目录文件', files)
  const bak = files.find((f) => f.includes('.corrupt-'))
  if (bak) log('备份内容前 40 字', readFileSync(join(USERDATA, bak), 'utf-8').slice(0, 40))

  await send('Runtime.evaluate', { expression: 'window.api.upsertEvent({ title: "恢复后新建", start: new Date().toISOString(), end: new Date(Date.now()+3600000).toISOString() })', awaitPromise: true })
  await sleep(900)
  const after = await send('Runtime.evaluate', {
    expression: `({ chips: document.querySelectorAll('.chip').length, json: JSON.parse(JSON.stringify(window.api.getData)) ? 'ok' : 'x' })`,
    returnByValue: true
  })
  log('恢复后可用', after.result?.value)
  const jsonNow = existsSync(join(USERDATA, 'daily-list.json'))
  log('数据文件已重建', jsonNow)
  await send('Runtime.evaluate', { expression: 'window.api.quit()' })
  await sleep(500)
} catch (e) {
  log('ERROR', e.message)
  log('日志', logs.join('').split('\n').filter((l) => /store|error|Error/.test(l)).slice(0, 8))
} finally {
  child.kill()
}
process.exit(0)
