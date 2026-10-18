export type ViewMode = 'month' | 'week' | 'day'

export type EventColor = 'blue' | 'violet' | 'emerald' | 'amber' | 'rose' | 'slate'

export interface CalendarEvent {
  id: string
  title: string
  /** ISO 8601 */
  start: string
  /** ISO 8601 */
  end: string
  allDay: boolean
  color: EventColor
  notes?: string
  createdAt: string
  updatedAt: string
  /** 预留云同步：单调递增版本号 */
  rev: number
  /** 软删除，供未来同步墓碑使用 */
  deleted?: boolean
}

export interface WidgetBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface Settings {
  /** 关闭主窗口时隐藏到系统托盘 */
  closeToTray: boolean
  /** 最小化时隐藏到系统托盘（否则最小化到任务栏） */
  minimizeToTray: boolean
  launchAtLogin: boolean
  weekStartsOn: 0 | 1
  defaultView: ViewMode
  widgetOpacity: number
  widgetAlwaysOnTop: boolean
  widgetBounds: WidgetBounds | null
  showWidgetOnStart: boolean
  /** 24 小时制 */
  hour24: boolean
}

export interface AppData {
  /** 数据结构版本，供未来迁移/同步使用 */
  schemaVersion: number
  events: CalendarEvent[]
  settings: Settings
}

export interface AppApi {
  getData(): Promise<AppData>
  upsertEvent(input: Partial<CalendarEvent> & { title: string; start: string; end: string }): Promise<CalendarEvent>
  deleteEvent(id: string): Promise<void>
  importEvents(events: CalendarEvent[]): Promise<number>
  patchSettings(patch: Partial<Settings>): Promise<Settings>
  toggleWidget(force?: boolean): Promise<boolean>
  setWidgetOpacity(value: number): Promise<void>
  setWidgetPinned(pinned: boolean): Promise<void>
  setWidgetHeight(height: number): Promise<void>
  openMain(): Promise<void>
  openEvent(id: string): Promise<void>
  quit(): Promise<void>
  openDataFolder(): Promise<void>
  onDataChanged(cb: (data: AppData) => void): () => void
  onQuickAdd(cb: () => void): () => void
  onOpenEvent(cb: (id: string) => void): () => void
}

declare global {
  interface Window {
    api: AppApi
  }
}
