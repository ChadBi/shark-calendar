import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'

/**
 * 同步令牌的加密存储。
 *
 * 绝不能和 daily-list.json 放在一起：那个文件用户随时可能发给别人排错。
 * Windows 下 safeStorage 走 DPAPI，密钥绑定当前用户账户，拷到别的机器上解不开。
 */

function tokenPath(): string {
  return join(app.getPath('userData'), 'sync-token.bin')
}

export function saveSyncToken(token: string): void {
  const p = tokenPath()
  const trimmed = token.trim()
  if (!trimmed) {
    try {
      if (existsSync(p)) unlinkSync(p)
    } catch {
      /* ignore */
    }
    return
  }
  if (safeStorage.isEncryptionAvailable()) {
    writeFileSync(p, safeStorage.encryptString(trimmed))
  } else {
    // 系统不支持加密时降级为明文，但至少不让它混进数据文件
    writeFileSync(p, trimmed, 'utf-8')
  }
}

export function loadSyncToken(): string | null {
  const p = tokenPath()
  if (!existsSync(p)) return null
  try {
    const buf = readFileSync(p)
    if (safeStorage.isEncryptionAvailable()) {
      try {
        return safeStorage.decryptString(buf)
      } catch {
        // 换了机器或用户账户，密文解不开
        return null
      }
    }
    return buf.toString('utf-8').trim() || null
  } catch {
    return null
  }
}

export function hasSyncToken(): boolean {
  return existsSync(tokenPath())
}
