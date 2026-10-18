# 桌面日程软件 · 第二轮迭代交付报告

**日期**：2026-10-18
**场景**：全流程交付（需求评审 → 代码实现 → QA 复测）
**参与成员**：产品评审员（gstack-product-reviewer-2）、QA 与发布负责人（gstack-qa-lead）、主理人（team-lead）
**版本**：0.1.0 → 0.2.0

---

## 📌 TL;DR

- 整体结论：🟢 **通过**。两个需求均已落地，QA 复测提出的 5 个必修项全部修复并回归验证。
- 阻塞项数量：0（修复前为 1 个 P1 会导致订阅面板永久卡死）
- 关键判断：需求 A 的实质不是「改默认值」，而是**数据迁移**——老用户的 `widgetAlwaysOnTop: true` 已经落盘，新默认值对他们完全无效。
- 下一步：安装包已重新产出，可安装使用；重复日程与系统通知列入 V1.5。

---

## 🎯 核心结论卡片

| 项目 | 内容 |
|------|------|
| Go / No-Go | 🟢 Go |
| 严重度分布 | 🔴 0 / 🟠 1 / 🟡 8 / 🟢 6（QA 提出 5 个必修，另自查发现 2 个） |
| 关键行动项 | 4 条（全部完成） |
| 建议负责人 | 主理人负责修复，QA 负责回归 |

---

## 1. 各成员核心结论

### 🔍 产品评审员（需求评审）

- **核心判断（需求 A）**：用户说的「和桌面一个级别」实质是「别挡着我干活」，对应的是**普通窗口**语义，不是真正的桌面层窗口。后者（Windows 需要 SetParent 到 WorkerW）会带来「点不到、最大化时永远不可见、Explorer 重启就消失」等一连串问题，与「抬眼能看见日程」的目标自相矛盾，**明确不做**。
- **关键洞察（需求 A 的真因）**：`DEFAULT_SETTINGS` 改成 false 对老用户无效——设置已经在 `daily-list.json` 里持久化为 true，`load()` 的 `{...DEFAULT, ...parsed.settings}` 会用旧值覆盖新默认值。必须做 schemaVersion 迁移显式改写。
- **核心判断（需求 B）**：RRULE **必须支持**。Google 导出的日历里每周例会、生日占比极高，丢掉重复事件的日历是「错的日历」，比没有更伤信任。但只做「展开式」——存具体实例而非规则，现有渲染层零侵入。
- **关键建议（只读语义）**：订阅事件不可编辑不可删除，但必须提供「忽略此次」（本地黑名单，解决「取消某一场重复会议」）和「复制为我的本地日程」（逃生口）。UI 固定一句「订阅事件请回原日历修改」。
- **被采纳情况**：全部采纳。展开范围「过去 60 天 ~ 未来 365 天」、单源 3000 实例上限、失败不清空数据、6 小时刷新，均按建议落地。

### ✅ QA 与发布（复测）

- **核心判断**：🟡 有条件通过。迁移链路 A1–A6 全通过，订阅正常流程与异常文案都正确，但存在 **1 个会让订阅面板永久卡死的缺陷**（请求无超时）+ 3 个边界问题 + 迁移提示 100% 送不到。
- **关键发现**：`net.fetch` 缺少超时 → 遇到「接受连接但永不响应」的地址时 `syncing` 永远为 true，所有按钮 disabled，只能重启；且 `syncAll` 串行执行，一个挂起的源会挡住后面全部。
- **修复后复测**：5 个必修项全部验证通过，其中超时精确在 15.0s 返回，界面未卡死。

---

## 2. 交付清单

### 改动 1：悬浮窗层级（需求 A）

| 文件 | 变更 |
| --- | --- |
| `src/shared/defaults.ts` | `widgetAlwaysOnTop` 默认 true → false；`SCHEMA_VERSION` 1 → 2 |
| `src/main/store.ts` | **迁移逻辑**：`version < 2` 时强制 `widgetAlwaysOnTop = false` 并落盘，记录 `migratedFrom` |
| `src/main/index.ts` | 移除 `setVisibleOnAllWorkspaces`（它会让窗口压在全屏应用之上）；`showWidget()` 补 `moveTop()` 并处理首次创建的竞态；`safeWidgetBounds()` 改为夹取到屏幕工作区 |
| `src/renderer/src/Widget.tsx` | 标题栏加图钉按钮，一键切换置顶，置顶时高亮 |
| `src/renderer/src/components/SettingsPanel.tsx` | 开关文案改为「置顶显示」，说明改清楚两种状态的行为差异 |
| `src/shared/types.ts` + `store.ts` | `AppData.migratedFrom` 通过 `data:get` 返回，替代不可靠的 push 通知 |

### 改动 2：ICS 日历订阅（需求 B）

| 文件 | 说明 |
| --- | --- |
| `src/main/ics.ts` | 手写解析器：折行合并、转义还原、TZID 时区换算（含 DST）、VALARM 嵌套隔离、EXDATE；`expandOccurrences()` 用 rrule 展开；`fetchViaNet()` 走 `net.request` + 15s 超时 + 8MB 上限 + 首尾标记校验 |
| `src/main/sync.ts` | `syncSource` / `syncAll`（并发）。整体替换该源事件，失败保留旧数据只记 `lastError` |
| `src/main/store.ts` | `removeSource` / `replaceSourceEvents` / `hideInstance` |
| `src/main/index.ts` | IPC `sources:add/remove/sync/hideInstance`；添加时先同步成功再落盘、按归一化 URL 去重；启动延迟 5s 同步 + 每 6 小时 |
| `src/renderer/src/components/SubscriptionPanel.tsx` | 订阅管理 UI（添加/刷新/删除、同步时间与条数、截断提示、链接等同密码的提醒） |
| `src/renderer/src/components/EventEditor.tsx` | 订阅事件只读态：来源 banner、输入禁用、「忽略此次」/「复制为我的日程」 |

### 测试覆盖

| 脚本 | 覆盖 | 结果 |
| --- | --- | --- |
| `scripts/test-migrate.mjs` | v1→v2 迁移、老事件保留、落盘检查、二次启动不重复迁移、用户手动开启后不被改回、迁移标记送达 | ✅ 10 项 |
| `scripts/test-subscribe.mjs` | 折行/转义/RRULE/EXDATE/全天/VALARM 隔离/只读/重复链接去重 | ✅ 13 项 |
| `scripts/test-edge.mjs` | 404/HTML/非法链接/file 协议不落盘、截断 ICS 被拒、15s 超时、超时不清空数据、界面不卡死 | ✅ 25 项 |
| `scripts/smoke.mjs` | 主流程截图回归 | ✅ |

### 发布检查清单

- [x] `tsc --noEmit` 无错误
- [x] `npm run build` 通过
- [x] 三个测试脚本全绿（共 48 项断言）
- [x] 版本号升至 0.2.0
- [x] 重新打包（旧 `release/` 不含本轮功能）
- [ ] 安装版实测：托盘菜单、关窗隐藏、`Ctrl+Alt+N` / `Ctrl+Alt+D`、开机自启
- [ ] 安装版迁移回归（`%APPDATA%/daily-list` 与 dev 路径不同）

### 回滚预案

- 数据层：`schemaVersion` 1→2 为**单向迁移**。回滚到 0.1.0 时，`widgetAlwaysOnTop` 会停留在 false（旧版能正常读取 v2 数据，只是不再置顶）。如需恢复旧行为，手工把 `daily-list.json` 里的 `settings.widgetAlwaysOnTop` 改回 true。
- 订阅数据可随时删除：设置面板移除订阅源即删除其全部事件，本地事件不受影响。
- 代码层：`git log` 基线为 `7652688`（本轮功能提交）。

---

## 3. 综合审查发现（按严重度排序）

| # | 严重度 | 类别 | 位置 | 问题描述 | 状态 |
|---|--------|------|------|---------|------|
| 1 | 🟠 | 稳定性 | `ics.ts` | `net.fetch` 无超时，卡死地址会让面板永久「同步中」 | ✅ 改 `net.request` + 15s 超时 |
| 2 | 🟡 | 数据 | `index.ts` | 添加失败仍落盘，留下僵尸订阅并每 6 小时重试 | ✅ 先同步成功再落盘 |
| 3 | 🟡 | 数据 | `index.ts` | `webcal://` 与 `https://` 同源被当两个源，事件重复 | ✅ 比较前归一化 |
| 4 | 🟡 | 交互 | `index.ts`/`store.ts` | 迁移提示用 push 发送，与监听注册抢时序，100% 丢失 | ✅ 改为 `data:get` 返回值 |
| 5 | 🟡 | 数据 | `ics.ts` | 截断的 ICS 被当空日历，清空已有事件 | ✅ 校验 `END:VCALENDAR` |
| 6 | 🟢 | 解析 | `ics.ts` | 转义还原顺序错误，字面 `\\n` 被误还原成换行 | ✅ 改一次性正则替换 |
| 7 | 🟢 | 布局 | `index.ts` | 悬浮窗位置只判交集，可能只露出一个角 | ✅ 夹取到工作区 |
| 8 | 🟢 | 交互 | `EventEditor.tsx` | 只读态 Ctrl+Enter 仍触发保存 | ✅ 只读时忽略 |
| 9 | 🟢 | 显示 | `SubscriptionPanel.tsx` | `truncated` 未展示给用户 | ✅ 加「已达上限」提示 |
| 10 | 🟢 | 数据 | `store.ts` | 未来 v3 数据被降级标成 v2 | ✅ 保留更高版本号 |
| 11 | 🟢 | 交互 | `index.ts` | 同一链接重复添加会产生两份事件 | ✅ 按归一化 URL 去重（自查发现） |
| 12 | 🟢 | 稳定性 | `index.ts` | `moveTop()` 在首次创建时窗口未 ready | ✅ `once('show')` 兜住（自查发现） |

---

## 4. 行动清单

| # | 行动 | 负责方 | 紧急度 | 状态 |
|---|------|--------|--------|------|
| 1 | 修复请求超时，避免订阅面板永久卡死 | 主理人 | P0 | ✅ |
| 2 | 修复失败落盘、webcal 重复、迁移提示丢失、截断清空 | 主理人 | P1 | ✅ |
| 3 | 重新打包 0.2.0 安装包 | 主理人 | P1 | ✅ |
| 4 | 安装版上实测托盘/快捷键/迁移 | 待人工 | P2 | ⏳ 需在目标机器操作 |

---

## 5. 待完善 / 已知局限

- **订阅只读**：不能在自己软件里改外部日历事件，这是设计选择而非缺陷。
- **不支持 `RECURRENCE-ID` 覆盖**：Google 里「只改某一次重复会议的时间」产生的覆盖记录，目前会被当作独立事件与原始实例同时显示。这是已知限制，V1.5 补。
- **不支持 `RDATE`、`BYSETPOS`、`BYYEARDAY`**：遇到时忽略该部分规则。
- **无订阅级开关**：`CalendarSource.enabled` 字段已存在但 UI 未暴露。
- **本地 .ics 文件导入未做**：当前只支持 URL 订阅。链接失效时可改用「复制为我的日程」逐条保留。
- **云同步仍未实现**：数据模型字段齐备，接同步层即可。

---

## 6. 成员产出索引

- gstack-product-reviewer-2（产品评审员）：需求 A 三档层级方案与「不做桌面层」的判断、需求 B 的 RRULE 必要性与只读语义规则、刷新策略与三大风险。
- gstack-qa-lead（QA 与发布）：`deliverables/gstack/qa-report-round2.md`，含 5 个必修项、6 类异常路径验证、时区/DST 用例、发布检查清单。
- 主理人（team-lead）：全部代码实现、12 项修复、48 项断言的测试脚本、打包与文档。

---

> 本报告由软件工坊 AI 协作生成，关键决策请由工程负责人复核。
