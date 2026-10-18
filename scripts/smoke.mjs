/**
 * 冒烟测试：真实启动 Electron，通过 CDP 截图主窗口与悬浮窗。
 * 用法：node scripts/smoke.mjs
 */
import { spawn } from 'node:child_process'
import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const ELECTRON = join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
const OUT = join(ROOT, 'smoke')
const PORT = 9333

if (!existsSync(ELECTRON)) {
  console.error('找不到 electron.exe，先执行 npm install')
  process.exit(1)
}
mkdirSync(OUT, { recursive: true })

const logs = []
const env = { ...process.env }
// 某些终端环境会把 ELECTRON_RUN_AS_NODE 置 1，导致 electron 退化成纯 Node
delete env.ELECTRON_RUN_AS_NODE
// 当前会话没有可用 GPU，强制软件渲染，否则 Electron 会直接 FATAL 退出
env.DAILY_LIST_DISABLE_GPU = '1'

const child = spawn(
  ELECTRON,
  [
    '.',
    `--remote-debugging-port=${PORT}`,
    // 受限会话里 Chromium 沙箱会拖垮 GPU 进程，测试环境关闭
    '--no-sandbox',
    '--disable-gpu',
    '--disable-gpu-compositing',
    // 用独立的用户数据目录，避免污染真实日程数据
    `--user-data-dir=${join(OUT, 'userdata')}`
  ],
  { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] }
)
child.stdout.on('data', (d) => logs.push(`[out] ${d}`))
child.stderr.on('data', (d) => logs.push(`[err] ${d}`))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function listTargets() {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
    return await res.json()
  } catch {
    return []
  }
}

async function waitForTarget(match, timeoutMs = 20000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const targets = await listTargets()
    const t = targets.find((x) => x.type === 'page' && x.url.includes(match))
    if (t) return t
    await sleep(250)
  }
  throw new Error(`等待目标超时：${match}`)
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl)
  let seq = 0
  const pending = new Map()
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)
    }
  })
  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve)
    ws.addEventListener('error', reject)
  })
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params }))
    })
  return { ws, ready, send }
}

async function shoot(target, file) {
  console.log(`  → 连接 ${target.url}`)
  const { ws, ready, send } = connect(target.webSocketDebuggerUrl)
  await Promise.race([
    ready,
    new Promise((_, rej) => setTimeout(() => rej(new Error('WebSocket 连接超时')), 8000))
  ])
  console.log('  → 已连接，启用 Page 域')
  await Promise.race([
    send('Page.enable'),
    new Promise((_, rej) => setTimeout(() => rej(new Error('Page.enable 超时')), 8000))
  ])
  await sleep(700)
  const { data } = await Promise.race([
    send('Page.captureScreenshot', { format: 'png' }),
    new Promise((_, rej) => setTimeout(() => rej(new Error('截图超时')), 15000))
  ])
  writeFileSync(join(OUT, file), Buffer.from(data, 'base64'))
  return { ws, send }
}

try {
  const main = await waitForTarget('index.html')
  const { ws, send } = await shoot(main, 'main-month.png')
  console.log('✓ 主窗口截图 smoke/main-month.png')

  // 注入示例数据（含两个故意重叠的事件，用于验证分栏算法）
  await send('Runtime.evaluate', {
    expression: `(async () => {
      const now = new Date()
      const mk = async (d, h, m, dur, title, color, allDay) => {
        const s = new Date(now); s.setDate(s.getDate() + d); s.setHours(h, m, 0, 0)
        const e = allDay ? new Date(s.getTime() + 86400000) : new Date(s.getTime() + dur * 60000)
        await window.api.upsertEvent({ title, start: s.toISOString(), end: e.toISOString(), allDay: !!allDay, color })
      }
      await mk(0, 9, 0, 60, '晨会同步', 'blue')
      await mk(0, 14, 0, 90, '和设计对需求', 'violet')
      await mk(0, 14, 30, 60, '客户电话', 'amber')
      await mk(0, 16, 30, 60, '周会', 'emerald')
      await mk(0, 20, 0, 45, '健身', 'slate')
      // 今天的全天事件：用于验证「全天」行与时间轴不会重复渲染
      await mk(0, 0, 0, 0, '版本发布', 'rose', true)
      await mk(1, 10, 0, 120, '写季度总结', 'blue')
      await mk(2, 15, 0, 60, '体检', 'rose')
      await mk(3, 11, 0, 30, '站会', 'emerald')
      await mk(4, 0, 0, 0, '产品发布日', 'violet', true)
      await mk(6, 9, 30, 90, '周末爬山', 'emerald')
      return 'seeded'
    })()`,
    awaitPromise: true
  })
  await sleep(900)

  await shoot(main, 'main-month-filled.png')
  console.log('✓ 月视图（含数据）smoke/main-month-filled.png')

  // 通过 CDP 驱动界面：切到周视图
  await send('Runtime.evaluate', { expression: "document.querySelectorAll('.segmented button')[1].click()" })
  await sleep(800)
  const { data: weekData } = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(OUT, 'main-week.png'), Buffer.from(weekData, 'base64'))
  console.log('✓ 周视图截图 smoke/main-week.png')

  await send('Runtime.evaluate', { expression: "document.querySelectorAll('.segmented button')[2].click()" })
  await sleep(800)
  const { data: dayData } = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(OUT, 'main-day.png'), Buffer.from(dayData, 'base64'))
  console.log('✓ 日视图截图 smoke/main-day.png')

  // 打开快速添加
  await send('Runtime.evaluate', {
    expression: `(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('快速添加'))
      btn && btn.click()
      return !!btn
    })()`
  })
  await sleep(400)
  await send('Runtime.evaluate', {
    expression: `(() => {
      const input = document.querySelector('.qa-input')
      if (!input) return 'no input'
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(input, '明天下午3点 和产品对需求 1小时')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      return 'typed'
    })()`
  })
  await sleep(400)
  const { data: qaData } = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(OUT, 'main-quickadd.png'), Buffer.from(qaData, 'base64'))
  console.log('✓ 快速添加截图 smoke/main-quickadd.png')

  await send('Runtime.evaluate', { expression: 'document.querySelector(".quickadd-overlay") && document.querySelector(".quickadd-overlay").dispatchEvent(new MouseEvent("mousedown",{bubbles:true}))' })
  await sleep(300)

  // 打开新建弹窗
  await send('Runtime.evaluate', {
    expression: "Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='新建').click()"
  })
  await sleep(500)
  const { data: modalData } = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(OUT, 'main-editor.png'), Buffer.from(modalData, 'base64'))
  console.log('✓ 新建弹窗截图 smoke/main-editor.png')

  await send('Runtime.evaluate', { expression: "document.querySelector('.overlay .icon-btn').click()" })
  await sleep(300)

  // 打开悬浮窗
  await send('Runtime.evaluate', { expression: 'window.api.toggleWidget(true)' })
  const widget = await waitForTarget('widget.html', 8000)
  const w = await shoot(widget, 'widget.png')
  console.log('✓ 悬浮窗截图 smoke/widget.png')

  await sleep(400)
  await w.send('Runtime.evaluate', { expression: 'window.api.quit()' })
  await sleep(600)
} catch (err) {
  console.error('✗ 冒烟测试失败：', err.message)
  const errs = logs.filter((l) => /error|Error|failed/i.test(l))
  if (errs.length) console.error(errs.join('\n'))
  child.kill()
  process.exit(1)
}

child.kill()
console.log('\n--- 运行日志 ---')
console.log(logs.join('').trim() || '(无输出)')
