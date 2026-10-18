/**
 * 自然语言快速添加。
 *
 * 产品评审的结论：这类软件做不出差异的原因通常是"记一条日程的成本比忘记它还高"。
 * 所以这里做的是「一句话记日程」——输入 "明天下午3点 和设计对需求 1小时" 直接落库，
 * 而不是先弹一个 6 个字段的表单。
 */

import { addDays } from 'date-fns'

const CN_DIGITS: Record<string, number> = {
  零: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9
}

function cnNumber(raw: string): number | null {
  if (/^\d+$/.test(raw)) return Number(raw)
  if (raw === '十') return 10
  if (raw.includes('十')) {
    const [a, b] = raw.split('十')
    const tens = a ? (CN_DIGITS[a] ?? 0) : 1
    const ones = b ? (CN_DIGITS[b] ?? 0) : 0
    return tens * 10 + ones
  }
  if (raw.length === 1 && raw in CN_DIGITS) return CN_DIGITS[raw]
  return null
}

const WEEKDAY_MAP: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  日: 0,
  天: 0,
  七: 0
}

export interface ParsedQuickAdd {
  title: string
  start: Date
  end: Date
  allDay: boolean
  hasDate: boolean
  hasTime: boolean
}

function atTime(base: Date, hours: number, minutes: number): Date {
  const d = new Date(base)
  d.setHours(hours, minutes, 0, 0)
  return d
}

function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

export function parseQuickAdd(input: string, now = new Date()): ParsedQuickAdd | null {
  let text = ` ${input.trim()} `
  if (!text.trim()) return null

  let hasDate = false
  let hasTime = false
  let targetDay = startOfDay(now)
  let hour: number | null = null
  let minute = 0
  let forcedPeriod = ''
  let durationMin = 60
  let allDay = false

  /* ---------- 1. 时长 ---------- */
  const durH = text.match(/(\d+(?:\.\d+)?)\s*个?\s*(?:小时|钟头|h)/i)
  if (durH) {
    durationMin = Math.round(parseFloat(durH[1]) * 60)
    text = text.replace(durH[0], ' ')
  } else {
    const durM = text.match(/(\d+)\s*分钟/)
    if (durM) {
      durationMin = Number(durM[1])
      text = text.replace(durM[0], ' ')
    }
  }

  /* ---------- 2. 「今晚 / 明早」这类复合词：同时决定日期和时段 ---------- */
  // 必须先于「相对日」和「时段」处理，否则「今晚8点」会把"今"留在标题里
  const COMPOUND: Record<string, { offset: number; period: string }> = {
    今晚: { offset: 0, period: '晚上' },
    今夜: { offset: 0, period: '晚上' },
    今早: { offset: 0, period: '早上' },
    今晨: { offset: 0, period: '早上' },
    明晚: { offset: 1, period: '晚上' },
    明早: { offset: 1, period: '早上' },
    明晨: { offset: 1, period: '早上' },
    后晚: { offset: 2, period: '晚上' }
  }
  const compound = text.match(/(今|明|后)(晚|夜|早|晨)/)
  if (compound && COMPOUND[compound[0]]) {
    const conf = COMPOUND[compound[0]]
    targetDay = startOfDay(addDays(now, conf.offset))
    hasDate = true
    forcedPeriod = conf.period
    text = text.replace(compound[0], ' ')
  }

  /* ---------- 3. 相对日 ---------- */
  const rel = text.match(/(大后天|后天|明天|明日|今天|今日)/)
  if (rel) {
    const offset = { 今天: 0, 今日: 0, 明天: 1, 明日: 1, 后天: 2, 大后天: 3 }[rel[1]]!
    targetDay = startOfDay(addDays(now, offset))
    hasDate = true
    text = text.replace(rel[0], ' ')
  }

  /* ---------- 3. 周几 ---------- */
  if (!hasDate) {
    const wk = text.match(/(下下|下|本|这)?\s*(?:周|星期|礼拜)\s*([一二三四五六日天1-7])/)
    if (wk) {
      const target = /[1-7]/.test(wk[2]) ? Number(wk[2]) % 7 : WEEKDAY_MAP[wk[2]]
      const prefix = wk[1] ?? ''
      const todayDow = now.getDay() // 0 = 周日

      // 以周一为一周之首：算出本周一相对今天的天数偏移
      const mondayOffset = (todayDow + 6) % 7
      const toThisMonday = -mondayOffset
      // 目标日在本周内的位置（周一 = 0 ... 周日 = 6）
      const inWeek = (target + 6) % 7

      let delta: number
      if (prefix === '下') delta = toThisMonday + 7 + inWeek
      else if (prefix === '下下') delta = toThisMonday + 14 + inWeek
      else if (prefix === '本' || prefix === '这') delta = toThisMonday + inWeek
      // 不带前缀：指"即将到来的那一天"，今天就是则指今天
      else delta = (target - todayDow + 7) % 7

      targetDay = startOfDay(addDays(now, delta))
      hasDate = true
      text = text.replace(wk[0], ' ')
    }
  }

  /* ---------- 4. 月日 ---------- */
  if (!hasDate) {
    const md = text.match(/(\d{1,2})\s*[月\/\-]\s*(\d{1,2})\s*[日号]?/)
    if (md) {
      const month = Number(md[1])
      const day = Number(md[2])
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        const d = new Date(now.getFullYear(), month - 1, day)
        // 已过去的日期视为明年
        if (d.getTime() < startOfDay(now).getTime() - 86400000) d.setFullYear(d.getFullYear() + 1)
        targetDay = startOfDay(d)
        hasDate = true
        text = text.replace(md[0], ' ')
      }
    }
  }

  /* ---------- 5. 时段 + 时刻 ---------- */
  const periodMatch = forcedPeriod
    ? null
    : text.match(/(凌晨|清晨|早上|早晨|上午|中午|下午|傍晚|晚上|夜里|晚)/)
  const period = forcedPeriod || (periodMatch ? periodMatch[1] : '')

  const hm = text.match(/(\d{1,2})\s*[:：]\s*(\d{2})/)
  if (hm) {
    hour = Number(hm[1])
    minute = Number(hm[2])
    hasTime = true
    text = text.replace(hm[0], ' ')
  } else {
    const h = text.match(/(\d{1,2}|[一二两三四五六七八九十]{1,3})\s*[点时](半|\d{1,2}\s*分?)?/)
    if (h) {
      const n = cnNumber(h[1])
      if (n !== null && n >= 0 && n <= 24) {
        hour = n
        hasTime = true
        if (h[2]) {
          if (h[2] === '半') minute = 30
          else minute = Number(h[2].replace(/[^\d]/g, '')) || 0
        }
        text = text.replace(h[0], ' ')
      }
    }
  }

  if (periodMatch) text = text.replace(periodMatch[0], ' ')

  // 时段修正
  if (hour !== null) {
    if (['下午', '傍晚', '晚上', '夜里', '晚'].includes(period) && hour < 12) hour += 12
    else if (period === '中午' && hour < 12) hour += 12
    else if (['凌晨', '清晨', '早上', '早晨', '上午'].includes(period) && hour === 12) hour = 0
    if (hour === 24) hour = 0
  }

  /* ---------- 6. 全天 ---------- */
  if (/全天|整日/.test(text)) {
    allDay = true
    text = text.replace(/全天|整日/, ' ')
  }

  /* ---------- 7. 兜底 ---------- */
  if (!hasTime) {
    if (allDay) {
      hour = 0
      minute = 0
    } else if (hasDate) {
      // 只说了"下午"没说几点，给一个符合直觉的默认时刻
      if (period === '下午' || period === '傍晚') {
        hour = 14
      } else if (['晚上', '夜里', '晚'].includes(period)) {
        hour = 20
      } else if (period === '中午') {
        hour = 12
      } else {
        hour = 9
      }
      minute = 0
    } else {
      // 没提到任何时间：默认下一个整点半（留出准备时间）
      const next = new Date(now.getTime() + 30 * 60000)
      next.setMinutes(next.getMinutes() > 30 ? 60 : 30, 0, 0)
      targetDay = startOfDay(next)
      hour = next.getHours()
      minute = next.getMinutes()
    }
  }

  const title = text
    .replace(/[,，。;；!！?？]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!title) return null

  const start = allDay ? startOfDay(targetDay) : atTime(targetDay, hour ?? 9, minute)
  const end = allDay
    ? new Date(startOfDay(targetDay).getTime() + 86400000)
    : new Date(start.getTime() + durationMin * 60000)

  return { title, start, end, allDay, hasDate, hasTime }
}
