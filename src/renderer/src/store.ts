import { create } from 'zustand'
import type {
  CalendarEvent,
  CalendarSource,
  EventColor,
  Settings,
  SyncResult,
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
}

interface State {
  ready: boolean
  events: CalendarEvent[]
  sources: CalendarSource[]
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
  removeEvent: (id: string) => Promise<void>
  patchSettings: (p: Partial<Settings>) => Promise<void>
  setSettingsOpen: (b: boolean) => void
  setQuickAddOpen: (b: boolean) => void
  showToast: (msg: string) => void

  addSource: (name: string, url: string) => Promise<SyncResult | null>
  removeSource: (id: string) => Promise<void>
  syncSources: (id?: string) => Promise<SyncResult[]>
  hideInstance: (sourceId: string, key: string) => Promise<void>
}

let toastTimer: ReturnType<typeof setTimeout> | null = null

export const useApp = create<State>()((set, get) => ({
  ready: false,
  events: [],
  sources: [],
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
      settings: data.settings,
      view: data.settings.defaultView ?? 'month'
    })
    window.api.onDataChanged((d) =>
      set({ events: d.events, sources: d.sources ?? [], settings: d.settings })
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
        location: ev.location
      }
    })
  },

  closeEditor: () => set({ editing: null }),

  saveEvent: async (draft) => {
    await window.api.upsertEvent({
      id: draft.id,
      title: draft.title.trim() || '未命名日程',
      start: draft.start.toISOString(),
      end: draft.end.toISOString(),
      allDay: draft.allDay,
      color: draft.color,
      notes: draft.notes
    })
    set({ editing: null })
    get().showToast(draft.id ? '已更新' : '已创建')
  },

  removeEvent: async (id) => {
    await window.api.deleteEvent(id)
    set({ editing: null })
    get().showToast('已删除')
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
        result.ok ? `已添加订阅，导入 ${result.added} 条日程` : `订阅失败：${result.error ?? '未知错误'}`
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
    get().showToast('已移除订阅，其日程一并删除')
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
        get().showToast(`同步完成，共 ${total} 条日程`)
      }
      return results
    } finally {
      set({ syncing: false })
    }
  },

  hideInstance: async (sourceId, key) => {
    await window.api.hideInstance(sourceId, key)
    get().showToast('已忽略此次')
  }
}))
