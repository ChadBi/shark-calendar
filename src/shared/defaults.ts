import type { Settings } from './types'

export const DEFAULT_SETTINGS: Settings = {
  closeToTray: true,
  minimizeToTray: false,
  launchAtLogin: false,
  weekStartsOn: 1,
  defaultView: 'month',
  widgetOpacity: 0.92,
  widgetAlwaysOnTop: true,
  widgetBounds: null,
  showWidgetOnStart: false,
  hour24: true
}

export const SCHEMA_VERSION = 1

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
