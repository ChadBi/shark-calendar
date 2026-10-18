/**
 * 更换应用图标（傻瓜式）
 *
 * 用法：
 *   1. 把你的新图标保存成一个图片文件（PNG / JPG 都行，方形，建议 ≥ 256x256）
 *   2. 运行： node scripts/update-icon.mjs <图片路径>
 *      例如： node scripts/update-icon.mjs C:/Users/我/Desktop/新图标.png
 *   3. 运行： npm run dist      （重新打包，新图标就会生效）
 *
 * 脚本会自动：
 *   - 转成真正的 PNG（electron-builder 不认 JPEG）
 *   - 生成 32x32 的托盘小图标
 */
import { execFileSync } from 'node:child_process'
import { existsSync, copyFileSync, mkdirSync } from 'node:fs'
import { join, dirname, resolve, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/* 可通过 PYTHON 指定解释器，否则从 PATH 查找安装了 Pillow 的 Python。 */
const PY_CANDIDATES = [
  process.env.PYTHON,
  'python',
  'python3',
  'py'
].filter(Boolean)

function findPython() {
  for (const py of PY_CANDIDATES) {
    try {
      execFileSync(py, ['-c', 'import PIL'], { stdio: 'pipe' })
      return py
    } catch {
      /* 这个不行，试下一个 */
    }
  }
  return null
}

function pngSignature(buf) {
  // \x89PNG\r\n\x1a\n
  return (
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  )
}

const src = process.argv[2]
if (!src) {
  console.error('用法： node scripts/update-icon.mjs <你的图片路径>')
  process.exit(1)
}

const abs = resolve(src)
if (!existsSync(abs)) {
  console.error('找不到文件：' + abs)
  process.exit(1)
}

const dir = join(ROOT, 'resources')
mkdirSync(dir, { recursive: true })

/* 1. 先看看是不是真正的 PNG 且尺寸合适 */
const { readFileSync, writeFileSync, statSync } = await import('node:fs')
const buf = readFileSync(abs)
const isPng = pngSignature(buf)
const isJpeg = buf[0] === 0xff && buf[1] === 0xd8
const isWebp = buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP'

console.log('源文件：' + abs)
console.log('格式：' + (isPng ? 'PNG' : isJpeg ? 'JPEG' : isWebp ? 'WebP' : '未知'))
console.log('大小：' + (statSync(abs).size / 1024).toFixed(1) + ' KB')

/* 2. 转换（需要 Pillow；真 PNG 且尺寸 OK 时免转换直接复制） */
let convertedIcon = null

if (isPng) {
  convertedIcon = abs
  console.log('✓ 已经是 PNG，直接用')
} else {
  const py = findPython()
  if (!py) {
    console.error('')
    console.error('✗ 你的图不是 PNG 格式，而本机没检测到带 Pillow 的 Python。')
    console.error('  两个办法任选其一：')
    console.error('    a) 用画图/Photoshop/GIMP 把图片另存为 PNG，再跑一次本脚本')
    console.error('    b) 装一下依赖： pip install Pillow')
    process.exit(1)
  }

  const iconOut = join(dir, 'icon.png')
  try {
    execFileSync(
      py,
      [
        '-c',
        `from PIL import Image
img = Image.open(${JSON.stringify(abs)}).convert('RGBA')
w, h = img.size
if w != h:
    # 正方形裁切（居中），避免拉伸变形
    side = min(w, h)
    left, top = (w - side) // 2, (h - side) // 2
    img = img.crop((left, top, left + side, top + side))
img = img.resize((1024, 1024), Image.LANCZOS) if w > 1024 else img.resize((256, 256), Image.LANCZOS)
img.save(${JSON.stringify(iconOut)}, 'PNG')
# 托盘小图标
img.resize((32, 32), Image.LANCZOS).save(${JSON.stringify(join(dir, 'tray.png'))}, 'PNG')
print('ok')`
      ],
      { stdio: 'pipe' }
    )
    convertedIcon = iconOut
    console.log('✓ 已转换并输出 1024x1024（或 256x256）PNG + 32x32 托盘图标')
  } catch (err) {
    console.error('✗ 转换失败：' + String(err.stderr || err.message))
    process.exit(1)
  }
}

/* 3. 保存一份源文件副本，方便以后回滚 */
copyFileSync(abs, join(dir, 'icon-source.' + extname(abs).slice(1)))
if (convertedIcon !== abs) copyFileSync(convertedIcon, join(dir, 'icon.png'))

/* 4. 真 PNG 时也补一个托盘图标（如果 Pillow 可用） */
if (isPng) {
  const py = findPython()
  if (py) {
    try {
      execFileSync(
        py,
        [
          '-c',
          `from PIL import Image
img = Image.open(${JSON.stringify(abs)}).convert('RGBA')
w, h = img.size
side = min(w, h)
img = img.crop(((w - side) // 2, (h - side) // 2, (w - side) // 2 + side, (h - side) // 2 + side))
img.resize((32, 32), Image.LANCZOS).save(${JSON.stringify(join(dir, 'tray.png'))}, 'PNG')
print('ok')`
        ],
        { stdio: 'pipe' }
      )
      console.log('✓ 托盘小图标 32x32 已更新')
    } catch {
      console.log('⚠ 托盘小图标没更新成功（不影响主图标，重新打包后托盘会用缩略版）')
    }
  }
}

console.log('')
console.log('==================================================')
console.log('  完成！现在运行  npm run dist  重新打包即可')
console.log('  安装包里就会带上你的新图标')
console.log('==================================================')
