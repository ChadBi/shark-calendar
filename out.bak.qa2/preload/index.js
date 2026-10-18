"use strict";
const electron = require("electron");
const api = {
  getData: () => electron.ipcRenderer.invoke("data:get"),
  upsertEvent: (input) => electron.ipcRenderer.invoke("events:upsert", input),
  deleteEvent: (id) => electron.ipcRenderer.invoke("events:delete", id),
  importEvents: (events) => electron.ipcRenderer.invoke("events:import", events),
  patchSettings: (patch) => electron.ipcRenderer.invoke("settings:patch", patch),
  toggleWidget: (force) => electron.ipcRenderer.invoke("widget:toggle", force),
  setWidgetOpacity: (value) => electron.ipcRenderer.invoke("widget:opacity", value),
  setWidgetPinned: (pinned) => electron.ipcRenderer.invoke("widget:pin", pinned),
  setWidgetHeight: (height) => electron.ipcRenderer.invoke("widget:height", height),
  openMain: () => electron.ipcRenderer.invoke("app:openMain"),
  openEvent: (id) => electron.ipcRenderer.invoke("app:openEvent", id),
  quit: () => electron.ipcRenderer.invoke("app:quit"),
  openDataFolder: () => electron.ipcRenderer.invoke("app:dataFolder"),
  addSource: (input) => electron.ipcRenderer.invoke("sources:add", input),
  removeSource: (id) => electron.ipcRenderer.invoke("sources:remove", id),
  syncSources: (id) => electron.ipcRenderer.invoke("sources:sync", id),
  hideInstance: (sourceId, key) => electron.ipcRenderer.invoke("sources:hideInstance", sourceId, key),
  onDataChanged: (cb) => {
    const listener = (_e, data) => cb(data);
    electron.ipcRenderer.on("data:changed", listener);
    return () => electron.ipcRenderer.removeListener("data:changed", listener);
  },
  onQuickAdd: (cb) => {
    const listener = () => cb();
    electron.ipcRenderer.on("app:quick-add", listener);
    return () => electron.ipcRenderer.removeListener("app:quick-add", listener);
  },
  onOpenEvent: (cb) => {
    const listener = (_e, id) => cb(id);
    electron.ipcRenderer.on("app:open-event", listener);
    return () => electron.ipcRenderer.removeListener("app:open-event", listener);
  },
  onMigrated: (cb) => {
    const listener = (_e, v) => cb(v);
    electron.ipcRenderer.on("app:migrated", listener);
    return () => electron.ipcRenderer.removeListener("app:migrated", listener);
  }
};
electron.contextBridge.exposeInMainWorld("api", api);
