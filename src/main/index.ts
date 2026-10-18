import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  ipcMain,
  globalShortcut,
  nativeImage,
  screen,
  shell
} from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { Store } from './store'
import type { CalendarEvent, Settings, WidgetBounds } from '../shared/types'

const isDev = !app.isPackaged

// 无 GPU 的远程会话/虚拟机里，GPU 进程会直接崩溃并拖垮整个应用。
// 用环境变量兜底：DAILY_LIST_DISABLE_GPU=1 时走软件渲染。
if (process.env['DAILY_LIST_DISABLE_GPU'] === '1') {
  app.disableHardwareAcceleration()
}

let mainWindow: BrowserWindow | null = null
let widgetWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
let store: Store
let widgetMoveTimer: NodeJS.Timeout | null = null

const WIDGET_W = 340
const WIDGET_H = 440

function assetPath(name: string): string {
  // dev 下 __dirname 是 out/main，packaged 下在 asar 内，两种都回退到 resources 目录
  const candidates = [
    join(__dirname, '../../resources', name),
    join(process.resourcesPath ?? '', name)
  ]
  for (const p of candidates) if (p && existsSync(p)) return p
  return candidates[0]
}

function appIcon(): Electron.NativeImage {
  const p = assetPath('icon.png')
  return existsSync(p) ? nativeImage.createFromPath(p) : nativeImage.createEmpty()
}

function preloadPath(): string {
  return join(__dirname, '../preload/index.js')
}

function loadPage(win: BrowserWindow, page: 'index' | 'widget'): void {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (isDev && devUrl) {
    win.loadURL(`${devUrl}/${page}.html`)
  } else {
    win.loadFile(join(__dirname, `../renderer/${page}.html`))
  }
}

function defaultWidgetBounds(): WidgetBounds {
  const { workArea } = screen.getPrimaryDisplay()
  return {
    x: workArea.x + workArea.width - WIDGET_W - 24,
    y: workArea.y + 24,
    width: WIDGET_W,
    height: WIDGET_H
  }
}

/**
 * 上次记住的位置可能来自已经拔掉的外接显示器，
 * 直接还原会让悬浮窗跑到看不见的地方，所以先校验是否还落在某块屏幕内。
 */
function safeWidgetBounds(): WidgetBounds {
  const saved = store.settings.widgetBounds
  if (!saved) return defaultWidgetBounds()
  const stillVisible = screen.getAllDisplays().some((d) => {
    const a = d.workArea
    return (
      saved.x < a.x + a.width &&
      saved.x + saved.width > a.x &&
      saved.y < a.y + a.height &&
      saved.y + saved.height > a.y
    )
  })
  return stillVisible ? saved : defaultWidgetBounds()
}

/* ------------------------------------------------------------------ 主窗口 */

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1180,
    height: 790,
    minWidth: 940,
    minHeight: 600,
    show: false,
    title: '日程',
    backgroundColor: '#f6f7f9',
    autoHideMenuBar: true,
    icon: appIcon(),
    webPreferences: {
      preload: preloadPath(),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.once('ready-to-show', () => win.show())

  // 关闭 → 隐藏到托盘（托盘常驻是这类软件的基本盘）
  win.on('close', (e) => {
    if (!isQuitting && store.settings.closeToTray) {
      e.preventDefault()
      win.hide()
    }
  })

  // 最小化 → 可选隐藏到托盘；默认走系统任务栏最小化
  win.on('minimize', () => {
    if (store.settings.minimizeToTray) win.hide()
  })

  win.on('closed', () => {
    mainWindow = null
  })

  // 外链一律走系统浏览器，不在应用内开新窗口
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  loadPage(win, 'index')
  return win
}

function showMain(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createMainWindow()
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

/* -------------------------------------------------------------- 悬浮小窗 */

function createWidgetWindow(): BrowserWindow {
  const bounds = safeWidgetBounds()

  const win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
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
  })

  win.setAlwaysOnTop(store.settings.widgetAlwaysOnTop, 'floating')
  // 不抢焦点：点悬浮窗不应该把正在全屏/前台的应用踢下去
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  win.once('ready-to-show', () => win.showInactive())

  const persistBounds = (): void => {
    if (widgetMoveTimer) clearTimeout(widgetMoveTimer)
    widgetMoveTimer = setTimeout(() => {
      if (!widgetWindow || widgetWindow.isDestroyed()) return
      const b = widgetWindow.getBounds()
      store.patchSettings({ widgetBounds: b })
    }, 300)
  }
  win.on('moved', persistBounds)

  win.on('closed', () => {
    widgetWindow = null
  })

  loadPage(win, 'widget')
  return win
}

function showWidget(): void {
  if (!widgetWindow || widgetWindow.isDestroyed()) {
    widgetWindow = createWidgetWindow()
  }
  widgetWindow.showInactive()
}

function hideWidget(): void {
  widgetWindow?.hide()
}

function toggleWidget(force?: boolean): boolean {
  const visible = !!widgetWindow && !widgetWindow.isDestroyed() && widgetWindow.isVisible()
  const next = typeof force === 'boolean' ? force : !visible
  if (next) showWidget()
  else hideWidget()
  return next
}

/* ------------------------------------------------------------------ 托盘 */

function buildTrayMenu(): void {
  if (!tray) return
  const s = store.settings
  const widgetVisible = !!widgetWindow && !widgetWindow.isDestroyed() && widgetWindow.isVisible()

  const menu = Menu.buildFromTemplate([
    { label: '打开日程', click: () => showMain() },
    { type: 'separator' },
    {
      label: widgetVisible ? '隐藏桌面悬浮窗' : '显示桌面悬浮窗',
      accelerator: 'CommandOrControl+Alt+D',
      click: () => toggleWidget()
    },
    {
      label: '新建日程',
      accelerator: 'CommandOrControl+Alt+N',
      click: () => quickAdd()
    },
    { type: 'separator' },
    {
      label: '开机自动启动',
      type: 'checkbox',
      checked: s.launchAtLogin,
      click: (item) => {
        store.patchSettings({ launchAtLogin: item.checked })
        app.setLoginItemSettings({ openAtLogin: item.checked })
        broadcast()
      }
    },
    { label: '打开数据文件夹', click: () => shell.openPath(store.dataDir) },
    { type: 'separator' },
    { label: '退出', click: () => quitApp() }
  ])
  tray.setContextMenu(menu)
  tray.setToolTip('日程')
}

function createTray(): void {
  const icon = appIcon().resize({ width: 20, height: 20 })
  tray = new Tray(icon.isEmpty() ? appIcon() : icon)
  tray.on('click', () => showMain())
  tray.on('double-click', () => showMain())
  buildTrayMenu()
}

/* -------------------------------------------------------------- 动作与广播 */

function quickAdd(): void {
  showMain()
  mainWindow?.webContents.send('app:quick-add')
}

function quitApp(): void {
  isQuitting = true
  store.saveNow()
  app.quit()
}

function broadcast(): void {
  const data = store.snapshot()
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('data:changed', data)
  }
  buildTrayMenu()
}

/* ------------------------------------------------------------------- IPC */

function registerIpc(): void {
  ipcMain.handle('data:get', () => store.snapshot())

  ipcMain.handle('events:upsert', (_e, input: Partial<CalendarEvent> & { title: string; start: string; end: string }) => {
    const ev = store.upsertEvent(input)
    broadcast()
    return ev
  })

  ipcMain.handle('events:delete', (_e, id: string) => {
    store.deleteEvent(id)
    broadcast()
  })

  ipcMain.handle('events:import', (_e, events: CalendarEvent[]) => {
    const n = store.importEvents(events)
    broadcast()
    return n
  })

  ipcMain.handle('settings:patch', (_e, patch: Partial<Settings>) => {
    const next = store.patchSettings(patch)
    if (patch.launchAtLogin !== undefined) {
      app.setLoginItemSettings({ openAtLogin: !!patch.launchAtLogin })
    }
    if (patch.widgetAlwaysOnTop !== undefined && widgetWindow && !widgetWindow.isDestroyed()) {
      widgetWindow.setAlwaysOnTop(!!patch.widgetAlwaysOnTop, 'floating')
    }
    broadcast()
    return next
  })

  ipcMain.handle('widget:toggle', (_e, force?: boolean) => {
    const state = toggleWidget(force)
    buildTrayMenu()
    return state
  })

  ipcMain.handle('widget:opacity', (_e, value: number) => {
    const v = Math.min(1, Math.max(0.35, Number(value) || 0.92))
    store.patchSettings({ widgetOpacity: v })
    broadcast()
  })

  ipcMain.handle('widget:pin', (_e, pinned: boolean) => {
    store.patchSettings({ widgetAlwaysOnTop: !!pinned })
    widgetWindow?.setAlwaysOnTop(!!pinned, 'floating')
    broadcast()
  })

  // 悬浮窗折叠 / 展开时改窗口高度，避免透明区域挡住桌面点击
  ipcMain.handle('widget:height', (_e, h: number) => {
    if (!widgetWindow || widgetWindow.isDestroyed()) return
    const b = widgetWindow.getBounds()
    const height = Math.min(720, Math.max(52, Math.round(Number(h) || WIDGET_H)))
    widgetWindow.setBounds({ x: b.x, y: b.y, width: b.width, height })
  })

  ipcMain.handle('app:openMain', () => showMain())

  // 从悬浮窗点某条日程 → 打开主窗口并弹出该日程的编辑框
  ipcMain.handle('app:openEvent', (_e, id: string) => {
    showMain()
    if (!mainWindow) return
    const deliver = (): void => mainWindow?.webContents.send('app:open-event', id)
    if (mainWindow.webContents.isLoading()) {
      mainWindow.webContents.once('did-finish-load', deliver)
    } else {
      setTimeout(deliver, 100)
    }
  })
  ipcMain.handle('app:quit', () => quitApp())
  ipcMain.handle('app:dataFolder', () => shell.openPath(store.dataDir))
}

/* ------------------------------------------------------------------ 启动 */

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => showMain())

  app.whenReady().then(() => {
    app.setAppUserModelId('com.dailylist.app')
    store = new Store()
    registerIpc()

    mainWindow = createMainWindow()
    createTray()

    if (store.settings.launchAtLogin) app.setLoginItemSettings({ openAtLogin: true })
    if (store.settings.showWidgetOnStart) showWidget()

    // 全局快捷键：注册失败不阻断启动（可能被其他软件占用）
    const shortcuts: Array<[string, () => void]> = [
      ['CommandOrControl+Alt+N', () => quickAdd()],
      ['CommandOrControl+Alt+D', () => toggleWidget()]
    ]
    for (const [accel, fn] of shortcuts) {
      try {
        const ok = globalShortcut.register(accel, fn)
        if (!ok) console.warn(`[shortcut] 注册失败（可能被占用）：${accel}`)
      } catch (err) {
        console.warn(`[shortcut] 注册异常：${accel}`, err)
      }
    }

    app.on('activate', () => showMain())
  })

  // 有托盘常驻，所有窗口关闭也不退出
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' && !store?.settings.closeToTray) app.quit()
  })

  app.on('before-quit', () => {
    isQuitting = true
    store?.saveNow()
  })

  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
  })
}
