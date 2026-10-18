import { useEffect, useMemo, useRef } from 'react'
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

interface Props {
  events: CalendarEvent[]
  days: Date[]
  hour24: boolean
  bare?: boolean
  onNew: (start: Date, allDay?: boolean) => void
  onEdit: (e: CalendarEvent) => void
  onOpenDay: (d: Date) => void
}

/**
 * 周视图与日视图共用同一条时间轴。
 * 差别只是列数：周视图 7 列，日视图 1 列。
 */
export function TimeGrid({ events, days, hour24, bare, onNew, onEdit, onOpenDay }: Props): React.ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null)
  const colCount = days.length

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
          style={{
            gridTemplateColumns: `repeat(${colCount}, minmax(0,1fr))`,
            height: TOTAL_MIN * (HOUR_H / 60),
            ['--hour-h' as string]: `${HOUR_H}px`
          }}
        >
          {days.map((day, di) => {
            const weekend = day.getDay() === 0 || day.getDay() === 6
            return (
              <div
                key={day.toISOString()}
                className={`tl-col${weekend ? ' weekend' : ''}`}
                onClick={(e) => {
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
                  const c = colorOf(slot.event.color)
                  const top = (slot.startMin / TOTAL_MIN) * 100
                  const height = ((slot.endMin - slot.startMin) / TOTAL_MIN) * 100
                  const widthPct = 100 / slot.cols
                  const compact = slot.endMin - slot.startMin < 42
                  return (
                    <div
                      key={slot.event.id}
                      className={`slot${compact ? ' compact' : ''}`}
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
                      onClick={(e) => {
                        e.stopPropagation()
                        onEdit(slot.event)
                      }}
                    >
                      <div className="slot-title">{slot.event.title}</div>
                      <div className="slot-time">
                        {slot.continuesBefore && '← '}
                        {fmtMinuteOfDay(slot.startMin, hour24)}
                        {slot.continuesAfter && ' →'}
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
