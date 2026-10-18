/**
 * QA：ICS 订阅异常路径 + 边界（404 / 非 ICS / 非法 URL / file:// / 空日历 /
 * 重复链接 / webcal 变体 / 忽略此次 / 断网保留 / 删除源 / 无超时挂起）。
 * 用法：node scripts/qa-subscription-edge.mjs
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'

const ROOT = process.cwd()
const ELECTRON = join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
const OUT = join(ROOT, 'smoke')
const USERDATA = join(OUT, `edge-${Date.now()}`)
mkdirSync(USERDATA, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (k, v) => console.log(`## ${k} :: ${JSON.stringify(v)}`)

const OK_ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//QA//Edge//CN
BEGIN:VEVENT
UID:daily-1
DTSTAMP:20261001T000000Z
DTSTART:20261017T020000Z
DTEND:20261017T030000Z
RRULE:FREQ=DAILY;COUNT=10
SUMMARY:每日同步
END:VEVENT
BEGIN:VEVENT
UID:once-1
DTSTAMP:20261001T000000Z
DTSTART:20261025T060000Z
DTEND:20261025T070000Z
SUMMARY:一次性事件
END:VEVENT
END:VCALENDAR
`

const EMPTY_ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//QA//Empty//CN
END:VCALENDAR
`

let hangingSockets = []
const server = createServer((req, res) => {
  const url = req.url ?? ''
  if (url.startsWith('/ok.ics')) {
    res.writeHead(200, { 'Content-Type': 'text/calendar; charset=utf-8' })
    res.end(OK_ICS)
  } else if (url.startsWith('/empty.ics')) {
    res.writeHead(200, { 'Content-Type': 'text/calendar' })
    res.end(EMPTY_ICS)
  } else if (url.startsWith('/html')) {
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end('<html><body>login required</body></html>')
  } else if (url.startsWith('/slow')) {
    // 永不响应：用来验证 fetchIcs 有没有超时
    hangingSockets.push(res)
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('not found')
  }
})
await new Promise((resolve, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', resolve)
})
const PORT = server.address().port
const BASE = `http://127.0.0.1:${PORT}`
log('测试服务', BASE)

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
env.DAILY_LIST_DISABLE_GPU = '1'
const child = spawn(
  ELECTRON,
  ['.', `--remote-debugging-port=9431`, '--no-sandbox', '--disable-gpu', '--disable-gpu-compositing', `--user-data-dir=${USERDATA}`],
  { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] }
)
const logs = []
child.stdout.on('data', (d) => logs.push(String(d)))
child.stderr.on('data', (d) => logs.push(String(d)))

try {
  let target = null
  for (let i = 0; i < 100 && !target; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:9431/json/list')).json()
      target = list.find((t) => t.type === 'page' && t.url.includes('index.html'))
    } catch {
      /* retry */
    }
    if (!target) await sleep(250)
  }
  if (!target) throw new Error('应用未启动')
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
    if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception?.description || r.exceptionDetails.text || '').split('\n')[0])
    return r.result?.value
  }
  await send('Page.enable')
  await sleep(1200)

  /* 基线：一条本地事件 */
  await ev(`window.api.upsertEvent({ title: '本地事件1', start: new Date().toISOString(), end: new Date(Date.now()+3600000).toISOString() })`)
  await sleep(400)

  const tryAdd = (url, label) =>
    ev(`(async () => {
      const before = await window.api.getData()
      let r
      try { r = await window.api.addSource({ name: ${JSON.stringify(label)}, url: ${JSON.stringify(url)} }) }
      catch (e) { return { threw: String(e && e.message || e) } }
      const after = await window.api.getData()
      return {
        ok: r.result.ok,
        added: r.result.added,
        error: r.result.error ?? null,
        sources: after.sources.length,
        events: after.events.length,
        localEvents: after.events.filter(e => !e.sourceId).length,
        subEvents: after.events.filter(e => e.sourceId).length
      }
    })()`)

  log('B1_非法URL', await tryAdd('这不是一个链接', '非法URL'))
  log('B2_file协议', await tryAdd('file:///C:/windows/win.ini', 'file协议'))
  log('B3_404', await tryAdd(`${BASE}/404`, '404'))
  log('B4_非ICS(HTML)', await tryAdd(`${BASE}/html`, 'HTML'))
  log('B5_空日历', await tryAdd(`${BASE}/empty.ics`, '空日历'))
  log('B6_正常订阅', await tryAdd(`${BASE}/ok.ics`, '正常日历'))

  /* 重复同步是否幂等 */
  log(
    'B7_重复同步幂等',
    await ev(`(async () => {
      const s = (await window.api.getData()).sources.find(s => s.name === '正常日历')
      const r = await window.api.syncSources(s.id)
      const d = await window.api.getData()
      return { added: r[0].added, removed: r[0].removed, subEvents: d.events.filter(e => e.sourceId).length, sourceEvents: d.sources.find(x => x.id === s.id).eventCount }
    })()`)
  )

  /* webcal:// 变体是否会绕过 URL 去重产生第二份 */
  log(
    'B8_webcal变体',
    await ev(`(async () => {
      const before = await window.api.getData()
      const r = await window.api.addSource({ name: 'webcal变体', url: 'webcal://127.0.0.1:${PORT}/ok.ics' })
      await new Promise(res => setTimeout(res, 300))
      const after = await window.api.getData()
      return {
        ok: r.result.ok, error: r.result.error ?? null,
        sourcesBefore: before.sources.length, sourcesAfter: after.sources.length,
        subEventsBefore: before.events.filter(e => e.sourceId).length,
        subEventsAfter: after.events.filter(e => e.sourceId).length,
        dupTitles: (() => {
          const m = {}
          for (const e of after.events) m[e.title] = (m[e.title] || 0) + 1
          return Object.entries(m).filter(([, n]) => n > 1).map(([t, n]) => t + '×' + n)
        })()
      }
    })()`)
  )

  /* 「忽略此次」→ 消失，且再次同步不回来 */
  log(
    'B9_忽略此次',
    await ev(`(async () => {
      const d0 = await window.api.getData()
      const src = d0.sources.find(s => s.name === '正常日历')
      const inst = d0.events.find(e => e.sourceId === src.id && e.externalId === 'daily-1')
      if (!inst) return { error: 'no instance' }
      const key = inst.externalId + ':' + inst.start
      await window.api.hideInstance(src.id, key)
      await new Promise(r => setTimeout(r, 300))
      const d1 = await window.api.getData()
      const goneNow = !d1.events.some(e => e.id === inst.id)
      const hiddenList = d1.sources.find(s => s.id === src.id).hidden ?? []
      await window.api.syncSources(src.id)
      await new Promise(r => setTimeout(r, 300))
      const d2 = await window.api.getData()
      return {
        key,
        goneNow,
        hiddenCount: hiddenList.length,
        stillGoneAfterSync: !d2.events.some(e => e.id === inst.id),
        subEventsAfterResync: d2.events.filter(e => e.sourceId === src.id).length
      }
    })()`)
  )

  /* 断网：关掉服务再同步 */
  await new Promise((r) => server.close(r))
  log(
    'B10_断网同步',
    await ev(`(async () => {
      const before = await window.api.getData()
      const src = before.sources.find(s => s.name === '正常日历')
      const n0 = before.events.filter(e => e.sourceId === src.id).length
      const r = await window.api.syncSources(src.id)
      const after = await window.api.getData()
      const srcAfter = after.sources.find(s => s.id === src.id)
      return {
        ok: r[0].ok, error: r[0].error ?? null,
        eventsBefore: n0,
        eventsAfter: after.events.filter(e => e.sourceId === src.id).length,
        lastError: srcAfter.lastError ?? null,
        lastSyncAt: srcAfter.lastSyncAt ?? null
      }
    })()`)
  )

  /* UI：订阅管理里是否显示「同步失败」 */
  log(
    'B11_UI错误展示',
    await ev(`(async () => {
      [...document.querySelectorAll('button')].find(b => b.title === '设置')?.click()
      await new Promise(r => setTimeout(r, 500))
      const body = document.querySelector('.settings-sheet .modal-body')
      if (body) body.scrollTop = body.scrollHeight
      await new Promise(r => setTimeout(r, 300))
      const items = [...document.querySelectorAll('.source-item')].map(i => ({
        name: i.querySelector('.source-name')?.textContent,
        meta: i.querySelector('.source-meta')?.textContent
      }))
      return { count: items.length, items }
    })()`)
  )
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(OUT, 'edge-settings-error.png'), Buffer.from(shot.data, 'base64'))

  /* 删除订阅源：其事件消失，本地事件保留 */
  log(
    'B12_删除订阅源',
    await ev(`(async () => {
      document.querySelector('.overlay .icon-btn')?.click()
      const before = await window.api.getData()
      const src = before.sources.find(s => s.name === '正常日历')
      await window.api.removeSource(src.id)
      await new Promise(r => setTimeout(r, 400))
      const after = await window.api.getData()
      return {
        sourcesBefore: before.sources.length, sourcesAfter: after.sources.length,
        subEventsAfter: after.events.filter(e => e.sourceId).length,
        localEventsAfter: after.events.filter(e => !e.sourceId).length,
        sourceStillThere: after.sources.some(s => s.id === src.id)
      }
    })()`)
  )

  /* 无超时验证：/slow 永不响应，看 addSource 会不会一直挂着 */
  const slow = await Promise.race([
    ev(`(async () => {
      const t0 = Date.now()
      const r = await window.api.addSource({ name: '挂起测试', url: '${BASE}/slow' })
      return { ms: Date.now() - t0, ok: r.result.ok, error: r.result.error ?? null }
    })()`),
    sleep(7000).then(() => ({ timeout: true, note: '7 秒内没有返回，说明请求没有超时控制' }))
  ])
  log('B13_挂起请求', slow)

  const after = await ev(`(async () => {
    const d = await window.api.getData()
    return { events: d.events.length, local: d.events.filter(e => !e.sourceId).length, sources: d.sources.map(s => s.name) }
  })()`)
  log('B14_最终状态', after)

  await send('Runtime.evaluate', { expression: 'window.api.quit()' }).catch(() => {})
  await sleep(500)
} catch (e) {
  log('ERROR', e.message)
  log('日志', logs.join('').split('\n').filter((l) => /error|Error/i.test(l)).slice(0, 6))
} finally {
  child.kill()
  for (const s of hangingSockets) {
    try {
      s.destroy()
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
