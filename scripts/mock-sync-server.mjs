/**
 * 模拟同步服务端（用于双设备联调测试）。
 *
 * 实现的是客户端约定的最小协议：
 *   POST /sync
 *   Authorization: Bearer <token>
 *   { lastSeq, deviceId, changes: [{ id, payload, updatedAt, deleted }] }
 *   → { serverSeq, records: [{ ...change, seq }] }
 *
 * 真实部署时把这段逻辑搬到 CloudBase 云函数即可，客户端代码一行都不用改。
 */
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'

export function createMockSyncServer() {
  /** userId → Map<id, record> */
  const store = new Map()
  /** userId → 当前最大序号 */
  const seqs = new Map()
  const stats = { requests: 0, accepted: 0, rejected: 0 }

  const bucket = (userId) => {
    if (!store.has(userId)) store.set(userId, new Map())
    if (!seqs.has(userId)) seqs.set(userId, 0)
    return store.get(userId)
  }

  const server = createServer((req, res) => {
    const send = (code, obj) => {
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(obj))
    }

    if (req.method === 'GET' && req.url?.startsWith('/stats')) {
      send(200, { ...stats, users: store.size })
      return
    }

    if (req.method !== 'POST' || !req.url?.startsWith('/sync')) {
      send(404, { error: 'not found' })
      return
    }

    const auth = req.headers.authorization || ''
    const token = auth.replace(/^Bearer\s+/i, '').trim()
    if (!token) {
      send(401, { error: 'missing token' })
      return
    }

    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      stats.requests++
      let body
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf-8'))
      } catch {
        send(400, { error: 'bad json' })
        return
      }

      const userId = createHash('sha256').update(token).digest('hex').slice(0, 16)
      const events = bucket(userId)
      let seq = seqs.get(userId)

      const changes = Array.isArray(body.changes) ? body.changes : []
      for (const change of changes) {
        if (!change?.id) continue
        const existing = events.get(change.id)
        // LWW：只有更新的记录才覆盖
        if (!existing || Number(change.updatedAt) > Number(existing.updatedAt)) {
          seq++
          events.set(change.id, {
            id: change.id,
            payload: change.payload,
            updatedAt: Number(change.updatedAt),
            deleted: !!change.deleted,
            seq
          })
          stats.accepted++
        } else {
          stats.rejected++
        }
      }
      seqs.set(userId, seq)

      const lastSeq = Number(body.lastSeq) || 0
      const records = [...events.values()].filter((r) => r.seq > lastSeq).sort((a, b) => a.seq - b.seq)

      send(200, { serverSeq: seq, records })
    })
  })

  return {
    server,
    stats,
    async listen() {
      await new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', resolve)
      })
      return `http://127.0.0.1:${server.address().port}`
    },
    close() {
      server.closeAllConnections?.()
      server.close()
    }
  }
}
