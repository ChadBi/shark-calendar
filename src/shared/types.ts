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
  /** 来自订阅源时记录来源；本地创建的事件为空 */
  sourceId?: string
  /** 订阅源里的原始 UID，用于稳定生成实例 id */
  externalId?: string
  /** 订阅事件只读，不能直接编辑或删除 */
  readOnly?: boolean
  location?: string
}

/** 一个 ICS 订阅源 */
export interface CalendarSource {
  id: string
  name: string
  url: string
  color: EventColor
  enabled: boolean
  /** 上次同步时间 ISO */
  lastSyncAt?: string
  lastError?: string
  eventCount?: number
  /** 命中单源实例上限，只导入了部分事件 */
  truncated?: boolean
  /** 被用户「忽略此次」的实例 key（uid:startISO） */
  hidden?: string[]
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
  sources: CalendarSource[]
  settings: Settings
  /** 本次启动发生迁移时带旧版本号，渲染进程据此给一次性提示 */
  migratedFrom?: number | null
}

/** 单次订阅同步的结果 */
export interface SyncResult {
  ok: boolean
  sourceId: string
  sourceName: string
  added: number
  removed: number
  /** 命中单源实例上限，结果被截断 */
  truncated: boolean
  error?: string
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

  /* 日历订阅 */
  addSource(input: { name: string; url: string; color?: EventColor }): Promise<{
    source?: CalendarSource
    result: SyncResult
  }>
  removeSource(id: string): Promise<void>
  syncSources(id?: string): Promise<SyncResult[]>
  hideInstance(sourceId: string, key: string): Promise<void>

  onDataChanged(cb: (data: AppData) => void): () => void
  onQuickAdd(cb: () => void): () => void
  onOpenEvent(cb: (id: string) => void): () => void
  onMigrated(cb: (fromVersion: number) => void): () => void
}

declare global {
  interface Window {
    api: AppApi
  }
}
