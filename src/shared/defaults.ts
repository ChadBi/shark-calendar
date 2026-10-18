import type { Settings } from './types'

export const DEFAULT_SETTINGS: Settings = {
  closeToTray: true,
  minimizeToTray: false,
  launchAtLogin: false,
  weekStartsOn: 1,
  defaultView: 'month',
  widgetOpacity: 0.92,
  // 默认不置顶：悬浮窗和普通窗口同级，切到别的应用时会被自然遮挡，
  // 不会一直压在其他窗口上面碍事。需要常驻最前时可在设置里打开。
  widgetAlwaysOnTop: false,
  widgetBounds: null,
  showWidgetOnStart: false,
  hour24: true,

  // 云同步默认关闭：没配置服务地址时开着只会不断报错
  syncEnabled: false,
  syncEndpoint: '',
  syncLastSeq: 0,
  syncLastAt: undefined
}

/**
 * 数据结构版本。
 * v2：悬浮窗默认改为不置顶，且对老数据做一次性迁移
 *     （已持久化的 true 不会被新的默认值覆盖，必须显式改写）
 */
export const SCHEMA_VERSION = 2

export const EVENT_COLORS = [
  { key: 'blue', label: '蓝', dot: '#3b6ff5', bg: '#e8efff', fg: '#1e4bd8' },
  { key: 'violet', label: '紫', dot: '#7c5cf0', bg: '#eee9ff', fg: '#5b34d6' },
  { key: 'emerald', label: '绿', dot: '#12a97a', bg: '#e2f7f0', fg: '#0a7a57' },
  { key: 'amber', label: '橙', dot: '#e08a0b', bg: '#fdf1dc', fg: '#a35f00' },
  { key: 'rose', label: '红', dot: '#e05070', bg: '#fde9ee', fg: '#b32347' },
  { key: 'slate', label: '灰', dot: '#6b7484', bg: '#eef0f3', fg: '#4a5261' }
] as const

export function colorOf(key: string) {
  return EVENT_COLORS.find((c) => c.key === key) ?? EVENT_COLORS[0]
}
