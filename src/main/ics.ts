import { net } from 'electron'
import { RRule } from 'rrule'

/**
 * 精简 iCalendar 解析器。
 *
 * 只做订阅场景需要的事：读 VEVENT、展开 RRULE、排除 EXDATE。
 * 刻意不引第三方 ICS 库——它们为了兼容极老的服务端会带上大量历史包袱，
 * 而这里只需要处理 Google Calendar / Outlook / Apple 导出的标准格式。
 *
 * 已处理的坑：
 * - 折行：RFC 5545 规定超长行会在 75 字节处折断，续行以空格或 tab 开头
 * - 转义：\, \; \n \\
 * - 时区：带 Z 的按 UTC，带 TZID 的按该时区换算，不带 TZID 的按本地时间
 * - 嵌套：VALARM 里的属性不能当成事件属性
 * - EXDATE：排除单次实例
 */

export interface IcsEvent {
  uid: string
  summary: string
  description?: string
  location?: string
  start: Date
  end: Date
  allDay: boolean
  rrule?: string
  exdates: Date[]
}

interface RawProp {
  name: string
  params: Record<string, string>
  value: string
}

/** 合并折行 */
function unfold(text: string): string[] {
  const raw = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const out: string[] = []
  for (const line of raw) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && out.length > 0) {
      out[out.length - 1] += line.slice(1)
    } else {
      out.push(line)
    }
  }
  return out
}

/** 拆 `NAME;PARAM=VALUE:CONTENT`，冒号只在引号外才算分隔符 */
function splitProp(line: string): RawProp | null {
  let inQuote = false
  let colon = -1
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') inQuote = !inQuote
    else if (ch === ':' && !inQuote) {
      colon = i
      break
    }
  }
  if (colon <= 0) return null

  const head = line.slice(0, colon)
  const value = line.slice(colon + 1)
  const segs = head.split(';')
  const name = segs[0].trim().toUpperCase()
  const params: Record<string, string> = {}
  for (const seg of segs.slice(1)) {
    const eq = seg.indexOf('=')
    if (eq > 0) {
      params[seg.slice(0, eq).trim().toUpperCase()] = seg
        .slice(eq + 1)
        .trim()
        .replace(/^"|"$/g, '')
    }
  }
  return { name, params, value }
}

function unescapeText(v: string): string {
  return v
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
    .trim()
}

/** 某时区在某一时刻的 UTC 偏移（分钟） */
function tzOffsetMinutes(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
  const p: Record<string, string> = {}
  for (const part of dtf.formatToParts(date)) p[part.type] = part.value
  const asUTC = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour) % 24,
    Number(p.minute),
    Number(p.second)
  )
  return Math.round((asUTC - date.getTime()) / 60000)
}

/** 把「某时区的墙上时间」换算成真实 UTC 时刻（处理夏令时跳变） */
function zonedToUtc(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  s: number,
  tzid: string
): Date {
  const wall = Date.UTC(y, mo - 1, d, h, mi, s)
  try {
    let offset = tzOffsetMinutes(new Date(wall), tzid)
    let utc = wall - offset * 60000
    const offset2 = tzOffsetMinutes(new Date(utc), tzid)
    if (offset2 !== offset) utc = wall - offset2 * 60000
    return new Date(utc)
  } catch {
    // 未知时区（例如 VTIMEZONE 里自定义的名字）退化为本地时间
    return new Date(y, mo - 1, d, h, mi, s)
  }
}

function parseDateValue(
  value: string,
  params: Record<string, string>
): { date: Date; allDay: boolean } | null {
  const v = value.trim()
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/)
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])

  // 纯日期 → 全天
  if (!m[4]) return { date: new Date(year, month - 1, day, 0, 0, 0), allDay: true }

  const h = Number(m[4])
  const mi = Number(m[5])
  const s = Number(m[6])

  if (m[7] === 'Z') return { date: new Date(Date.UTC(year, month - 1, day, h, mi, s)), allDay: false }

  const tzid = params['TZID']
  if (tzid && tzid.toUpperCase() !== 'UTC') {
    return { date: zonedToUtc(year, month - 1 + 1, day, h, mi, s, tzid), allDay: false }
  }
  return { date: new Date(year, month - 1, day, h, mi, s), allDay: false }
}

/** 解析整份 ICS，返回未展开重复规则的事件 */
export function parseIcs(text: string): IcsEvent[] {
  const lines = unfold(text)
  const events: IcsEvent[] = []
  let cur: Partial<IcsEvent> | null = null
  let inAlarm = false

  for (const line of lines) {
    const upper = line.toUpperCase()

    if (upper.startsWith('BEGIN:VALARM')) {
      inAlarm = true
      continue
    }
    if (upper.startsWith('END:VALARM')) {
      inAlarm = false
      continue
    }
    if (upper.startsWith('BEGIN:VEVENT')) {
      cur = { exdates: [] }
      continue
    }
    if (upper.startsWith('END:VEVENT')) {
      if (cur?.start && cur?.end) {
        events.push({
          uid: cur.uid ?? `no-uid-${cur.start.toISOString()}`,
          summary: cur.summary ?? '未命名日程',
          description: cur.description,
          location: cur.location,
          start: cur.start,
          end: cur.end,
          allDay: cur.allDay ?? false,
          rrule: cur.rrule,
          exdates: cur.exdates ?? []
        })
      }
      cur = null
      continue
    }
    if (!cur || inAlarm) continue

    const prop = splitProp(line)
    if (!prop) continue

    switch (prop.name) {
      case 'UID':
        cur.uid = prop.value.trim()
        break
      case 'SUMMARY':
        cur.summary = unescapeText(prop.value)
        break
      case 'DESCRIPTION':
        cur.description = unescapeText(prop.value)
        break
      case 'LOCATION':
        cur.location = unescapeText(prop.value)
        break
      case 'DTSTART': {
        const d = parseDateValue(prop.value, prop.params)
        if (d) {
          cur.start = d.date
          cur.allDay = d.allDay
        }
        break
      }
      case 'DTEND': {
        const d = parseDateValue(prop.value, prop.params)
        if (d) cur.end = d.date
        break
      }
      case 'RRULE':
        cur.rrule = prop.value.trim()
        break
      case 'EXDATE': {
        for (const piece of prop.value.split(',')) {
          const d = parseDateValue(piece, prop.params)
          if (d) cur.exdates!.push(d.date)
        }
        break
      }
      default:
        break
    }
  }

  return events
}

export interface Occurrence {
  start: Date
  end: Date
}

/**
 * 把事件展开成 [from, to] 区间内的具体实例。
 * 无 RRULE 的事件最多返回一条；重复事件按规则展开并剔除 EXDATE。
 */
export function expandOccurrences(ev: IcsEvent, from: Date, to: Date): Occurrence[] {
  const durationMs = Math.max(0, ev.end.getTime() - ev.start.getTime())

  if (!ev.rrule) {
    return ev.start >= from && ev.start <= to ? [{ start: ev.start, end: ev.end }] : []
  }

  try {
    const rule = new RRule({
      ...RRule.parseString(ev.rrule),
      dtstart: ev.start
    })
    const exSet = new Set(ev.exdates.map((d) => d.getTime()))
    return rule
      .between(from, to, true)
      .filter((d) => !exSet.has(d.getTime()))
      .map((d) => ({ start: d, end: new Date(d.getTime() + durationMs) }))
  } catch {
    // 规则写坏时退化为单次事件，不要让整个订阅失败
    return ev.start >= from && ev.start <= to ? [{ start: ev.start, end: ev.end }] : []
  }
}

/** webcal:// 是订阅协议，实际走 https */
export function normalizeIcsUrl(raw: string): string {
  const url = raw.trim()
  if (/^webcal:\/\//i.test(url)) return url.replace(/^webcal:\/\//i, 'https://')
  return url
}

const MAX_BYTES = 8 * 1024 * 1024

/** 拉取订阅内容。走 Electron 的 net 而不是 Node fetch，以复用系统代理设置 */
export async function fetchIcs(url: string): Promise<string> {
  const target = normalizeIcsUrl(url)
  let parsed: URL
  try {
    parsed = new URL(target)
  } catch {
    throw new Error('链接格式不正确')
  }
  if (!/^https?:$/.test(parsed.protocol)) throw new Error('只支持 http / https / webcal 链接')

  const res = await net.fetch(target, { redirect: 'follow' })
  if (!res.ok) throw new Error(`服务器返回 ${res.status}`)

  const buf = await res.arrayBuffer()
  if (buf.byteLength > MAX_BYTES) throw new Error('日历文件超过 8MB，已拒绝')

  const text = new TextDecoder('utf-8').decode(buf)
  if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('这不是有效的 iCalendar 文件')
  return text
}
