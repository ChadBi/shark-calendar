import { useEffect, useMemo } from 'react'
import { useApp } from './store'
import { Sidebar } from './components/Sidebar'
import { MonthView } from './components/MonthView'
import { TimeGrid } from './components/TimeGrid'
import { EventEditor } from './components/EventEditor'
import { QuickAdd } from './components/QuickAdd'
import { SettingsPanel } from './components/SettingsPanel'
import { Icon } from './components/Icon'
import { colorOf } from '../../shared/defaults'
import type { ViewMode } from '../../shared/types'
import {
  durationLabel,
  endOfDay,
  eventsOnDay,
  fmtDayLabel,
  fmtTime,
  monthMatrix,
  startOfDay,
  viewTitle,
  weekDays
} from './lib/date'
import { expandRecurring } from './lib/recur'

const VIEWS: Array<{ key: ViewMode; label: string }> = [
  { key: 'month', label: '月' },
  { key: 'week', label: '周' },
  { key: 'day', label: '日' }
]

export default function App(): React.ReactElement {
  const ready = useApp((s) => s.ready)
  const events = useApp((s) => s.events)
  const todos = useApp((s) => s.todos)
  const settings = useApp((s) => s.settings)
  const view = useApp((s) => s.view)
  const cursor = useApp((s) => s.cursor)
  const editing = useApp((s) => s.editing)
  const settingsOpen = useApp((s) => s.settingsOpen)
  const quickAddOpen = useApp((s) => s.quickAddOpen)
  const toast = useApp((s) => s.toast)

  const init = useApp((s) => s.init)
  const setView = useApp((s) => s.setView)
  const setCursor = useApp((s) => s.setCursor)
  const step = useApp((s) => s.step)
  const goToday = useApp((s) => s.goToday)
  const openNew = useApp((s) => s.openNew)
  const openEdit = useApp((s) => s.openEdit)
  const closeEditor = useApp((s) => s.closeEditor)
  const saveEvent = useApp((s) => s.saveEvent)
  const rescheduleEvent = useApp((s) => s.rescheduleEvent)
  const removeEvent = useApp((s) => s.removeEvent)
  const setSettingsOpen = useApp((s) => s.setSettingsOpen)
  const setQuickAddOpen = useApp((s) => s.setQuickAddOpen)
  const addTodo = useApp((s) => s.addTodo)
  const toggleTodo = useApp((s) => s.toggleTodo)
  const deleteTodo = useApp((s) => s.deleteTodo)
  const updateTodo = useApp((s) => s.updateTodo)

  useEffect(() => {
    void init()
  }, [init])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement | null)?.tagName
      const typing = tag === 'INPUT' || tag === 'TEXTAREA'

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setQuickAddOpen(true)
        return
      }
      if (typing || editing) return

      switch (e.key) {
        case 'n':
        case 'N':
          e.preventDefault()
          openNew()
          break
        case 't':
        case 'T':
          e.preventDefault()
          goToday()
          break
        case '1':
          setView('month')
          break
        case '2':
          setView('week')
          break
        case '3':
          setView('day')
          break
        case 'ArrowLeft':
          e.preventDefault()
          step(-1)
          break
        case 'ArrowRight':
          e.preventDefault()
          step(1)
          break
        default:
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editing, goToday, openNew, setQuickAddOpen, setView, step])

  const openDay = (d: Date): void => {
    setCursor(d)
    setView('day')
  }

  /** 当前视图的可见时间范围，用于展开重复事件 */
  const viewEvents = useMemo(() => {
    let from: Date
    let to: Date
    if (view === 'month') {
      const days = monthMatrix(cursor, settings.weekStartsOn)
      from = startOfDay(days[0])
      to = endOfDay(days[41])
    } else if (view === 'week') {
      const days = weekDays(cursor, settings.weekStartsOn)
      from = startOfDay(days[0])
      to = endOfDay(days[6])
    } else {
      from = startOfDay(cursor)
      to = endOfDay(cursor)
    }
    return expandRecurring(events, from, to)
  }, [events, view, cursor, settings.weekStartsOn])

  const dayEvents = useMemo(
    () => (view === 'day' ? eventsOnDay(viewEvents, cursor) : []),
    [view, viewEvents, cursor]
  )

  if (!ready) {
    return <div style={{ display: 'grid', placeItems: 'center', height: '100vh', color: '#8b93a1' }}>加载中…</div>
  }

  return (
    <div className="app-shell">
      <Sidebar
        events={events}
        todos={todos}
        cursor={cursor}
        weekStartsOn={settings.weekStartsOn}
        hour24={settings.hour24}
        onJump={openDay}
        onEdit={openEdit}
        onNew={() => openNew()}
        onOpenSettings={() => setSettingsOpen(true)}
        onToggleWidget={() => void window.api.toggleWidget()}
        onAddTodo={(title) => void addTodo(title)}
        onToggleTodo={(id, done) => void toggleTodo(id, done)}
        onDeleteTodo={(id) => void deleteTodo(id)}
        onSetTodoDue={(id, due) => void updateTodo(id, { dueAt: due })}
      />

      <main className="main">
        <div className="toolbar">
          <div className="toolbar-title">{viewTitle(cursor, view)}</div>

          <div className="nav-group">
            <button className="icon-btn" onClick={() => step(-1)} title="上一页">
              <Icon name="chevronLeft" size={14} />
            </button>
            <button className="btn ghost" style={{ height: 24 }} onClick={goToday} title="回到今天 (T)">
              今天
            </button>
            <button className="icon-btn" onClick={() => step(1)} title="下一页">
              <Icon name="chevronRight" size={14} />
            </button>
          </div>

          <div className="spacer" />

          <div className="segmented">
            {VIEWS.map((v) => (
              <button
                key={v.key}
                className={view === v.key ? 'active' : ''}
                onClick={() => setView(v.key)}
                title={`${v.label}视图 (${VIEWS.indexOf(v) + 1})`}
              >
                {v.label}
              </button>
            ))}
          </div>

          <button className="btn" onClick={() => setQuickAddOpen(true)} title="快速添加 (Ctrl+K)">
            <Icon name="clock" size={13} />
            快速添加
          </button>

          <button className="btn primary" onClick={() => openNew()} title="新建事件 (N)">
            <Icon name="plus" size={14} strokeWidth={2.4} />
            新建
          </button>
        </div>

        <div className="view-area">
          {view === 'month' && (
            <MonthView
              events={viewEvents}
              cursor={cursor}
              weekStartsOn={settings.weekStartsOn}
              hour24={settings.hour24}
              onNew={openNew}
              onEdit={openEdit}
              onOpenDay={openDay}
            />
          )}

          {view === 'week' && (
            <TimeGrid
              events={viewEvents}
              days={weekDays(cursor, settings.weekStartsOn)}
              hour24={settings.hour24}
              onNew={openNew}
              onEdit={openEdit}
              onOpenDay={openDay}
              onReschedule={(ev, s, e) => void rescheduleEvent(ev, s, e)}
            />
          )}

          {view === 'day' && (
            <div className="day-layout">
              <TimeGrid
                events={viewEvents}
                days={[startOfDay(cursor)]}
                hour24={settings.hour24}
                bare
                onNew={openNew}
                onEdit={openEdit}
                onOpenDay={openDay}
                onReschedule={(ev, s, e) => void rescheduleEvent(ev, s, e)}
              />

              <div className="day-panel">
                <h3>{fmtDayLabel(cursor)}</h3>
                <div className="muted">
                  {dayEvents.length === 0 ? '这一天还是空的。' : `共 ${dayEvents.length} 项安排`}
                </div>

                <div className="detail-list">
                  {dayEvents.map((ev) => {
                    const c = colorOf(ev.color)
                    return (
                      <div key={ev.id} className="detail-item" onClick={() => openEdit(ev)}>
                        <div className="detail-time">
                          {ev.allDay ? '全天' : fmtTime(new Date(ev.start), settings.hour24)}
                        </div>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontWeight: 550, wordBreak: 'break-word' }}>{ev.title}</div>
                          <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 1 }}>
                            {ev.allDay ? '' : durationLabel(new Date(ev.start), new Date(ev.end))}
                            {ev.notes ? ` · ${ev.notes.slice(0, 24)}` : ''}
                          </div>
                        </div>
                        <span
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: '50%',
                            background: c.dot,
                            marginTop: 6,
                            flex: 'none'
                          }}
                        />
                      </div>
                    )
                  })}
                </div>

                <button
                  className="btn"
                  style={{ marginTop: 14, width: '100%', justifyContent: 'center' }}
                  onClick={() => openNew(startOfDay(cursor))}
                >
                  <Icon name="plus" size={13} />
                  在这天新建
                </button>
              </div>
            </div>
          )}
        </div>
      </main>

      {editing && (
        <EventEditor
          draft={editing}
          onSave={saveEvent}
          onDelete={removeEvent}
          onClose={closeEditor}
        />
      )}
      {quickAddOpen && <QuickAdd />}
      {settingsOpen && <SettingsPanel />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
