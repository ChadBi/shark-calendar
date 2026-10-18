# 第二轮复测报告 — 悬浮窗层级 + ICS 订阅

> 复测人：gstack-qa-lead ｜ 全程真实启动 Electron + CDP 断言，未改 src
> 新增脚本：`qa-migrate.mjs`（6 次启动验迁移）、`qa-migrate2.mjs`（迁移提示时序）、`qa-subscription-edge.mjs`（异常路径）、`qa-subscription-edge2.mjs`（时区/UI 忽略/挂起）、`qa-widget2.mjs`（图钉+回归）、`qa-dup.mjs`（复制为我的日程）

## 1. 结论：🟡 有条件通过

两处改动的**主干逻辑都正确**：迁移 A1–A6 全部通过，订阅的正常流程、错误文案、失败保留数据、黑名单、删除源、时区换算全部正确，上轮 P0-1（全天事件污染分栏）已修复，build/typecheck 干净。
但订阅有 1 个可让面板永久卡死的缺陷（无超时），另有 3 处边界问题；迁移提示 100% 送不到。修完 4 项 + 重新打包即可发版。

## 2. Issue 清单

### 🟠 P1-1 fetchIcs 无超时 → 订阅面板永久卡在「同步中…」，并阻塞其他源
- 复现：添加一个「接受连接但永不响应」的地址（我用本地 `/slow` 路由模拟）
- 实际：8 秒仍未返回；渲染进程 `syncing` 永远为 true → 添加/刷新/删除按钮全 disabled，只能重启；`syncAll` 串行 `await`，一个挂起源会挡住后面所有源；6 小时定时器还会不断堆积未完成的请求链
- 期望：5–15s 超时并提示「请求超时」
- 定位：`src/main/ics.ts:306` `net.fetch` 无 AbortSignal → 加 `AbortSignal.timeout(15000)`；`src/main/sync.ts:98` 建议 `Promise.allSettled`

### 🟡 P1-2 添加失败会留下僵尸订阅源，且每 6 小时无限重试
- 复现：依次添加「这不是一个链接」「file:///C:/windows/win.ini」「/404」「/html」
- 实际：四次都 `ok:false` 且文案正确，但 `sources` 从 0 涨到 4，设置面板出现 4 条用户从未添加成功的「同步失败」条目，URL 已落盘并会每 6 小时重试
- 期望：首次同步失败就不落盘（或标记 pending 由用户确认）
- 定位：`src/main/index.ts:374` 先 `upsertSource` 再 `syncSource`；失败时 `removeSource(src.id)`

### 🟡 P1-3 webcal:// 与 https:// 指向同一日历时算两个源 → 事件重复
- 复现：先加 `https://host/a.ics`，再加 `webcal://host/a.ics`
- 实际：`sources:add` 用 `s.url.trim()` 原样比较，`normalizeIcsUrl` 只在 fetchIcs 内部生效 → 生成两个源，事件 id 前缀不同 → 同一日程两份（本地实测该变体因测试服务是明文 HTTP 报 ERR_SSL_PROTOCOL_ERROR，但去重路径已确认）
- 期望：入库前先 normalize 再比较
- 定位：`src/main/index.ts:366`、`src/main/store.ts:161`

### 🟡 P1-4 迁移提示 100% 送不到（6 次启动 0 次 toast）
- 复现：写入 v1 文件（`widgetAlwaysOnTop: true`）后启动
- 实际：迁移数据全对（v→2、onTop→false、其余设置与事件保留、落盘 v2），但用户看不到任何提示；用 CDP 在页面加载早期就注册 `onMigrated` 也没收到事件；对照实验（走 UI 触发「订阅失败」）toast 正常，说明通道没问题
- 期望：老用户升级后看到「悬浮窗已改为普通窗口」
- 定位：`src/main/index.ts:435` 在 `did-finish-load` push 事件，而渲染进程 `store.ts:94` 要等 `init()` 里 `await getData()` 之后才注册（`ipcRenderer.on` 不缓存）；且 `once('did-finish-load')` 在 `createMainWindow()` 之后才注册，页面先加载完就漏。建议把 `migratedFrom` 放进 `data:get` 返回值主动读

### 🟡 P1-5 截断的 ICS 会被当「空日历」清空已有事件
- 复现：`fetchIcs` 只校验 `BEGIN:VCALENDAR`（`ics.ts:313`），不校验 `END:VCALENDAR`；代理中断导致半截响应也能通过 → `parseIcs` 返回 0 条 → `replaceSourceEvents` 清空该源
- 期望：缺少 `END:VCALENDAR` 视为失败并保留旧数据
- 定位：`ics.ts:313` 补 `/END:VCALENDAR/i` 校验

### 🟢 P3
`truncated` 未在 UI 展示；`enabled` 字段没有开关；`unescapeText` 先替换 `\n` 再替换 `\\`，字面 `\\n` 会被误还原（`ics.ts:82`）；`Store.load` 把任何版本都写成 2，未来 v3 降级会误判（`store.ts:55`）；`safeWidgetBounds` 只判交集不夹取；只读编辑器里 Ctrl+Enter 仍会走 `commit()`（无实际数据变化，建议忽略）。

## 3. 已验证通过

- **迁移 A1–A6**：v1→v2 正确（含无 `schemaVersion` 的极老数据）；事件与其余设置（opacity/defaultView/hour24）保留；落盘即 v2；二次启动不重复迁移；用户手动开启置顶后重启保持 true；v2 数据不被改写
- **订阅主流程**：11 条导入、重复同步幂等（11→11 无重复）；既有 13 项断言（折行/转义/RRULE/EXDATE/全天/VALARM/只读）全绿
- **异常路径**：非法 URL / file:// / 404 / HTML 文案可读且不清空数据；空日历 ok 且 0 条不崩；断网同步保留 10 条事件并写 `lastError`，UI 显示「同步失败：…」
- **忽略此次**（API + UI 两条路径）：实例消失、`hidden` 落盘、再同步不复活（5→4）
- **删除订阅源**：其事件全清（11→0），本地事件保留
- **复制为我的日程**：生成无 `sourceId` 的本地事件、可正常编辑保存，原订阅事件不变
- **时区（D3）**：纽约冬令时 10:00→15:00Z、夏令时 10:00→14:00Z、上海 10:00→02:00Z、UTC 原样、无时区按本地、跨 DST 歧义时刻 01:30→05:30Z（取第一次，正确）；不存在的 02:30 归一到 06:30Z 且时长仍 1 小时（可接受）
- **悬浮窗**：默认不置顶（getData=false）；图钉双向切换生效且 `active` 高亮；折叠 440↔56；隐藏再显示不崩（moveTop 路径）
- **回归**：日视图重叠 49.2%/49.2%、不重叠 99.2%、全天只在「全天」行（上轮 P0-1 已修）；周视图 7 列 + 红线；月视图 42 格；快速添加解析正常；`npm run build` / `tsc --noEmit` 干净

## 4. 发布检查清单

1. 修 P1-1 后重跑 `qa-subscription-edge.mjs` 的 B13（应返回超时错误而非挂起）
2. **release/ 必须重新打包**：现有 `release/win-unpacked/resources/app.asar` 是 12:27 的产物，grep 不到 `VCALENDAR`，不含本轮功能 → `npm run dist`，用 NSIS 包实测「图钉 + 订阅」两处
3. `package.json` 版本 0.1.0 → 0.2.0（schemaVersion 1→2 是有感变更），README 与安装包版本对齐
4. 打包版实测托盘菜单、关窗隐藏、`Ctrl+Alt+N/D`、开机自启（仅安装版写注册表）
5. 迁移回归在**安装版**上再跑一次（数据路径 `%APPDATA%/daily-list` 与 dev 不同）
6. 三连回归：`smoke.mjs` / `test-subscribe.mjs` / `qa-widget2.mjs` 全绿
