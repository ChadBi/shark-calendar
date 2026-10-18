import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, copyFileSync } from 'fs'
import type { AppData, CalendarEvent, CalendarSource, Settings } from '../shared/types'
import { DEFAULT_SETTINGS, SCHEMA_VERSION } from '../shared/defaults'

export { DEFAULT_SETTINGS, SCHEMA_VERSION }

function emptyData(): AppData {
  return { schemaVersion: SCHEMA_VERSION, events: [], sources: [], settings: { ...DEFAULT_SETTINGS } }
}

/**
 * 单文件 JSON 存储。
 *
 * 为什么不是 SQLite：better-sqlite3 是原生模块，在 Electron 下需要 electron-rebuild，
 * 会显著提高"装完就能跑"的门槛。个人日程的数据量（几千条）用 JSON 全量读写完全够用，
 * 而原子写（tmp + rename）已经能防住崩溃导致的半截文件。
 *
 * 但数据结构按多设备同步设计：id / rev / updatedAt / deleted 四个字段现在就存在，
 * 未来接云同步不需要做数据迁移。
 */
export class Store {
  private filePath: string
  private saveTimer: NodeJS.Timeout | null = null
  /** 本次启动是否从旧版本迁移而来，用于给用户一次性提示 */
  migratedFrom: number | null = null
  data: AppData

  constructor() {
    const dir = app.getPath('userData')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    this.filePath = join(dir, 'daily-list.json')
    this.data = this.load()
    if (this.migratedFrom !== null) this.saveNow()
  }

  private load(): AppData {
    if (!existsSync(this.filePath)) return emptyData()
    try {
      const raw = readFileSync(this.filePath, 'utf-8')
      const parsed = JSON.parse(raw) as Partial<AppData>
      const version = parsed.schemaVersion ?? 1
      let settings: Settings = { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) }

      if (version < 2) {
        // v2 迁移：悬浮窗从「始终置顶」改为「与普通窗口同级」。
        // 关键点：老配置里已经持久化了 widgetAlwaysOnTop: true，
        // 仅修改默认值对老用户完全无效，必须在这里显式改写。
        settings = { ...settings, widgetAlwaysOnTop: false }
        this.migratedFrom = version
      }

      return {
        // 数据来自更新版本时不要把版本号降下来，否则未来 v3 的数据
        // 被旧版程序打开会被误标成 v2，回滚时又触发一次迁移
        schemaVersion: version > SCHEMA_VERSION ? version : SCHEMA_VERSION,
        events: Array.isArray(parsed.events) ? parsed.events : [],
        sources: Array.isArray(parsed.sources) ? parsed.sources : [],
        settings
      }
    } catch (err) {
      // 文件损坏时先留档再重置，避免用户数据被静默清空
      try {
        copyFileSync(this.filePath, `${this.filePath}.corrupt-${Date.now()}.bak`)
      } catch {
        /* ignore */
      }
      console.error('[store] 数据文件解析失败，已备份并重置：', err)
      return emptyData()
    }
  }

  get settings(): Settings {
    return this.data.settings
  }

  /** 防抖落盘，避免高频写入 */
  save(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => this.saveNow(), 180)
  }

  saveNow(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    const tmp = `${this.filePath}.tmp`
    try {
      writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf-8')
      renameSync(tmp, this.filePath)
    } catch (err) {
      console.error('[store] 写入失败：', err)
    }
  }

  upsertEvent(input: Partial<CalendarEvent> & { title: string; start: string; end: string }): CalendarEvent {
    const now = new Date().toISOString()
    const existing = input.id ? this.data.events.find((e) => e.id === input.id) : undefined
    if (existing) {
      Object.assign(existing, {
        title: input.title,
        start: input.start,
        end: input.end,
        allDay: input.allDay ?? existing.allDay,
        color: input.color ?? existing.color,
        notes: input.notes ?? existing.notes,
        updatedAt: now,
        rev: existing.rev + 1
      })
      this.save()
      return existing
    }
    const created: CalendarEvent = {
      id: input.id ?? crypto.randomUUID(),
      title: input.title,
      start: input.start,
      end: input.end,
      allDay: input.allDay ?? false,
      color: input.color ?? 'blue',
      notes: input.notes,
      createdAt: now,
      updatedAt: now,
      rev: 1,
      deleted: false
    }
    this.data.events.push(created)
    this.save()
    return created
  }

  deleteEvent(id: string): void {
    const target = this.data.events.find((e) => e.id === id)
    if (!target) return
    // 软删除：保留墓碑记录，为将来同步做准备
    target.deleted = true
    target.updatedAt = new Date().toISOString()
    target.rev += 1
    this.save()
  }

  importEvents(events: CalendarEvent[]): number {
    let added = 0
    for (const e of events) {
      if (!e?.id || !e?.start || !e?.end) continue
      if (this.data.events.some((x) => x.id === e.id)) continue
      this.data.events.push({ ...e, deleted: e.deleted ?? false })
      added++
    }
    this.save()
    return added
  }

  patchSettings(patch: Partial<Settings>): Settings {
    this.data.settings = { ...this.data.settings, ...patch }
    this.save()
    return this.data.settings
  }

  /* ------------------------------------------------------------ 订阅源 */

  upsertSource(input: Partial<CalendarSource> & { name: string; url: string }): CalendarSource {
    const existing = input.id ? this.data.sources.find((s) => s.id === input.id) : undefined
    if (existing) {
      existing.name = input.name
      existing.url = input.url
      if (input.color) existing.color = input.color
      if (input.enabled !== undefined) existing.enabled = input.enabled
      this.save()
      return existing
    }
    const created: CalendarSource = {
      id: crypto.randomUUID(),
      name: input.name,
      url: input.url,
      color: input.color ?? 'violet',
      enabled: input.enabled ?? true,
      hidden: []
    }
    this.data.sources.push(created)
    this.save()
    return created
  }

  removeSource(id: string): void {
    this.data.sources = this.data.sources.filter((s) => s.id !== id)
    this.data.events = this.data.events.filter((e) => e.sourceId !== id)
    this.save()
  }

  /** 用最新拉取结果整体替换某个源的事件，避免重复堆积 */
  replaceSourceEvents(sourceId: string, events: CalendarEvent[]): { before: number; after: number } {
    const before = this.data.events.filter((e) => e.sourceId === sourceId && !e.deleted).length
    this.data.events = this.data.events.filter((e) => e.sourceId !== sourceId)
    this.data.events.push(...events)
    this.save()
    return { before, after: events.length }
  }

  /** 「忽略此次」：把某个重复实例加入黑名单，下次同步不再生成 */
  hideInstance(sourceId: string, key: string): void {
    const src = this.data.sources.find((s) => s.id === sourceId)
    if (!src) return
    src.hidden = Array.from(new Set([...(src.hidden ?? []), key]))
    this.data.events = this.data.events.filter(
      (e) => !(e.sourceId === sourceId && `${e.externalId}:${e.start}` === key)
    )
    this.save()
  }

  /** 渲染进程可见的数据：过滤掉软删除的墓碑 */
  snapshot(): AppData {
    return {
      schemaVersion: this.data.schemaVersion,
      events: this.data.events.filter((e) => !e.deleted),
      sources: this.data.sources,
      settings: this.data.settings
    }
  }

  get dataDir(): string {
    return app.getPath('userData')
  }
}
