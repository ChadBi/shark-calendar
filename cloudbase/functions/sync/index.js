/**
 * 日程同步云函数（腾讯云开发 CloudBase）
 *
 * 通过「HTTP 访问服务」暴露后，客户端会 POST {访问路径}/sync。
 * 协议与 scripts/mock-sync-server.mjs 完全一致，客户端不需要任何改动。
 *
 * 需要先建两个集合：events、meta，并在 events 上建 userId + seq 的复合索引。
 * 详见 docs/cloud-sync-setup.md。
 */
const crypto = require('crypto')
const cloud = require('@cloudbase/node-sdk')

const app = cloud.init({ env: cloud.SYMBOL_CURRENT_ENV })
const db = app.database()
const _ = db.command

const EVENTS = 'events'
const META = 'meta'
const MAX_PULL = 1000

/** 令牌不存明文：只把它哈希后当作用户标识，服务端拿不到原始令牌 */
function userKeyOf(token) {
  return crypto.createHash('sha256').update(token).digest('hex').slice(0, 32)
}

function reply(statusCode, obj) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(obj)
  }
}

/** 每个用户一个自增计数器，保证 seq 单调递增 */
async function nextSeq(userId) {
  const meta = db.collection(META)
  const id = `seq_${userId}`

  const res = await meta.where({ _id: id }).update({ value: _.inc(1) })
  if (!res.updated) {
    try {
      await meta.add({ _id: id, value: 1 })
      return 1
    } catch {
      // 并发下可能已被别的请求创建，重读一次
      const doc = await meta.doc(id).get()
      return (doc.data[0] && doc.data[0].value) || 1
    }
  }
  const doc = await meta.doc(id).get()
  return (doc.data[0] && doc.data[0].value) || 1
}

async function getExisting(id) {
  try {
    const res = await db.collection(EVENTS).doc(id).get()
    return res.data && res.data[0] ? res.data[0] : null
  } catch {
    return null
  }
}

exports.main = async (event) => {
  const headers = event.headers || {}
  const rawAuth = headers.authorization || headers.Authorization || ''
  const token = String(rawAuth).replace(/^Bearer\s+/i, '').trim()
  if (!token) return reply(401, { error: 'missing token' })

  const userId = userKeyOf(token)

  let body
  try {
    const raw = event.body
    const text = event.isBase64Encoded ? Buffer.from(raw || '', 'base64').toString('utf-8') : raw
    body = JSON.parse(text || '{}')
  } catch {
    return reply(400, { error: 'bad json' })
  }

  const lastSeq = Number(body.lastSeq) || 0
  const changes = Array.isArray(body.changes) ? body.changes : []

  try {
    /* ---------------- 1. 写入本地变更 ---------------- */
    for (const change of changes) {
      if (!change || !change.id) continue
      const ts = Number(change.updatedAt) || Date.now()
      const prev = await getExisting(change.id)

      // LWW：服务端已有更新的版本时忽略本次推送
      if (prev && Number(prev.updatedAt) >= ts) continue

      const seq = await nextSeq(userId)
      const doc = {
        userId,
        payload: change.payload,
        updatedAt: ts,
        deleted: !!change.deleted,
        seq
      }

      if (prev) {
        await db.collection(EVENTS).doc(change.id).update(doc)
      } else {
        await db.collection(EVENTS).add({ _id: change.id, ...doc })
      }
    }

    /* ---------------- 2. 返回增量 ---------------- */
    const pulled = await db
      .collection(EVENTS)
      .where({ userId, seq: _.gt(lastSeq) })
      .orderBy('seq', 'asc')
      .limit(MAX_PULL)
      .get()

    const tail = await db
      .collection(EVENTS)
      .where({ userId })
      .orderBy('seq', 'desc')
      .limit(1)
      .get()

    const serverSeq = tail.data[0] ? tail.data[0].seq : lastSeq

    return reply(200, {
      serverSeq,
      records: pulled.data.map((d) => ({
        id: d._id,
        payload: d.payload,
        updatedAt: d.updatedAt,
        deleted: !!d.deleted,
        seq: d.seq
      }))
    })
  } catch (err) {
    console.error('[sync] 失败', err)
    return reply(500, { error: 'server error' })
  }
}
