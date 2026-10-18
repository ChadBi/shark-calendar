/**
 * 订阅异常路径测试（对应第二轮 QA 的 P1-1 ~ P1-5）：
 * - P1-1 请求无超时 → 面板永久卡「同步中」
 * - P1-2 添加失败留下僵尸订阅源
 * - P1-5 截断的 ICS 被当成空日历清空数据
 *
 * 用法：node scripts/test-edge.mjs
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { readFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const ELECTRON = join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
const OUT = join(ROOT, 'smoke')
const CDP_PORT = 9399
const USERDATA = join(OUT, `edge-${Date.now()}`)
mkdirSync(USERDATA, { recursive: true })

const goodIcs = readFileSync(join(OUT, 'test.ics'), 'utf-8')

const server = createServer((req, res) => {
  const url = req.url || ''
  if (url.startsWith('/test.ics')) {
    res.writeHead(200, { 'Content-Type': 'text/calendar; charset=utf-8' })
    res.end(goodIcs)
  } else if (url.startsWith('/slow')) {
    // 接受连接但永不响应，模拟卡死的订阅地址
  } else if (url.startsWith('/truncated')) {
    // 只有开头没有结尾，模拟代理中断的半截响应
    res.writeHead(200, { 'Content-Type': 'text/calendar' })
    res.end('BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:half\nDTSTART:20261020T140000Z\nDTEND:20261020T150000Z\nSUMMARY:半截日历\n')
  } else if (url.startsWith('/html')) {
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end('<html><body>not a calendar</body></html>')
  } else {
    res.writeHead(404)
    res.end('not found')
  }
})
await new Promise((resolve, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', resolve)
})
const PORT = server.address().port
const base = `http://127.0.0.1:${PORT}`
console.log(`✓ 测试服务 http://127.0.0.1:${PORT}`)

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
env.DAILY_LIST_DISABLE_GPU = '1'

const child = spawn(
  ELECTRON,
  [
    '.',
    `--remote-debugging-port=${CDP_PORT}`,
    '--no-sandbox',
    '--disable-gpu',
    '--disable-gpu-compositing',
    `--user-data-dir=${USERDATA}`
  ],
  { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] }
)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitTarget() {
  for (let i = 0; i < 100; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()
      const t = list.find((x) => x.type === 'page' && x.url.includes('index.html'))
      if (t) return t
    } catch {
      /* not ready */
    }
    await sleep(250)
  }
  throw new Error('页面未就绪')
}

let failures = 0
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  实际=${JSON.stringify(actual)} 期望=${JSON.stringify(expected)}`}`)
  if (!ok) failures++
}

try {
  const target = await waitTarget()
  const ws = new WebSocket(target.webSocketDebuggerUrl)
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
  await new Promise((res, rej) => {
    ws.addEventListener('open', res)
    ws.addEventListener('error', rej)
  })
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params }))
    })
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
    return r.result.value
  }

  await sleep(1500)

  console.log('\n--- P1-2 失败不落盘 ---')
  for (const [label, url] of [
    ['404', `${base}/404`],
    ['HTML 内容', `${base}/html`],
    ['非法链接', '这不是一个链接'],
    ['file 协议', 'file:///C:/windows/win.ini']
  ]) {
    const r = JSON.parse(
      await evaluate(`(async () => {
        const r = await window.api.addSource({ name: '${label}', url: ${JSON.stringify(url)} })
        const d = await window.api.getData()
        return JSON.stringify({ ok: r.result.ok, error: r.result.error ?? null, sources: d.sources.length, events: d.events.length })
      })()`)
    )
    check(`${label}：返回失败`, r.ok, false)
    check(`${label}：没有留下订阅源`, r.sources, 0)
    check(`${label}：事件未被污染`, r.events, 0)
  }

  console.log('\n--- P1-5 截断的 ICS ---')
  const trunc = JSON.parse(
    await evaluate(`(async () => {
      const r = await window.api.addSource({ name: '截断', url: '${base}/truncated' })
      const d = await window.api.getData()
      return JSON.stringify({ ok: r.result.ok, error: r.result.error ?? null, sources: d.sources.length, events: d.events.length })
    })()`)
  )
  check('截断文件被拒绝', trunc.ok, false)
  check('截断错误提示可读', String(trunc.error).includes('完整'), true)
  check('截断不落盘', trunc.sources, 0)

  console.log('\n--- 正常订阅 ---')
  const good = JSON.parse(
    await evaluate(`(async () => {
      const r = await window.api.addSource({ name: '正常', url: '${base}/test.ics' })
      const d = await window.api.getData()
      return JSON.stringify({ ok: r.result.ok, added: r.result.added, sources: d.sources.length, events: d.events.length })
    })()`)
  )
  check('正常订阅成功', good.ok, true)
  check('导入 9 条', good.added, 9)
  check('订阅源 1 个', good.sources, 1)

  console.log('\n--- 重复添加（同 URL）---')
  const dup = JSON.parse(
    await evaluate(`(async () => {
      await window.api.addSource({ name: '重复', url: '${base}/test.ics' })
      const d = await window.api.getData()
      return JSON.stringify({ sources: d.sources.length, events: d.events.length })
    })()`)
  )
  check('不新增源', dup.sources, 1)
  check('不重复事件', dup.events, 9)

  console.log('\n--- P1-1 超时（最长等 20 秒）---')
  const t0 = Date.now()
  const slow = JSON.parse(
    await evaluate(`(async () => {
      const t = Date.now()
      const r = await window.api.addSource({ name: '卡死', url: '${base}/slow' })
      const d = await window.api.getData()
      return JSON.stringify({ ok: r.result.ok, error: r.result.error ?? null, ms: Date.now() - t, sources: d.sources.length, events: d.events.length })
    })()`)
  )
  const elapsed = Date.now() - t0
  check('卡死地址返回失败', slow.ok, false)
  check('错误文案是超时', String(slow.error).includes('超时'), true)
  check('15 秒左右返回（非无限挂起）', slow.ms > 13000 && slow.ms < 20000, true)
  check('超时不落盘', slow.sources, 1)
  check('超时不清空已有事件', slow.events, 9)
  console.log(`  （实际耗时 ${(elapsed / 1000).toFixed(1)}s）`)

  console.log('\n--- 超时后 UI 可继续操作 ---')
  const uiState = JSON.parse(
    await evaluate(`(async () => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('快速添加'))
      return JSON.stringify({ buttonsUsable: !btn.disabled })
    })()`)
  )
  check('界面未卡死', uiState.buttonsUsable, true)

  await evaluate('window.api.quit()').catch(() => {})
  await sleep(500)
} catch (err) {
  console.error('✗ 测试失败：', err.message)
  failures++
} finally {
  child.kill()
  // /slow 那条连接是我们主动 abort 的，服务端 socket 可能还挂着，
  // 不强制断开的话 server.close() 会一直等
  server.closeAllConnections?.()
  server.close()
}

console.log(failures === 0 ? '\n异常路径测试全部通过' : `\n${failures} 项失败`)
process.exit(failures === 0 ? 0 : 1)
