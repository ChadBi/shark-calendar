import { useCallback, useEffect, useState } from 'react'
import type { SyncStatus } from '../../../shared/types'
import { useApp } from '../store'
import { Icon } from './Icon'
import { format } from '../lib/date'

/** 设置面板里的「云同步」区块 */
export function SyncPanel(): React.ReactElement {
  const settings = useApp((s) => s.settings)
  const patch = useApp((s) => s.patchSettings)
  const showToast = useApp((s) => s.showToast)

  const [endpoint, setEndpoint] = useState(settings.syncEndpoint)
  const [token, setToken] = useState('')
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    setStatus(await window.api.getSyncStatus())
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const save = async (): Promise<void> => {
    const url = endpoint.trim()
    if (url && !/^https?:\/\//i.test(url)) {
      showToast('服务地址需要以 http:// 或 https:// 开头')
      return
    }
    await patch({ syncEndpoint: url, syncEnabled: true })
    if (token.trim()) {
      await window.api.setSyncToken(token.trim())
      setToken('')
    }
    await refresh()
    showToast('同步配置已保存')
  }

  const doSync = async (): Promise<void> => {
    setBusy(true)
    try {
      const r = await window.api.syncNow()
      showToast(
        r.ok ? `同步完成：推送 ${r.pushed} 条，拉取 ${r.pulled} 条` : `同步失败：${r.error ?? '未知错误'}`
      )
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sidebar-section">
      <div className="sidebar-title" style={{ padding: '0 0 8px' }}>
        <span>云同步</span>
        <button
          className={`switch${settings.syncEnabled ? ' on' : ''}`}
          onClick={() => void patch({ syncEnabled: !settings.syncEnabled })}
          aria-pressed={settings.syncEnabled}
        />
      </div>

      {!settings.syncEnabled && (
        <div className="setting-desc" style={{ lineHeight: 1.7, paddingBottom: 6 }}>
          开启后，本地创建的事件会在多台设备间同步。订阅日历是派生数据，不参与同步。
        </div>
      )}

      {settings.syncEnabled && (
        <>
          <div className="source-form">
            <input
              className="input"
              placeholder="同步服务地址（https://...）"
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
            />
            <input
              className="input"
              type="password"
              placeholder={status?.hasToken ? '访问令牌已保存（留空则不修改）' : '访问令牌'}
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
            <div className="source-form-foot">
              <span className="setting-desc" style={{ flex: 1, lineHeight: 1.45 }}>
                令牌经系统加密后单独存放，不会写进数据文件
              </span>
              <button className="btn primary" onClick={() => void save()}>
                保存
              </button>
            </div>
          </div>

          <div className="source-item">
            <span
              className="source-dot"
              style={{ background: status?.lastAt ? 'var(--brand)' : '#b4b2a9' }}
            />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="source-name">
                {status?.lastAt ? '已连接' : '尚未同步'}
                {status && status.pending > 0 && (
                  <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>
                    {' '}
                    · 待推送 {status.pending} 条
                  </span>
                )}
              </div>
              <div className="source-meta">
                {status?.lastAt
                  ? `上次同步 ${format(new Date(status.lastAt), 'M/d HH:mm')}`
                  : status?.hasToken
                    ? '配置完成后点「立即同步」'
                    : '还需要填写访问令牌'}
              </div>
            </div>
            <button
              className="icon-btn plain"
              title="立即同步"
              disabled={busy || !status?.hasToken || !settings.syncEndpoint}
              onClick={() => void doSync()}
            >
              <Icon name="refresh" size={13} />
            </button>
          </div>
        </>
      )}
    </div>
  )
}
