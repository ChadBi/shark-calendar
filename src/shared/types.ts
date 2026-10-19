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
  /** 服务端分配的单调递增序号，用于增量拉取；undefined 表示尚未同步 */
  serverSeq?: number
  /** 本地有未推送的修改 */
  dirty?: boolean
  /**
   * 本地重复规则（RFC 5545 的 RRULE 值，不含 "RRULE:" 前缀）。
   * 例：`FREQ=WEEKLY;BYDAY=MO`。渲染时展开成虚拟实例，不落盘。
   */
  rrule?: string
  /** 重复规则截止日（本地时间当天 23:59:59），与 rrule 配合使用 */
  rruleUntil?: string
  /**
   * 虚拟实例指向的主事件 id。
   * 带这个字段的事件是渲染时展开出来的，不能单独改，改主事件。
   */
  recurringMasterId?: string
}

/**
 * 无日期待办：只记「要做」，不占日历格子。
 * 可选填截止日；填了就作为全天事件出现在当天日历里。
 */
export interface Todo {
  id: string
  title: string
  done: boolean
  /** 完成时间 ISO，未完成时为空 */
  doneAt?: string
  createdAt: string
  updatedAt: string
  rev: number
  deleted?: boolean
  dirty?: boolean
  /** 截止日（yyyy-MM-dd），为空表示「有空再做」 */
  dueAt?: string
  /** 置顶 */
  pinned?: boolean
  /** 手动排序权重，小的在前 */
  order: number
  notes?: string
  serverSeq?: number
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
  /** 压到桌面层（z-order 最底）：永不遮挡其他窗口，但会被任何窗口遮住 */
  widgetDesktopLayer: boolean
  widgetBounds: WidgetBounds | null
  showWidgetOnStart: boolean
  /** 24 小时制 */
  hour24: boolean

  /* ---------------- 提醒 ---------------- */
  /** 事件开始前弹系统通知 */
  reminderEnabled: boolean
  /** 提前多少分钟提醒 */
  reminderLeadMinutes: number

  /* ---------------- 云同步 ---------------- */
  syncEnabled: boolean
  /** 同步服务地址，例如云函数的 HTTP 触发地址 */
  syncEndpoint: string
  /** 已拉取到的最大序号，增量游标 */
  syncLastSeq: number
  /** 上次成功同步时间 ISO */
  syncLastAt?: string
}

export interface AppData {
  /** 数据结构版本，供未来迁移/同步使用 */
  schemaVersion: number
  /** 本机标识，同步时用于区分来源设备 */
  deviceId: string
  events: CalendarEvent[]
  sources: CalendarSource[]
  /** 无日期待办 */
  todos: Todo[]
  settings: Settings
  /**
   * 已提醒过的实例 key（`eventId@startISO`），防止重启后重复弹窗。
   * 不发给渲染进程，也不参与云同步。
   */
  reminderLog?: string[]
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

/* ------------------------------------------------------------ 云同步 */

/** 与服务端交换的单条记录 */
export interface SyncWireRecord {
  id: string
  payload: CalendarEvent
  /** 毫秒时间戳，冲突时按它取新 */
  updatedAt: number
  deleted: boolean
  /** 服务端分配，客户端只读 */
  seq?: number
}

export interface SyncPullResponse {
  serverSeq: number
  records: SyncWireRecord[]
}

export interface SyncOutcome {
  ok: boolean
  pushed: number
  pulled: number
  applied: number
  conflicts: number
  error?: string
  at?: string
}

export interface SyncStatus {
  enabled: boolean
  hasToken: boolean
  endpoint: string
  lastSeq: number
  lastAt?: string
  /** 本地待推送条数 */
  pending: number
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

  /* 云同步 */
  syncNow(): Promise<SyncOutcome>
  getSyncStatus(): Promise<SyncStatus>
  setSyncToken(token: string): Promise<void>

  /* 待办 */
  addTodo(input: { title: string; dueAt?: string; notes?: string }): Promise<Todo>
  updateTodo(id: string, patch: Partial<Pick<Todo, 'title' | 'done' | 'dueAt' | 'pinned' | 'order' | 'notes'>>): Promise<Todo | null>
  deleteTodo(id: string): Promise<void>
  reorderTodos(ids: string[]): Promise<void>

  /* 提醒 */
  testNotification(): Promise<boolean>

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
