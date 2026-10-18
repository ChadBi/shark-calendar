/**
 * QA：「复制为我的日程」是否生成可编辑的本地事件；以及订阅事件软删除后是否会被同步恢复。
 * 用法：node scripts/qa-dup.mjs
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'

const ROOT = process.cwd()
const ELECTRON = join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
const USERDATA = join(ROOT, 'smoke', `dup-${Date.now()}`)
mkdirSync(USERDATA, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (k, v) => console.log(`## ${k} :: ${JSON.stringify(v)}`)

const ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//QA//Dup//CN
BEGIN:VEVENT
UID:dup-1
DTSTART:20261019T020000Z
DTEND:20261019T030000Z
SUMMARY:原始订阅事件
DESCRIPTION:描述文本
LOCATION:会议室A
END:VEVENT
END:VCALENDAR
`
const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/calendar' })
  res.end(ICS)
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const PORT = server.address().port

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
env.DAILY_LIST_DISABLE_GPU = '1'
const child = spawn(
  ELECTRON,
  ['.', '--remote-debugging-port=9471', '--no-sandbox', '--disable-gpu', '--disable-gpu-compositing', `--user-data-dir=${USERDATA}`],
  { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] }
)

try {
  let target = null
  for (let i = 0; i < 120 && !target; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:9471/json/list')).json()
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

  log(
    '准备',
    await ev(`(async () => {
      const r = await window.api.addSource({ name: '复制测试', url: 'http://127.0.0.1:${PORT}/x.ics' })
      const d = await window.api.getData()
      const inst = d.events.find(e => e.sourceId)
      window.api.openEvent(inst.id)
      await new Promise(res => setTimeout(res, 900))
      return { added: r.result.added, instId: inst.id, h2: document.querySelector('.modal h2')?.textContent, notes: document.querySelector('.modal .textarea')?.value }
    })()`)
  )

  log(
    '复制为我的日程',
    await ev(`(async () => {
      const btn = [...document.querySelectorAll('.modal-foot button')].find(b => b.textContent.includes('复制为我的日程'))
      if (!btn) return { error: 'no button' }
      btn.click()
      await new Promise(r => setTimeout(r, 1000))
      const d = await window.api.getData()
      const local = d.events.filter(e => !e.sourceId)
      const sub = d.events.filter(e => e.sourceId)
      return {
        localCount: local.length,
        localTitle: local[0]?.title,
        localHasSource: !!local[0]?.sourceId,
        localReadOnly: local[0]?.readOnly ?? null,
        subCount: sub.length,
        subTitle: sub[0]?.title,
        subStart: sub[0]?.start,
        toast: document.querySelector('.toast')?.textContent ?? null,
        modalClosed: !document.querySelector('.modal')
      }
    })()`)
  )

  // 复制出来的本地事件能否正常编辑
  log(
    '编辑副本',
    await ev(`(async () => {
      const d = await window.api.getData()
      const local = d.events.find(e => !e.sourceId)
      window.api.openEvent(local.id)
      await new Promise(r => setTimeout(r, 800))
      const h2 = document.querySelector('.modal h2')?.textContent
      const title = document.querySelector('.modal .title-input')
      const editable = !title?.readOnly && !document.querySelector('.readonly-banner')
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(title, '改过的副本')
      title.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise(r => setTimeout(r, 200))
      document.querySelector('.modal .btn.primary')?.click()
      await new Promise(r => setTimeout(r, 700))
      const after = (await window.api.getData()).events.find(e => e.id === local.id)
      return { h2, editable, savedTitle: after?.title, stillLocal: !after?.sourceId }
    })()`)
  )

  // 订阅事件被软删除后，同步是否恢复
  log(
    '软删除订阅事件后同步',
    await ev(`(async () => {
      const d = await window.api.getData()
      const sub = d.events.find(e => e.sourceId)
      await window.api.deleteEvent(sub.id)
      await new Promise(r => setTimeout(r, 400))
      const gone = !(await window.api.getData()).events.some(e => e.id === sub.id)
      await window.api.syncSources()
      await new Promise(r => setTimeout(r, 600))
      const back = (await window.api.getData()).events.some(e => e.id === sub.id)
      return { goneAfterDelete: gone, backAfterSync: back }
    })()`)
  )

  await send('Runtime.evaluate', { expression: 'window.api.quit()' }).catch(() => {})
  await sleep(400)
} catch (e) {
  log('ERROR', e.message)
} finally {
  child.kill()
  server.close()
}
process.exit(0)
