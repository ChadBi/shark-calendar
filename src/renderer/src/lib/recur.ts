import { RRule } from 'rrule'
import type { CalendarEvent } from '../../../shared/types'

/**
 * 把带 rrule 的本地事件展开成虚拟实例。
 *
 * 为什么在渲染时展开，而不是像订阅那样落盘成多条：
 * - 落盘会产生"主事件 + N 个实例"的同步负担，删一条要删一片，很容易漏
 * - 个人日历的重复事件数量很少，渲染时按可见范围展开成本可以忽略
 *
 * 虚拟实例带 `recurringMasterId` 指回主事件：
 * 编辑时改主事件（v0.4 只支持改整个系列），不能单独删某一场。
 */
export interface ExpandOptions {
  /** 单次展开的实例上限，防止「每天重复 + 十年范围」把界面卡死 */
  limit?: number
}

export function expandRecurring(
  events: CalendarEvent[],
  from: Date,
  to: Date,
  opts: ExpandOptions = {}
): CalendarEvent[] {
  const limit = opts.limit ?? 4000
  const out: CalendarEvent[] = []
  let budget = limit

  for (const e of events) {
    // 订阅事件在同步时已经展开过，虚拟实例也不需要二次展开
    if (!e.rrule || e.sourceId || e.recurringMasterId) {
      out.push(e)
      continue
    }

    const base = new Date(e.start)
    if (Number.isNaN(base.getTime())) {
      out.push(e)
      continue
    }

    try {
      const parsed = RRule.parseString(e.rrule)
      const until = e.rruleUntil ? new Date(e.rruleUntil) : undefined
      const rule = new RRule({
        ...parsed,
        dtstart: base,
        until: until && !Number.isNaN(until.getTime()) ? until : parsed.until
      })

      const starts = rule.between(from, to, true)
      if (starts.length === 0) continue

      const durationMs = Math.max(0, new Date(e.end).getTime() - base.getTime())

      for (const s of starts) {
        if (budget-- <= 0) return out
        out.push({
          ...e,
          id: `${e.id}#${s.toISOString()}`,
          start: s.toISOString(),
          end: new Date(s.getTime() + durationMs).toISOString(),
          // 实例本身不再带规则，避免被二次展开
          rrule: undefined,
          rruleUntil: undefined,
          recurringMasterId: e.id
        })
      }
    } catch (err) {
      // 规则写坏了就当单次事件处理，至少不让这条事件消失
      console.warn('[recur] 规则解析失败，按单次事件渲染：', e.rrule, err)
      out.push(e)
    }
  }

  return out
}
