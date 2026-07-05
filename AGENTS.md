# AGENTS.md — PLVS

PLVS：实时音频计量桌面应用（Tauri 2 + Rust 后端 / React 19 + Vite 前端）。
详细文档见 docs/，本文件只记**每次都要遵守的约定**和**踩过的坑**。

## 文档地图（需要细节时去读，别在这里重复）
- 架构 / 音频管线 / IPC / 主题：docs/architecture.md
- 产品范围与边界：docs/prd.md
- Token 系统：docs/design-tokens.md
- 架构决策：docs/adr/
- 本地开发 / CI / 版本规则：CONTRIBUTING.md
> 文档与代码冲突时，**以 main 分支代码为准**。

## 硬约定（违反会被 CI 或 review 挡下）
- **音频引擎 IPC 收口**：与 Rust 音频引擎的通信（invoke / Channel / Event：启停采集、切设备、指标帧订阅）只走 `src/ipc/`，不在组件里直接拼命令名调 `@tauri-apps/api/core`。
  （注意：窗口/托盘/置顶/开机自启等外壳 API 是各 hook 直接调 `@tauri-apps/api` 的，**不**收口——别照搬"全部收口"的说法。）
- **版本三处同步**：`package.json` / `src-tauri/Cargo.toml` / `src-tauri/tauri.conf.json` 三处 version 必须一致，`npm run version:check` 会校验。
- **源码注释 / commit / PR 全英文**。仅匹配本地化 OS/UI 文本的字符串字面量除外。
- **行尾 LF**（见 .editorconfig / .gitattributes）。
- **合并前必过** `npm run check`（前端 format + lint + test + build + 版本 + Rust fmt/clippy/test）。

## 踩过的坑（来自真实改过的 commit）
- **持久化分域**：状态分三个域，`src/persistence/index.js` 里的 `settingsStore` / `workspaceStore` / `presetsStore`；底层在 Tauri 下走 plugin-store、否则 localStorage。新增持久化键先确认归属，别再退回已废弃的 `plvs.ui` 适配层；旧键清理在 `cleanupLegacyKeys.js`。
- **窗口几何用物理像素存取**：bounds 存的是物理像素（`inner_size`+`outer_position`），还原必须用 `set_size`/`set_position`（物理），不能走 builder 的 `inner_size`/`position`（逻辑像素）——否则缩放屏（如 150%）下每次启动窗口翻倍变大。见 `src-tauri/src/lib.rs`。

## 约定（非铁律，相关时参考）
- **realtime-safe**：音频回调线程应不做内存分配 / 不加锁 / 不 syscall。改 `src-tauri/src/audio`、`dsp` 时留意——细节见 docs/architecture.md §7。
- **生成文件不手改**：`src/generated/theme-fallbacks.css` 由 `npm run theme:generate` 产出（prebuild 自动跑）。
- 测试与源文件同目录，命名 `*.test.js` / `*.test.jsx`（Vitest）。

## 工作流偏好
- 回复用中文；代码 / 路径 / 术语保持英文。
- **可以用 subagents（Agent 工具）分担工作**，但省着点 token：仅在任务确实能并行、或需要隔离上下文时才 spawn；琐碎的小活直接自己干，别为省事频繁起 agent。
  - **按子任务难度选模型**：搜索 / 改字串 / 跑命令这类机械活派便宜模型（Haiku、Sonnet），只有需要复杂推理的子任务才用 Opus。用 Agent 的 `model` 参数指定。
- **Commit/CL message 不要以 `@` 开头**。根因：Windows PowerShell 下用 here-string `@'...'@` 传多行 message 时，定界符的 `@` 会漏进 subject。改用多个 `-m` 拼 subject 和 body，别用 here-string。
