import { create } from 'zustand'
import type {
  CalendarEvent,
  CalendarSource,
  EventColor,
  Settings,
  SyncResult,
  Todo,
  ViewMode
} from '../../shared/types'
import { DEFAULT_SETTINGS } from '../../shared/defaults'
import { shiftCursor, startOfDay } from './lib/date'

export interface EditorDraft {
  id?: string
  title: string
  start: Date
  end: Date
  allDay: boolean
  color: EventColor
  notes?: string
  /** 订阅事件：只读，不能直接改 */
  readOnly?: boolean
  sourceId?: string
  externalId?: string
  location?: string
  /** 本地重复规则（RRULE 值），空表示不重复 */
  rrule?: string
  /** 重复截止日 yyyy-MM-dd */
  rruleUntil?: string
  /** 虚拟实例：改它等于改主事件 */
  recurringMasterId?: string
}

interface State {
  ready: boolean
  events: CalendarEvent[]
  sources: CalendarSource[]
  todos: Todo[]
  settings: Settings
  view: ViewMode
  cursor: Date
  editing: EditorDraft | null
  settingsOpen: boolean
  quickAddOpen: boolean
  syncing: boolean
  toast: string | null

  init: () => Promise<void>
  setView: (v: ViewMode) => void
  setCursor: (d: Date) => void
  step: (dir: 1 | -1) => void
  goToday: () => void
  openNew: (start?: Date, allDay?: boolean) => void
  openEdit: (ev: CalendarEvent) => void
  closeEditor: () => void
  saveEvent: (draft: EditorDraft) => Promise<void>
  /** 拖拽改时间：只改起止，其余字段原样保留 */
  rescheduleEvent: (ev: CalendarEvent, start: Date, end: Date) => Promise<void>
  removeEvent: (id: string) => Promise<void>
  patchSettings: (p: Partial<Settings>) => Promise<void>
  setSettingsOpen: (b: boolean) => void
  setQuickAddOpen: (b: boolean) => void
  showToast: (msg: string) => void

  addSource: (name: string, url: string) => Promise<SyncResult | null>
  removeSource: (id: string) => Promise<void>
  syncSources: (id?: string) => Promise<SyncResult[]>
  hideInstance: (sourceId: string, key: string) => Promise<void>

  /* 待办 */
  addTodo: (title: string, dueAt?: string) => Promise<void>
  toggleTodo: (id: string, done: boolean) => Promise<void>
  updateTodo: (id: string, patch: Partial<Todo>) => Promise<void>
  deleteTodo: (id: string) => Promise<void>
  reorderTodos: (ids: string[]) => Promise<void>
}

let toastTimer: ReturnType<typeof setTimeout> | null = null

export const useApp = create<State>()((set, get) => ({
  ready: false,
  events: [],
  sources: [],
  todos: [],
  settings: DEFAULT_SETTINGS,
  view: 'month',
  cursor: new Date(),
  editing: null,
  settingsOpen: false,
  quickAddOpen: false,
  syncing: false,
  toast: null,

  init: async () => {
    const data = await window.api.getData()
    set({
      ready: true,
      events: data.events,
      sources: data.sources ?? [],
      todos: data.todos ?? [],
      settings: data.settings,
      view: data.settings.defaultView ?? 'month'
    })
    window.api.onDataChanged((d) =>
      set({
        events: d.events,
        sources: d.sources ?? [],
        todos: d.todos ?? [],
        settings: d.settings
      })
    )
    window.api.onQuickAdd(() => set({ quickAddOpen: true }))
    window.api.onOpenEvent((id) => {
      const ev = get().events.find((e) => e.id === id)
      if (ev) get().openEdit(ev)
    })
    // 迁移提示从数据里读，不依赖主进程 push（push 会和渲染进程的监听注册抢时序）
    if (data.migratedFrom != null) {
      setTimeout(() => {
        get().showToast('悬浮窗已改为普通窗口，不再遮挡其他应用')
      }, 600)
    }
  },

  setView: (v) => set({ view: v }),
  setCursor: (d) => set({ cursor: d }),
  step: (dir) => set((s) => ({ cursor: shiftCursor(s.cursor, s.view, dir) })),
  goToday: () => set({ cursor: new Date() }),

  openNew: (start, allDay = false) => {
    const base = start ?? new Date()
    const s = allDay ? startOfDay(base) : base
    const e = allDay
      ? new Date(startOfDay(base).getTime() + 86400000)
      : new Date(s.getTime() + 60 * 60000)
    set({
      editing: { title: '', start: s, end: e, allDay, color: 'blue' }
    })
  },

  openEdit: (ev) => {
    // 虚拟实例本身不带规则，要回主事件取，否则编辑弹窗会显示「不重复」，
    // 一保存就把整个系列的规则清掉了
    const master = ev.recurringMasterId
      ? get().events.find((e) => e.id === ev.recurringMasterId)
      : undefined

    set({
      editing: {
        id: ev.id,
        title: ev.title,
        start: new Date(ev.start),
        end: new Date(ev.end),
        allDay: ev.allDay,
        color: ev.color,
        notes: ev.notes,
        readOnly: ev.readOnly,
        sourceId: ev.sourceId,
        externalId: ev.externalId,
        location: ev.location,
        rrule: master?.rrule ?? ev.rrule,
        rruleUntil: (master?.rruleUntil ?? ev.rruleUntil)?.slice(0, 10),
        recurringMasterId: ev.recurringMasterId
      }
    })
  },

  closeEditor: () => set({ editing: null }),

  saveEvent: async (draft) => {
    await window.api.upsertEvent({
      // 虚拟实例没有自己的记录，编辑时落到主事件上
      id: draft.recurringMasterId ?? draft.id,
      title: draft.title.trim() || '未命名事件',
      start: draft.start.toISOString(),
      end: draft.end.toISOString(),
      allDay: draft.allDay,
      color: draft.color,
      notes: draft.notes,
      rrule: draft.rrule,
      rruleUntil: draft.rruleUntil
    })
    set({ editing: null })
    get().showToast(draft.id ? '已更新' : '已创建')
  },

  removeEvent: async (id) => {
    await window.api.deleteEvent(id)
    set({ editing: null })
    get().showToast('已删除')
  },

  rescheduleEvent: async (ev, start, end) => {
    await window.api.upsertEvent({
      id: ev.id,
      title: ev.title,
      start: start.toISOString(),
      end: end.toISOString(),
      allDay: ev.allDay,
      color: ev.color,
      notes: ev.notes,
      rrule: ev.rrule,
      rruleUntil: ev.rruleUntil
    })
  },

  patchSettings: async (p) => {
    const next = await window.api.patchSettings(p)
    set({ settings: next })
  },

  setSettingsOpen: (b) => set({ settingsOpen: b }),
  setQuickAddOpen: (b) => set({ quickAddOpen: b }),

  showToast: (msg) => {
    set({ toast: msg })
    if (toastTimer) clearTimeout(toastTimer)
    toastTimer = setTimeout(() => set({ toast: null }), 2200)
  },

  /* ---------------------------------------------------------- 订阅 */

  addSource: async (name, url) => {
    set({ syncing: true })
    try {
      const { result } = await window.api.addSource({ name, url })
      get().showToast(
        result.ok ? `已添加订阅，导入 ${result.added} 条事件` : `订阅失败：${result.error ?? '未知错误'}`
      )
      return result
    } catch (err) {
      get().showToast(`订阅失败：${err instanceof Error ? err.message : String(err)}`)
      return null
    } finally {
      set({ syncing: false })
    }
  },

  removeSource: async (id) => {
    await window.api.removeSource(id)
    get().showToast('已移除订阅，其事件一并删除')
  },

  syncSources: async (id) => {
    set({ syncing: true })
    try {
      const results = await window.api.syncSources(id)
      const failed = results.filter((r) => !r.ok)
      if (failed.length > 0) {
        get().showToast(`${failed.length} 个订阅同步失败：${failed[0].error ?? ''}`)
      } else if (results.length > 0) {
        const total = results.reduce((n, r) => n + r.added, 0)
        get().showToast(`同步完成，共 ${total} 条事件`)
      }
      return results
    } finally {
      set({ syncing: false })
    }
  },

  hideInstance: async (sourceId, key) => {
    await window.api.hideInstance(sourceId, key)
    get().showToast('已忽略此次')
  },

  /* ---------------------------------------------------------- 待办 */

  addTodo: async (title, dueAt) => {
    const text = title.trim()
    if (!text) return
    await window.api.addTodo({ title: text, dueAt })
  },

  toggleTodo: async (id, done) => {
    await window.api.updateTodo(id, { done })
  },

  updateTodo: async (id, patch) => {
    await window.api.updateTodo(id, patch)
  },

  deleteTodo: async (id) => {
    await window.api.deleteTodo(id)
  },

  reorderTodos: async (ids) => {
    await window.api.reorderTodos(ids)
  }
}))
