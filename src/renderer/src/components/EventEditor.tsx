import { useEffect, useMemo, useRef, useState } from 'react'
import type { EventColor } from '../../../shared/types'
import { EVENT_COLORS } from '../../../shared/defaults'
import { durationLabel, format } from '../lib/date'
import type { EditorDraft } from '../store'
import { Icon } from './Icon'

interface Props {
  draft: EditorDraft
  onSave: (d: EditorDraft) => void
  onDelete?: (id: string) => void
  onClose: () => void
}

const toDateStr = (d: Date): string => format(d, 'yyyy-MM-dd')
const toTimeStr = (d: Date): string => format(d, 'HH:mm')

export function EventEditor({ draft, onSave, onDelete, onClose }: Props): React.ReactElement {
  const [title, setTitle] = useState(draft.title)
  const [dateStr, setDateStr] = useState(toDateStr(draft.start))
  const [startStr, setStartStr] = useState(toTimeStr(draft.start))
  const [endStr, setEndStr] = useState(toTimeStr(draft.end))
  const [allDay, setAllDay] = useState(draft.allDay)
  const [color, setColor] = useState<EventColor>(draft.color)
  const [notes, setNotes] = useState(draft.notes ?? '')
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    titleRef.current?.focus()
    titleRef.current?.select()
  }, [])

  // 结束时间早于开始时间 → 视为跨到次日，这是用户最自然的意图
  const { start, end } = useMemo(() => {
    const [y, m, d] = dateStr.split('-').map(Number)
    const [sh, sm] = startStr.split(':').map(Number)
    const [eh, em] = endStr.split(':').map(Number)
    if (allDay) {
      const s = new Date(y, m - 1, d, 0, 0, 0, 0)
      return { start: s, end: new Date(s.getTime() + 86400000) }
    }
    const s = new Date(y, m - 1, d, sh || 0, sm || 0, 0, 0)
    let e = new Date(y, m - 1, d, eh || 0, em || 0, 0, 0)
    if (e.getTime() <= s.getTime()) e = new Date(e.getTime() + 86400000)
    return { start: s, end: e }
  }, [dateStr, startStr, endStr, allDay])

  const commit = (): void => {
    onSave({
      id: draft.id,
      title: title.trim() || '未命名日程',
      start,
      end,
      allDay,
      color,
      notes: notes.trim() || undefined
    })
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      commit()
    }
  }

  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      onKeyDown={onKeyDown}
    >
      <div className="modal" onKeyDown={onKeyDown}>
        <div className="modal-head">
          <h2>{draft.id ? '编辑日程' : '新建日程'}</h2>
          <button className="icon-btn plain" onClick={onClose} title="关闭">
            <Icon name="x" size={15} />
          </button>
        </div>

        <div className="modal-body">
          <input
            ref={titleRef}
            className="title-input"
            placeholder="要做什么？"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
                e.preventDefault()
                commit()
              }
            }}
          />

          <div className="field-row">
            <span className="field-label">日期</span>
            <input
              type="date"
              className="input"
              style={{ flex: 1 }}
              value={dateStr}
              onChange={(e) => setDateStr(e.target.value)}
            />
            <button
              className="btn ghost"
              onClick={() => {
                const t = new Date()
                setDateStr(toDateStr(t))
              }}
            >
              今天
            </button>
          </div>

          {!allDay && (
            <div className="field-row">
              <span className="field-label">时间</span>
              <input
                type="time"
                className="input"
                style={{ flex: 1 }}
                value={startStr}
                onChange={(e) => setStartStr(e.target.value)}
              />
              <span style={{ color: 'var(--text-3)' }}>–</span>
              <input
                type="time"
                className="input"
                style={{ flex: 1 }}
                value={endStr}
                onChange={(e) => setEndStr(e.target.value)}
              />
              <span style={{ fontSize: 11.5, color: 'var(--text-3)', width: 62, textAlign: 'right' }}>
                {durationLabel(start, end)}
              </span>
            </div>
          )}

          <div className="field-row">
            <span className="field-label">全天</span>
            <button
              className={`switch${allDay ? ' on' : ''}`}
              onClick={() => setAllDay((v) => !v)}
              aria-pressed={allDay}
            />
            <span className="spacer" />
            <span className="field-label" style={{ width: 'auto' }}>
              颜色
            </span>
            <div className="color-row">
              {EVENT_COLORS.map((c) => (
                <button
                  key={c.key}
                  className={`color-dot${color === c.key ? ' active' : ''}`}
                  style={{ background: c.dot, color: c.dot }}
                  onClick={() => setColor(c.key as EventColor)}
                  title={c.label}
                />
              ))}
            </div>
          </div>

          <div>
            <textarea
              className="textarea"
              placeholder="备注（可选）"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>

        <div className="modal-foot">
          {draft.id && onDelete && (
            <button className="btn danger" onClick={() => onDelete(draft.id!)}>
              <Icon name="trash" size={13} />
              删除
            </button>
          )}
          <span className="spacer" />
          <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
            <kbd>Ctrl</kbd> + <kbd>Enter</kbd> 保存
          </span>
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn primary" onClick={commit}>
            <Icon name="check" size={13} strokeWidth={2.4} />
            保存
          </button>
        </div>
      </div>
    </div>
  )
}
