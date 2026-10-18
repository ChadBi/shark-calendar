/**
 * 生成鲨鱼日程应用图标（纯 Node，无第三方依赖）。
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

const inCircle = (u, v, cx, cy, r) => {
  const dx = u - cx
  const dy = v - cy
  return dx * dx + dy * dy <= r * r
}

const lerp = (a, b, t) => a + (b - a) * t

/** 判断点 (u,v) 是否在鲨鱼背鳍形状内 */
function inSharkFin(u, v) {
  // 鲨鱼背鳍：底部宽，向上收窄，尖端略弯
  // 底部中心在 (0.50, 0.72)，尖端在 (0.50, 0.22)
  // 使用二次贝塞尔曲线轮廓

  const tipX = 0.50
  const tipY = 0.22
  const baseLeftX = 0.30
  const baseRightX = 0.70
  const baseY = 0.72
  const curveControlX = 0.62 // 右侧控制点，让背鳍稍向后弯
  const curveControlY = 0.38

  // 点在底部以下？不在
  if (v > baseY) return false

  // 点在尖端以上？不在
  if (v < tipY) return false

  // 计算当前高度处的轮廓宽度
  const t = (v - tipY) / (baseY - tipY) // 0 在尖端，1 在底部

  // 左边界：直线从尖端到底部左端
  const leftX = lerp(tipX, baseLeftX, t)

  // 右边界：二次贝塞尔曲线从尖端到控制点到底部右端
  // B(t) = (1-t)^2 * P0 + 2(1-t)t * P1 + t^2 * P2
  const mt = 1 - t
  const rightX = mt * mt * tipX + 2 * mt * t * curveControlX + t * t * baseRightX

  return u >= leftX && u <= rightX
}

/** 判断点在波浪线（表示水面）附近 */
function inWave(u, v) {
  // 波浪线 y = 0.78 + 0.03 * sin(u * PI * 3)
  const waveY = 0.78 + 0.028 * Math.sin(u * Math.PI * 3.5)
  const thickness = 0.025
  return v >= waveY - thickness && v <= waveY + thickness
}

/** 归一化坐标 (0..1) 上的颜色采样，返回 [r,g,b,a] 或 null(透明) */
function shade(u, v) {
  const R = 0.235
  // 圆形裁切
  const cx = 0.5, cy = 0.5
  const dx = u - cx, dy = v - cy
  if (dx * dx + dy * dy > 0.5 * 0.5) return null

  // 海洋渐变背景：深海蓝 → 浅海蓝
  const dist = Math.sqrt(dx * dx + dy * dy) / 0.5
  const t = Math.min(1, Math.max(0, dist * 0.7 + (v - 0.3) * 0.3))

  // 深蓝 #1a5fb4 → 浅蓝 #62a0ea
  let r = lerp(0x1a, 0x62, t)
  let g = lerp(0x5f, 0xa0, t)
  let b = lerp(0xb4, 0xea, t)

  const white = () => [0xff, 0xff, 0xff, 255]

  // 鲨鱼背鳍（白色）
  if (inSharkFin(u, v)) return white()

  // 水面波浪线（白色，半透明混合）
  if (inWave(u, v)) return white()

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
