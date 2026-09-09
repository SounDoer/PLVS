# 参与贡献

感谢你对 PLVS 的兴趣。以下为本地开发与 CI 约定；产品范围与承诺见 [`docs/prd.md`](docs/prd.md)，技术架构见 [`docs/architecture.md`](docs/architecture.md)。

## 环境

- **Node.js**：`.nvmrc` 是唯一版本源，CI 的 `setup-node` 也读它；`package.json` 的 `engines` 只声明下限。
- **Rust**：stable（与 `src-tauri/Cargo.toml` 的 `rust-version` 一致）
- **FFmpeg sidecar**：`npm run ffmpeg:fetch`。`src-tauri/binaries/` 不入库（sidecar 走 Release 资产），新 clone 和新 worktree 都是空的，缺了它 Rust 侧构建会失败——而且报错指向 `serde_derive` 编译失败这种无关的第三方 crate，真正原因埋在 build script 的输出里。构建流程见 [`docs/ffmpeg-sidecar-build.md`](docs/ffmpeg-sidecar-build.md)。

## 常用命令

```bash
npm ci
npm run ffmpeg:fetch     # once per clone/worktree: downloads the gitignored FFmpeg sidecars
npm run theme:generate   # optional: regenerates src/generated/theme-fallbacks.css (also runs via prebuild)
npm run lint
npm test
npm run build
```

桌面端（Tauri）：

```bash
npm run desktop
```

`npm run desktop` 和 `npm run desktop:build` 都会带上 `--config src-tauri/tauri.dev.conf.json --features dev-identity`，把 app identifier 换成 `com.soundoer.plvs.dev`。开发版因此有自己的 `%APPDATA%\com.soundoer.plvs.dev\plvs-settings.json` 和自己的 webview 数据，不会和本机安装的正式版互相覆盖设置、窗口位置和 dock 状态。构建脚本会先以同一 identity 构建独立的 `src-tauri/plvs-cli` workspace package，再把它 staging 为 Tauri external binary；host 与 CLI 两边必须成对出现。切换开发/正式 identity 时，Cargo 只需分别刷新受该 feature 影响的 package。

需要让 agent 检查或调整正在运行的开发版 Workspace 时，另开一个终端：

```bash
npm run desktop:control -- inspect --json
npm run desktop:control -- workspace apply layout.json --json
```

`desktop:control` 会安静地增量构建独立 CLI package，并固定使用同一个 `dev-identity`，再将参数直接转发给扁平的 `plvs-cli` 命令；开发版 GUI 必须已经运行。它不依赖 Settings 中的 Agent Control / PATH，也不会发现或修改本机安装的正式版。公开的 release CLI 使用同一套扁平命令，但通过正式版 identity 与已安装应用通信。Windows 使用当前用户 named pipe，macOS 使用私有 Unix socket；Visual Capture 截图支持两个平台，录制暂时只支持 Windows。

NSIS 相关的脚本（`desktop:dev-nsis`、`desktop:release-nsis`）**不带**这个 overlay：注册表登记键 `HKCU\Software\SounDoer\PLVS` 是写死的，且 `scripts/generate-agent-discovery.mjs` 只读基础 `tauri.conf.json`，给它们套上 overlay 只会写出自相矛盾的登记。

Windows 发布构建（与 CI `release.yml` 一致：NSIS 安装包 + Portable ZIP）：

```bash
npm run build
npm run desktop:release-nsis
```

原始产物：`src-tauri/target/release/bundle/nsis/` 下的安装程序，以及
`src-tauri/target/release/plvs.exe` 和 `plvs-cli.exe`。Tag 发布工作流把后两者保持原名打包
为 `PLVS-v<version>-x64-portable.zip`；便携版依赖本机已安装 WebView2，与安装包相同。
`scripts/build-plvs-cli.mjs` 是 CLI debug/release、development/release identity 与 Tauri staging
的唯一构建入口；Tauri 输入文件带 target triple，安装后和 Portable 中的公开名称不带。

Rust（在 `src-tauri` 目录下）：

```bash
cd src-tauri
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

根目录一键检查 **前端 + 版本号 + Rust 格式/静态检查/测试**：

```bash
npm run check
```

## 版本号

发布或 bump 版本时，请同时修改（并保持三者一致）：

- 根目录 `package.json` 的 `version`
- `src-tauri/Cargo.toml` 中 `[workspace.package]` 的 `version`（`plvs` 与 `plvs-cli` 共同继承）
- `src-tauri/tauri.conf.json` 的 `version`

`npm run version:check` 会校验上述三处一致；CI 中也会运行。若改了 `Cargo.toml` 依赖，请在 `src-tauri` 下执行 `cargo check` 并视情况提交 `Cargo.lock`。

## Code comments

All **comments and docstrings in source code** (`*.rs`, `*.js`, `*.jsx`, `*.css`, etc.) must be **English** (line/block/JSDoc, Rust `///` / `//!`). **String literals** that must match localized OS or UI text (e.g. Windows device name heuristics) are exempt.

## Git commits and PRs

Use **English only** for commit messages, PR titles/descriptions, and any text that accompanies `git push` (no Chinese in those strings).

**Changelist (CL) descriptions**—the full narrative in a pull request body (or any equivalent review “description” field)—must also be **English** (what changed, why, risks or follow-ups in clear technical prose).

## CI 说明

- **Pull request / push 到 `main`**：见 [`.github/workflows/ci.yml`](.github/workflows/ci.yml)（前端 + Ubuntu 上 Rust；Windows 上 Rust `fmt` / `clippy` / `test`）。
- **Windows 安装包**：打 `v*` 标签触发 [`.github/workflows/release.yml`](.github/workflows/release.yml)。

## 依赖更新

仓库已启用 [Dependabot](.github/dependabot.yml)（npm 与 cargo，每周）。合并前请在本地跑一遍 `npm run check`。

## 行尾与编码

仓库使用 **LF**（见 [`.editorconfig`](.editorconfig) 与 [`.gitattributes`](.gitattributes)）。在 Windows 上若 Git 仍提示 CRLF，可执行 `git add --renormalize .` 一次性规范化。
