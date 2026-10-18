import { useEffect, useMemo, useState } from 'react'
import type { AppData } from '../../shared/types'
import { DEFAULT_SETTINGS, colorOf } from '../../shared/defaults'
import { eventsOnDay, fmtDayLabel, fmtTime } from './lib/date'
import { Icon } from './components/Icon'
import './styles/widget.css'

const EXPANDED_H = 440
const COLLAPSED_H = 56

export default function Widget(): React.ReactElement {
  const [data, setData] = useState<AppData | null>(null)
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    void window.api.getData().then(setData)
    const off = window.api.onDataChanged(setData)
    return off
  }, [])

  useEffect(() => {
    void window.api.setWidgetHeight(collapsed ? COLLAPSED_H : EXPANDED_H)
  }, [collapsed])

  const settings = data?.settings ?? DEFAULT_SETTINGS
  const events = data?.events ?? []

  const todays = useMemo(() => eventsOnDay(events, new Date()), [events])

  const now = Date.now()
  const ongoing = todays.filter(
    (e) => new Date(e.start).getTime() <= now && new Date(e.end).getTime() > now
  )

  const alpha = settings.widgetOpacity

  const openMain = (): void => void window.api.openMain()
  const hide = (): void => void window.api.toggleWidget(false)

  return (
    <div
      className="wg"
      style={{
        ['--wg-alpha' as string]: String(alpha)
      }}
    >
      <div className="wg-head">
        <div className="wg-date" onDoubleClick={openMain} title="双击打开鲨鱼日程">
          <span className="wg-day">{fmtDayLabel(new Date())}</span>
          <span className="wg-count">
            {todays.length === 0
              ? '今天空闲'
              : ongoing.length > 0
                ? `今天 ${todays.length} 项 · 进行中 ${ongoing.length}`
                : `今天 ${todays.length} 项`}
          </span>
        </div>

        <div className="wg-actions">
          <button
            className={`wg-btn${settings.widgetAlwaysOnTop ? ' active' : ''}`}
            onClick={() => void window.api.setWidgetPinned(!settings.widgetAlwaysOnTop)}
            title={settings.widgetAlwaysOnTop ? '取消置顶（当前会遮挡其他窗口）' : '置顶显示'}
          >
            <Icon name="pin" size={12} />
          </button>
          <button className="wg-btn" onClick={() => setCollapsed((v) => !v)} title={collapsed ? '展开' : '收起'}>
            <Icon name={collapsed ? 'chevronLeft' : 'chevronRight'} size={13} />
          </button>
          <button className="wg-btn" onClick={openMain} title="打开鲨鱼日程">
            <Icon name="calendar" size={13} />
          </button>
          <button className="wg-btn" onClick={hide} title="隐藏悬浮窗">
            <Icon name="x" size={13} />
          </button>
        </div>
      </div>

      {!collapsed && (
        <>
          <div className="wg-list">
            {todays.length === 0 && (
              <div className="wg-empty">
                今天没有安排
                <br />
                <span>在应用里按 Ctrl+K 快速记一条</span>
              </div>
            )}

            {todays.map((ev) => {
              const c = colorOf(ev.color)
              const past = new Date(ev.end).getTime() < now
              const live =
                new Date(ev.start).getTime() <= now && new Date(ev.end).getTime() > now
              return (
                <div
                  key={ev.id}
                  className={`wg-item${past ? ' past' : ''}${live ? ' live' : ''}`}
                  onClick={() => void window.api.openEvent(ev.id)}
                  title={ev.title}
                >
                  <span className="wg-bar" style={{ background: c.dot }} />
                  <span className="wg-time">
                    {ev.allDay ? '全天' : fmtTime(new Date(ev.start), settings.hour24)}
                  </span>
                  <span className="wg-title">{ev.title}</span>
                  {live && <span className="wg-live-dot" style={{ background: c.dot }} />}
                </div>
              )
            })}
          </div>

          <div className="wg-foot">
            <span className="wg-hint">拖动标题栏可移动 · 双击打开</span>
            <button className="wg-open" onClick={openMain}>
              打开鲨鱼日程
            </button>
          </div>
        </>
      )}
    </div>
  )
}
