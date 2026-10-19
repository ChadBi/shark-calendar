import {
  addDays,
  addMonths,
  differenceInMinutes,
  endOfDay,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfDay,
  startOfMonth,
  startOfWeek
} from 'date-fns'
import { zhCN } from 'date-fns/locale'
import type { CalendarEvent, ViewMode } from '../../../shared/types'

export const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日']
export const WEEKDAY_FULL = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

/** 周起始日（0=周日，1=周一） */
export function weekOpts(weekStartsOn: 0 | 1): { weekStartsOn: 0 | 1 } {
  return { weekStartsOn }
}

/** 月视图固定 6×7 网格，保证切换月份时高度不跳动 */
export function monthMatrix(cursor: Date, weekStartsOn: 0 | 1): Date[] {
  const first = startOfWeek(startOfMonth(cursor), { weekStartsOn })
  return Array.from({ length: 42 }, (_, i) => addDays(first, i))
}

export function weekDays(cursor: Date, weekStartsOn: 0 | 1): Date[] {
  const first = startOfWeek(cursor, { weekStartsOn })
  return Array.from({ length: 7 }, (_, i) => addDays(first, i))
}

export function shiftCursor(cursor: Date, view: ViewMode, dir: 1 | -1): Date {
  if (view === 'month') return addMonths(cursor, dir)
  if (view === 'week') return addDays(cursor, dir * 7)
  return addDays(cursor, dir)
}

export function viewTitle(cursor: Date, view: ViewMode): string {
  if (view === 'month') return format(cursor, 'yyyy 年 M 月', { locale: zhCN })
  if (view === 'week') {
    const days = weekDays(cursor, 1)
    const a = days[0]
    const b = days[6]
    if (isSameMonth(a, b)) return format(a, 'yyyy 年 M 月', { locale: zhCN })
    return `${format(a, 'yyyy 年 M 月', { locale: zhCN })} – ${format(b, 'M 月', { locale: zhCN })}`
  }
  return format(cursor, 'yyyy 年 M 月 d 日 EEEE', { locale: zhCN })
}

/* ------------------------------------------------------------ 事件工具 */

export function eventStart(e: CalendarEvent): Date {
  return new Date(e.start)
}

export function eventEnd(e: CalendarEvent): Date {
  return new Date(e.end)
}

/** 事件是否与某天有交集（跨天事件在每一天都出现） */
export function eventOverlapsDay(e: CalendarEvent, day: Date): boolean {
  const dayStart = startOfDay(day).getTime()
  const dayEnd = dayStart + 24 * 60 * 60 * 1000
  const s = new Date(e.start).getTime()
  const en = new Date(e.end).getTime()
  return s < dayEnd && en > dayStart
}

/** 把事件裁剪到某一天内，返回分钟偏移 */
export function clipToDay(e: CalendarEvent, day: Date): { startMin: number; endMin: number } {
  const dayStart = startOfDay(day).getTime()
  const s = Math.max(new Date(e.start).getTime(), dayStart)
  const en = Math.min(new Date(e.end).getTime(), dayStart + 24 * 60 * 60 * 1000)
  const startMin = Math.round((s - dayStart) / 60000)
  // 极短事件（如 0 分钟）给一个最小可视高度
  const endMin = Math.max(Math.round((en - dayStart) / 60000), startMin + 20)
  return { startMin: Math.max(0, startMin), endMin: Math.min(1440, endMin) }
}

export function eventsOnDay(events: CalendarEvent[], day: Date): CalendarEvent[] {
  return events
    .filter((e) => eventOverlapsDay(e, day))
    .sort((a, b) => {
      const sa = new Date(a.start).getTime()
      const sb = new Date(b.start).getTime()
      if (sa !== sb) return sa - sb
      return new Date(b.end).getTime() - new Date(a.end).getTime()
    })
}

/* -------------------------------------------------- 重叠事件分栏（核心） */

export interface Slot {
  event: CalendarEvent
  startMin: number
  endMin: number
  /** 在该重叠簇中的列索引 */
  col: number
  /** 该重叠簇的总列数 */
  cols: number
  /** 是否为跨天裁剪后的续接片段 */
  continuesBefore: boolean
  continuesAfter: boolean
}

/**
 * 时间轴视图的重叠分栏算法。
 *
 * 三步：
 * 1. 按开始时间排序（同时刻则长者在前，视觉上更稳定）
 * 2. 扫描成"重叠簇"：一旦下一个事件的开始时间 >= 当前簇的最大结束时间，簇断开
 * 3. 簇内贪心分配列：把事件放进第一个"最后一个事件已结束"的列
 *
 * 为什么按簇而不是全局算列数：全局算会让 9:00 的一个小事件被 14:00 的三个
 * 并列事件挤成 1/4 宽，视觉上完全错误。簇内算列数才符合直觉。
 */
export function layoutDay(events: CalendarEvent[], day: Date): Slot[] {
  // 全天事件归顶部「全天」行，不参与时间轴分栏——否则会渲染成一个占满整列的色块
  const items = eventsOnDay(events, day)
    .filter((e) => !e.allDay)
    .map((e) => {
    const { startMin, endMin } = clipToDay(e, day)
    const dayStart = startOfDay(day).getTime()
    return {
      event: e,
      startMin,
      endMin,
      continuesBefore: new Date(e.start).getTime() < dayStart,
      continuesAfter: new Date(e.end).getTime() > dayStart + 86400000,
      col: 0,
      cols: 1
    } as Slot
  })

  items.sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin)

  const clusters: Slot[][] = []
  let current: Slot[] = []
  let clusterEnd = -1
  for (const item of items) {
    if (current.length > 0 && item.startMin >= clusterEnd) {
      clusters.push(current)
      current = []
      clusterEnd = -1
    }
    current.push(item)
    clusterEnd = Math.max(clusterEnd, item.endMin)
  }
  if (current.length > 0) clusters.push(current)

  for (const cluster of clusters) {
    const columns: Slot[][] = []
    for (const item of cluster) {
      let placed = false
      for (let i = 0; i < columns.length; i++) {
        const col = columns[i]
        const last = col[col.length - 1]
        if (last.endMin <= item.startMin) {
          col.push(item)
          item.col = i
          placed = true
          break
        }
      }
      if (!placed) {
        item.col = columns.length
        columns.push([item])
      }
    }
    const total = columns.length
    for (const item of cluster) item.cols = total
  }

  return items
}

/* -------------------------------------------------------------- 格式化 */

export function fmtTime(d: Date, hour24 = true): string {
  return format(d, hour24 ? 'HH:mm' : 'h:mm a', { locale: zhCN })
}

/** 10 月 18 日 星期日 */
export function fmtDayLabel(d: Date): string {
  return format(d, 'M 月 d 日 EEEE', { locale: zhCN })
}

/**
 * 把"当天第几分钟"格式化成时刻。
 * 跨天事件在次日只显示裁剪后的片段（00:00 而不是原始的 23:00），
 * 所以时间轴里必须按分钟数格式化，不能直接格式化 event.start。
 */
export function fmtMinuteOfDay(min: number, hour24 = true): string {
  const total = ((Math.round(min) % 1440) + 1440) % 1440
  const h = Math.floor(total / 60)
  const m = total % 60
  if (hour24) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  const suffix = h < 12 ? 'am' : 'pm'
  return `${h % 12 || 12}:${String(m).padStart(2, '0')}${suffix}`
}

export function fmtEventRange(e: CalendarEvent, hour24 = true): string {
  const s = new Date(e.start)
  const en = new Date(e.end)
  if (e.allDay) return '全天'
  if (isSameDay(s, en)) return `${fmtTime(s, hour24)} – ${fmtTime(en, hour24)}`
  return `${format(s, 'M/d')} ${fmtTime(s, hour24)} – ${format(en, 'M/d')} ${fmtTime(en, hour24)}`
}

export function durationLabel(start: Date, end: Date): string {
  const mins = differenceInMinutes(end, start)
  if (mins < 60) return `${mins} 分钟`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m ? `${h} 小时 ${m} 分` : `${h} 小时`
}

export { format, isSameDay, isSameMonth, isToday, startOfDay, endOfDay, endOfWeek, endOfMonth }
