import { useEffect, useMemo, useRef, useState } from 'react'
import { fmtDayLabel, fmtTime } from '../lib/date'
import { parseQuickAdd } from '../lib/parse'
import { useApp } from '../store'
import { Icon } from './Icon'

export function QuickAdd(): React.ReactElement {
  const [text, setText] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  const setOpen = useApp((s) => s.setQuickAddOpen)
  const saveEvent = useApp((s) => s.saveEvent)
  const openNew = useApp((s) => s.openNew)

  useEffect(() => {
    ref.current?.focus()
  }, [])

  const parsed = useMemo(() => (text.trim() ? parseQuickAdd(text) : null), [text])

  const submit = (): void => {
    if (!parsed) {
      // 完全无法解析时退回到完整表单，别把用户输入丢掉
      if (text.trim()) {
        setOpen(false)
        openNew()
      } else {
        setOpen(false)
      }
      return
    }
    void saveEvent({
      title: parsed.title,
      start: parsed.start,
      end: parsed.end,
      allDay: parsed.allDay,
      color: 'blue'
    })
    setOpen(false)
  }

  return (
    <div
      className="quickadd-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false)
      }}
    >
      <div className="quickadd">
        <div className="qa-input-row">
          <Icon name="plus" size={17} strokeWidth={2.2} />
          <input
            ref={ref}
            className="qa-input"
            placeholder="明天下午3点 和设计对需求 1小时"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                submit()
              }
              if (e.key === 'Escape') setOpen(false)
            }}
          />
          {text && (
            <button className="icon-btn plain" onClick={() => setText('')} title="清空">
              <Icon name="x" size={14} />
            </button>
          )}
        </div>

        {parsed ? (
          <div className="qa-preview">
            <Icon name="clock" size={14} />
            <span>
              <strong>{parsed.title}</strong>
              {' · '}
              {fmtDayLabel(parsed.start)}
              {!parsed.allDay && ` ${fmtTime(parsed.start)} – ${fmtTime(parsed.end)}`}
              {parsed.allDay && ' 全天'}
            </span>
            <span className="spacer" />
            <span style={{ fontSize: 11, color: 'var(--text-3)' }}>回车保存</span>
          </div>
        ) : (
          <div className="qa-hint">
            试试：
            <code>明天 3 点 开会</code>
            <code>周五 14:30 评审 2 小时</code>
            <code>10/20 体检</code>
            <code>下周一 站会 30 分钟</code>
          </div>
        )}
      </div>
    </div>
  )
}
