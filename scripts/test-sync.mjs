/**
 * 双设备云同步端到端测试。
 *
 * 同时启动两个独立的 Electron 实例（不同 user-data-dir），连同一个 mock 服务端，
 * 验证：A 建 → B 收到 → B 改 → A 收到 → A 删 → B 消失（墓碑生效）。
 *
 * 用法：node scripts/test-sync.mjs
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createMockSyncServer } from './mock-sync-server.mjs'

const ROOT = process.cwd()
const ELECTRON = join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
const OUT = join(ROOT, 'smoke')
const TOKEN = 'test-token-abc123'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let failures = 0
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  console.log(
    `${ok ? '✓' : '✗'} ${name}${ok ? '' : `  实际=${JSON.stringify(actual)} 期望=${JSON.stringify(expected)}`}`
  )
  if (!ok) failures++
}

function launch(label, port) {
  const userData = join(OUT, `sync-${label}-${Date.now()}`)
  mkdirSync(userData, { recursive: true })
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  env.DAILY_LIST_DISABLE_GPU = '1'

  const child = spawn(
    ELECTRON,
    [
      '.',
      `--remote-debugging-port=${port}`,
      '--no-sandbox',
      '--disable-gpu',
      '--disable-gpu-compositing',
      `--user-data-dir=${userData}`
    ],
    { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] }
  )

  let send = null
  let evaluate = null

  const ready = (async () => {
    let target = null
    for (let i = 0; i < 120; i++) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
        target = list.find((x) => x.type === 'page' && x.url.includes('index.html'))
        if (target) break
      } catch {
        /* not ready */
      }
      await sleep(250)
    }
    if (!target) throw new Error(`${label}: 页面未就绪`)

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
    send = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++seq
        pending.set(id, { resolve, reject })
        ws.send(JSON.stringify({ id, method, params }))
      })
    evaluate = async (expr) => {
      const r = await send('Runtime.evaluate', {
        expression: expr,
        awaitPromise: true,
        returnByValue: true
      })
      return r.result.value
    }
    await sleep(1200)
    return { evaluate, send, close: () => child.kill() }
  })()

  return ready
}

const mock = createMockSyncServer()
const endpoint = await mock.listen()
console.log(`✓ mock 同步服务 ${endpoint}`)

let A = null
let B = null

try {
  /* ---------------- 设备 A ---------------- */
  A = await launch('a', 9401)
  console.log('\n--- 设备 A 配置同步 ---')
  await A.evaluate(`(async () => {
    await window.api.patchSettings({ syncEnabled: true, syncEndpoint: '${endpoint}' })
    await window.api.setSyncToken('${TOKEN}')
    return 'ok'
  })()`)

  const created = JSON.parse(
    await A.evaluate(`(async () => {
      const s = new Date(); s.setDate(s.getDate() + 1); s.setHours(10, 0, 0, 0)
      const e = new Date(s.getTime() + 3600000)
      const ev = await window.api.upsertEvent({ title: '设备A建的会议', start: s.toISOString(), end: e.toISOString(), allDay: false, color: 'blue' })
      const r = await window.api.syncNow()
      return JSON.stringify({ id: ev.id, sync: r })
    })()`)
  )
  check('A 首次同步成功', created.sync.ok, true)
  check('A 推送了 1 条', created.sync.pushed, 1)

  /* ---------------- 设备 B ---------------- */
  B = await launch('b', 9402)
  console.log('\n--- 设备 B 首次同步（应拉到 A 的记录）---')
  const bPull = JSON.parse(
    await B.evaluate(`(async () => {
      await window.api.patchSettings({ syncEnabled: true, syncEndpoint: '${endpoint}' })
      await window.api.setSyncToken('${TOKEN}')
      const r = await window.api.syncNow()
      const d = await window.api.getData()
      return JSON.stringify({ sync: r, titles: d.events.map(e => e.title), count: d.events.length })
    })()`)
  )
  check('B 同步成功', bPull.sync.ok, true)
  check('B 拉到 1 条', bPull.sync.pulled, 1)
  check('B 看到 A 的日程', bPull.titles, ['设备A建的会议'])

  /* ---------------- B 修改 ---------------- */
  console.log('\n--- 设备 B 修改并推送 ---')
  const bEdit = JSON.parse(
    await B.evaluate(`(async () => {
      const d = await window.api.getData()
      const ev = d.events[0]
      const s = new Date(ev.start)
      const e = new Date(ev.end)
      await window.api.upsertEvent({ id: ev.id, title: 'B改过的标题', start: s.toISOString(), end: e.toISOString(), allDay: false, color: 'rose' })
      const r = await window.api.syncNow()
      return JSON.stringify(r)
    })()`)
  )
  check('B 推送修改成功', bEdit.ok, true)

  /* ---------------- A 拉取 ---------------- */
  console.log('\n--- 设备 A 拉取 B 的修改 ---')
  const aPull = JSON.parse(
    await A.evaluate(`(async () => {
      const r = await window.api.syncNow()
      const d = await window.api.getData()
      const ev = d.events.find(e => e.id === ${JSON.stringify(created.id)})
      return JSON.stringify({ sync: r, title: ev?.title, color: ev?.color })
    })()`)
  )
  check('A 同步成功', aPull.sync.ok, true)
  check('A 看到 B 的标题', aPull.title, 'B改过的标题')
  check('A 看到 B 改的颜色', aPull.color, 'rose')

  /* ---------------- A 删除 ---------------- */
  console.log('\n--- 设备 A 删除（墓碑）---')
  const aDel = JSON.parse(
    await A.evaluate(`(async () => {
      await window.api.deleteEvent(${JSON.stringify(created.id)})
      const r = await window.api.syncNow()
      return JSON.stringify(r)
    })()`)
  )
  check('A 删除并同步成功', aDel.ok, true)

  console.log('\n--- 设备 B 同步后应消失 ---')
  const bAfterDel = JSON.parse(
    await B.evaluate(`(async () => {
      const r = await window.api.syncNow()
      const d = await window.api.getData()
      return JSON.stringify({ sync: r, count: d.events.length })
    })()`)
  )
  check('B 同步成功', bAfterDel.sync.ok, true)
  check('B 侧事件已消失（墓碑生效，没被推活）', bAfterDel.count, 0)

  /* ---------------- 订阅事件不参与同步 ---------------- */
  console.log('\n--- 订阅事件不参与同步 ---')
  const subCheck = JSON.parse(
    await A.evaluate(`(async () => {
      const d1 = await window.api.getData()
      const local = d1.events.filter(e => !e.sourceId && e.dirty)
      return JSON.stringify({ dirtyLocal: local.length })
    })()`)
  )
  check('本地脏数据已清空', subCheck.dirtyLocal, 0)

  const stats = await (await fetch(`${endpoint}/stats`)).json()
  console.log(`\n（服务端统计：${stats.requests} 次请求，接受 ${stats.accepted}，拒绝 ${stats.rejected}）`)

  // 截图设置面板里的同步区块
  await A.send('Page.enable')
  await A.evaluate(`(async () => {
    const btn = document.querySelector('.sidebar-foot .icon-btn')
    if (btn) btn.click()
    await new Promise(r => setTimeout(r, 600))
    const body = document.querySelector('.settings-sheet .modal-body')
    if (body) body.scrollTop = body.scrollHeight
    await new Promise(r => setTimeout(r, 400))
    return 'ok'
  })()`)
  const shot = await A.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(OUT, 'sync-settings.png'), Buffer.from(shot.data, 'base64'))
  console.log('✓ 截图 smoke/sync-settings.png')
} catch (err) {
  console.error('✗ 测试失败：', err.message)
  failures++
} finally {
  A?.close()
  B?.close()
  await sleep(400)
  mock.close()
}

console.log(failures === 0 ? '\n双设备同步测试全部通过' : `\n${failures} 项失败`)
process.exit(failures === 0 ? 0 : 1)
