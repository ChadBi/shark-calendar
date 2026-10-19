import { execFile } from 'child_process'
import type { BrowserWindow } from 'electron'

/**
 * 把悬浮窗压到桌面层（z-order 最底）。
 *
 * 为什么不用「SetParent 到 WorkerW」那种真·壁纸层方案：
 * 那需要直接调 user32，与本项目「零原生模块」的约定冲突（要引 koffi/ffi），
 * 而且挂到 WorkerW 后窗口不参与 Alt+Tab、多显示器下 WorkerW 结构还要探测，
 * 出问题表现为「窗口彻底不见了」，用户无法自救。
 *
 * 这里用 HWND_BOTTOM：窗口始终排在所有普通窗口之下。
 * 效果是「永不遮挡别人」，代价是「别人永远挡住它」——这正是产品要的语义。
 * 实现方式是一次性 PowerShell P/Invoke，不引依赖；失败就静默退回普通窗口。
 */

/** HWND_BOTTOM */
const HWND_BOTTOM = '1'
/** SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE */
const FLAGS = '0x0013'

let lastApply = 0
let warned = false

function hwndOf(win: BrowserWindow): string | null {
  try {
    const buf = win.getNativeWindowHandle()
    if (process.arch === 'x64' || process.arch === 'arm64') {
      return buf.readBigUInt64LE(0).toString()
    }
    return String(buf.readUInt32LE(0))
  } catch {
    return null
  }
}

/**
 * 把窗口压到最底层。节流 1.5 秒，避免 focus 事件高频触发时刷屏。
 */
export function sendToBottom(win: BrowserWindow, force = false): void {
  if (process.platform !== 'win32') return
  if (!win || win.isDestroyed()) return

  const now = Date.now()
  if (!force && now - lastApply < 1500) return
  lastApply = now

  const hwnd = hwndOf(win)
  if (!hwnd) return

  const script = [
    '$sig = @"',
    'using System;',
    'using System.Runtime.InteropServices;',
    'public static class SharkZOrder {',
    '  [DllImport("user32.dll", SetLastError=true)]',
    '  public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);',
    '}',
    '"@',
    'Add-Type -TypeDefinition $sig -ErrorAction Stop',
    `[SharkZOrder]::SetWindowPos([IntPtr]${hwnd}, [IntPtr]${HWND_BOTTOM}, 0, 0, 0, 0, ${FLAGS}) | Out-Null`
  ].join('\n')

  execFile(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script],
    { windowsHide: true, timeout: 8000 },
    (err) => {
      // 只警告一次，避免每 5 秒刷一条日志
      if (err && !warned) {
        warned = true
        console.warn('[desktop-layer] 压到桌面层失败，已退回普通窗口层级：', err.message)
      }
    }
  )
}

/** 恢复普通层级：重新提到顶层一次，之后交给系统正常管理 */
export function restoreNormalLayer(win: BrowserWindow): void {
  if (!win || win.isDestroyed()) return
  try {
    win.moveTop()
  } catch {
    /* ignore */
  }
}
