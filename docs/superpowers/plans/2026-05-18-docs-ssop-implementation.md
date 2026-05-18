# Docs SSOP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize `docs/` into a clean SSOP structure — accurate, consistent, and navigable by both humans and AI agents.

**Architecture:** File restructure first (moves, new dirs), then rewrite each standard doc with code as ground truth, then verify. No code changes; `npm test` is run at the end as a regression check only.

**Tech Stack:** Git, Node.js (npm test via Vitest), Markdown.

---

## Task 1: File restructure — create `docs/working/` and move process docs

**Files:**
- Create dir: `docs/working/design/`
- Move: `docs/adr/design_handoff_workspace_layout/` → `docs/working/design/workspace-layout/`
- Move: `docs/adr/Header Footer Redesion.md` → `docs/working/design/header-footer.md`
- Move: `docs/superpowers/` → `docs/working/superpowers/`

- [ ] **Step 1: Create the new directory structure and move files**

```bash
mkdir -p docs/working/design
git mv "docs/adr/Header Footer Redesion.md" docs/working/design/header-footer.md
git mv docs/adr/design_handoff_workspace_layout docs/working/design/workspace-layout
git mv docs/superpowers docs/working/superpowers
```

- [ ] **Step 2: Verify the moves**

```bash
ls docs/adr/
# Expected: only 0001-*.md and 0002-*.md

ls docs/working/design/
# Expected: header-footer.md  workspace-layout/

ls docs/working/superpowers/
# Expected: plans/  specs/
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "refactor(docs): create working/ dir and move process docs out of adr/"
```

---

## Task 2: Write `docs/README.md` — navigation index and agent entry point

**Files:**
- Create: `docs/README.md`

- [ ] **Step 1: Create `docs/README.md` with the following content**

```markdown
# PLVS — Documentation

This directory contains all development documentation for PLVS.
Standard reference docs live directly in `docs/`. Working and process docs live in `docs/working/`.

## Standard docs

| File | Purpose | Read when |
|------|---------|-----------|
| [prd.md](prd.md) | Product intent: what PLVS is, target users, features, non-goals | Understanding product scope and decisions |
| [architecture.md](architecture.md) | Technical map: tech stack, directory structure, audio pipeline, IPC, theme system | Writing code, navigating the codebase |
| [design-tokens.md](design-tokens.md) | UI token system: CSS variables, semantic tokens, theme structure | Working on visual appearance or theming |
| [loudness-references.md](loudness-references.md) | Loudness reference profile data for UI overlays | Adding or editing loudness reference targets |

## Decision records

| File | Decision |
|------|---------|
| [adr/0001-ui-layout-vs-shadcn-theme.md](adr/0001-ui-layout-vs-shadcn-theme.md) | `--ui-*` layout tokens vs shadcn/Tailwind surface tokens — boundary definition |
| [adr/0002-theme-id-and-appearance.md](adr/0002-theme-id-and-appearance.md) | `themeId`, `appearance`, `data-theme`, first-paint placeholder, chart token naming |

ADRs are historical records — do not edit them. Add a new ADR to record a new decision.

## Working docs (`docs/working/`)

Process documents generated during development. Not maintained as living references.

| Path | Contents |
|------|---------|
| `working/design/` | Design handoff specs for implemented features (workspace layout, header/footer) |
| `working/superpowers/specs/` | Design specs produced during brainstorming sessions |
| `working/superpowers/plans/` | Implementation plans (including this one) |

## For AI agents

Start here, then read `architecture.md` for the codebase map. Key facts:
- Source of truth for any technical claim is the code, not this documentation
- If a doc contradicts the code, the code wins — update the doc
- All test files are colocated with source files in `src/` (pattern: `*.test.js` / `*.test.jsx`)
- Run `npm test` to verify frontend; `npm run check` for full stack
```

- [ ] **Step 2: Commit**

```bash
git add docs/README.md
git commit -m "docs: add docs/README.md navigation index and agent entry point"
```

---

## Task 3: Rewrite `docs/prd.md`

**Files:**
- Modify: `docs/prd.md`

The current file is 254 lines with accurate product intent, but uses "AudioMeter" throughout and is missing Spectrogram. Appendix B (grill trace) is a process artifact to remove. Keep all product decisions.

- [ ] **Step 1: Apply the following targeted changes to `docs/prd.md`**

Change 1 — Title:
```
OLD: # AudioMeter — Product Requirements (PRD)
NEW: # PLVS — Product Requirements (PRD)
```

Change 2 — Abstract paragraph (line 5): replace every instance of `AudioMeter` with `PLVS`. The abstract mentions "AudioMeter" four times:
- `"AudioMeter is a local, read-only..."` → `"PLVS is a local, read-only..."`
- `"AudioMeter` in specs list (×2) → `PLVS`

Change 3 — Add Spectrogram to the features list in §5.1:
```
OLD: **表头**：**Peak / Loudness / Spectrum / Vectorscope** 同屏
NEW: **表头**：**Peak / Loudness / Spectrum / Spectrogram / Vectorscope** 同屏
```

Change 4 — §2, §3, §0 project positioning: replace every remaining `AudioMeter` with `PLVS`. Use a global find-and-replace within the file.

Change 5 — Remove Appendix B entirely (lines 237–251, the "Grill 决策追溯" section). This is a process artifact; the decisions it references are already captured in the main PRD sections.

Change 6 — Update the document-end marker if needed (should remain `**文档结束。**`).

- [ ] **Step 2: Verify no "AudioMeter" remains in prd.md**

```bash
grep -n "AudioMeter" docs/prd.md
# Expected: no output
```

- [ ] **Step 3: Verify Spectrogram appears in the features**

```bash
grep "Spectrogram" docs/prd.md
# Expected: at least one match in §5.1
```

- [ ] **Step 4: Commit**

```bash
git add docs/prd.md
git commit -m "docs: rewrite prd.md — rename AudioMeter→PLVS, add Spectrogram, remove process appendix"
```

---

## Task 4: Rewrite `docs/architecture.md`

**Files:**
- Modify: `docs/architecture.md`

Current file is 788 lines. Keep: §0 (trim), §1 (trim), §2 (keep diagram), §3 (keep terms), §5 audio, §6 DSP, §7 IPC, §8 device UX, §9 platform.
Remove: §10 CI/release (in CONTRIBUTING.md), §11 migration path (done), §12 extension points, §13 roadmap (in issues), §14 agent guide (now in docs/README.md), §15 changelog, Appendix A.
Update: all `AudioMeter` → `PLVS`, directory tree to match actual `src/` structure.

Before rewriting, read these files to verify accuracy:
- `src/ipc/commands.js` — IPC command names
- `src-tauri/src/ipc/commands.rs` — Rust-side command definitions
- `src-tauri/src/engine/meter_pipeline.rs` — pipeline structure
- `src/main.jsx` — first-paint theme application sequence

- [ ] **Step 1: Read the four verification files listed above**

Confirm: (a) command names match between JS and Rust, (b) Channel push frequency is still ~60Hz, (c) Event frequency is still ~2Hz, (d) first-paint applies `applyLayoutToDocument` then `applyThemeToDocument`.

- [ ] **Step 2: Replace the entire contents of `docs/architecture.md` with the following**

```markdown
# PLVS — Architecture

> **文档用途**：PLVS 技术地图——技术栈选型、目录结构、音频管线、前后端通信、主题系统。  
> **面向读者**：项目作者 + AI agent。以 **main 分支实现** 为准；文档与代码冲突时以代码为准。  
> **配套文档**：产品范围见 [`prd.md`](prd.md)；UI token 细节见 [`design-tokens.md`](design-tokens.md)；架构决策见 [`adr/`](adr/)。

---

## 1. 技术栈

**Tauri 2 + Rust（后端）+ React 19 / Vite（前端）**

| 层 | 技术 | 职责 |
|---|---|---|
| 桌面壳 | Tauri 2 | 系统 WebView、进程管理、平台 API 桥接 |
| 音频引擎 | Rust + cpal / Core Audio | PCM 采集、DSP 计算（peak / LUFS / FFT / vectorscope） |
| 前端 UI | React 19 + Vite + Tailwind CSS v4 | 面板渲染、布局、设置 |
| 组件库 | shadcn/ui (Radix) | 壳与设置控件 |
| 测试 | Vitest | 前端单元测试（与源文件同目录，`*.test.js/jsx`） |

**为什么是 Rust + Tauri：** Rust 的无 GC 特性保证音频回调线程 realtime-safe；Tauri 用系统 WebView（无需打包 Chromium，安装包 ~10MB）；现有 React UI 完整复用。Electron 与 JUCE 因体积/定位问题被否决（详见 ADR）。

---

## 2. 系统架构

```
┌─────────────────────────────────────────────┐
│              Tauri Application               │
│                                              │
│  ┌──────────────┐       ┌─────────────────┐  │
│  │   Frontend   │◄──────│   Rust Backend  │  │
│  │ React + Vite │Channel│                 │  │
│  │              │ ~60Hz │  Audio Engine   │  │
│  │  • Panels    │       │  ┌───────────┐  │  │
│  │  • Controls  │◄──────│  │ cpal /    │  │  │
│  │  • Settings  │ Event │  │ Core Audio│  │  │
│  │              │ ~2Hz  │  └─────┬─────┘  │  │
│  │              │──────►│        ▼        │  │
│  │              │invoke │  DSP Pipeline   │  │
│  └──────────────┘       └─────────────────┘  │
└─────────────────────────────────────────────┘
         ▲
         │ WASAPI Loopback (Windows) / Core Audio Tap (macOS 14.2+)
    System Audio
```

**数据流：**
1. **采集**：Rust 通过 cpal（Windows WASAPI Loopback + 物理输入）或 macOS Core Audio Tap 获取 PCM。
2. **DSP**：音频线程并行计算 Peak / True Peak / LUFS / FFT spectrum / correlation。
3. **推送**：高频指标（~60Hz）→ Tauri Channel；低频状态（~2Hz）→ Tauri Event。
4. **渲染**：React 订阅数据更新面板。
5. **控制**：前端按钮（START/STOP/设备切换）→ `invoke` 调 Rust command。

---

## 3. 目录结构

```
PLVS/
├── index.html                    # Vite entry
├── package.json / vite.config.js / eslint.config.js
├── scripts/
│   ├── generate-theme-fallbacks.mjs   # writes src/generated/theme-fallbacks.css
│   └── verify-versions.mjs            # checks package.json / Cargo.toml / tauri.conf.json
│
├── src/                          # React frontend
│   ├── main.jsx                  # React mount + first-paint theme apply
│   ├── App.jsx                   # Shell: workspace layout + panel routing
│   ├── FloatApp.jsx              # Float window entry (?float= route)
│   ├── index.css                 # Global styles + first-paint token fallbacks
│   ├── meterHealth.js            # Metering health state
│   ├── uiPreferences.js          # Re-export of UI_PREFERENCES
│   │
│   ├── components/
│   │   ├── panels/               # PeakPanel, LoudnessPanel, LoudnessStatsPanel,
│   │   │                         # SpectrumPanel, SpectrogramPanel, VectorscopePanel
│   │   └── ui/                   # shadcn/ui components (Button, Dialog, Select…)
│   │
│   ├── config/
│   │   ├── scales.js             # Scale definitions shared with Rust DSP
│   │   └── loudnessReferenceProfiles.js
│   │
│   ├── hooks/                    # useAudioEngine, useSettings, useLayoutDrag,
│   │                             # useHistoryInteraction, useSnapshot, useCanvasSize…
│   │
│   ├── ipc/                      # ★ single entry point for all frontend↔backend comms
│   │   ├── commands.js           # all invoke() calls
│   │   ├── events.js             # listen + Channel subscriptions
│   │   ├── capturePrefs.js       # device preference (Tauri store + localStorage)
│   │   ├── floatWindow.js        # float WebviewWindow management
│   │   ├── floatWindowPrefs.js   # float window geometry persistence
│   │   └── env.js                # isTauri() helper
│   │
│   ├── lib/                      # engine integration helpers
│   │   ├── FrameIntake.js        # high-frequency frame ingestion + ring buffer
│   │   ├── audioEngineCommands.js # start/stop/device abstraction over IPC
│   │   ├── shellLayout.js        # layout computation helpers
│   │   └── tauriFrameApply.js    # frame → React state bridge
│   │
│   ├── math/                     # pure functions: history paths, format, spectrum math
│   │
│   ├── preferences/
│   │   ├── data.js               # UI_PREFERENCES constant (layout, typography, radii)
│   │   ├── themeResolve.js       # resolveThemeId, parsePersistedUiStateJson
│   │   └── applyDocumentTheme.js # applyLayoutToDocument, applyThemeToDocument
│   │
│   ├── theme/
│   │   ├── builtinThemes.js      # BUILTIN_THEMES, THEME_IDS (plvs-dark + future)
│   │   ├── meterColorBridge.js   # chart color → CSS var bridge
│   │   └── shadcnSemanticPreset.js # shadcn semantic token preset
│   │
│   ├── workspace/                # split-tree workspace layout system
│   │   ├── constants.js          # WORKSPACE_STORAGE_KEY, DEFAULT_TREE, BUILTIN_PRESETS
│   │   ├── reducer.js            # workspace state reducer
│   │   ├── SplitLayout.jsx       # draggable split container
│   │   └── LeafView.jsx          # tab container for panels
│   │
│   └── generated/
│       └── theme-fallbacks.css   # auto-generated by npm run theme:generate
│
├── src-tauri/
│   ├── Cargo.toml                # package name: plvs
│   ├── tauri.conf.json           # productName: PLVS, identifier: com.soundoer.plvs
│   ├── capabilities/default.json # Tauri 2 permission declarations
│   ├── native/macos/tap_bridge.m # Core Audio process tap (macOS build only)
│   └── src/
│       ├── main.rs / state.rs
│       ├── audio/                # capture layer: cpal_backend, platform_backend, macos/
│       ├── dsp/                  # peak, loudness, spectrum, vectorscope, filters
│       ├── engine/meter_pipeline.rs  # PCM → metering frames → Channel/Event push
│       └── ipc/                  # commands.rs, events.rs, types.rs
│
└── docs/                         # see docs/README.md
```

---

## 4. 音频管线

### 采集层（`src-tauri/src/audio/`）

- **Windows**：`cpal_backend.rs` 通过 `cpal` 打开 WASAPI Loopback——无需虚拟声卡，直接读系统输出 PCM。物理输入也走 cpal。
- **macOS**：系统音频走 `macos/`（Core Audio process tap，需 macOS 14.2+）；物理输入走 cpal。平台分发由 `platform_backend.rs` 处理。

### DSP 层（`src-tauri/src/dsp/`）

| 模块 | 计算 |
|---|---|
| `peak.rs` | 采样峰值 + True Peak（4× 过采样） |
| `loudness.rs` | K-weighting → gate → M / S / I / LRA（ITU-R BS.1770 / EBU R128） |
| `spectrum.rs` | rFFT + Hann 窗，hop=N/4，4 帧非相干平均；带内能量按 Hz 连续边界与 bin 分数重叠积分（非整数 bin 截断） |
| `vectorscope.rs` | L/R → XY + 相关系数 |

### 编排层（`src-tauri/src/engine/meter_pipeline.rs`）

PCM 帧 → 并行 DSP → 打包 `MeteringFrame` → Channel（~60Hz）推前端；慢速响度 / 状态 → Event（~2Hz）广播。

---

## 5. 前后端通信（IPC）

前端 IPC 的**唯一入口**是 `src/ipc/`；绝不在组件或 hook 里直接调 `@tauri-apps/api`。

| 通道 | 方向 | 频率 | 用途 |
|---|---|---|---|
| **Channel** | Rust → Frontend | ~60Hz | 高频指标帧（peak、LUFS M/S、spectrum path、vectorscope） |
| **Event** | Rust → Frontend | ~2Hz | 慢速响度（I/LRA）、设备状态、健康状态 |
| **invoke (command)** | Frontend → Rust | 用户触发 | START/STOP、设备切换、设置写入 |

Rust command 定义在 `src-tauri/src/ipc/commands.rs`；前端调用封装在 `src/ipc/commands.js`。

---

## 6. 主题与 Token 系统

首屏渲染流程（`src/main.jsx`）：
1. 从 `localStorage` 键 `plvs.ui` 读 `appearance`（`system`|`fixed`）与 `themeId`
2. `resolveThemeId`（结合 `prefers-color-scheme`）→ 当前 `themeId`
3. `applyLayoutToDocument`：布局 / 字号 / `--ui-*` 非调色变量
4. `applyThemeToDocument`：`data-theme`、`color-scheme`、shadcn semantic tokens、`--ui-chart-*`、Peak 渐变

**Token 分层**（详见 [`design-tokens.md`](design-tokens.md) 与 ADR 0001/0002）：

| 层 | CSS 变量前缀 | 定义位置 |
|---|---|---|
| shadcn 语义（表面色） | `--background`, `--foreground`, `--primary`… | `builtinThemes.js` → `applyThemeToDocument` |
| UI 布局 | `--ui-*` | `data.js` → `applyLayoutToDocument` |
| 图表色 | `--ui-chart-*`, `--ui-color-*` | `builtinThemes.js` → `applyThemeToDocument` |

首屏占位变量由 `npm run theme:generate` 写入 `src/generated/theme-fallbacks.css`（与默认暗色语义同源）。

---

## 7. 关键术语

| 术语 | 定义 |
|---|---|
| **WASAPI Loopback** | Windows 原生 API：把输出设备当输入读，无需虚拟声卡 |
| **Core Audio Tap** | macOS 14.2+ 原生系统音频捕获（等效于 Windows WASAPI Loopback） |
| **realtime-safe** | 音频回调线程不做内存分配、不加锁、不 syscall |
| **Channel** | Tauri 高频单向推送通道（~60Hz 指标帧） |
| **plvs.ui** | `localStorage` 键，持久化 `appearance` + `themeId` |
| **plvs:workspace:v2** | `localStorage` 键，持久化工作区布局树 |

---

## 8. 平台说明

| 平台 | 系统音频路径 | 最低版本 |
|---|---|---|
| Windows | WASAPI Loopback（cpal） | Windows 10+（WebView2 required） |
| macOS | Core Audio process tap | macOS 14.2+（tap 能力要求） |

macOS 低于 14.2 或无 tap 能力时的回退行为以代码实现为准。免签名安装摩擦（Gatekeeper / SmartScreen）的用户说明见 `README.md`。
```

- [ ] **Step 3: Verify no "AudioMeter" remains in architecture.md**

```bash
grep -n "AudioMeter" docs/architecture.md
# Expected: no output
```

- [ ] **Step 4: Verify key directory entries are present in the new file**

```bash
grep -E "src/workspace|src/lib|src/config|src/theme" docs/architecture.md
# Expected: all four directories appear in the directory map
```

- [ ] **Step 5: Commit**

```bash
git add docs/architecture.md
git commit -m "docs: rewrite architecture.md — trim to 8 sections, accurate dir map, remove stale content"
```

---

## Task 5: Update `docs/design-tokens.md`

**Files:**
- Modify: `docs/design-tokens.md`

- [ ] **Step 1: Check for remaining "audiometer" references**

```bash
grep -in "audiometer" docs/design-tokens.md
```

- [ ] **Step 2: Replace any found instances**

For each occurrence, replace `audiometer` (case-insensitive) with `plvs` preserving original casing (`audiometer-dark` → `plvs-dark`, `AudioMeter` → `PLVS`).

- [ ] **Step 3: Verify token names against source**

Check that token names mentioned in the doc still exist in the codebase:
```bash
grep -r "plvs-dark" src/theme/builtinThemes.js
grep "layoutPersistKey" src/preferences/data.js
```

Both should return results. If a token name in the doc doesn't appear in source, update the doc to match the source.

- [ ] **Step 4: Commit (only if changes were made)**

```bash
git add docs/design-tokens.md
git commit -m "docs: update design-tokens.md — align audiometer→plvs references"
```

---

## Task 6: Final verification

- [ ] **Step 1: Confirm docs/ structure matches target**

```bash
ls docs/
# Expected: README.md  adr/  architecture.md  design-tokens.md  loudness-references.md  prd.md  working/

ls docs/adr/
# Expected: 0001-ui-layout-vs-shadcn-theme.md  0002-theme-id-and-appearance.md

ls docs/working/
# Expected: design/  superpowers/
```

- [ ] **Step 2: Confirm no "AudioMeter" anywhere in docs/ standard files**

```bash
grep -rn "AudioMeter" docs/README.md docs/prd.md docs/architecture.md docs/design-tokens.md docs/loudness-references.md
# Expected: no output
```

- [ ] **Step 3: Run frontend test suite**

```bash
npm test
# Expected: all tests pass (279 tests)
```

- [ ] **Step 4: Final commit if anything was missed**

```bash
git status
# If clean: done. If any unstaged changes: stage and commit with appropriate message.
```
