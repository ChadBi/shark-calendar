import { useEffect, useMemo, useRef, useState } from 'react'
import type { CalendarEvent } from '../../../shared/types'
import { colorOf } from '../../../shared/defaults'
import {
  WEEKDAY_FULL,
  eventsOnDay,
  fmtMinuteOfDay,
  fmtTime,
  isToday,
  layoutDay,
  startOfDay
} from '../lib/date'

const HOUR_H = 52
const TOTAL_MIN = 1440
const TOTAL_H = TOTAL_MIN * (HOUR_H / 60)
const MIN_PER_PX = TOTAL_MIN / TOTAL_H
const SNAP_MIN = 15
const MIN_DURATION = 15
/** 上下边缘的可拖拽热区高度 */
const EDGE_PX = 7

type DragMode = 'move' | 'top' | 'bottom'

interface DragState {
  event: CalendarEvent
  mode: DragMode
  startY: number
  startX: number
  /** 原始起止（毫秒） */
  origStart: number
  origEnd: number
  dayIndex: number
  previewStart: number
  previewEnd: number
  moved: boolean
}

interface Props {
  events: CalendarEvent[]
  days: Date[]
  hour24: boolean
  bare?: boolean
  onNew: (start: Date, allDay?: boolean) => void
  onEdit: (e: CalendarEvent) => void
  onOpenDay: (d: Date) => void
  /** 拖拽结束后回调；订阅事件与重复实例不会触发 */
  onReschedule?: (e: CalendarEvent, start: Date, end: Date) => void
}

/**
 * 周视图与日视图共用同一条时间轴。
 * 差别只是列数：周视图 7 列，日视图 1 列。
 */
export function TimeGrid({
  events,
  days,
  hour24,
  bare,
  onNew,
  onEdit,
  onOpenDay,
  onReschedule
}: Props): React.ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null)
  const colsRef = useRef<HTMLDivElement>(null)
  const suppressClick = useRef(false)
  const colCount = days.length

  const [drag, setDrag] = useState<DragState | null>(null)

  const canDrag = (ev: CalendarEvent): boolean =>
    !!onReschedule && !ev.readOnly && !ev.sourceId && !ev.recurringMasterId

  const beginDrag = (e: React.PointerEvent<HTMLDivElement>, ev: CalendarEvent, dayIndex: number): void => {
    if (!canDrag(ev)) return
    // 只响应主键，避免右键/中键触发
    if (e.button !== 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    const offsetY = e.clientY - rect.top
    const mode: DragMode =
      offsetY <= EDGE_PX ? 'top' : offsetY >= rect.height - EDGE_PX ? 'bottom' : 'move'

    e.currentTarget.setPointerCapture(e.pointerId)
    const startMs = new Date(ev.start).getTime()
    const endMs = new Date(ev.end).getTime()
    setDrag({
      event: ev,
      mode,
      startY: e.clientY,
      startX: e.clientX,
      origStart: startMs,
      origEnd: endMs,
      dayIndex,
      previewStart: startMs,
      previewEnd: endMs,
      moved: false
    })
  }

  const moveDrag = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!drag) return
    const dy = e.clientY - drag.startY
    const rawDelta = Math.round((dy * MIN_PER_PX) / SNAP_MIN) * SNAP_MIN
    const moved = drag.moved || Math.abs(dy) > 3 || Math.abs(e.clientX - drag.startX) > 3

    let previewStart = drag.origStart
    let previewEnd = drag.origEnd

    if (drag.mode === 'move') {
      // 横向移动 → 换日
      let dayDelta = 0
      const cols = colsRef.current
      if (cols && colCount > 1) {
        const r = cols.getBoundingClientRect()
        const idx = Math.floor(((e.clientX - r.left) / r.width) * colCount)
        const clamped = Math.min(colCount - 1, Math.max(0, idx))
        dayDelta = clamped - drag.dayIndex
      }
      const shift = rawDelta * 60_000 + dayDelta * 86_400_000
      previewStart = drag.origStart + shift
      previewEnd = drag.origEnd + shift
    } else if (drag.mode === 'top') {
      previewStart = Math.min(
        drag.origStart + rawDelta * 60_000,
        drag.origEnd - MIN_DURATION * 60_000
      )
    } else {
      previewEnd = Math.max(
        drag.origEnd + rawDelta * 60_000,
        drag.origStart + MIN_DURATION * 60_000
      )
    }

    setDrag({ ...drag, previewStart, previewEnd, moved })
  }

  const endDrag = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!drag) return
    const { event, previewStart, previewEnd, moved } = drag
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    // 拖过之后紧跟的 click 不应该再打开编辑弹窗
    suppressClick.current = moved
    setDrag(null)
    if (moved && onReschedule) {
      onReschedule(event, new Date(previewStart), new Date(previewEnd))
    }
  }

  /** 把拖拽预览裁剪到某一天，返回分钟区间；无交集返回 null */
  const previewClip = (day: Date): { startMin: number; endMin: number } | null => {
    if (!drag) return null
    const dayStart = startOfDay(day).getTime()
    const s = Math.max(drag.previewStart, dayStart)
    const en = Math.min(drag.previewEnd, dayStart + 86_400_000)
    if (s >= en) return null
    const startMin = Math.max(0, Math.round((s - dayStart) / 60_000))
    const endMin = Math.min(TOTAL_MIN, Math.max(Math.round((en - dayStart) / 60_000), startMin + 5))
    return { startMin, endMin }
  }

  const dragTargetDayIndex = (): number => {
    if (!drag) return -1
    return days.findIndex((d) => {
      const t = startOfDay(d).getTime()
      return drag.previewStart < t + 86_400_000 && drag.previewEnd > t
    })
  }

  const slotsByDay = useMemo(
    () => days.map((d) => layoutDay(events, d)),
    [days, events]
  )

  const allDayByDay = useMemo(
    () => days.map((d) => eventsOnDay(events, d).filter((e) => e.allDay)),
    [days, events]
  )

  const hasAllDay = allDayByDay.some((l) => l.length > 0)

  // 打开时滚动到当前时间附近，而不是从 0 点开始
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const now = new Date()
    const anchor = isToday(days[0]) || days.some((d) => isToday(d)) ? now.getHours() : 8
    el.scrollTop = Math.max(0, (anchor - 2) * HOUR_H)
  }, [days])

  const now = new Date()
  const nowMin = now.getHours() * 60 + now.getMinutes()
  const showNow = days.some((d) => isToday(d))

  return (
    <div className={`timeline-wrap${bare ? ' bare' : ''}`} ref={scrollRef}>
      <div className="timeline" style={{ gridTemplateColumns: '54px minmax(0,1fr)' }}>
        <div className="tl-head">
          <div className="tl-head-gutter" />
          <div className="tl-head-days" style={{ gridTemplateColumns: `repeat(${colCount}, minmax(0,1fr))` }}>
            {days.map((d) => (
              <div
                key={d.toISOString()}
                className={`tl-head-day${isToday(d) ? ' today' : ''}`}
                onClick={() => onOpenDay(d)}
                title="打开这一天的详情"
              >
                <div className="tl-dow">{WEEKDAY_FULL[(d.getDay() + 6) % 7]}</div>
                <div className="tl-date">{d.getDate()}</div>
              </div>
            ))}
          </div>
        </div>

        {hasAllDay && (
          <div className="allday-row" style={{ gridColumn: '1 / -1' }}>
            <div className="allday-label">全天</div>
            <div className="allday-cells" style={{ gridTemplateColumns: `repeat(${colCount}, minmax(0,1fr))` }}>
              {allDayByDay.map((list, i) => (
                <div className="allday-cell" key={i}>
                  {list.map((ev) => {
                    const c = colorOf(ev.color)
                    return (
                      <div
                        key={ev.id}
                        className="chip"
                        style={{ background: c.bg, color: c.fg }}
                        onClick={() => onEdit(ev)}
                        title={ev.title}
                      >
                        <span className="chip-dot" style={{ background: c.dot }} />
                        <span className="chip-text">{ev.title}</span>
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="tl-gutter" style={{ height: TOTAL_MIN * (HOUR_H / 60) }}>
          {Array.from({ length: 24 }, (_, h) => h).map((h) =>
            h === 0 ? null : (
              <div key={h} className="tl-hour-label" style={{ top: h * HOUR_H }}>
                {hour24 ? `${String(h).padStart(2, '0')}:00` : `${h % 12 || 12}${h < 12 ? 'am' : 'pm'}`}
              </div>
            )
          )}
        </div>

        <div
          className="tl-cols"
          ref={colsRef}
          style={{
            gridTemplateColumns: `repeat(${colCount}, minmax(0,1fr))`,
            height: TOTAL_MIN * (HOUR_H / 60),
            ['--hour-h' as string]: `${HOUR_H}px`
          }}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          {days.map((day, di) => {
            const weekend = day.getDay() === 0 || day.getDay() === 6
            const targetIdx = dragTargetDayIndex()
            // 被拖到别的列时，在目标列画一个预览块（原列会跳过原块）
            const ghost =
              drag && targetIdx === di && !slotsByDay[di].some((s) => s.event.id === drag.event.id)
                ? previewClip(day)
                : null

            return (
              <div
                key={day.toISOString()}
                className={`tl-col${weekend ? ' weekend' : ''}`}
                onClick={(e) => {
                  if (drag) return
                  // 点在空白处才新建，点事件块由事件自己拦截
                  const rect = e.currentTarget.getBoundingClientRect()
                  const ratio = (e.clientY - rect.top) / rect.height
                  const mins = Math.min(23 * 60 + 30, Math.max(0, Math.round((ratio * TOTAL_MIN) / 30) * 30))
                  const d = startOfDay(day)
                  d.setMinutes(mins)
                  onNew(d)
                }}
              >
                {isToday(day) && showNow && (
                  <div className="now-line" style={{ top: `${(nowMin / TOTAL_MIN) * 100}%` }} />
                )}

                {slotsByDay[di].map((slot) => {
                  const isDragged = drag?.event.id === slot.event.id
                  // 拖到别的列时，原列不再重复绘制
                  if (isDragged && targetIdx !== di) return null

                  const c = colorOf(slot.event.color)
                  const clip = isDragged ? previewClip(day) : null
                  const startMin = clip ? clip.startMin : slot.startMin
                  const endMin = clip ? clip.endMin : slot.endMin
                  const top = (startMin / TOTAL_MIN) * 100
                  const height = ((endMin - startMin) / TOTAL_MIN) * 100
                  const widthPct = 100 / slot.cols
                  const compact = endMin - startMin < 42
                  const draggable = canDrag(slot.event)

                  return (
                    <div
                      key={slot.event.id}
                      className={`slot${compact ? ' compact' : ''}${isDragged ? ' dragging' : ''}${draggable ? ' draggable' : ''}`}
                      style={{
                        top: `${top}%`,
                        height: `${height}%`,
                        left: `calc(${slot.col * widthPct}% + 2px)`,
                        width: `calc(${widthPct}% - 4px)`,
                        background: c.bg,
                        color: c.fg,
                        borderLeftColor: c.dot
                      }}
                      title={`${slot.event.title}\n${fmtTime(new Date(slot.event.start), hour24)} – ${fmtTime(new Date(slot.event.end), hour24)}`}
                      onPointerDown={(e) => beginDrag(e, slot.event, di)}
                      onClick={(e) => {
                        e.stopPropagation()
                        if (suppressClick.current) {
                          suppressClick.current = false
                          return
                        }
                        onEdit(slot.event)
                      }}
                    >
                      <div className="slot-title">{slot.event.title}</div>
                      <div className="slot-time">
                        {slot.continuesBefore && !isDragged && '← '}
                        {fmtMinuteOfDay(startMin, hour24)}
                        {slot.continuesAfter && !isDragged && ' →'}
                      </div>
                      {draggable && <span className="slot-grip" />}
                    </div>
                  )
                })}

                {ghost && drag && (
                  <div
                    className="slot dragging ghost"
                    style={{
                      top: `${(ghost.startMin / TOTAL_MIN) * 100}%`,
                      height: `${((ghost.endMin - ghost.startMin) / TOTAL_MIN) * 100}%`,
                      left: '2px',
                      width: 'calc(100% - 4px)',
                      background: colorOf(drag.event.color).bg,
                      color: colorOf(drag.event.color).fg,
                      borderLeftColor: colorOf(drag.event.color).dot
                    }}
                  >
                    <div className="slot-title">{drag.event.title}</div>
                    <div className="slot-time">{fmtMinuteOfDay(ghost.startMin, hour24)}</div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
