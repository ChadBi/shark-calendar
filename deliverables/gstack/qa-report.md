# QA 测试与发布验证报告 — 日程 v0.1.0

> 测试人：gstack-qa-lead ｜ 环境：Windows + Electron 33（无 GPU，软件渲染）｜ 未修改任何 src 源码
> 证据脚本：`scripts/qa-verify.mjs`（A/B/C 断言）、`qa-verify2.mjs`（分栏 A/B + CRUD）、`qa-verify3.mjs`（编辑器/设置/悬浮窗）、`qa-corrupt.mjs`（损坏数据自愈）、`qa-packaged.mjs`（打包产物）
> 截图：`smoke/qa-*.png`（含 `qa2-day-noallday.png` 与 `qa2-day-withallday.png` 的对照）

## 1. 测试结论：🔴 不通过（修 2 个 P0 后可转 🟡/🟢）

功能完成度高：分栏算法主干正确、自然语言解析命中率高、持久化与损坏自愈可靠、打包产物可启动。
但存在 2 个必须先修的阻塞项：**全天事件污染时间轴分栏**（影响核心视觉，且是 PRD 明确要求）、**README 承诺的 `npm run dist` 不存在**（发布流程不可复现）。

## 2. Issue 清单

### 🔴 P0-1 全天事件进入时间轴，把当天所有事件压成 1/3 宽

- 复现：今天建 1 条全天事件 + 09:00 两条完全重叠 + 12:00/12:30/13:00 链式三条 + 16:00、18:00 两条不重叠 → 打开日视图（周视图同样）
- 实际：全天事件以 `top:0% / height:100%` 的全高色块出现在时间轴里（同时顶部"全天"行又出现一次，重复）；当天**全部**事件宽度 32.6%（日）/29.7%（周），连 16:00、18:00 这两条不重叠的也被压成 1/3
- 期望：全天事件只出现在顶部"全天"行；不重叠事件占满整宽
- 对照实测（删掉全天事件后同一批数据）：重叠对 49.2%/49.2%（2 列）、链式 A/C 共用第 0 列 B 第 1 列（2 列）、不重叠 99.2%（整宽）→ **算法本身是对的**
- 定位：`src/renderer/src/lib/date.ts:123` `layoutDay()` 内 `eventsOnDay(events, day)` 未过滤 `allDay`。全天事件被 `clipToDay` 裁成 0–1440，`clusterEnd` 恒为 1440，整天并成同一个重叠簇 → `cols=3`
- 修复建议：`eventsOnDay(events, day).filter(e => !e.allDay)`（TimeGrid 的 `allDayByDay` 已单独渲染全天行，UI 无需改）

### 🔴 P0-2 打包流程不可复现（README 与实现不一致）

- README「快速开始」写 `npm run dist` → `release/日程 Setup x.x.x.exe`；实际 package.json **没有 dist 脚本**、devDependencies **没有 electron-builder**（只在 node_modules 里，`npm ci` 后消失）、也**没有 build 配置**（appId/productName/nsis/icon/files）
- 现状 `release/win-unpacked/日程.exe` 是手工 `npx electron-builder` 的产物，无 NSIS 安装包、无版本号，换机器无法复现
- 修复建议：新增 `"dist": "electron-vite build && electron-builder --win"`，补 `electron-builder.yml`（appId `com.dailylist.app`、productName `日程`、`win.target: nsis`、`icon: resources/icon.ico`、`files: [out/**/*, resources/**/*, package.json]`），electron-builder 写入 devDependencies

### 🟠 P1「下周X」解析整体晚一周

- 复现：快速添加输入 `下周一 站会 30 分钟`（今天 2026-10-18 周日）→ 预览「10 月 26 日」，应为 10/19
- 根因：`lib/parse.ts:105` 的 `delta = (target - todayDow + 7) % 7` 已经指向"即将到来的周X"（多数情况就落在下周），`下` 前缀再加 7 天 → 多一周；只有今天正好是周一才正确（`下下` 同理多一周）
- 修复建议：以周起点计算 `delta = (7 - ((dow - 1 + 7) % 7)) + (target === 0 ? 6 : target - 1)`，`下下` 再加 7

### 🟡 P2（6 条）

1. **月视图双击事件 chip 变成"新建"**：实测单击→`编辑日程`，双击→`新建日程`（用户的编辑意图丢失，弹出空白表单）。`MonthView.tsx:119` chip 只对 `onClick` 做了 `stopPropagation`，缺 `onDoubleClick` 的
2. **跨天事件的次日片段仍显示原始开始时间**：次日 00:00–01:00 的块上写"23:00"。`TimeGrid.tsx:164` 用 `slot.event.start`，应用裁剪后的 `startMin`，并用已算好的 `continuesBefore` 标"←"
3. **"全天"行不粘滞**：时间轴滚动到当前时间后全天行滚出视口，全天事件就彻底看不见了（见 `qa2-day-withallday.png`）。`.allday-row` 在 `.timeline-wrap` 滚动容器内，需 `position: sticky`
4. **月视图双击空白新建默认 00:00–01:00**（实测 times=`00:00`/`01:00`）。`MonthView` 传 `startOfDay(day)`，建议默认 9:00（与快速添加的兜底一致）
5. **悬浮窗位置记忆不校验显示器**：`widgetBounds` 直接使用，拔掉副屏后悬浮窗落在屏外且没有"重置位置"入口。`createWidgetWindow` 前应用 `screen.getAllDisplays()` 的 workArea 夹取，托盘菜单加"重置悬浮窗位置"
6. **设置面板 Esc 关不掉**：README 承诺"Esc 关闭弹窗"，QuickAdd / EventEditor 支持，`SettingsPanel` 没有 keydown 处理

### 🟢 P3（择要）

- 月视图表头与网格错位：实测 delta 从 +2.5px 线性变到 −2.5px（`.month-head` 缺 `gap:6px`，`.month-grid` 有）
- `maxChips` 恒预留"还有 X 项"行高（`CELL_CHROME=45`），实测格子里还能再放 1 条却显示"还有 8 项"
- 快速添加跨天预览显示"23:30 – 01:30"，应显示"次日 01:30"（数据正确，仅文案歧义）
- 日期运算用 `86400000` 毫秒加减（`eventOverlapsDay` / `clipToDay` / `parse`），有夏令时的时区会错一天
- IPC 不校验 `start/end` 合法性（`upsertEvent` / `importEvents`），坏 ISO → Invalid Date → 事件静默消失
- 无 `session-end` / `query-session-end` 处理，Windows 关机时 `isQuitting` 未置位，`close` 的 `preventDefault` 可能让关机被应用卡住
- 无 git 仓库（无版本可回滚）；README 引用的 `screenshots/*.png` 为空；`resources/tray.png` 未被使用

## 3. 已验证通过（均为真实启动 + CDP 断言，非人工目测）

| 项 | 结果 |
| --- | --- |
| `npm run build` / `npm run typecheck` | 通过，0 error |
| 打包产物 `release/win-unpacked/日程.exe` | 可启动，asar 内 index.html 加载，42 格 + 设置正常，无报错 |
| 空数据首启 | 42 格 + "今天还没有安排"，无白屏 |
| 完全重叠 | 2 列，各 49.2% |
| 链式重叠 A9-10/B9:30-10:30/C10-11 | 2 列，A、C 共用第 0 列，B 第 1 列（无全天事件时） |
| 不重叠 | 99.2% 整宽（无全天事件时） |
| 0 分钟事件 | 17px 最小可视高度，不消失 |
| 跨天 23:00→次日 01:00 | 两天都显示且各自裁剪：当天 top 95.83%/52px，次日 top 0/52px，`→` 标记正确 |
| 周视图 | 7 列 + 7 表头 + 23 个刻度 + 1 条当前时间红线 |
| 周视图点击空白吸附 | 10:22→10:30、10:37→10:30、14:01→14:00 |
| 月视图 | 42 格、今天高亮、"还有 8 项"、200 字标题不溢出（chip 109 / cell 123px）、`<script>` 与 emoji 纯文本渲染（无 XSS、无横向滚动） |
| CRUD | 新建 / 编辑 / 软删除（8→7，墓碑落盘）均正常 |
| 编辑器跨天 | 23:00–01:00 存为次日 01:00，时长显示"2 小时"；全天开关隐藏时间输入 |
| 自然语言 | 明天下午3点 / 周五14:30 / 10-20 / 晚上8点 / 后天全天 全部正确；"买牛奶"取下一个半点；乱码优雅降级；"3点"无标题回退完整表单 |
| 持久化 | 原子写（tmp+rename），70 条 25KB，schemaVersion 1 |
| 损坏数据自愈 | 写入半截 JSON 后启动：不白屏、自动备份 `.corrupt-<ts>.bak`、重建数据文件 |
| 悬浮窗 | 440px ↔ 折叠 56px 双向正确、透明度 0.92、长标题 ellipsis（sw 2513 / cw 259）无溢出、进行中计数与实际时间一致 |
| 关闭窗口 | 渲染进程存活（隐藏到托盘，未退出） |
| 性能 | 50 条顺序写入 144ms；周/月视图切换 6/13ms（70 条事件） |

## 4. 发布检查清单（打包前必须确认）

1. 修完 P0-1 后重跑 `qa-verify2.mjs` 的 A/B 两组断言（不重叠必须回到 ~99%）
2. 补 `dist` 脚本 + electron-builder 配置，electron-builder 进 devDependencies；在干净目录 `npm ci && npm run dist` 验证
3. 用 NSIS 安装包实测：安装 / 卸载 / 开机自启（`setLoginItemSettings` 只有安装版才写注册表）
4. 版本一致性：package.json `0.1.0` 与 README、安装包版本号对齐；补齐 README 引用的 5 张 screenshots
5. 三连回归：`node scripts/smoke.mjs`、`qa-verify.mjs`、`qa-verify3.mjs` 全绿
6. 打包版实测托盘：关窗隐藏、托盘菜单退出、`Ctrl+Alt+N` / `Ctrl+Alt+D`（注册失败不阻断启动，需看日志）
7. 写 `schemaVersion` 迁移函数（当前 `Store.load` 只做浅合并，将来加字段会丢数据）

> 环境备注：本机 `npm run build` 第二次会因 safe-delete shim 删除 `out/` 失败，需先把 `out` 改名再构建。属环境问题，非产品缺陷。

## 5. 回滚预案

- **前置**：当前目录不是 git 仓库 → 发布前先 `git init` + `git tag v0.1.0`；在此之前至少整包备份 `src/` 与 `out/`
- **产物回滚**：同时保留上一版 `release/win-unpacked` 与 `Setup.exe`，回滚 = 覆盖安装旧包
- **数据不回滚**：数据在 `%APPDATA%/daily-list/daily-list.json`，`schemaVersion=1` 未变，新旧版可互读；若新版写坏数据，删除/重命名该文件即自动重建，且已有 `.corrupt-*.bak` 可恢复
- **白屏级故障**：托盘仍可用 → 菜单「打开数据文件夹」导出数据；README 排障段需保留这条路径
- **触发条件**：安装后首启白屏、托盘无图标、悬浮窗无法显示、或事件大面积消失 → 立即回退旧包并回收 `.corrupt-*.bak`
