/**
 * 打包版联调验证：启动 release-v3 的安装包，用真实后端地址同步一次。
 *
 * 用一个无效令牌去试——如果返回「令牌无效」，说明网络、地址、云函数全通了，
 * 只是令牌不对；如果返回超时或 404，说明地址或路径还有问题。
 *
 * 用法：node scripts/verify-packed.mjs
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const EXE = join(ROOT, 'release-v3', 'win-unpacked', '日程.exe')
const USERDATA = join(ROOT, 'smoke', `verify-${Date.now()}`)
const PORT = 9410

// 换成你要验证的地址
const ENDPOINT = process.argv[2] || 'https://daily-list-d1gs9b0xa87ba7f30-1309664590.ap-shanghai.app.tcloudbase.com'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
mkdirSync(USERDATA, { recursive: true })

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
env.DAILY_LIST_DISABLE_GPU = '1'

const child = spawn(
  EXE,
  [
    '--no-sandbox',
    '--disable-gpu',
    '--disable-gpu-compositing',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${USERDATA}`
  ],
  { cwd: join(ROOT, 'release-v3', 'win-unpacked'), env, stdio: ['ignore', 'pipe', 'pipe'] }
)

try {
  let target = null
  for (let i = 0; i < 120; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      target = list.find((x) => x.type === 'page' && x.url.includes('index.html'))
      if (target) break
    } catch {
      /* not ready */
    }
    await sleep(250)
  }
  if (!target) throw new Error('打包版未启动')

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

  const result = JSON.parse(
    await evaluate(`(async () => {
      await window.api.patchSettings({ syncEnabled: true, syncEndpoint: ${JSON.stringify(ENDPOINT)} })
      await window.api.setSyncToken('invalid-token-for-verification')
      const r = await window.api.syncNow()
      const status = await window.api.getSyncStatus()
      return JSON.stringify({ outcome: r, status })
    })()`)
  )

  console.log('\n--- 同步结果 ---')
  console.log('ok      :', result.outcome.ok)
  console.log('error   :', result.outcome.error ?? '(无)')
  console.log('hasToken:', result.status.hasToken)
  console.log('endpoint:', result.status.endpoint)

  const connected =
    String(result.outcome.error || '').includes('令牌') ||
    String(result.outcome.error || '').includes('token') ||
    String(result.outcome.error || '').includes('无效')
  console.log(connected ? '\n✓ 地址可用：请求到达了云函数，仅令牌不正确' : '\n✗ 地址或路径仍有问题')

  await send('Page.enable')
  await evaluate(`(async () => {
    const btn = document.querySelector('.sidebar-foot .icon-btn')
    if (btn) btn.click()
    await new Promise(r => setTimeout(r, 600))
    const body = document.querySelector('.settings-sheet .modal-body')
    if (body) body.scrollTop = body.scrollHeight
    await new Promise(r => setTimeout(r, 400))
    return 'ok'
  })()`)
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(ROOT, 'smoke', 'packed-sync.png'), Buffer.from(shot.data, 'base64'))
  console.log('✓ 截图 smoke/packed-sync.png')
} catch (err) {
  console.error('✗ 验证失败：', err.message)
} finally {
  child.kill()
}
process.exit(0)
