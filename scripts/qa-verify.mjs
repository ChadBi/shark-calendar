/**
 * QA 断言脚本：一次启动真实应用，覆盖 A（分栏算法）、B（自然语言）、C（边界稳定性）。
 * 用法：node scripts/qa-verify.mjs
 * 只读 src，不修改任何源码；每次使用独立 user-data-dir。
 */
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'

const ROOT = process.cwd()
const ELECTRON = join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
const PORT = 9366
const USERDATA = join(ROOT, 'smoke', `qa-${Date.now()}`)
const OUT = join(ROOT, 'smoke')
mkdirSync(USERDATA, { recursive: true })

const logs = []
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
env.DAILY_LIST_DISABLE_GPU = '1'

const child = spawn(
  ELECTRON,
  [
    '.',
    `--remote-debugging-port=${PORT}`,
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

async function listTargets() {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
    return await res.json()
  } catch {
    return []
  }
}

async function waitTarget(match, timeoutMs = 25000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    const t = (await listTargets()).find((x) => x.type === 'page' && x.url.includes(match))
    if (t) return t
    await sleep(250)
  }
  throw new Error(`等待目标超时: ${match}`)
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl)
  let seq = 0
  const pending = new Map()
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
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
  return { ws, ready, send }
}

const errors = []
const log = (k, v) => console.log(`## ${k} :: ${JSON.stringify(v)}`)
const results = new Proxy(
  {},
  {
    set(t, k, v) {
      t[k] = v
      log(k, v)
      return true
    }
  }
)

try {
  const main = await waitTarget('index.html')
  const { send } = connect(main.webSocketDebuggerUrl)
  await sleep(300)

  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + expr.slice(0, 60))
    return r.result?.value
  }
  const shoot = async (file) => {
    const { data } = await send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(join(OUT, file), Buffer.from(data, 'base64'))
  }
  await send('Page.enable')
  await sleep(800)

  /* ---------------------------------------------- C1 空数据首启 */
  results.emptyState = await ev(`({
    appShell: !!document.querySelector('.app-shell'),
    monthCells: document.querySelectorAll('.month-cell').length,
    sidebarHint: document.querySelector('.empty-hint')?.textContent.replace(/\\s+/g,' ').trim() ?? null,
    view: document.querySelector('.toolbar-title')?.textContent ?? null,
    chipCount: document.querySelectorAll('.chip').length
  })`)

  /* ---------------------------------------------- 月视图表头对齐（视觉） */
  results.monthHeaderAlign = await ev(`(() => {
    const heads = [...document.querySelectorAll('.month-head div')].map(d => { const r = d.getBoundingClientRect(); return +(r.left + r.width/2).toFixed(1) })
    const cells = [...document.querySelectorAll('.month-cell')].slice(0,7).map(d => { const r = d.getBoundingClientRect(); return +(r.left + r.width/2).toFixed(1) })
    return { heads, cells, delta: heads.map((h,i) => +(h - cells[i]).toFixed(1)) }
  })()`)

  /* ---------------------------------------------- 注入测试数据 */
  results.seed = await ev(`(async () => {
    const base = new Date(); base.setHours(0,0,0,0)
    const mk = async (off, h, m, dur, title, color, allDay) => {
      const s = new Date(base); s.setDate(s.getDate() + off); s.setHours(h, m, 0, 0)
      const e = allDay ? new Date(s.getTime() + 86400000) : new Date(s.getTime() + dur * 60000)
      return window.api.upsertEvent({ title, start: s.toISOString(), end: e.toISOString(), allDay: !!allDay, color })
    }
    // 完全重叠
    await mk(0, 9, 0, 60, 'QA-完全重叠A', 'blue')
    await mk(0, 9, 0, 60, 'QA-完全重叠B', 'violet')
    // 链式重叠 A 12-13 B 12:30-13:30 C 13-14
    await mk(0, 12, 0, 60, 'QA-链A', 'emerald')
    await mk(0, 12, 30, 60, 'QA-链B', 'amber')
    await mk(0, 13, 0, 60, 'QA-链C', 'rose')
    // 不重叠
    await mk(0, 16, 0, 60, 'QA-独立1', 'slate')
    await mk(0, 18, 0, 60, 'QA-独立2', 'blue')
    // 0 分钟
    await mk(0, 21, 0, 0, 'QA-零时长', 'rose')
    // 跨天 23:00 → 次日 01:00
    await mk(0, 23, 0, 120, 'QA-跨天', 'violet')
    // 全天
    await mk(0, 0, 0, 0, 'QA-全天', 'amber', true)
    // 超长标题 + emoji/特殊字符
    await mk(2, 10, 0, 60, 'QA-' + '很长的标题'.repeat(40), 'blue')
    await mk(2, 11, 0, 60, 'QA-🎉 <b>特殊</b> & "引号" \\\\ 斜杠', 'emerald')
    // 8 条同一天，验证 "还有 X 项"
    for (let i = 0; i < 8; i++) await mk(3, 8 + i, 0, 45, 'QA-批量' + (i + 1), 'blue')
    return 'seeded'
  })()`)
  await sleep(900)

  /* ---------------------------------------------- A. 日视图：今天的分栏 */
  await ev(`(() => {
    [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '今天')?.click()
    document.querySelectorAll('.segmented button')[2].click()
    return 'day-view'
  })()`)
  await sleep(900)
  results.dayToday = await ev(`(() => {
    const col = document.querySelector('.tl-col')
    if (!col) return { error: 'no .tl-col' }
    const cr = col.getBoundingClientRect()
    const slots = [...col.querySelectorAll('.slot')].map(s => {
      const r = s.getBoundingClientRect()
      return {
        title: s.querySelector('.slot-title')?.textContent,
        time: s.querySelector('.slot-time')?.textContent,
        styleLeft: s.style.left, styleWidth: s.style.width,
        xPct: +((r.left - cr.left) / cr.width * 100).toFixed(1),
        wPct: +(r.width / cr.width * 100).toFixed(1),
        topPct: +((r.top - cr.top) / cr.height * 100).toFixed(2),
        hPx: Math.round(r.height)
      }
    })
    return {
      slots,
      alldayRow: !!document.querySelector('.allday-row'),
      alldayChips: [...document.querySelectorAll('.allday-row .chip')].map(c => c.textContent.trim()),
      colH: Math.round(cr.height)
    }
  })()`)
  await shoot('qa-day-today.png')

  /* ---------------------------------------------- A. 跨天事件次日片段 */
  await ev(`(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })); return 'next' })()`)
  await sleep(700)
  results.dayTomorrow = await ev(`(() => {
    const col = document.querySelector('.tl-col')
    const cr = col.getBoundingClientRect()
    return {
      title: document.querySelector('.toolbar-title')?.textContent,
      slots: [...col.querySelectorAll('.slot')].map(s => {
        const r = s.getBoundingClientRect()
        return {
          title: s.querySelector('.slot-title')?.textContent,
          time: s.querySelector('.slot-time')?.textContent,
          xPct: +((r.left - cr.left) / cr.width * 100).toFixed(1),
          wPct: +(r.width / cr.width * 100).toFixed(1),
          topPct: +((r.top - cr.top) / cr.height * 100).toFixed(2),
          hPx: Math.round(r.height)
        }
      })
    }
  })()`)
  await shoot('qa-day-tomorrow.png')
  await ev(`(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' })); return 'back' })()`)
  await sleep(500)

  /* ---------------------------------------------- 周视图：7 列 + 现在线 */
  await ev(`document.querySelectorAll('.segmented button')[1].click()`)
  await sleep(800)
  results.weekView = await ev(`({
    cols: document.querySelectorAll('.tl-col').length,
    heads: document.querySelectorAll('.tl-head-day').length,
    nowLine: document.querySelectorAll('.now-line').length,
    gutterLabels: document.querySelectorAll('.tl-hour-label').length
  })`)
  await shoot('qa-week.png')

  /* ---------------------------------------------- C. 月视图：42 格 / 还有 N 项 / 长标题 */
  await ev(`document.querySelectorAll('.segmented button')[0].click()`)
  await sleep(800)
  results.monthView = await ev(`(() => {
    const cells = [...document.querySelectorAll('.month-cell')]
    const today = document.querySelector('.month-cell.today')
    const chips = [...(today?.querySelectorAll('.chip') ?? [])].map(c => c.textContent.trim())
    const more = today?.querySelector('.more-link')?.textContent.trim() ?? null
    // 长标题所在格（今天 +2 天）
    const longChip = [...document.querySelectorAll('.chip')].find(c => (c.textContent || '').includes('很长的标题'))
    const lc = longChip?.closest('.month-cell')
    const cellR = lc?.getBoundingClientRect(); const chipR = longChip?.getBoundingClientRect()
    return {
      cells: cells.length,
      todayChips: chips,
      moreLink: more,
      todayOut: today?.className,
      longTitle: {
        exists: !!longChip,
        chipW: chipR ? Math.round(chipR.width) : null,
        cellW: cellR ? Math.round(cellR.width) : null,
        overflowRight: chipR && cellR ? +(chipR.right - cellR.right).toFixed(1) : null,
        textScroll: longChip ? longChip.scrollWidth : null,
        textClient: longChip ? longChip.clientWidth : null,
        docScrollW: document.documentElement.scrollWidth,
        docClientW: document.documentElement.clientWidth
      },
      emojiChip: [...document.querySelectorAll('.chip')].map(c => c.textContent.trim()).find(t => t.includes('🎉')) ?? null
    }
  })()`)
  await shoot('qa-month.png')

  /* ---------------------------------------------- 交互：双击 chip 是否误触发新建 */
  results.dblclickChip = await ev(`(async () => {
    const chip = document.querySelector('.month-cell.today .chip')
    if (!chip) return { error: 'no chip' }
    chip.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await new Promise(r => setTimeout(r, 120))
    const afterClick = document.querySelector('.modal h2')?.textContent ?? null
    document.querySelector('.overlay .icon-btn')?.click()
    await new Promise(r => setTimeout(r, 120))
    chip.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    await new Promise(r => setTimeout(r, 200))
    const afterDbl = document.querySelector('.modal h2')?.textContent ?? null
    document.querySelector('.overlay .icon-btn')?.click()
    return { afterClick, afterDbl }
  })()`)
  await sleep(300)

  /* ---------------------------------------------- B. 自然语言解析 */
  results.parse = await ev(`(async () => {
    [...document.querySelectorAll('button')].find(b => b.textContent.includes('快速添加'))?.click()
    await new Promise(r => setTimeout(r, 300))
    const input = document.querySelector('.qa-input')
    if (!input) return { error: 'no .qa-input' }
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    const cases = [
      '明天下午3点 开会',
      '周五 14:30 评审 2 小时',
      '10/20 体检',
      '下周一 站会 30 分钟',
      '晚上8点 健身',
      '买牛奶',
      'asdf!@#$%^&*() 乱码输入',
      '3点',
      '后天 全天 团建',
      '今天 23:30 复盘 2 小时'
    ]
    const out = []
    for (const c of cases) {
      setter.call(input, c)
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise(r => setTimeout(r, 90))
      out.push({
        input: c,
        preview: document.querySelector('.qa-preview')?.textContent.replace(/\\s+/g,' ').trim() ?? null,
        hint: !!document.querySelector('.qa-hint')
      })
    }
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    return out
  })()`)
  await sleep(400)
  await ev(`document.querySelector('.quickadd-overlay') && document.querySelector('.quickadd-overlay').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`)
  await sleep(300)

  /* ---------------------------------------------- C. 50 条事件性能 */
  results.perf50 = await ev(`(async () => {
    const base = new Date(); base.setHours(0,0,0,0)
    const t0 = performance.now()
    for (let i = 0; i < 50; i++) {
      const s = new Date(base); s.setDate(s.getDate() + 5); s.setHours(6 + (i % 16), (i % 2) * 30, 0, 0)
      await window.api.upsertEvent({ title: 'QA-压力' + i, start: s.toISOString(), end: new Date(s.getTime() + 30*60000).toISOString(), allDay: false, color: 'blue' })
    }
    const t1 = performance.now()
    const t2 = performance.now()
    document.querySelectorAll('.segmented button')[1].click()
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    const t3 = performance.now()
    document.querySelectorAll('.segmented button')[0].click()
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    const t4 = performance.now()
    return {
      createMs: Math.round(t1 - t0),
      weekSwitchMs: Math.round(t3 - t2),
      monthSwitchMs: Math.round(t4 - t3),
      totalEvents: (await window.api.getData()).events.length,
      monthCells: document.querySelectorAll('.month-cell').length,
      weekCols: 0
    }
  })()`)
  await sleep(600)
  await shoot('qa-month-stress.png')

  /* ---------------------------------------------- 悬浮窗 */
  results.widget = await (async () => {
    try {
      await ev(`window.api.toggleWidget(true)`)
      const wt = await waitTarget('widget.html', 12000)
      const w = connect(wt.webSocketDebuggerUrl)
      await Promise.race([w.ready, sleep(6000).then(() => Promise.reject(new Error('ws timeout')))])
      await sleep(900)
      const wev = async (expr) => {
        const r = await w.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
        return r.result?.value
      }
      const before = await wev(`({
        h: window.innerHeight,
        items: document.querySelectorAll('.wg-item').length,
        count: document.querySelector('.wg-count')?.textContent,
        titleOverflow: [...document.querySelectorAll('.wg-title')].map(t => ({ sw: t.scrollWidth, cw: t.clientWidth })).slice(0, 3),
        alpha: getComputedStyle(document.querySelector('.wg')).getPropertyValue('--wg-alpha').trim()
      })`)
      await wev(`document.querySelector('.wg-actions .wg-btn').click()`)
      await sleep(700)
      const after = await wev(`({ h: window.innerHeight, hasList: !!document.querySelector('.wg-list') })`)
      const { data } = await w.send('Page.captureScreenshot', { format: 'png' })
      writeFileSync(join(OUT, 'qa-widget-collapsed.png'), Buffer.from(data, 'base64'))
      await wev(`document.querySelector('.wg-actions .wg-btn').click()`)
      await sleep(600)
      const reopened = await wev(`({ h: window.innerHeight })`)
      return { before, afterCollapse: after, afterExpand: reopened }
    } catch (e) {
      return { error: e.message }
    }
  })()

  /* ---------------------------------------------- D. 关闭窗口 → 隐藏到托盘 */
  await ev(`window.close()`)
  await sleep(1500)
  const stillThere = (await listTargets()).some((t) => t.url.includes('index.html'))
  results.closeToTray = { pageStillAlive: stillThere }
  if (stillThere) {
    const again = await waitTarget('index.html', 4000)
    const c2 = connect(again.webSocketDebuggerUrl)
    await c2.ready
    await sleep(400)
    const r = await c2.send('Runtime.evaluate', {
      expression: `({ alive: true, events: (await window.api.getData()).events.length })`,
      returnByValue: true,
      awaitPromise: true
    })
    results.closeToTray.afterHide = r.result?.value
    await c2.send('Runtime.evaluate', { expression: 'window.api.quit()' }).catch(() => {})
  }

  /* ---------------------------------------------- 数据落盘检查 */
  results.persistedFile = (() => {
    try {
      const raw = readFileSync(join(USERDATA, 'daily-list.json'), 'utf-8')
      const j = JSON.parse(raw)
      return { ok: true, bytes: raw.length, events: j.events?.length, schemaVersion: j.schemaVersion, hasTombstone: j.events?.some((e) => e.deleted === true) }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  })()
} catch (err) {
  errors.push(err.message)
} finally {
  child.kill()
}

console.log(JSON.stringify({ results, errors, logs: logs.join('').split('\n').filter((l) => /error|warn/i.test(l)).slice(0, 12) }, null, 2))
process.exit(0)
