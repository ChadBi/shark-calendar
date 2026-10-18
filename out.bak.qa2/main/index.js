"use strict";
const electron = require("electron");
const path = require("path");
const fs = require("fs");
const rrule = require("rrule");
const DEFAULT_SETTINGS = {
  closeToTray: true,
  minimizeToTray: false,
  launchAtLogin: false,
  weekStartsOn: 1,
  defaultView: "month",
  widgetOpacity: 0.92,
  // 默认不置顶：悬浮窗和普通窗口同级，切到别的应用时会被自然遮挡，
  // 不会一直压在其他窗口上面碍事。需要常驻最前时可在设置里打开。
  widgetAlwaysOnTop: false,
  widgetBounds: null,
  showWidgetOnStart: false,
  hour24: true
};
const SCHEMA_VERSION = 2;
function emptyData() {
  return { schemaVersion: SCHEMA_VERSION, events: [], sources: [], settings: { ...DEFAULT_SETTINGS } };
}
class Store {
  filePath;
  saveTimer = null;
  /** 本次启动是否从旧版本迁移而来，用于给用户一次性提示 */
  migratedFrom = null;
  data;
  constructor() {
    const dir = electron.app.getPath("userData");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this.filePath = path.join(dir, "daily-list.json");
    this.data = this.load();
    if (this.migratedFrom !== null) this.saveNow();
  }
  load() {
    if (!fs.existsSync(this.filePath)) return emptyData();
    try {
      const raw = fs.readFileSync(this.filePath, "utf-8");
      const parsed = JSON.parse(raw);
      const version = parsed.schemaVersion ?? 1;
      let settings = { ...DEFAULT_SETTINGS, ...parsed.settings ?? {} };
      if (version < 2) {
        settings = { ...settings, widgetAlwaysOnTop: false };
        this.migratedFrom = version;
      }
      return {
        schemaVersion: SCHEMA_VERSION,
        events: Array.isArray(parsed.events) ? parsed.events : [],
        sources: Array.isArray(parsed.sources) ? parsed.sources : [],
        settings
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
  /* ------------------------------------------------------------ 订阅源 */
  upsertSource(input) {
    const existing = input.id ? this.data.sources.find((s) => s.id === input.id) : void 0;
    if (existing) {
      existing.name = input.name;
      existing.url = input.url;
      if (input.color) existing.color = input.color;
      if (input.enabled !== void 0) existing.enabled = input.enabled;
      this.save();
      return existing;
    }
    const created = {
      id: crypto.randomUUID(),
      name: input.name,
      url: input.url,
      color: input.color ?? "violet",
      enabled: input.enabled ?? true,
      hidden: []
    };
    this.data.sources.push(created);
    this.save();
    return created;
  }
  removeSource(id) {
    this.data.sources = this.data.sources.filter((s) => s.id !== id);
    this.data.events = this.data.events.filter((e) => e.sourceId !== id);
    this.save();
  }
  /** 用最新拉取结果整体替换某个源的事件，避免重复堆积 */
  replaceSourceEvents(sourceId, events) {
    const before = this.data.events.filter((e) => e.sourceId === sourceId && !e.deleted).length;
    this.data.events = this.data.events.filter((e) => e.sourceId !== sourceId);
    this.data.events.push(...events);
    this.save();
    return { before, after: events.length };
  }
  /** 「忽略此次」：把某个重复实例加入黑名单，下次同步不再生成 */
  hideInstance(sourceId, key) {
    const src = this.data.sources.find((s) => s.id === sourceId);
    if (!src) return;
    src.hidden = Array.from(/* @__PURE__ */ new Set([...src.hidden ?? [], key]));
    this.data.events = this.data.events.filter(
      (e) => !(e.sourceId === sourceId && `${e.externalId}:${e.start}` === key)
    );
    this.save();
  }
  /** 渲染进程可见的数据：过滤掉软删除的墓碑 */
  snapshot() {
    return {
      schemaVersion: this.data.schemaVersion,
      events: this.data.events.filter((e) => !e.deleted),
      sources: this.data.sources,
      settings: this.data.settings
    };
  }
  get dataDir() {
    return electron.app.getPath("userData");
  }
}
function unfold(text) {
  const raw = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const out = [];
  for (const line of raw) {
    if ((line.startsWith(" ") || line.startsWith("	")) && out.length > 0) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}
function splitProp(line) {
  let inQuote = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuote = !inQuote;
    else if (ch === ":" && !inQuote) {
      colon = i;
      break;
    }
  }
  if (colon <= 0) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const segs = head.split(";");
  const name = segs[0].trim().toUpperCase();
  const params = {};
  for (const seg of segs.slice(1)) {
    const eq = seg.indexOf("=");
    if (eq > 0) {
      params[seg.slice(0, eq).trim().toUpperCase()] = seg.slice(eq + 1).trim().replace(/^"|"$/g, "");
    }
  }
  return { name, params, value };
}
function unescapeText(v) {
  return v.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\").trim();
}
function tzOffsetMinutes(date, timeZone) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
  const p = {};
  for (const part of dtf.formatToParts(date)) p[part.type] = part.value;
  const asUTC = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour) % 24,
    Number(p.minute),
    Number(p.second)
  );
  return Math.round((asUTC - date.getTime()) / 6e4);
}
function zonedToUtc(y, mo, d, h, mi, s, tzid) {
  const wall = Date.UTC(y, mo - 1, d, h, mi, s);
  try {
    let offset = tzOffsetMinutes(new Date(wall), tzid);
    let utc = wall - offset * 6e4;
    const offset2 = tzOffsetMinutes(new Date(utc), tzid);
    if (offset2 !== offset) utc = wall - offset2 * 6e4;
    return new Date(utc);
  } catch {
    return new Date(y, mo - 1, d, h, mi, s);
  }
}
function parseDateValue(value, params) {
  const v = value.trim();
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!m[4]) return { date: new Date(year, month - 1, day, 0, 0, 0), allDay: true };
  const h = Number(m[4]);
  const mi = Number(m[5]);
  const s = Number(m[6]);
  if (m[7] === "Z") return { date: new Date(Date.UTC(year, month - 1, day, h, mi, s)), allDay: false };
  const tzid = params["TZID"];
  if (tzid && tzid.toUpperCase() !== "UTC") {
    return { date: zonedToUtc(year, month - 1 + 1, day, h, mi, s, tzid), allDay: false };
  }
  return { date: new Date(year, month - 1, day, h, mi, s), allDay: false };
}
function parseIcs(text) {
  const lines = unfold(text);
  const events = [];
  let cur = null;
  let inAlarm = false;
  for (const line of lines) {
    const upper = line.toUpperCase();
    if (upper.startsWith("BEGIN:VALARM")) {
      inAlarm = true;
      continue;
    }
    if (upper.startsWith("END:VALARM")) {
      inAlarm = false;
      continue;
    }
    if (upper.startsWith("BEGIN:VEVENT")) {
      cur = { exdates: [] };
      continue;
    }
    if (upper.startsWith("END:VEVENT")) {
      if (cur?.start && cur?.end) {
        events.push({
          uid: cur.uid ?? `no-uid-${cur.start.toISOString()}`,
          summary: cur.summary ?? "未命名日程",
          description: cur.description,
          location: cur.location,
          start: cur.start,
          end: cur.end,
          allDay: cur.allDay ?? false,
          rrule: cur.rrule,
          exdates: cur.exdates ?? []
        });
      }
      cur = null;
      continue;
    }
    if (!cur || inAlarm) continue;
    const prop = splitProp(line);
    if (!prop) continue;
    switch (prop.name) {
      case "UID":
        cur.uid = prop.value.trim();
        break;
      case "SUMMARY":
        cur.summary = unescapeText(prop.value);
        break;
      case "DESCRIPTION":
        cur.description = unescapeText(prop.value);
        break;
      case "LOCATION":
        cur.location = unescapeText(prop.value);
        break;
      case "DTSTART": {
        const d = parseDateValue(prop.value, prop.params);
        if (d) {
          cur.start = d.date;
          cur.allDay = d.allDay;
        }
        break;
      }
      case "DTEND": {
        const d = parseDateValue(prop.value, prop.params);
        if (d) cur.end = d.date;
        break;
      }
      case "RRULE":
        cur.rrule = prop.value.trim();
        break;
      case "EXDATE": {
        for (const piece of prop.value.split(",")) {
          const d = parseDateValue(piece, prop.params);
          if (d) cur.exdates.push(d.date);
        }
        break;
      }
    }
  }
  return events;
}
function expandOccurrences(ev, from, to) {
  const durationMs = Math.max(0, ev.end.getTime() - ev.start.getTime());
  if (!ev.rrule) {
    return ev.start >= from && ev.start <= to ? [{ start: ev.start, end: ev.end }] : [];
  }
  try {
    const rule = new rrule.RRule({
      ...rrule.RRule.parseString(ev.rrule),
      dtstart: ev.start
    });
    const exSet = new Set(ev.exdates.map((d) => d.getTime()));
    return rule.between(from, to, true).filter((d) => !exSet.has(d.getTime())).map((d) => ({ start: d, end: new Date(d.getTime() + durationMs) }));
  } catch {
    return ev.start >= from && ev.start <= to ? [{ start: ev.start, end: ev.end }] : [];
  }
}
function normalizeIcsUrl(raw) {
  const url = raw.trim();
  if (/^webcal:\/\//i.test(url)) return url.replace(/^webcal:\/\//i, "https://");
  return url;
}
const MAX_BYTES = 8 * 1024 * 1024;
async function fetchIcs(url) {
  const target = normalizeIcsUrl(url);
  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    throw new Error("链接格式不正确");
  }
  if (!/^https?:$/.test(parsed.protocol)) throw new Error("只支持 http / https / webcal 链接");
  const res = await electron.net.fetch(target, { redirect: "follow" });
  if (!res.ok) throw new Error(`服务器返回 ${res.status}`);
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) throw new Error("日历文件超过 8MB，已拒绝");
  const text = new TextDecoder("utf-8").decode(buf);
  if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error("这不是有效的 iCalendar 文件");
  return text;
}
const RANGE_BACK_DAYS = 60;
const RANGE_FORWARD_DAYS = 365;
const MAX_INSTANCES_PER_SOURCE = 3e3;
async function syncSource(store2, source) {
  const base = {
    sourceId: source.id,
    sourceName: source.name,
    added: 0,
    removed: 0,
    truncated: false
  };
  try {
    const text = await fetchIcs(source.url);
    const parsed = parseIcs(text);
    const from = new Date(Date.now() - RANGE_BACK_DAYS * 864e5);
    const to = new Date(Date.now() + RANGE_FORWARD_DAYS * 864e5);
    const hidden = new Set(source.hidden ?? []);
    const stamp = (/* @__PURE__ */ new Date()).toISOString();
    const events = [];
    let truncated = false;
    for (const ev of parsed) {
      for (const occ of expandOccurrences(ev, from, to)) {
        const key = `${ev.uid}:${occ.start.toISOString()}`;
        if (hidden.has(key)) continue;
        if (events.length >= MAX_INSTANCES_PER_SOURCE) {
          truncated = true;
          break;
        }
        const notes = [ev.location ? `地点：${ev.location}` : "", ev.description ?? ""].filter(Boolean).join("\n").trim();
        events.push({
          id: `${source.id}:${key}`,
          title: ev.summary,
          start: occ.start.toISOString(),
          end: occ.end.toISOString(),
          allDay: ev.allDay,
          color: source.color,
          notes: notes || void 0,
          location: ev.location,
          createdAt: stamp,
          updatedAt: stamp,
          rev: 1,
          sourceId: source.id,
          externalId: ev.uid,
          readOnly: true
        });
      }
      if (truncated) break;
    }
    const { before } = store2.replaceSourceEvents(source.id, events);
    const src = store2.data.sources.find((s) => s.id === source.id);
    if (src) {
      src.lastSyncAt = stamp;
      src.lastError = void 0;
      src.eventCount = events.length;
    }
    store2.save();
    return { ...base, ok: true, added: events.length, removed: Math.max(0, before - events.length), truncated };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const src = store2.data.sources.find((s) => s.id === source.id);
    if (src) {
      src.lastError = message;
    }
    store2.save();
    return { ...base, ok: false, error: message };
  }
}
async function syncAll(store2) {
  const enabled = store2.data.sources.filter((s) => s.enabled);
  const results = [];
  for (const src of enabled) {
    results.push(await syncSource(store2, src));
  }
  return results;
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
function safeWidgetBounds() {
  const saved = store.settings.widgetBounds;
  if (!saved) return defaultWidgetBounds();
  const stillVisible = electron.screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return saved.x < a.x + a.width && saved.x + saved.width > a.x && saved.y < a.y + a.height && saved.y + saved.height > a.y;
  });
  return stillVisible ? saved : defaultWidgetBounds();
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
  const bounds = safeWidgetBounds();
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
  const win = widgetWindow;
  win.showInactive();
  if (win.isVisible()) win.moveTop();
  else win.once("show", () => win.moveTop());
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
  electron.ipcMain.handle("sources:add", async (_e, input) => {
    const normalized = input.url.trim();
    const existing = store.data.sources.find((s) => s.url.trim() === normalized);
    if (existing) {
      const result2 = await syncSource(store, existing);
      broadcast();
      return { source: existing, result: result2 };
    }
    const src = store.upsertSource({ name: input.name, url: normalized, color: input.color });
    const result = await syncSource(store, src);
    broadcast();
    return { source: store.data.sources.find((s) => s.id === src.id), result };
  });
  electron.ipcMain.handle("sources:remove", (_e, id) => {
    store.removeSource(id);
    broadcast();
  });
  electron.ipcMain.handle("sources:sync", async (_e, id) => {
    let results;
    if (id) {
      const src = store.data.sources.find((s) => s.id === id);
      results = src ? [await syncSource(store, src)] : [];
    } else {
      results = await syncAll(store);
    }
    broadcast();
    return results;
  });
  electron.ipcMain.handle("sources:hideInstance", (_e, sourceId, key) => {
    store.hideInstance(sourceId, key);
    broadcast();
  });
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
    if (store.migratedFrom !== null) {
      mainWindow.webContents.once("did-finish-load", () => {
        mainWindow?.webContents.send("app:migrated", store.migratedFrom);
      });
    }
    const runSync = () => {
      void syncAll(store).then((results) => {
        if (results.length > 0) broadcast();
      });
    };
    setTimeout(runSync, 5e3).unref();
    setInterval(runSync, 6 * 60 * 60 * 1e3).unref();
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
