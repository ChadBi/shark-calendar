/**
 * 带自愈能力的打包脚本。
 *
 * 背景：Windows 上 electron-builder 覆盖写 `resources/app.asar` 时，
 * 只要有一个进程（资源管理器预览、杀毒扫描、上一次残留的 Electron）
 * 还持有句柄，就会抛 `EBUSY: resource busy or locked`，整次打包白跑。
 *
 * 这个脚本做三件事：
 *   1. 先杀掉可能占用文件的旧进程
 *   2. 尝试清理输出目录（带重试）
 *   3. 删不掉就自动把输出目录递增（release-v8 → release-v9）再打包
 *
 * 用法：npm run dist
 */
import { execSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PKG_PATH = join(ROOT, 'package.json')
const pkg = JSON.parse(readFileSync(PKG_PATH, 'utf-8'))

const APP_NAMES = ['鲨鱼日程.exe', '日程.exe']

function killRunning() {
  for (const name of APP_NAMES) {
    try {
      execSync(`taskkill /F /IM "${name}"`, { stdio: 'ignore' })
      console.log(`[dist] 已结束运行中的 ${name}`)
    } catch {
      /* 没在跑，正常 */
    }
  }
}

/** 清理目录；失败返回 false（多半是被占用） */
function tryRemove(dir) {
  if (!existsSync(dir)) return true
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 })
    return true
  } catch (err) {
    console.warn(`[dist] 清理失败：${err.code ?? err.message}`)
    return false
  }
}

/** release-v8 → release-v9；release → release-v2 */
function nextDirName(dir) {
  const m = dir.match(/^(.*?)(\d+)$/)
  if (!m) return `${dir}-v2`
  return `${m[1]}${Number(m[2]) + 1}`
}

let outDir = pkg.build?.directories?.output ?? 'release'

killRunning()

if (!tryRemove(join(ROOT, outDir))) {
  const prev = outDir
  outDir = nextDirName(outDir)
  pkg.build.directories.output = outDir
  writeFileSync(PKG_PATH, `${JSON.stringify(pkg, null, 2)}\n`, 'utf-8')
  console.log(`[dist] ${prev} 被占用，改用 ${outDir}（已写回 package.json）`)
}

console.log(`[dist] 输出目录：${outDir}`)

const steps = [
  ['构建', 'npx electron-vite build'],
  ['打包', 'npx electron-builder --win']
]

for (const [label, cmd] of steps) {
  console.log(`\n[dist] ${label}中…`)
  const r = spawnSync(cmd, { cwd: ROOT, stdio: 'inherit', shell: true })
  if (r.status !== 0) {
    console.error(`[dist] ${label}失败，退出码 ${r.status}`)
    process.exit(r.status ?? 1)
  }
}

const artifact = join(ROOT, outDir)
console.log(`\n[dist] 完成。产物目录：${artifact}`)
