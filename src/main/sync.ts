import type { CalendarEvent, CalendarSource, SyncResult } from '../shared/types'
import type { Store } from './store'
import { expandOccurrences, fetchIcs, parseIcs } from './ics'

/**
 * 订阅同步。
 *
 * 设计取舍：
 * - 每次同步整体替换该源的事件，而不是做增量 diff。订阅数据量在千级，
 *   全量替换比维护 diff 简单得多，也不会因为 id 生成规则变化而残留脏数据。
 * - 展开范围限定在「过去 60 天 ~ 未来 365 天」。一个 2010 年就存在的周会
 *   如果不限制范围会展开出上万条，既没用也会拖垮渲染。
 * - 单源实例上限 3000，超出截断并记录，避免一个订阅把应用撑爆。
 */

const RANGE_BACK_DAYS = 60
const RANGE_FORWARD_DAYS = 365
const MAX_INSTANCES_PER_SOURCE = 3000

export async function syncSource(store: Store, source: CalendarSource): Promise<SyncResult> {  const base: Omit<SyncResult, 'ok'> = {
    sourceId: source.id,
    sourceName: source.name,
    added: 0,
    removed: 0,
    truncated: false
  }

  try {
    const text = await fetchIcs(source.url)
    const parsed = parseIcs(text)

    const from = new Date(Date.now() - RANGE_BACK_DAYS * 86400000)
    const to = new Date(Date.now() + RANGE_FORWARD_DAYS * 86400000)
    const hidden = new Set(source.hidden ?? [])
    const stamp = new Date().toISOString()

    const events: CalendarEvent[] = []
    let truncated = false

    for (const ev of parsed) {
      for (const occ of expandOccurrences(ev, from, to)) {
        const key = `${ev.uid}:${occ.start.toISOString()}`
        if (hidden.has(key)) continue
        if (events.length >= MAX_INSTANCES_PER_SOURCE) {
          truncated = true
          break
        }
        const notes = [ev.location ? `地点：${ev.location}` : '', ev.description ?? '']
          .filter(Boolean)
          .join('\n')
          .trim()

        events.push({
          id: `${source.id}:${key}`,
          title: ev.summary,
          start: occ.start.toISOString(),
          end: occ.end.toISOString(),
          allDay: ev.allDay,
          color: source.color,
          notes: notes || undefined,
          location: ev.location,
          createdAt: stamp,
          updatedAt: stamp,
          rev: 1,
          sourceId: source.id,
          externalId: ev.uid,
          readOnly: true
        })
      }
      if (truncated) break
    }

    const { before } = store.replaceSourceEvents(source.id, events)
    // 直接改传入的对象：它可能是尚未入库的草稿源（添加订阅时先同步成功再落盘）
    source.lastSyncAt = stamp
    source.lastError = undefined
    source.eventCount = events.length
    source.truncated = truncated
    store.save()

    return { ...base, ok: true, added: events.length, removed: Math.max(0, before - events.length), truncated }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // 失败时保留上一次的数据，只记录错误——断网不应该让用户的日历变空
    source.lastError = message
    store.save()
    return { ...base, ok: false, error: message }
  }
}

/** 并发拉取所有启用的源：串行的话一个慢源会拖住后面全部 */
export async function syncAll(store: Store): Promise<SyncResult[]> {
  const enabled = store.data.sources.filter((s) => s.enabled)
  const settled = await Promise.allSettled(enabled.map((s) => syncSource(store, s)))
  return settled.map((r, i) =>
    r.status === 'fulfilled'
      ? r.value
      : {
          ok: false,
          sourceId: enabled[i].id,
          sourceName: enabled[i].name,
          added: 0,
          removed: 0,
          truncated: false,
          error: r.reason instanceof Error ? r.reason.message : String(r.reason)
        }
  )
}
