import { create } from 'zustand'
import type { CalendarEvent, EventColor, Settings, ViewMode } from '../../shared/types'
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
}

interface State {
  ready: boolean
  events: CalendarEvent[]
  settings: Settings
  view: ViewMode
  cursor: Date
  editing: EditorDraft | null
  settingsOpen: boolean
  quickAddOpen: boolean
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
}

let toastTimer: ReturnType<typeof setTimeout> | null = null

export const useApp = create<State>()((set, get) => ({
  ready: false,
  events: [],
  settings: DEFAULT_SETTINGS,
  view: 'month',
  cursor: new Date(),
  editing: null,
  settingsOpen: false,
  quickAddOpen: false,
  toast: null,

  init: async () => {
    const data = await window.api.getData()
    set({
      ready: true,
      events: data.events,
      settings: data.settings,
      view: data.settings.defaultView ?? 'month'
    })
    window.api.onDataChanged((d) => set({ events: d.events, settings: d.settings }))
    window.api.onQuickAdd(() => set({ quickAddOpen: true }))
    window.api.onOpenEvent((id) => {
      const ev = get().events.find((e) => e.id === id)
      if (ev) get().openEdit(ev)
    })
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
        notes: ev.notes
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
    toastTimer = setTimeout(() => set({ toast: null }), 1800)
  }
}))
