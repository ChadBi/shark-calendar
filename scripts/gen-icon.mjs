/**
 * 生成应用图标（纯 Node，无第三方依赖）。
 * 输出：resources/icon.png（512）、resources/tray.png（32）
 * 用法：node scripts/gen-icon.mjs
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/* ------------------------------- PNG 编码 ------------------------------- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crc])
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0 // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

/* ------------------------------- 图形绘制 ------------------------------- */

const inRect = (u, v, x0, y0, x1, y1) => u >= x0 && u <= x1 && v >= y0 && v <= y1

function inRoundRect(u, v, x0, y0, x1, y1, r) {
  if (!inRect(u, v, x0, y0, x1, y1)) return false
  const cx = Math.min(Math.max(u, x0 + r), x1 - r)
  const cy = Math.min(Math.max(v, y0 + r), y1 - r)
  const dx = u - cx
  const dy = v - cy
  return dx * dx + dy * dy <= r * r
}

const lerp = (a, b, t) => a + (b - a) * t

/** 归一化坐标 (0..1) 上的颜色采样，返回 [r,g,b,a] 或 null(透明) */
function shade(u, v) {
  const R = 0.235
  if (!inRoundRect(u, v, 0, 0, 1, 1, R)) return null

  // 渐变底色：靛蓝 → 深蓝
  const t = Math.min(1, Math.max(0, (u * 0.35 + v * 0.65)))
  let r = lerp(0x5b, 0x35, t)
  let g = lerp(0x8d, 0x56, t)
  let b = lerp(0xf8, 0xc8, t)

  const white = () => [0xff, 0xff, 0xff, 255]

  // 日历外框（描边）
  const outer = inRoundRect(u, v, 0.215, 0.255, 0.785, 0.805, 0.055)
  const inner = inRoundRect(u, v, 0.265, 0.305, 0.735, 0.755, 0.032)
  if (outer && !inner) return white()

  // 顶部实心横条
  if (inRoundRect(u, v, 0.215, 0.255, 0.785, 0.405, 0.055)) return white()

  // 两个装订环
  if (inRoundRect(u, v, 0.335, 0.165, 0.395, 0.30, 0.028)) return white()
  if (inRoundRect(u, v, 0.605, 0.165, 0.665, 0.30, 0.028)) return white()

  // 日期格点
  const dots = [
    [0.315, 0.485, 0.395, 0.555],
    [0.46, 0.485, 0.54, 0.555],
    [0.605, 0.485, 0.685, 0.555],
    [0.315, 0.625, 0.395, 0.695],
    [0.46, 0.625, 0.54, 0.695]
  ]
  for (const [x0, y0, x1, y1] of dots) {
    if (inRoundRect(u, v, x0, y0, x1, y1, 0.022)) return white()
  }

  return [Math.round(r), Math.round(g), Math.round(b), 255]
}

function render(size) {
  const SS = 3 // 每个像素 3x3 超采样做抗锯齿
  const buf = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (x + (sx + 0.5) / SS) / size
          const v = (y + (sy + 0.5) / SS) / size
          const c = shade(u, v)
          if (c) {
            r += c[0]
            g += c[1]
            b += c[2]
            a += 255
          }
        }
      }
      const n = SS * SS
      const i = (y * size + x) * 4
      if (a === 0) {
        buf[i] = buf[i + 1] = buf[i + 2] = buf[i + 3] = 0
      } else {
        const cover = a / (n * 255)
        // 预乘后再还原，避免边缘出现白边
        buf[i] = Math.round(r / (n * cover))
        buf[i + 1] = Math.round(g / (n * cover))
        buf[i + 2] = Math.round(b / (n * cover))
        buf[i + 3] = Math.round(255 * cover)
      }
    }
  }
  return encodePng(size, size, buf)
}

const dir = join(ROOT, 'resources')
mkdirSync(dir, { recursive: true })
writeFileSync(join(dir, 'icon.png'), render(512))
writeFileSync(join(dir, 'tray.png'), render(32))
console.log('✓ resources/icon.png (512x512)')
console.log('✓ resources/tray.png (32x32)')
