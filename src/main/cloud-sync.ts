import { net } from 'electron'
import type {
  CalendarEvent,
  SyncOutcome,
  SyncPullResponse,
  SyncStatus,
  SyncWireRecord
} from '../shared/types'
import type { Store } from './store'
import { loadSyncToken, hasSyncToken } from './credentials'

/**
 * 云同步引擎。
 *
 * 协议刻意做得很薄（一个 POST 同时完成推和拉），后端可以是云函数、自建 Node 服务，
 * 或者任何能实现这个接口的东西。客户端不依赖任何特定云厂商的 SDK。
 *
 * 三条硬规则：
 * 1. 只同步本地事件。订阅事件（sourceId 有值）是派生数据，同步会造成双重来源。
 * 2. 删除是墓碑，永远不物理删除，否则另一台设备会把记录「推活」。
 * 3. 增量游标用服务端序号，不用设备时钟——某台设备时间不准会导致永久漏同步。
 */

const TIMEOUT_MS = 20000
const base: Omit<SyncOutcome, 'ok'> = { pushed: 0, pulled: 0, applied: 0, conflicts: 0 }

let running = false

function httpJson(
  url: string,
  method: string,
  headers: Record<string, string>,
  body?: string
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
    }

    const request = net.request({ url, method, redirect: 'follow' })
    for (const [k, v] of Object.entries(headers)) request.setHeader(k, v)

    const timer = setTimeout(() => {
      finish(() => {
        request.abort()
        reject(new Error('同步请求超时（20 秒）'))
      })
    }, TIMEOUT_MS)

    request.on('response', (response) => {
      const chunks: Buffer[] = []
      response.on('data', (c) => chunks.push(c))
      response.on('end', () =>
        finish(() => resolve({ status: response.statusCode, text: Buffer.concat(chunks).toString('utf-8') }))
      )
      response.on('error', (err) => finish(() => reject(err)))
    })
    request.on('error', (err) => finish(() => reject(err)))

    if (body) request.write(body)
    request.end()
  })
}

export function toWire(e: CalendarEvent): SyncWireRecord {
  return {
    id: e.id,
    payload: e,
    updatedAt: new Date(e.updatedAt).getTime() || Date.now(),
    deleted: !!e.deleted
  }
}

async function postSync(
  endpoint: string,
  token: string,
  body: unknown
): Promise<SyncPullResponse> {
  const url = `${endpoint.replace(/\/+$/, '')}/sync`
  const res = await httpJson(
    url,
    'POST',
    { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    JSON.stringify(body)
  )

  if (res.status === 401 || res.status === 403) throw new Error('访问令牌无效或已过期')
  if (res.status < 200 || res.status >= 300) throw new Error(`同步服务返回 ${res.status}`)

  let parsed: unknown
  try {
    parsed = JSON.parse(res.text)
  } catch {
    throw new Error('同步服务返回的不是 JSON')
  }

  const obj = parsed as Partial<SyncPullResponse>
  if (typeof obj?.serverSeq !== 'number' || !Array.isArray(obj?.records)) {
    throw new Error('同步服务返回格式不正确')
  }
  return { serverSeq: obj.serverSeq, records: obj.records }
}

export function countPending(store: Store): number {
  return store.data.events.filter((e) => e.dirty && !e.sourceId).length
}

export function getStatus(store: Store): SyncStatus {
  const s = store.settings
  return {
    enabled: s.syncEnabled,
    hasToken: hasSyncToken(),
    endpoint: s.syncEndpoint,
    lastSeq: s.syncLastSeq,
    lastAt: s.syncLastAt,
    pending: countPending(store)
  }
}

export async function syncOnce(store: Store): Promise<SyncOutcome> {
  const s = store.settings
  if (!s.syncEnabled) return { ...base, ok: false, error: '同步未开启' }
  if (!s.syncEndpoint.trim()) return { ...base, ok: false, error: '未配置同步服务地址' }
  const token = loadSyncToken()
  if (!token) return { ...base, ok: false, error: '未配置访问令牌' }
  if (running) return { ...base, ok: false, error: '同步正在进行中' }

  running = true
  try {
    const pending = store.data.events.filter((e) => e.dirty && !e.sourceId)
    const changes = pending.map(toWire)

    let resp: SyncPullResponse
    try {
      resp = await postSync(s.syncEndpoint, token, {
        lastSeq: s.syncLastSeq,
        deviceId: store.data.deviceId,
        changes
      })
    } catch (err) {
      return { ...base, ok: false, error: err instanceof Error ? err.message : String(err) }
    }

    let applied = 0
    let conflicts = 0

    for (const rec of resp.records) {
      // 订阅事件不接受远端覆盖，它们由各自的订阅源负责
      if (rec.payload?.sourceId) continue

      const local = store.data.events.find((e) => e.id === rec.id)

      if (!local) {
        store.data.events.push({ ...rec.payload, serverSeq: rec.seq, dirty: false })
        applied++
        continue
      }

      const localTs = new Date(local.updatedAt).getTime()
      if (rec.updatedAt > localTs) {
        // 远端更新：覆盖本地
        if (local.dirty) conflicts++
        Object.assign(local, rec.payload, { serverSeq: rec.seq, dirty: false })
        applied++
      } else if (rec.updatedAt < localTs) {
        // 本地更新：保留本地，下一轮会推上去
        if (local.dirty) conflicts++
      } else {
        // 时间戳相同，视为同一条，只需确认已同步
        local.serverSeq = rec.seq
        local.dirty = false
      }
    }

    // 已推送的记录清掉脏标记
    for (const e of pending) {
      e.dirty = false
      if (e.serverSeq === undefined) e.serverSeq = resp.serverSeq
    }

    store.data.settings.syncLastSeq = resp.serverSeq
    store.data.settings.syncLastAt = new Date().toISOString()
    store.saveNow()

    return {
      ok: true,
      pushed: changes.length,
      pulled: resp.records.length,
      applied,
      conflicts,
      at: store.data.settings.syncLastAt
    }
  } finally {
    running = false
  }
}
