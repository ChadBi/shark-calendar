/**
 * 数据迁移测试：v1（widgetAlwaysOnTop: true）→ v2（强制 false）。
 *
 * 为什么必须单独测：老用户跑过应用后，true 已经持久化在 daily-list.json 里，
 * 只改代码里的默认值对他们完全无效。这条链路断了，用户升级后看到的还是置顶。
 *
 * 用法：node scripts/test-migrate.mjs
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const ELECTRON = join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
const USERDATA = join(ROOT, 'smoke', 'migrate-test')
const CDP_PORT = 9388

rmSync(USERDATA, { recursive: true, force: true })
mkdirSync(USERDATA, { recursive: true })

const OLD_EVENT = {
  id: 'old-1',
  title: '迁移前就存在的日程',
  start: '2026-10-18T02:00:00.000Z',
  end: '2026-10-18T03:00:00.000Z',
  allDay: false,
  color: 'blue',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  rev: 1,
  deleted: false
}

// 模拟 v1 数据：置顶为 true，且没有 sources 字段
writeFileSync(
  join(USERDATA, 'daily-list.json'),
  JSON.stringify(
    {
      schemaVersion: 1,
      events: [OLD_EVENT],
      settings: {
        closeToTray: true,
        minimizeToTray: false,
        launchAtLogin: false,
        weekStartsOn: 1,
        defaultView: 'month',
        widgetOpacity: 0.92,
        widgetAlwaysOnTop: true,
        widgetBounds: null,
        showWidgetOnStart: false,
        hour24: true
      }
    },
    null,
    2
  )
)
console.log('✓ 已构造 v1 数据（widgetAlwaysOnTop: true，1 条事件）')

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
env.DAILY_LIST_DISABLE_GPU = '1'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function runOnce(label) {
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

  let target = null
  for (let i = 0; i < 100; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()
      target = list.find((x) => x.type === 'page' && x.url.includes('index.html'))
      if (target) break
    } catch {
      /* not ready */
    }
    await sleep(250)
  }
  if (!target) {
    child.kill()
    throw new Error(`${label}: 页面未就绪`)
  }

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

  await sleep(1500)
  const res = await send('Runtime.evaluate', {
    expression: `(async () => {
      const d = await window.api.getData()
      return JSON.stringify({
        schemaVersion: d.schemaVersion,
        alwaysOnTop: d.settings.widgetAlwaysOnTop,
        events: d.events.length,
        firstTitle: d.events[0]?.title ?? null,
        sources: (d.sources || []).length,
        migratedFrom: d.migratedFrom ?? null
      })
    })()`,
    awaitPromise: true,
    returnByValue: true
  })

  await send('Runtime.evaluate', { expression: 'window.api.quit()' }).catch(() => {})
  await sleep(600)
  child.kill()
  await sleep(400)

  return JSON.parse(res.result.value)
}

let failures = 0
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  实际=${JSON.stringify(actual)} 期望=${JSON.stringify(expected)}`}`)
  if (!ok) failures++
}

try {
  console.log('\n--- 第一次启动（v1 → v2 迁移）---')
  const first = await runOnce('first')
  check('schemaVersion 升到 2', first.schemaVersion, 2)
  check('置顶被强制关闭', first.alwaysOnTop, false)
  check('老事件未丢失', first.events, 1)
  check('老事件标题完好', first.firstTitle, '迁移前就存在的日程')
  check('sources 字段补齐为空数组', first.sources, 0)
  // P1-4：迁移提示必须真的能送到渲染进程，靠 data:get 返回值而不是 push
  check('渲染进程能读到迁移标记', first.migratedFrom, 1)

  // 落盘检查
  const onDisk = JSON.parse(readFileSync(join(USERDATA, 'daily-list.json'), 'utf-8'))
  check('磁盘上 schemaVersion=2', onDisk.schemaVersion, 2)
  check('磁盘上 widgetAlwaysOnTop=false', onDisk.settings.widgetAlwaysOnTop, false)

  // 模拟用户在 v2 里主动重新开启置顶
  onDisk.settings.widgetAlwaysOnTop = true
  writeFileSync(join(USERDATA, 'daily-list.json'), JSON.stringify(onDisk, null, 2))
  console.log('\n（模拟用户手动重新开启置顶）')

  console.log('\n--- 第二次启动（已是 v2，不应再迁移）---')
  const second = await runOnce('second')
  check('用户主动开启的置顶被保留', second.alwaysOnTop, true)
  check('事件仍然完好', second.events, 1)
  check('二次启动不再提示迁移', second.migratedFrom, null)
} catch (err) {
  console.error('✗ 测试失败：', err.message)
  failures++
}

console.log(failures === 0 ? '\n迁移测试全部通过' : `\n${failures} 项失败`)
process.exit(failures === 0 ? 0 : 1)
