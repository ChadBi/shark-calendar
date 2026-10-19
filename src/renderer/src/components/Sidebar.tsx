import { useMemo, useState } from 'react'
import type { CalendarEvent, Todo } from '../../../shared/types'
import { colorOf } from '../../../shared/defaults'
import {
  WEEKDAY_LABELS,
  endOfDay,
  eventsOnDay,
  fmtTime,
  isSameDay,
  isSameMonth,
  isToday,
  monthMatrix,
  startOfDay
} from '../lib/date'
import { expandRecurring } from '../lib/recur'
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
    // 重复事件要先按这个月的范围展开，否则小圆点只会出现在首次发生的那天
    const from = startOfDay(days[0])
    const to = endOfDay(days[days.length - 1])
    const set = new Set<string>()
    for (const e of expandRecurring(events, from, to)) {
      const d = startOfDay(new Date(e.start)).toDateString()
      set.add(d)
    }
    return set
  }, [events, days])

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
  todos: Todo[]
  cursor: Date
  weekStartsOn: 0 | 1
  hour24: boolean
  onJump: (d: Date) => void
  onEdit: (e: CalendarEvent) => void
  onNew: () => void
  onOpenSettings: () => void
  onToggleWidget: () => void
  onAddTodo: (title: string) => void
  onToggleTodo: (id: string, done: boolean) => void
  onDeleteTodo: (id: string) => void
  onSetTodoDue: (id: string, due: string | undefined) => void
}

export function Sidebar({
  events,
  todos,
  cursor,
  weekStartsOn,
  hour24,
  onJump,
  onEdit,
  onNew,
  onOpenSettings,
  onToggleWidget,
  onAddTodo,
  onToggleTodo,
  onDeleteTodo,
  onSetTodoDue
}: SidebarProps): React.ReactElement {
  const [todoInput, setTodoInput] = useState('')
  const [dueEditing, setDueEditing] = useState<string | null>(null)

  const todays = useMemo(() => {
    const today = new Date()
    return eventsOnDay(expandRecurring(events, startOfDay(today), endOfDay(today)), today)
  }, [events])

  // 未完成在前、置顶在前、手动顺序次之、最近创建的排后面
  const sortedTodos = useMemo(() => {
    return [...todos].sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1
      if (a.order !== b.order) return a.order - b.order
      return b.createdAt.localeCompare(a.createdAt)
    })
  }, [todos])

  const pendingCount = useMemo(() => todos.filter((t) => !t.done).length, [todos])

  const submitTodo = (): void => {
    const text = todoInput.trim()
    if (!text) return
    onAddTodo(text)
    setTodoInput('')
  }

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

        <div className="sidebar-section">
          <div className="sidebar-title">
            <span>待办</span>
            <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>
              {pendingCount} 项
            </span>
          </div>

          <input
            className="input todo-input"
            placeholder="添加待办，回车保存"
            value={todoInput}
            onChange={(e) => setTodoInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                submitTodo()
              }
            }}
          />

          {sortedTodos.length === 0 && (
            <div className="empty-hint">
              没有待办
              <br />
              想到什么先记下来，不用挑时间
            </div>
          )}

          {sortedTodos.map((t) => (
            <div key={t.id} className={`todo-item${t.done ? ' done' : ''}`}>
              <button
                className={`todo-check${t.done ? ' on' : ''}`}
                onClick={() => onToggleTodo(t.id, !t.done)}
                title={t.done ? '标记为未完成' : '标记完成'}
              >
                {t.done && <Icon name="check" size={9} strokeWidth={3.2} />}
              </button>

              <div className="todo-body">
                <div className="todo-title" title={t.title}>
                  {t.pinned && <span className="todo-pin">置顶</span>}
                  {t.title}
                </div>
                {dueEditing === t.id ? (
                  <input
                    type="date"
                    className="todo-due-input"
                    autoFocus
                    value={t.dueAt ?? ''}
                    onChange={(e) => onSetTodoDue(t.id, e.target.value || undefined)}
                    onBlur={() => setDueEditing(null)}
                  />
                ) : (
                  t.dueAt && <div className="todo-due">{t.dueAt.slice(5).replace('-', '/')} 截止</div>
                )}
              </div>

              <button
                className="todo-act"
                onClick={() => setDueEditing(dueEditing === t.id ? null : t.id)}
                title="设置截止日（会出现在当天日历里）"
              >
                <Icon name="calendar" size={11} />
              </button>
              <button className="todo-act" onClick={() => onDeleteTodo(t.id)} title="删除">
                <Icon name="x" size={11} />
              </button>
            </div>
          ))}
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
