import { contextBridge, ipcRenderer } from 'electron'
import type { AppApi, AppData, CalendarEvent, Settings } from '../shared/types'

const api: AppApi = {
  getData: () => ipcRenderer.invoke('data:get'),
  upsertEvent: (input) => ipcRenderer.invoke('events:upsert', input),
  deleteEvent: (id) => ipcRenderer.invoke('events:delete', id),
  importEvents: (events: CalendarEvent[]) => ipcRenderer.invoke('events:import', events),
  patchSettings: (patch: Partial<Settings>) => ipcRenderer.invoke('settings:patch', patch),
  toggleWidget: (force?: boolean) => ipcRenderer.invoke('widget:toggle', force),
  setWidgetOpacity: (value: number) => ipcRenderer.invoke('widget:opacity', value),
  setWidgetPinned: (pinned: boolean) => ipcRenderer.invoke('widget:pin', pinned),
  setWidgetHeight: (height: number) => ipcRenderer.invoke('widget:height', height),
  openMain: () => ipcRenderer.invoke('app:openMain'),
  openEvent: (id: string) => ipcRenderer.invoke('app:openEvent', id),
  quit: () => ipcRenderer.invoke('app:quit'),
  openDataFolder: () => ipcRenderer.invoke('app:dataFolder'),

  onDataChanged: (cb: (data: AppData) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, data: AppData): void => cb(data)
    ipcRenderer.on('data:changed', listener)
    return () => ipcRenderer.removeListener('data:changed', listener)
  },

  onQuickAdd: (cb: () => void) => {
    const listener = (): void => cb()
    ipcRenderer.on('app:quick-add', listener)
    return () => ipcRenderer.removeListener('app:quick-add', listener)
  },

  onOpenEvent: (cb: (id: string) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, id: string): void => cb(id)
    ipcRenderer.on('app:open-event', listener)
    return () => ipcRenderer.removeListener('app:open-event', listener)
  }
}

contextBridge.exposeInMainWorld('api', api)
