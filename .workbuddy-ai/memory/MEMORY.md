# daily-list 项目约定

## 技术栈
Electron 33 + React 18 + TypeScript + electron-vite。主进程输出 CJS（package.json 无 `type: module`，可直接用 `__dirname`）。

## 架构约定
- 主进程 `src/main`，渲染进程 `src/renderer`，共用类型与默认值放 `src/shared`
- 悬浮窗是**独立 BrowserWindow + 独立入口** `src/renderer/widget.html`，不做单页路由切换透明
- 数据存 `%APPDATA%/daily-list/daily-list.json`，**原子写**（tmp + rename）。不要引入 better-sqlite3 等原生模块
- 事件模型固定含 `id / rev / updatedAt / deleted`，为云同步预留，改数据结构时不要删这几个字段

## 测试约定
- 本机 bash 默认 `ELECTRON_RUN_AS_NODE=1`，启动 Electron 前必须 unset
- 无 GPU 环境需 `DAILY_LIST_DISABLE_GPU=1` + `--no-sandbox --disable-gpu`
- 断言式验证用 `node scripts/probe.mjs "<表达式>"`，截图用 `node scripts/smoke.mjs`
- 测试数据用 `--user-data-dir=./smoke/userdata` 隔离，不要污染真实数据

## 产品边界（MVP 刻意不做）
重复日程、系统通知提醒、拖拽调整、云同步。加功能前先确认是否越界。
