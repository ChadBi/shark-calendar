# 🦈 鲨鱼日程

一个常驻托盘的 Windows 桌面日程软件。月 / 周 / 日三种视图，一个贴在桌面上的悬浮小窗，支持 ICS 订阅导入 Google / Outlook 日历，以及多设备云同步。

![月视图](screenshots/month.png)

| 周视图 | 日视图 |
| --- | --- |
| ![周视图](screenshots/week.png) | ![日视图](screenshots/day.png) |

| 桌面悬浮窗 | 快速添加 |
| --- | --- |
| ![悬浮窗](screenshots/widget.png) | ![快速添加](screenshots/quickadd.png) |

| 订阅外部日历 | 订阅管理 |
| --- | --- |
| ![订阅](screenshots/subscription.png) | ![订阅管理](screenshots/subscription-settings.png) |

## 功能

**三种视图**

- **月视图**：固定 6×7 网格，每格按可用高度自动显示 N 条事件，超出部分折叠为「还有 X 项」
- **周视图**：7 列 × 24 小时时间轴，重叠的事件自动并排分栏，当前时间有红线指示
- **日视图**：单列时间轴 + 右侧当日详情面板

**记一条日程的成本要足够低**

- `Ctrl + K` 打开快速添加，直接输入 `明天下午3点 和设计对需求 1小时`，回车即存
- 支持 `今天/明天/后天`、`周五/下周一`、`10/20`、`下午3点/14:30/晚上八点半`、`2小时/30分钟`
- 解析结果实时预览，认不出来就退回到完整表单，不会丢输入

**桌面悬浮窗**

- 无边框透明小卡片，显示今天的所有安排，进行中的那条会高亮并带呼吸圆点
- **默认不置顶**：和普通窗口同级，切到浏览器或编辑器时会被自然遮挡，不会一直压在别的窗口上面
- 需要常驻最前时，点悬浮窗标题栏的图钉按钮即可临时置顶（设置里也能改）
- 拖动标题栏移动位置，位置会被记住；可折叠成一行、可调背景透明度
- 点任意一条直接跳到主窗口的编辑框

**订阅外部日历**

- 支持粘贴 ICS 链接（`https://.../basic.ics` 或 `webcal://...`），把 Google 日历、Outlook、Apple 日历同步进来
- 解析 VEVENT 全字段，支持 `RRULE` 重复规则展开（DAILY / WEEKLY / MONTHLY / YEARLY、BYDAY、INTERVAL、COUNT、UNTIL）与 `EXDATE` 排除
- 正确处理折行、转义字符、`VALARM` 嵌套、`TZID` 时区
- 订阅事件**只读**：不能直接编辑删除，但可以「忽略此次」（跳过重复会议里的某一场）或「复制为我的事件」
- 启动后自动同步一次，之后每 6 小时刷新；也可以手动刷新。同步失败会保留上一次的数据，不会把日历变空

**托盘常驻**

- 关闭窗口默认隐藏到托盘（可在设置里改），`Ctrl + Alt + N` 全局唤起新建
- 托盘菜单可开关开机自启、打开数据文件夹

**云同步**

- 本地创建的日程可以在多台设备间同步，后端用腾讯云开发 CloudBase（部署指南见 `docs/cloud-sync-setup.md`）
- 只同步本地事件：订阅来的日历是派生数据，每台设备各自拉取，不参与同步
- 删除是墓碑，同步到其他设备后不会「复活」
- 冲突按修改时间取新（同一秒内两台设备同时改同一条才会撞车，实际几乎不会发生）
- 访问令牌用系统加密存储（Windows DPAPI），不会写进数据文件
- 同步时机：启动后 4 秒、本地改动后 2.5 秒、每 5 分钟轮询，也可手动触发

## 快速开始

```bash
npm ci             # 按锁文件安装依赖
npm run dev        # 开发模式（热更新）
npm run build      # 构建
npm start          # 用构建产物启动
npm run dist       # 打包成 Windows 安装包 → release-v8/
```

`npm run dist` 会生成 `release-v8/鲨鱼日程 Setup x.x.x.exe`（NSIS 安装包，可自选安装目录）。输出目录由 `package.json` 的 `build.directories.output` 配置。

## 更换应用图标

图标就是普通图片，不需要设计软件。把新图（PNG / JPG，方形，建议 ≥ 256x256）准备好，然后：

```bash
node scripts/update-icon.mjs <你的图片路径>
npm run dist
```

转换图片和生成托盘图标需要安装 Python 与 Pillow（`python -m pip install Pillow`）。脚本会从 PATH 查找解释器，也可以通过 `PYTHON` 环境变量指定 Python 可执行文件路径。

脚本会自动完成格式转换（electron-builder 只认 PNG）、生成 1024×1024 主图标和 32×32 托盘小图标，之后重新打包就生效。

相关文件：
- `resources/icon.png` —— 主图标
- `resources/tray.png` —— 托盘小图标
- `resources/icon-source.*` —— 你放进去的原始图片（留档，方便回滚）
- `scripts/gen-icon.mjs` —— 程序化生成图标的备用方案

## 快捷键

| 快捷键 | 作用 |
| --- | --- |
| `Ctrl + K` | 快速添加（自然语言） |
| `N` | 新建事件 |
| `T` | 回到今天 |
| `1` / `2` / `3` | 切换 月 / 周 / 日 视图 |
| `←` / `→` | 上一页 / 下一页 |
| `Ctrl + Enter` | 在编辑框里保存 |
| `Esc` | 关闭弹窗 |
| `Ctrl + Alt + N` | 全局：唤起新建（应用在托盘也生效） |
| `Ctrl + Alt + D` | 全局：显示 / 隐藏桌面悬浮窗 |

## 数据

日程数据保存在本机：

```
%APPDATA%\daily-list\daily-list.json
```

写入采用「临时文件 + rename」的原子写，程序崩溃不会产生半截文件。如果文件被外部破坏，启动时会自动备份为 `daily-list.json.corrupt-<时间戳>.bak` 并重置，不会白屏。

数据结构按**多设备同步**预留了字段：每条事件带 `id` / `rev` / `updatedAt` / `deleted`（软删除墓碑），顶层带 `schemaVersion`。

云同步默认关闭；启用后，本地创建的日程会上传到你配置的同步服务器。订阅日历会从你配置的 ICS 地址下载，订阅事件不参与云同步。部署与配置方法见[云同步部署指南](docs/cloud-sync-setup.md)。

访问令牌单独保存在同一数据目录下的 `sync-token.bin`，Windows 支持系统加密时使用 DPAPI；不要公开这个文件或含私人日程、订阅链接的数据文件。

## 项目结构

```
src/
├── main/              # 主进程
│   ├── index.ts       # 窗口、托盘、悬浮窗、IPC、全局快捷键
│   └── store.ts       # JSON 存储（原子写 + 损坏自愈）
├── preload/           # contextBridge 暴露的 API
├── shared/            # 主进程与渲染进程共用的类型、默认值、配色
└── renderer/
    ├── index.html     # 主窗口
    ├── widget.html    # 悬浮窗（独立渲染进程）
    └── src/
        ├── lib/date.ts      # 日期工具 + 重叠事件分栏算法 layoutDay()
        ├── lib/parse.ts     # 自然语言快速添加解析
        └── components/      # MonthView / TimeGrid / EventEditor / ...
scripts/
├── gen-icon.mjs       # 纯 Node 生成应用图标（无第三方依赖）
├── update-icon.mjs    # 一键更换应用图标（自动处理格式与尺寸）
├── smoke.mjs          # 冒烟测试：启动应用 + CDP 截图
└── probe.mjs          # 在运行中的渲染进程里执行 JS 做断言
```

## 测试

```bash
npm run typecheck    # 类型检查
node scripts/smoke.mjs   # 启动真实应用，截图到 smoke/
node scripts/probe.mjs "document.querySelectorAll('.month-cell').length"   # 应为 42
```

打包后的启动检查使用 `node scripts/qa-packaged.mjs`，先运行 `npm run dist:dir`。同步服务联调使用 `node scripts/verify-packed.mjs <同步服务地址>`，地址不带末尾 `/sync`，必须自行传入。

## 源码与发布

仓库保留源码、锁文件、图标和演示截图。依赖、构建与打包目录、测试运行数据、AI 工作记录、开发交付报告和本地凭据已加入 `.gitignore`。Windows 安装包通过 GitHub Releases 单独发布。

应用内部标识 `package.json` 的 `name` 保持为 `daily-list`，以沿用现有用户数据目录；显示名称由 `build.productName` 配置。

项目采用 [MIT 许可证](LICENSE)。

## 已知限制

- 暂不支持重复日程（**本地创建**的；订阅来的重复日程会正常展开）
- 暂不支持系统通知提醒
- 暂不支持拖拽调整事件时间
- 订阅只读：不能在自己软件里改外部日历的事件，改动请回原日历操作
- 订阅展开范围限定在「过去 60 天 ~ 未来 365 天」，单源上限 3000 条实例
- 云同步已就绪，但同步用的服务端需要自行部署（CloudBase 云函数模板已放在 `cloudbase/`，见部署指南）；不想用云同步不影响任何本地功能
- 仅针对 Windows 打包配置；Electron 本身跨平台，macOS / Linux 需自行补打包配置
