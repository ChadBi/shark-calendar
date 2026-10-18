import { useEffect } from 'react'
import { useApp } from '../store'
import { Icon } from './Icon'
import { SubscriptionPanel } from './SubscriptionPanel'
import { SyncPanel } from './SyncPanel'

function Row({
  label,
  desc,
  children
}: {
  label: string
  desc?: string
  children: React.ReactNode
}): React.ReactElement {
  return (
    <div className="setting-row">
      <div>
        <div className="setting-label">{label}</div>
        {desc && <div className="setting-desc">{desc}</div>}
      </div>
      {children}
    </div>
  )
}

function Switch({ on, onClick }: { on: boolean; onClick: () => void }): React.ReactElement {
  return <button className={`switch${on ? ' on' : ''}`} onClick={onClick} aria-pressed={on} />
}

export function SettingsPanel(): React.ReactElement {
  const settings = useApp((s) => s.settings)
  const patch = useApp((s) => s.patchSettings)
  const close = useApp((s) => s.setSettingsOpen)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close(false)
      }}
    >
      <div className="modal settings-sheet">
        <div className="modal-head">
          <h2>设置</h2>
          <button className="icon-btn plain" onClick={() => close(false)}>
            <Icon name="x" size={15} />
          </button>
        </div>

        <div className="modal-body" style={{ paddingBottom: 14 }}>
          <div className="sidebar-title" style={{ padding: '4px 0 0' }}>
            窗口行为
          </div>

          <Row label="关闭窗口时隐藏到托盘" desc="应用继续在后台运行，事件提醒不受影响">
            <Switch on={settings.closeToTray} onClick={() => patch({ closeToTray: !settings.closeToTray })} />
          </Row>

          <Row label="最小化时隐藏到托盘" desc="关闭后最小化按钮会把窗口收进托盘，而不是任务栏">
            <Switch
              on={settings.minimizeToTray}
              onClick={() => patch({ minimizeToTray: !settings.minimizeToTray })}
            />
          </Row>

          <Row label="开机自动启动" desc="登录 Windows 后自动在托盘运行">
            <Switch
              on={settings.launchAtLogin}
              onClick={() => patch({ launchAtLogin: !settings.launchAtLogin })}
            />
          </Row>

          <div className="sidebar-title" style={{ padding: '10px 0 0' }}>
            桌面悬浮窗
          </div>

          <Row
            label="置顶显示"
            desc="开启后会一直压在其他窗口上方；关闭时和普通窗口同级，切到别的应用会被遮挡"
          >
            <Switch
              on={settings.widgetAlwaysOnTop}
              onClick={() => patch({ widgetAlwaysOnTop: !settings.widgetAlwaysOnTop })}
            />
          </Row>

          <Row label="启动时显示" desc="应用启动后自动把悬浮窗贴到桌面">
            <Switch
              on={settings.showWidgetOnStart}
              onClick={() => patch({ showWidgetOnStart: !settings.showWidgetOnStart })}
            />
          </Row>

          <Row label="背景不透明度">
            <input
              type="range"
              className="range"
              min={0.35}
              max={1}
              step={0.01}
              value={settings.widgetOpacity}
              onChange={(e) => patch({ widgetOpacity: Number(e.target.value) })}
            />
          </Row>

          <div className="sidebar-title" style={{ padding: '10px 0 0' }}>
            日历
          </div>

          <Row label="每周起始日">
            <div className="segmented">
              <button
                className={settings.weekStartsOn === 1 ? 'active' : ''}
                onClick={() => patch({ weekStartsOn: 1 })}
              >
                周一
              </button>
              <button
                className={settings.weekStartsOn === 0 ? 'active' : ''}
                onClick={() => patch({ weekStartsOn: 0 })}
              >
                周日
              </button>
            </div>
          </Row>

          <Row label="时间格式">
            <div className="segmented">
              <button className={settings.hour24 ? 'active' : ''} onClick={() => patch({ hour24: true })}>
                24 小时
              </button>
              <button className={!settings.hour24 ? 'active' : ''} onClick={() => patch({ hour24: false })}>
                12 小时
              </button>
            </div>
          </Row>

          <SubscriptionPanel />

          <SyncPanel />

          <Row label="数据" desc="默认只存在本机；开启云同步后会发送到你自己的同步服务">
            <button className="btn" onClick={() => window.api.openDataFolder()}>
              打开数据文件夹
            </button>
          </Row>
        </div>
      </div>
    </div>
  )
}
