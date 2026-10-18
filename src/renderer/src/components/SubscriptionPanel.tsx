import { useState } from 'react'
import { useApp } from '../store'
import { Icon } from './Icon'
import { format } from '../lib/date'

/** 设置面板里的「日历订阅」区块 */
export function SubscriptionPanel(): React.ReactElement {
  const sources = useApp((s) => s.sources)
  const syncing = useApp((s) => s.syncing)
  const addSource = useApp((s) => s.addSource)
  const removeSource = useApp((s) => s.removeSource)
  const syncSources = useApp((s) => s.syncSources)

  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')

  const submit = async (): Promise<void> => {
    if (!url.trim() || syncing) return
    const ok = await addSource(name.trim() || '订阅日历', url.trim())
    if (ok?.ok) {
      setName('')
      setUrl('')
      setAdding(false)
    }
  }

  return (
    <div className="sidebar-section">
      <div className="sidebar-title" style={{ padding: '0 0 8px' }}>
        <span>日历订阅</span>
        <button
          className="btn ghost"
          style={{ height: 24, fontSize: 11.5 }}
          onClick={() => setAdding((v) => !v)}
        >
          <Icon name="plus" size={12} />
          添加
        </button>
      </div>

      {adding && (
        <div className="source-form">
          <input
            className="input"
            placeholder="名称（可选，如：工作日程）"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className="input"
            placeholder="ICS 链接（https://... 或 webcal://...）"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit()
            }}
          />
          <div className="source-form-foot">
            <span className="setting-desc" style={{ flex: 1, lineHeight: 1.5 }}>
              Google 日历：设置 → 日历 → 共享 → 复制「秘密地址（iCal 格式）」。
              <br />
              该链接等同密码，拿到的人都能读到你的日程，请勿公开分享。
            </span>
            <button className="btn" onClick={() => setAdding(false)}>
              取消
            </button>
            <button className="btn primary" onClick={() => void submit()} disabled={syncing}>
              {syncing ? '同步中…' : '添加'}
            </button>
          </div>
        </div>
      )}

      {sources.length === 0 && !adding && (
        <div className="setting-desc" style={{ padding: '2px 0 6px', lineHeight: 1.7 }}>
          还没有订阅。添加一个 ICS 链接，就能把 Google 日历、Outlook 等外部日程同步进来（只读）。
        </div>
      )}

      {sources.map((src) => (
        <div className="source-item" key={src.id}>
          <span className="source-dot" style={{ background: src.color }} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="source-name">{src.name}</div>
            <div className="source-meta">
              {src.lastError ? (
                <span style={{ color: 'var(--danger)' }}>同步失败：{src.lastError}</span>
              ) : src.lastSyncAt ? (
                <>
                  {format(new Date(src.lastSyncAt), 'M/d HH:mm')} 同步 · {src.eventCount ?? 0} 条
                  {src.truncated && (
                    <span style={{ color: 'var(--amber, #a35f00)' }}>（已达上限，部分未导入）</span>
                  )}
                </>
              ) : (
                '尚未同步'
              )}
            </div>
          </div>
          <button
            className="icon-btn plain"
            title="立即刷新"
            disabled={syncing}
            onClick={() => void syncSources(src.id)}
          >
            <Icon name="refresh" size={13} />
          </button>
          <button
            className="icon-btn plain"
            title="移除订阅（连同其日程一起删除）"
            onClick={() => void removeSource(src.id)}
          >
            <Icon name="trash" size={13} />
          </button>
        </div>
      ))}
    </div>
  )
}
