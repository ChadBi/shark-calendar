import { Notification } from 'electron'
import { RRule } from 'rrule'
import type { CalendarEvent } from '../shared/types'
import type { Store } from './store'

/**
 * 系统通知提醒。
 *
 * 三个设计要点：
 * 1. **轮询而不是为每个事件建定时器**：事件会被编辑/删除/同步覆盖，
 *    定时器要跟着增删改，容易漏。30 秒扫一次未来 12 小时，代价可以忽略。
 * 2. **去重落盘**：key 是 `eventId@startISO`，存进 reminderLog。
 *    否则每次重启应用都会把已经提醒过的事件再弹一遍。
 * 3. **重复事件在扫描窗口内展开**：主进程拿不到渲染进程展开的虚拟实例，
 *    这里用 rrule 只算未来 12 小时内的实例，成本很低。
 */

const TICK_MS = 30_000
/** 提前扫描的窗口：12 小时足够覆盖「提前 60 分钟」这类设置 */
const HORIZON_MS = 12 * 60 * 60 * 1000
/** 事件已经开始超过这个时间就不再补弹（避免开机时被历史事件轰炸） */
const GRACE_MS = 60_000

let timer: NodeJS.Timeout | null = null

export interface ReminderOptions {
  /** 点击通知时回调，用来打开对应事件 */
  onOpenEvent: (id: string) => void
}

function reminderKey(eventId: string, startIso: string): string {
  return `${eventId}@${startIso}`
}

/** 算出事件在 [from, to] 内的所有开始时刻；非重复事件只有一个 */
function occurrenceStarts(e: CalendarEvent, from: Date, to: Date): Date[] {
  const base = new Date(e.start)
  if (Number.isNaN(base.getTime())) return []
  if (!e.rrule) return [base]

  try {
    const until = e.rruleUntil ? new Date(e.rruleUntil) : undefined
    const parsed = RRule.parseString(e.rrule)
    const rule = new RRule({
      ...parsed,
      dtstart: base,
      // 显式设置的截止日优先于规则里自带的 UNTIL
      until: until && !Number.isNaN(until.getTime()) ? until : parsed.until
    })
    return rule.between(from, to, true)
  } catch (err) {
    console.warn('[reminder] 重复规则解析失败，按单次事件处理：', e.rrule, err)
    return [base]
  }
}

function fmtClock(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function showNotification(e: CalendarEvent, start: Date, leadMinutes: number, opts: ReminderOptions): void {
  const when = leadMinutes > 0 ? `${fmtClock(start)} 开始 · 还有 ${leadMinutes} 分钟` : `${fmtClock(start)} 开始`
  const body = e.notes?.trim() ? `${when}\n${e.notes.trim().slice(0, 90)}` : when

  const n = new Notification({
    title: e.title || '未命名事件',
    body,
    silent: false
  })
  n.on('click', () => opts.onOpenEvent(e.id))
  n.show()
}

export function checkReminders(store: Store, opts: ReminderOptions): void {
  const s = store.settings
  if (!s.reminderEnabled) return
  if (!Notification.isSupported()) return

  const leadMinutes = Math.max(0, Number(s.reminderLeadMinutes) || 0)
  const leadMs = leadMinutes * 60_000

  const now = Date.now()
  const from = new Date(now - GRACE_MS)
  const to = new Date(now + HORIZON_MS)

  for (const e of store.data.events) {
    if (e.deleted) continue
    // 全天事件没有具体时刻，提醒它「今天有这件事」价值不大，先不打扰
    if (e.allDay) continue

    for (const start of occurrenceStarts(e, from, to)) {
      const startMs = start.getTime()
      if (startMs > now + HORIZON_MS) continue
      // 还没到提醒时间
      if (now < startMs - leadMs) continue
      // 已经开始了很久，不补弹
      if (startMs < now - GRACE_MS) continue

      const key = reminderKey(e.id, start.toISOString())
      if (store.wasReminded(key)) continue

      showNotification(e, start, leadMinutes, opts)
      store.markReminded(key)
    }
  }
}

export function startReminders(store: Store, opts: ReminderOptions): void {
  stopReminders()

  timer = setInterval(() => checkReminders(store, opts), TICK_MS)
  timer.unref?.()

  // 启动后稍等一下再扫，别和窗口初始化抢资源
  const kickoff = setTimeout(() => checkReminders(store, opts), 3000)
  kickoff.unref?.()
}

export function stopReminders(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

/** 设置页「发送测试通知」用，不写去重记录 */
export function showTestNotification(): boolean {
  if (!Notification.isSupported()) return false
  const n = new Notification({
    title: '鲨鱼日程 · 通知测试',
    body: '看到这条说明系统通知正常。事件开始前会按你的设置提醒。'
  })
  n.show()
  return true
}
