import { useEffect, useMemo, useRef, useState } from 'react'
import type { CalendarEvent } from '../../../shared/types'
import { colorOf } from '../../../shared/defaults'
import {
  WEEKDAY_LABELS,
  eventsOnDay,
  fmtTime,
  isSameMonth,
  isToday,
  monthMatrix
} from '../lib/date'
import { Icon } from './Icon'

interface Props {
  events: CalendarEvent[]
  cursor: Date
  weekStartsOn: 0 | 1
  hour24: boolean
  onNew: (start: Date, allDay?: boolean) => void
  onEdit: (e: CalendarEvent) => void
  onOpenDay: (d: Date) => void
}

const CHIP_H = 19
const CHIP_GAP = 2
const CELL_CHROME = 20 + 16 + 9 // 日期行 + "还有 N 项" + 内边距

/** 月视图空白处新建，默认落在上午 9 点而不是 0 点 */
function defaultStart(day: Date): Date {
  const d = new Date(day)
  d.setHours(9, 0, 0, 0)
  return d
}

export function MonthView({
  events,
  cursor,
  weekStartsOn,
  hour24,
  onNew,
  onEdit,
  onOpenDay
}: Props): React.ReactElement {
  const days = useMemo(() => monthMatrix(cursor, weekStartsOn), [cursor, weekStartsOn])
  const gridRef = useRef<HTMLDivElement>(null)
  const [maxChips, setMaxChips] = useState(2)

  // 每个格子能放几条，取决于当前窗口高度，写死会在大屏浪费、小屏溢出
  useEffect(() => {
    const el = gridRef.current
    if (!el) return
    const calc = (): void => {
      const cellH = (el.clientHeight - 5 * 6) / 6
      const available = cellH - CELL_CHROME
      const n = Math.floor((available + CHIP_GAP) / (CHIP_H + CHIP_GAP))
      setMaxChips(Math.max(1, Math.min(6, n)))
    }
    calc()
    const ro = new ResizeObserver(calc)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>()
    for (const d of days) {
      map.set(d.toDateString(), eventsOnDay(events, d))
    }
    return map
  }, [days, events])

  const labels = useMemo(() => {
    if (weekStartsOn === 1) return WEEKDAY_LABELS
    return [WEEKDAY_LABELS[6], ...WEEKDAY_LABELS.slice(0, 6)]
  }, [weekStartsOn])

  return (
    <div className="month-view">
      <div className="month-head">
        {labels.map((l, i) => (
          <div key={l} className={i >= 5 ? 'weekend' : ''}>
            {l}
          </div>
        ))}
      </div>

      <div className="month-grid" ref={gridRef}>
        {days.map((day) => {
          const list = byDay.get(day.toDateString()) ?? []
          const out = !isSameMonth(day, cursor)
          const weekend = day.getDay() === 0 || day.getDay() === 6
          const shown = list.slice(0, maxChips)
          const rest = list.length - shown.length

          return (
            <div
              key={day.toISOString()}
              className={[
                'month-cell',
                out ? 'out' : '',
                weekend ? 'weekend' : '',
                isToday(day) ? 'today' : ''
              ]
                .filter(Boolean)
                .join(' ')}
              onDoubleClick={() => onNew(defaultStart(day))}
            >
              <div className="cell-top">
                <span className="day-num">{day.getDate()}</span>
                <button
                  className="cell-add"
                  title="在这天新建事件"
                  onClick={(e) => {
                    e.stopPropagation()
                    onNew(defaultStart(day))
                  }}
                >
                  <Icon name="plus" size={13} strokeWidth={2.2} />
                </button>
              </div>

              {shown.map((ev) => {
                const c = colorOf(ev.color)
                return (
                  <div
                    key={ev.id}
                    className="chip"
                    style={{ background: c.bg, color: c.fg }}
                    title={`${ev.title} · ${fmtTime(new Date(ev.start), hour24)}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      onEdit(ev)
                    }}
                    // 双击事件不该冒泡到格子触发「新建」
                    onDoubleClick={(e) => e.stopPropagation()}
                  >
                    <span className="chip-dot" style={{ background: c.dot }} />
                    {!ev.allDay && (
                      <span className="chip-time">{fmtTime(new Date(ev.start), hour24)}</span>
                    )}
                    <span className="chip-text">{ev.title}</span>
                  </div>
                )
              })}

              {rest > 0 && (
                <button
                  className="more-link"
                  onClick={(e) => {
                    e.stopPropagation()
                    onOpenDay(day)
                  }}
                >
                  还有 {rest} 项
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
