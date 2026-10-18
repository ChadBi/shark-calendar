/**
 * 连接一个已经在运行的 Electron 实例并截图。
 * 用法：node scripts/shot.mjs <调试端口> <输出文件> [url关键词]
 */
import { writeFileSync } from 'node:fs'

const port = Number(process.argv[2] || 9222)
const outFile = process.argv[3] || 'shot.png'
const match = process.argv[4] || ''

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const target = list.find((t) => t.type === 'page' && t.url.includes(match))
if (!target) {
  console.error('未找到目标页面，现有：', list.map((t) => t.url))
  process.exit(1)
}

const ws = new WebSocket(target.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id)
    pending.delete(m.id)
    m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)
  }
})
await new Promise((res, rej) => {
  ws.addEventListener('open', res)
  ws.addEventListener('error', rej)
})
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })

await send('Page.enable')
await sleep(800)
const { data } = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync(outFile, Buffer.from(data, 'base64'))
console.log(`✓ 已保存 ${outFile}`)
process.exit(0)
