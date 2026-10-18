import { useMemo, useState } from 'react'
import type { CalendarEvent } from '../../../shared/types'
import { colorOf } from '../../../shared/defaults'
import {
  WEEKDAY_LABELS,
  eventsOnDay,
  fmtTime,
  isSameDay,
  isSameMonth,
  isToday,
  monthMatrix,
  startOfDay
} from '../lib/date'
import { Icon } from './Icon'

interface MiniProps {
  events: CalendarEvent[]
  cursor: Date
  weekStartsOn: 0 | 1
  onSelect: (d: Date) => void
}

function MiniMonth({ events, cursor, weekStartsOn, onSelect }: MiniProps): React.ReactElement {
  const [anchor, setAnchor] = useState(() => startOfDay(cursor))

  const days = useMemo(() => monthMatrix(anchor, weekStartsOn), [anchor, weekStartsOn])
  const labels = useMemo(
    () => (weekStartsOn === 1 ? WEEKDAY_LABELS : [WEEKDAY_LABELS[6], ...WEEKDAY_LABELS.slice(0, 6)]),
    [weekStartsOn]
  )
  const busy = useMemo(() => {
    const set = new Set<string>()
    for (const e of events) {
      const d = startOfDay(new Date(e.start)).toDateString()
      set.add(d)
    }
    return set
  }, [events])

  const shift = (delta: number): void => {
    const d = new Date(anchor)
    d.setMonth(d.getMonth() + delta, 1)
    setAnchor(d)
  }

  return (
    <div className="sidebar-section">
      <div className="mini-head">
        <span className="mini-title">
          {anchor.getFullYear()} 年 {anchor.getMonth() + 1} 月
        </span>
        <div className="mini-nav">
          <button className="icon-btn plain" onClick={() => shift(-1)} title="上个月">
            <Icon name="chevronLeft" size={13} />
          </button>
          <button className="icon-btn plain" onClick={() => shift(1)} title="下个月">
            <Icon name="chevronRight" size={13} />
          </button>
        </div>
      </div>

      <div className="mini-grid">
        {labels.map((l) => (
          <div key={l} className="mini-dow">
            {l}
          </div>
        ))}
        {days.map((d) => {
          const cls = [
            'mini-cell',
            isSameMonth(d, anchor) ? '' : 'out',
            isToday(d) ? 'today' : '',
            isSameDay(d, cursor) && !isToday(d) ? 'sel' : ''
          ]
            .filter(Boolean)
            .join(' ')
          return (
            <div key={d.toISOString()} className={cls} onClick={() => onSelect(d)}>
              {d.getDate()}
              {busy.has(startOfDay(d).toDateString()) && !isToday(d) && <span className="dot" />}
            </div>
          )
        })}
      </div>
    </div>
  )
}

interface SidebarProps {
  events: CalendarEvent[]
  cursor: Date
  weekStartsOn: 0 | 1
  hour24: boolean
  onJump: (d: Date) => void
  onEdit: (e: CalendarEvent) => void
  onNew: () => void
  onOpenSettings: () => void
  onToggleWidget: () => void
}

export function Sidebar({
  events,
  cursor,
  weekStartsOn,
  hour24,
  onJump,
  onEdit,
  onNew,
  onOpenSettings,
  onToggleWidget
}: SidebarProps): React.ReactElement {
  const today = new Date()
  const todays = useMemo(() => eventsOnDay(events, today), [events, today])

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">鲨</div>
        <span className="brand-name">鲨鱼日程</span>
      </div>

      <div className="sidebar-scroll">
        <MiniMonth events={events} cursor={cursor} weekStartsOn={weekStartsOn} onSelect={onJump} />

        <div className="sidebar-section">
          <div className="sidebar-title">
            <span>今天</span>
            <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>
              {todays.length} 项
            </span>
          </div>

          {todays.length === 0 && (
            <div className="empty-hint">
              今天还没有安排
              <br />
              按 <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>N</kbd> 快速新建
            </div>
          )}

          {todays.slice(0, 8).map((ev) => {
            const c = colorOf(ev.color)
            return (
              <div key={ev.id} className="today-item" onClick={() => onEdit(ev)}>
                <span className="today-bar" style={{ background: c.dot }} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="today-name">{ev.title}</div>
                  <div className="today-time">
                    {ev.allDay ? '全天' : fmtTime(new Date(ev.start), hour24)}
                  </div>
                </div>
              </div>
            )
          })}

          {todays.length > 8 && (
            <div className="empty-hint" style={{ padding: '4px 8px' }}>
              还有 {todays.length - 8} 项…
            </div>
          )}
        </div>
      </div>

      <div className="sidebar-foot">
        <button className="btn ghost" onClick={onToggleWidget} title="显示 / 隐藏桌面悬浮窗">
          <Icon name="monitor" size={14} />
          桌面组件
        </button>
        <button className="icon-btn plain" onClick={onOpenSettings} title="设置">
          <Icon name="settings" size={15} />
        </button>
        <button className="icon-btn plain" onClick={onNew} title="新建事件">
          <Icon name="plus" size={16} strokeWidth={2.1} />
        </button>
      </div>
    </aside>
  )
}
