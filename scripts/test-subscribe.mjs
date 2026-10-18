/**
 * 订阅功能端到端测试：
 * 起一个本地 HTTP 服务提供 test.ics，真实启动应用，通过 IPC 添加订阅，
 * 然后断言解析结果（折行、转义、RRULE 展开、EXDATE 排除、VALARM 隔离、只读）。
 *
 * 用法：node scripts/test-subscribe.mjs
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const ELECTRON = join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
const OUT = join(ROOT, 'smoke')
const CDP_PORT = 9377
const USERDATA = join(OUT, `sub-${Date.now()}`)
mkdirSync(USERDATA, { recursive: true })
mkdirSync(OUT, { recursive: true })

const ics = readFileSync(join(OUT, 'test.ics'))
const server = createServer((req, res) => {
  if (req.url?.startsWith('/test.ics')) {
    res.writeHead(200, { 'Content-Type': 'text/calendar; charset=utf-8' })
    res.end(ics)
  } else {
    res.writeHead(404)
    res.end('not found')
  }
})
// 用随机端口，避免固定端口被占用时静默挂起
await new Promise((resolve, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', resolve)
})
const PORT = server.address().port
console.log(`✓ 测试服务已启动 http://127.0.0.1:${PORT}/test.ics`)

const logs = []
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
child.stdout.on('data', (d) => logs.push(`[out] ${d}`))
child.stderr.on('data', (d) => logs.push(`[err] ${d}`))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitTarget(match, timeoutMs = 25000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()
      const t = list.find((x) => x.type === 'page' && x.url.includes(match))
      if (t) return t
    } catch {
      /* not ready */
    }
    await sleep(250)
  }
  throw new Error(`等待目标超时：${match}`)
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

let failures = 0

function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  console.log(
    `${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n    实际: ${JSON.stringify(actual)}\n    期望: ${JSON.stringify(expected)}`}`
  )
  if (!ok) failures++
  return ok
}

try {
  const target = await waitTarget('index.html')
  const { ready, send } = connect(target.webSocketDebuggerUrl)
  await ready
  await send('Page.enable')
  await sleep(1200)

  const res = await send('Runtime.evaluate', {
    expression: `(async () => {
      const r = await window.api.addSource({ name: '测试日历', url: 'http://127.0.0.1:${PORT}/test.ics' })
      await new Promise(res => setTimeout(res, 600))
      const data = await window.api.getData()
      const subs = data.events.filter(e => e.sourceId)
      return JSON.stringify({
        ok: r.result.ok,
        added: r.result.added,
        error: r.result.error ?? null,
        subEvents: subs.length,
        allReadOnly: subs.every(e => e.readOnly === true),
        weeklyCount: subs.filter(e => e.title === '每周站会').length,
        weeklyDates: subs.filter(e => e.title === '每周站会').map(e => e.start.slice(0, 10)).sort(),
        allDayCount: subs.filter(e => e.allDay).length,
        escapedTitle: subs.find(e => e.title.startsWith('带逗号'))?.title ?? null,
        alarmLeak: (subs.find(e => e.title === '带提醒的事件')?.notes ?? '').includes('提醒内容'),
        folded: (subs.find(e => e.title === '普通会议')?.notes ?? '').includes('75 字节'),
        sources: data.sources.map(s => ({ name: s.name, count: s.eventCount, err: s.lastError ?? null }))
      })
    })()`,
    awaitPromise: true,
    returnByValue: true
  })

  const r = JSON.parse(res.result.value)
  console.log('\n--- 断言 ---')
  check('订阅添加成功', r.ok, true)
  check('导入事件数（1普通+1全天+5周会+1转义+1提醒）', r.added, 9)
  check('全部标记为只读', r.allReadOnly, true)
  check('RRULE 展开且 EXDATE 生效（6 次减 1 次）', r.weeklyCount, 5)
  check('周会日期正确', r.weeklyDates, [
    '2026-10-19',
    '2026-10-26',
    '2026-10-28',
    '2026-11-02',
    '2026-11-04'
  ])
  check('全天事件识别', r.allDayCount, 1)
  // 标题里的 \n 应被还原成真正的换行
  check('转义字符还原', r.escapedTitle, '带逗号,分号;和换行\n的标题')
  check('VALARM 描述未混入事件', r.alarmLeak, false)
  check('折行被正确合并', r.folded, true)
  check('订阅源记录条数', r.sources[0]?.count, 9)
  check('订阅源无错误', r.sources[0]?.err, null)

  // 重复添加同一链接：应按 URL 去重，不能产生第二份事件
  const dupRes = await send('Runtime.evaluate', {
    expression: `(async () => {
      const before = (await window.api.getData()).events.length
      const r2 = await window.api.addSource({ name: '重复添加', url: 'http://127.0.0.1:${PORT}/test.ics' })
      await new Promise(res => setTimeout(res, 400))
      const data = await window.api.getData()
      return JSON.stringify({
        ok: r2.result.ok,
        sourceCount: data.sources.length,
        before,
        after: data.events.length
      })
    })()`,
    awaitPromise: true,
    returnByValue: true
  })
  const d = JSON.parse(dupRes.result.value)
  check('重复链接不新增订阅源', d.sourceCount, 1)
  check('重复链接不产生重复事件', d.after, d.before)

  // 切到周视图并翻到下一周（订阅事件都在 10/19 之后）
  await send('Runtime.evaluate', { expression: "document.querySelectorAll('.segmented button')[1].click()" })
  await sleep(500)
  await send('Runtime.evaluate', {
    expression: "window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))"
  })
  await sleep(900)
  const { data: shot } = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(OUT, 'sub-week.png'), Buffer.from(shot, 'base64'))
  console.log('✓ 截图 smoke/sub-week.png')

  // 打开订阅事件，验证只读弹窗
  const clicked = await send('Runtime.evaluate', {
    expression: `(() => {
      const slot = document.querySelector('.slot')
      if (!slot) return 'no slot'
      slot.click()
      return slot.textContent
    })()`,
    returnByValue: true
  })
  console.log(`  （点击的事件：${clicked.result.value}）`)
  await sleep(700)
  const { data: roShot } = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(OUT, 'sub-readonly.png'), Buffer.from(roShot, 'base64'))
  console.log('✓ 截图 smoke/sub-readonly.png')

  // 打开设置面板看订阅管理
  await send('Runtime.evaluate', {
    expression: `(() => {
      const close = document.querySelector('.overlay .icon-btn')
      if (close) close.click()
      const btn = document.querySelector('.sidebar-foot .icon-btn')
      if (btn) btn.click()
      return 'ok'
    })()`
  })
  await sleep(700)
  // 滚到设置面板底部，让订阅管理可见
  await send('Runtime.evaluate', {
    expression: `(() => {
      const body = document.querySelector('.settings-sheet .modal-body')
      if (body) body.scrollTop = body.scrollHeight
      return 'ok'
    })()`
  })
  await sleep(400)
  const { data: setShot } = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(OUT, 'sub-settings.png'), Buffer.from(setShot, 'base64'))
  console.log('✓ 截图 smoke/sub-settings.png')

  await send('Runtime.evaluate', { expression: 'window.api.quit()' }).catch(() => {})
  await sleep(500)
} catch (err) {
  console.error('✗ 测试失败：', err.message)
  failures++
} finally {
  child.kill()
  server.close()
}

console.log(failures === 0 ? '\n全部断言通过' : `\n${failures} 项断言失败`)
if (failures > 0) console.log(logs.filter((l) => /error|Error/i.test(l)).join('\n'))
process.exit(failures === 0 ? 0 : 1)
