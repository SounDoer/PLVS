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

**为什么是 Rust + Tauri：** Rust 的无 GC 特性保证音频回调线程 realtime-safe；Tauri 用系统 WebView（无需打包 Chromium，安装包 ~10MB）；现有 React 组件完整复用。Electron 与 JUCE 因体积/定位问题被否决（详见原 architecture.md 历史与 ADR）。

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
│   │   ├── env.js                # isTauri() helper
│   │   └── types.js              # shared IPC type definitions
│   │
│   ├── lib/                      # engine integration helpers
│   │   ├── FrameIntake.js        # high-frequency frame ingestion + ring buffer
│   │   ├── audioEngineCommands.js # start/stop/device abstraction over IPC
│   │   ├── shellLayout.js        # layout computation helpers
│   │   ├── tauriFrameApply.js    # frame → React state bridge
│   │   └── …                     # floatHistorySeed, resetFloatMeteringState, utils
│   │
│   ├── math/                     # pure functions: history paths, format, spectrum math
│   │
│   ├── preferences/
│   │   ├── data.js               # UI_PREFERENCES constant (layout, typography, radii)
│   │   ├── themeResolve.js       # resolveThemeId, parsePersistedUiStateJson
│   │   ├── applyDocumentTheme.js # applyLayoutToDocument, applyThemeToDocument
│   │   └── layoutPersistence.js  # layout localStorage read/write
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
│   │   ├── LeafView.jsx          # tab container for panels
│   │   └── …                     # context, toolbar, registry, treeUtils, types
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
3. `getBuiltinTheme(themeId)` → 主题对象（含 `colorScheme`）
4. `applyLayoutToDocument(UI_PREFERENCES, { colorScheme })`：布局 / 字号 / `--ui-*` 非调色变量
5. `applyThemeToDocument(themeId)`：`data-theme`、`color-scheme`、shadcn semantic tokens、`--ui-chart-*`、Peak 渐变

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
