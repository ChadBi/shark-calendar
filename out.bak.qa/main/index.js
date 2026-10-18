"use strict";
const electron = require("electron");
const path = require("path");
const fs = require("fs");
const DEFAULT_SETTINGS = {
  closeToTray: true,
  minimizeToTray: false,
  launchAtLogin: false,
  weekStartsOn: 1,
  defaultView: "month",
  widgetOpacity: 0.92,
  widgetAlwaysOnTop: true,
  widgetBounds: null,
  showWidgetOnStart: false,
  hour24: true
};
const SCHEMA_VERSION = 1;
function emptyData() {
  return { schemaVersion: SCHEMA_VERSION, events: [], settings: { ...DEFAULT_SETTINGS } };
}
class Store {
  filePath;
  saveTimer = null;
  data;
  constructor() {
    const dir = electron.app.getPath("userData");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this.filePath = path.join(dir, "daily-list.json");
    this.data = this.load();
  }
  load() {
    if (!fs.existsSync(this.filePath)) return emptyData();
    try {
      const raw = fs.readFileSync(this.filePath, "utf-8");
      const parsed = JSON.parse(raw);
      return {
        schemaVersion: parsed.schemaVersion ?? SCHEMA_VERSION,
        events: Array.isArray(parsed.events) ? parsed.events : [],
        settings: { ...DEFAULT_SETTINGS, ...parsed.settings ?? {} }
      };
    } catch (err) {
      try {
        fs.copyFileSync(this.filePath, `${this.filePath}.corrupt-${Date.now()}.bak`);
      } catch {
      }
      console.error("[store] 数据文件解析失败，已备份并重置：", err);
      return emptyData();
    }
  }
  get settings() {
    return this.data.settings;
  }
  /** 防抖落盘，避免高频写入 */
  save() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveNow(), 180);
  }
  saveNow() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    const tmp = `${this.filePath}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), "utf-8");
      fs.renameSync(tmp, this.filePath);
    } catch (err) {
      console.error("[store] 写入失败：", err);
    }
  }
  upsertEvent(input) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const existing = input.id ? this.data.events.find((e) => e.id === input.id) : void 0;
    if (existing) {
      Object.assign(existing, {
        title: input.title,
        start: input.start,
        end: input.end,
        allDay: input.allDay ?? existing.allDay,
        color: input.color ?? existing.color,
        notes: input.notes ?? existing.notes,
        updatedAt: now,
        rev: existing.rev + 1
      });
      this.save();
      return existing;
    }
    const created = {
      id: input.id ?? crypto.randomUUID(),
      title: input.title,
      start: input.start,
      end: input.end,
      allDay: input.allDay ?? false,
      color: input.color ?? "blue",
      notes: input.notes,
      createdAt: now,
      updatedAt: now,
      rev: 1,
      deleted: false
    };
    this.data.events.push(created);
    this.save();
    return created;
  }
  deleteEvent(id) {
    const target = this.data.events.find((e) => e.id === id);
    if (!target) return;
    target.deleted = true;
    target.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    target.rev += 1;
    this.save();
  }
  importEvents(events) {
    let added = 0;
    for (const e of events) {
      if (!e?.id || !e?.start || !e?.end) continue;
      if (this.data.events.some((x) => x.id === e.id)) continue;
      this.data.events.push({ ...e, deleted: e.deleted ?? false });
      added++;
    }
    this.save();
    return added;
  }
  patchSettings(patch) {
    this.data.settings = { ...this.data.settings, ...patch };
    this.save();
    return this.data.settings;
  }
  /** 渲染进程可见的数据：过滤掉软删除的墓碑 */
  snapshot() {
    return {
      schemaVersion: this.data.schemaVersion,
      events: this.data.events.filter((e) => !e.deleted),
      settings: this.data.settings
    };
  }
  get dataDir() {
    return electron.app.getPath("userData");
  }
}
const isDev = !electron.app.isPackaged;
if (process.env["DAILY_LIST_DISABLE_GPU"] === "1") {
  electron.app.disableHardwareAcceleration();
}
let mainWindow = null;
let widgetWindow = null;
let tray = null;
let isQuitting = false;
let store;
let widgetMoveTimer = null;
const WIDGET_W = 340;
const WIDGET_H = 440;
function assetPath(name) {
  const candidates = [
    path.join(__dirname, "../../resources", name),
    path.join(process.resourcesPath ?? "", name)
  ];
  for (const p of candidates) if (p && fs.existsSync(p)) return p;
  return candidates[0];
}
function appIcon() {
  const p = assetPath("icon.png");
  return fs.existsSync(p) ? electron.nativeImage.createFromPath(p) : electron.nativeImage.createEmpty();
}
function preloadPath() {
  return path.join(__dirname, "../preload/index.js");
}
function loadPage(win, page) {
  const devUrl = process.env["ELECTRON_RENDERER_URL"];
  if (isDev && devUrl) {
    win.loadURL(`${devUrl}/${page}.html`);
  } else {
    win.loadFile(path.join(__dirname, `../renderer/${page}.html`));
  }
}
function defaultWidgetBounds() {
  const { workArea } = electron.screen.getPrimaryDisplay();
  return {
    x: workArea.x + workArea.width - WIDGET_W - 24,
    y: workArea.y + 24,
    width: WIDGET_W,
    height: WIDGET_H
  };
}
function createMainWindow() {
  const win = new electron.BrowserWindow({
    width: 1180,
    height: 790,
    minWidth: 940,
    minHeight: 600,
    show: false,
    title: "日程",
    backgroundColor: "#f6f7f9",
    autoHideMenuBar: true,
    icon: appIcon(),
    webPreferences: {
      preload: preloadPath(),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.once("ready-to-show", () => win.show());
  win.on("close", (e) => {
    if (!isQuitting && store.settings.closeToTray) {
      e.preventDefault();
      win.hide();
    }
  });
  win.on("minimize", () => {
    if (store.settings.minimizeToTray) win.hide();
  });
  win.on("closed", () => {
    mainWindow = null;
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    electron.shell.openExternal(url);
    return { action: "deny" };
  });
  loadPage(win, "index");
  return win;
}
function showMain() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createMainWindow();
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}
function createWidgetWindow() {
  const bounds = store.settings.widgetBounds ?? defaultWidgetBounds();
  const win = new electron.BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: store.settings.widgetAlwaysOnTop,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: preloadPath(),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.setAlwaysOnTop(store.settings.widgetAlwaysOnTop, "floating");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.once("ready-to-show", () => win.showInactive());
  const persistBounds = () => {
    if (widgetMoveTimer) clearTimeout(widgetMoveTimer);
    widgetMoveTimer = setTimeout(() => {
      if (!widgetWindow || widgetWindow.isDestroyed()) return;
      const b = widgetWindow.getBounds();
      store.patchSettings({ widgetBounds: b });
    }, 300);
  };
  win.on("moved", persistBounds);
  win.on("closed", () => {
    widgetWindow = null;
  });
  loadPage(win, "widget");
  return win;
}
function showWidget() {
  if (!widgetWindow || widgetWindow.isDestroyed()) {
    widgetWindow = createWidgetWindow();
  }
  widgetWindow.showInactive();
}
function hideWidget() {
  widgetWindow?.hide();
}
function toggleWidget(force) {
  const visible = !!widgetWindow && !widgetWindow.isDestroyed() && widgetWindow.isVisible();
  const next = typeof force === "boolean" ? force : !visible;
  if (next) showWidget();
  else hideWidget();
  return next;
}
function buildTrayMenu() {
  if (!tray) return;
  const s = store.settings;
  const widgetVisible = !!widgetWindow && !widgetWindow.isDestroyed() && widgetWindow.isVisible();
  const menu = electron.Menu.buildFromTemplate([
    { label: "打开日程", click: () => showMain() },
    { type: "separator" },
    {
      label: widgetVisible ? "隐藏桌面悬浮窗" : "显示桌面悬浮窗",
      accelerator: "CommandOrControl+Alt+D",
      click: () => toggleWidget()
    },
    {
      label: "新建日程",
      accelerator: "CommandOrControl+Alt+N",
      click: () => quickAdd()
    },
    { type: "separator" },
    {
      label: "开机自动启动",
      type: "checkbox",
      checked: s.launchAtLogin,
      click: (item) => {
        store.patchSettings({ launchAtLogin: item.checked });
        electron.app.setLoginItemSettings({ openAtLogin: item.checked });
        broadcast();
      }
    },
    { label: "打开数据文件夹", click: () => electron.shell.openPath(store.dataDir) },
    { type: "separator" },
    { label: "退出", click: () => quitApp() }
  ]);
  tray.setContextMenu(menu);
  tray.setToolTip("日程");
}
function createTray() {
  const icon = appIcon().resize({ width: 20, height: 20 });
  tray = new electron.Tray(icon.isEmpty() ? appIcon() : icon);
  tray.on("click", () => showMain());
  tray.on("double-click", () => showMain());
  buildTrayMenu();
}
function quickAdd() {
  showMain();
  mainWindow?.webContents.send("app:quick-add");
}
function quitApp() {
  isQuitting = true;
  store.saveNow();
  electron.app.quit();
}
function broadcast() {
  const data = store.snapshot();
  for (const w of electron.BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send("data:changed", data);
  }
  buildTrayMenu();
}
function registerIpc() {
  electron.ipcMain.handle("data:get", () => store.snapshot());
  electron.ipcMain.handle("events:upsert", (_e, input) => {
    const ev = store.upsertEvent(input);
    broadcast();
    return ev;
  });
  electron.ipcMain.handle("events:delete", (_e, id) => {
    store.deleteEvent(id);
    broadcast();
  });
  electron.ipcMain.handle("events:import", (_e, events) => {
    const n = store.importEvents(events);
    broadcast();
    return n;
  });
  electron.ipcMain.handle("settings:patch", (_e, patch) => {
    const next = store.patchSettings(patch);
    if (patch.launchAtLogin !== void 0) {
      electron.app.setLoginItemSettings({ openAtLogin: !!patch.launchAtLogin });
    }
    if (patch.widgetAlwaysOnTop !== void 0 && widgetWindow && !widgetWindow.isDestroyed()) {
      widgetWindow.setAlwaysOnTop(!!patch.widgetAlwaysOnTop, "floating");
    }
    broadcast();
    return next;
  });
  electron.ipcMain.handle("widget:toggle", (_e, force) => {
    const state = toggleWidget(force);
    buildTrayMenu();
    return state;
  });
  electron.ipcMain.handle("widget:opacity", (_e, value) => {
    const v = Math.min(1, Math.max(0.35, Number(value) || 0.92));
    store.patchSettings({ widgetOpacity: v });
    broadcast();
  });
  electron.ipcMain.handle("widget:pin", (_e, pinned) => {
    store.patchSettings({ widgetAlwaysOnTop: !!pinned });
    widgetWindow?.setAlwaysOnTop(!!pinned, "floating");
    broadcast();
  });
  electron.ipcMain.handle("widget:height", (_e, h) => {
    if (!widgetWindow || widgetWindow.isDestroyed()) return;
    const b = widgetWindow.getBounds();
    const height = Math.min(720, Math.max(52, Math.round(Number(h) || WIDGET_H)));
    widgetWindow.setBounds({ x: b.x, y: b.y, width: b.width, height });
  });
  electron.ipcMain.handle("app:openMain", () => showMain());
  electron.ipcMain.handle("app:openEvent", (_e, id) => {
    showMain();
    if (!mainWindow) return;
    const deliver = () => mainWindow?.webContents.send("app:open-event", id);
    if (mainWindow.webContents.isLoading()) {
      mainWindow.webContents.once("did-finish-load", deliver);
    } else {
      setTimeout(deliver, 100);
    }
  });
  electron.ipcMain.handle("app:quit", () => quitApp());
  electron.ipcMain.handle("app:dataFolder", () => electron.shell.openPath(store.dataDir));
}
const gotLock = electron.app.requestSingleInstanceLock();
if (!gotLock) {
  electron.app.quit();
} else {
  electron.app.on("second-instance", () => showMain());
  electron.app.whenReady().then(() => {
    electron.app.setAppUserModelId("com.dailylist.app");
    store = new Store();
    registerIpc();
    mainWindow = createMainWindow();
    createTray();
    if (store.settings.launchAtLogin) electron.app.setLoginItemSettings({ openAtLogin: true });
    if (store.settings.showWidgetOnStart) showWidget();
    const shortcuts = [
      ["CommandOrControl+Alt+N", () => quickAdd()],
      ["CommandOrControl+Alt+D", () => toggleWidget()]
    ];
    for (const [accel, fn] of shortcuts) {
      try {
        const ok = electron.globalShortcut.register(accel, fn);
        if (!ok) console.warn(`[shortcut] 注册失败（可能被占用）：${accel}`);
      } catch (err) {
        console.warn(`[shortcut] 注册异常：${accel}`, err);
      }
    }
    electron.app.on("activate", () => showMain());
  });
  electron.app.on("window-all-closed", () => {
    if (process.platform !== "darwin" && !store?.settings.closeToTray) electron.app.quit();
  });
  electron.app.on("before-quit", () => {
    isQuitting = true;
    store?.saveNow();
  });
  electron.app.on("will-quit", () => {
    electron.globalShortcut.unregisterAll();
  });
}
