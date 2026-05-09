# AudioMeter — Architecture & Roadmap

> **文档用途**：这是 AudioMeter 从「无需安装的网页工具」重构为「**Windows / macOS 原生壳（Tauri）**」的架构决策档案。内容覆盖技术选型、项目结构、通信协议、分发策略和路线图。
>
> **面向读者**：项目作者本人 + 未来参与开发的 AI agent / 协作者。每项决策都附带了原因和被否决的替代方案，便于任何人快速理解"为什么是现在这样"。
>
> **文档状态**：随仓库演进维护；与代码不一致时以 **main 分支实现** 为准，重大修订记在 **§15 Changelog**。  
> **与 PRD 分工**：**产品范围、用户故事、体验原则、非目标与路线图**以 **[`prd.md`](prd.md)** 为准；本文负责 **技术栈、分层、IPC、设备与发版工程**。若冲突：先对齐 **用户承诺（PRD）**，再改实现与本文技术描述。

---

### 配套文档

| 文档 | 职责 |
|---|---|
| **[`prd.md`](prd.md)** | 产品需求（PRD）：目标用户、承诺、明确不做、隐私/分发、多声道路线图等；附录含与 main 的 **实现对照 / gap** 摘要。 |
| **`architecture.md`（本文）** | 架构与实现决策：目录、协议、DSP 口径摘要、平台采集路径、CI/Release、Agent 工程约束。 |

---

## 0. 项目定位（必读）

**AudioMeter 是一个纯监测类的音频仪表工具，定位为声音设计师桌面常驻的参考表头。**

### 核心承诺

- **纯监测、不处理音频**：只读系统正在播放的信号，给出测量数据。永远不动声音本身。
- **Windows 优先**：主力用户与文档仍以 **Windows + WASAPI Loopback** 为第一叙述；**不考虑 Linux**。
- **macOS 桌面版（当前 main）**：与 Windows **同源 Tauri 应用**，**GitHub Release** 上由 CI 同时产出 **Windows（NSIS + 便携）** 与 **macOS DMG（Apple Silicon）**；系统音频走 **macOS 14.2+ Core Audio process tap**（见 §9），**不**依赖网页版那套 BlackHole 路由方案。低于 14.2 / 无 tap 时的回退与限制以代码与 Release 说明为准。
- **独立应用形态**：永远不做 VST / AU / AAX 插件，不进 DAW 宿主。
- **用户无需安装虚拟声卡（相对旧网页版）**：在 **Windows** 上对「听系统正在播的声音」成立（WASAPI Loopback）；**macOS** 上对应能力来自 **系统级 tap**（非第三方虚拟声卡）。

### 明确不做的（避免未来被反复提起）

**完整非目标列表、Legacy 政策、会话边界等**以 **[`prd.md`](prd.md) §6** 为准；下表从 **架构可行性** 角度保留高频否决项，便于与 §附录 A、ADR 交叉引用。

| 不做 | 原因 |
|---|---|
| 离线音频文件分析 | 定位是实时监测工具，不是分析工具 |
| 真实 EQ / 任何音频处理 | 一旦处理声音，"从哪里输出"是无解的架构难题（见 **[`prd.md`](prd.md) §6**，及本文 §0） |
| VST / AU / AAX 插件 | 放弃 DAW 生态，专注独立软件形态 |
| 多设备同时监测 / A-B 信号源对比 | v1.0 范围外，可能永远不做 |
| 商店上架（Microsoft Store / Mac App Store） | 避开沙箱限制，保持技术自由度 |
| Linux 支持 | 用户基数小，维护成本不值得 |

---

## 1. 技术栈

**Tauri 2 + Rust（后端）+ React / Vite（前端）**

### 为什么是这个组合

**Rust**：

- 无 GC，音频回调线程可做 realtime-safe 处理（对 LUFS 等连续测量关键）。
- Cargo 工具链现代，Rust 音频生态（`cpal`、`rustfft`、`hound`、`dasp` 等）足够支撑长期演进。
- 内存安全由编译器保证，长期维护风险低。

**Tauri 2**：

- 用系统自带 webview（Windows 上是 Edge WebView2），不打包 Chromium，安装包 ~10MB 量级。
- 前后端进程分离：Rust 做音频采集 + DSP，React 只负责 UI，职责清晰。
- 现有的 React 组件、math 工具、UI 交互逻辑能整体复用。

### 被否决的替代方案

| 方案 | 否决原因 |
|---|---|
| **Electron** | 严肃音频分析类工具在 Electron 上几乎没有先例（Slack/Discord 的"音频"只是被动播放/编解码）。音频路径里要避开 GC 抖动需要把所有 DSP 压进原生模块，本质上是"用 Electron 做了一个 Tauri 形状的东西"。安装包 100MB+ 体验也差。 |
| **JUCE（C++）** | JUCE 最大价值是"一套代码编成 Standalone/VST/AU/AAX 插件"。本项目明确不做插件，这个优势完全浪费。剩下的"工业级实时音频基础设施"Rust 生态也能提供。现有 React UI 全部丢弃成本过高。 |
| **Qt / 其他原生 UI** | UI 生态远不如 Web，开发效率低，现有代码零复用。 |
| **Flutter / .NET MAUI** | 桌面音频生态不成熟，路径上没看到严肃案例。 |

### 关于"Tauri + Rust 做音频工具没有先例"这件事

事实是：Tauri 社区里几乎没有严肃的音频仪表 / 分析类工具（awesome-tauri 清单里音频相关的只有混音播放器、字幕工具、屏幕录制等）。这意味着**某些问题我们是第一次踩**（比如 Tauri Channel 在高频推送下的延迟特征）。此决策是在充分知道这一点之后做出的——理由是 Rust 的音频生态（库层面）足够用，且长期维护性优于 Electron。

---

## 2. 系统架构总览

```
┌────────────────────────────────────────────────────────────┐
│                      Tauri Application                     │
│                                                            │
│  ┌──────────────────┐         ┌─────────────────────────┐  │
│  │   Frontend       │         │   Rust Backend          │  │
│  │ (系统 WebView)   │◄────────┤                         │  │
│  │                  │ Channel │  ┌─────────────────┐    │  │
│  │  React + Vite    │  60Hz   │  │ Audio Engine    │    │  │
│  │                  │         │  │                 │    │  │
│  │  • Panels        │         │  │  ┌───────────┐  │    │  │
│  │  • Controls      │◄────────┤  │  │ cpal      │  │    │  │
│  │  • Settings      │  Event  │  │  │ WASAPI    │  │    │  │
│  │  • History UI    │   2Hz   │  │  │ Loopback  │  │    │  │
│  │                  │         │  │  └─────┬─────┘  │    │  │
│  │                  │────────►│  │        │        │    │  │
│  │                  │ invoke  │  │        ▼        │    │  │
│  │                  │(command)│  │  ┌───────────┐  │    │  │
│  └──────────────────┘         │  │  │ DSP       │  │    │  │
│                               │  │  │ Pipeline  │  │    │  │
│                               │  │  └───────────┘  │    │  │
│                               │  └─────────────────┘    │  │
│                               └─────────────────────────┘  │
└────────────────────────────────────────────────────────────┘
          ▲
          │ WASAPI Loopback（Windows 原生，无需虚拟声卡）
          │
  ┌───────┴────────┐
  │  System Audio  │
  │   (播放中)      │
  └────────────────┘
```

### 数据流简述

1. **采集**：**Windows** 上 Rust 通过 `cpal` 打开 **WASAPI Loopback**，从当前选的输出设备读 PCM；**macOS** 上系统播放路径由 **`audio/macos/` + Core Audio tap** 提供 PCM，物理麦克风等输入仍可走 **cpal**（由 `AppAudioBackend` / `platform_backend` 分发）。
2. **DSP**：PCM 进入 Rust 音频线程，并行计算 Peak / True Peak / LUFS / FFT / Correlation 等指标。
3. **推送**：
   - 高频指标（~60Hz）通过 Tauri Channel 推给前端。
   - 慢指标（~2Hz）和状态变化通过 Tauri Event 广播。
4. **渲染**：前端 React 订阅数据，画面板。
5. **控制反向**：前端按钮（START / STOP / 设备切换等）通过 `invoke` 命令调 Rust。

---

## 3. 术语表（重要，避免歧义）

| 术语 | 定义 |
|---|---|
| **系统音频捕获** | 泛指"监听系统正在播放的声音"这个**目标**。不指定具体技术。 |
| **loopback** | 特指 **WASAPI Loopback**——Windows 原生 API，允许应用直接把输出设备当输入读。**不需要任何第三方驱动**。v1.0 的核心技术。 |
| **虚拟声卡 / Virtual Audio Device** | VB-Cable、BlackHole、Loopback by Rogue Amoeba 等第三方驱动方案。旧网页版依赖这种方式，v1.0 要消灭这个依赖。 |
| **Core Audio Taps** | macOS 14.2+ 的原生系统音频捕获 API，地位类似 Windows 的 WASAPI Loopback。**当前 main** 在受支持系统上用于系统音频路径（实现见 `src-tauri/src/audio/macos/`、`native/macos/tap_bridge.m`）。 |
| **realtime-safe** | 音频回调线程中不做任何可能阻塞或不可预测延迟的操作（无内存分配、无锁、无 syscall 等）。 |

---

## 4. 项目结构

### 仓库策略

- **原地重构**：保留 `SounDoer/AudioMeter` 仓库本身（URL、Stars、Issues、git 历史都延续）。
- **main 分支目录结构彻底重新设计**，不被旧代码约束。
- **旧网页版代码移到 `legacy-web` 分支**冻结，打一个 tag `v0.9.0-web-final`。
- **GitHub Pages 继续指向 `legacy-web` 分支的 build**，让老用户仍能用。
- README 明确标注"网页版已停止维护，桌面版见 Releases"。

### 核心原则

1. **现有代码只有"在新结构里仍然是最佳解"才能留下**。不为沉没成本妥协。
2. **`public/worklets/loudness-meter.js` 绝不带进新架构**（Phase 2 必须删除）。
3. **组件边界按新的关注点重新切分**，不受旧 hooks / components 结构束缚。

### 目录树

```
AudioMeter/
├── .github/
│   └── workflows/
│       ├── ci.yml                   # lint + test（前端 + Rust）
│       ├── release.yml              # Windows NSIS + 便携 exe；macOS DMG（tag 时 attach Release）
│       └── deploy-pages.yml         # （若启用）legacy / Pages 相关构建
├── .editorconfig
├── .gitignore                       # 含 src-tauri/target/、dist/
├── LICENSE                          # MIT 保持不变
├── README.md                        # 重写：桌面版介绍 + 旧网页版链接
│
├── index.html                       # Vite 入口
├── package.json                     # 前端依赖
├── package-lock.json
├── vite.config.js
├── eslint.config.js
│
├── src/                             # 前端 React 代码
│   ├── main.jsx                     # React 挂载入口
│   ├── App.jsx                      # 顶层组件（页面编排）
│   ├── index.css                    # 全局样式（无单独 styles/ 目录）
│   ├── FloatApp.jsx                 # `?float=` 辅窗口入口
│   ├── components/
│   │   ├── panels/
│   │   │   ├── PeakPanel.jsx
│   │   │   ├── LoudnessPanel.jsx
│   │   │   ├── SpectrumPanel.jsx
│   │   │   └── VectorscopePanel.jsx
│   │   ├── PillButton.jsx           # 顶栏按钮等
│   │   ├── SettingsPanel.jsx
│   │   └── HelpPopover.jsx
│   ├── hooks/
│   │   ├── useAudioEngine.js        # 订阅 Rust emit 的音频指标
│   │   ├── useHistoryInteraction.js # 历史窗拖拽 / 视口
│   │   ├── useSnapshot.js           # 快照模式逻辑
│   │   ├── useLayoutDrag.js         # 可拖动分割线 + 持久化
│   │   ├── useSettings.js           # 设置 / UI 模式
│   │   ├── useFloatMeteringCore.js  # 浮窗与主窗共用计量订阅
│   │   └── …                        # 其它浮窗与 Frame 订阅封装
│   ├── ipc/                         # ★ 前后端通信层（invoke/listen/Channel 的唯一入口）
│   │   ├── commands.js              # 所有 invoke
│   │   ├── events.js                # listen + Channel 订阅封装
│   │   ├── capturePrefs.js          # 采集设备 id：tauri-plugin-store / localStorage
│   │   ├── floatWindow.js           # 辅 WebviewWindow、Pop out
│   │   ├── floatWindowPrefs.js      # 浮窗几何持久化（与 dpi / window API）
│   │   ├── env.js
│   │   └── types.js
│   ├── math/                        # 纯函数（刻度、历史路径、格式、频谱辅助等）
│   ├── scales.js                    # 与 Rust DSP / UI 共享的刻度约定
│   └── uiPreferences.js
│
├── public/                          # 静态资源（图标等）
│   └── (不再有 worklets/)
│
├── src-tauri/                       # Rust 后端
│   ├── Cargo.toml
│   ├── Cargo.lock
│   ├── tauri.conf.json              # 窗口、权限、bundle 配置
│   ├── build.rs
│   ├── native/
│   │   └── macos/
│   │       └── tap_bridge.m         # Core Audio process tap（仅 macOS 构建）
│   ├── icons/                       # 应用图标（多平台多尺寸）
│   ├── capabilities/                # Tauri 2.x 权限声明
│   │   └── default.json
│   └── src/
│       ├── main.rs                  # 入口
│       ├── lib.rs                   # 桌面/移动共用入口
│       │
│       ├── audio/                   # 【音频采集层】
│       │   ├── mod.rs
│       │   ├── capture.rs           # AudioCapture trait、PcmFrame
│       │   ├── platform_backend.rs  # 按 OS 选择 cpal 与/或 macOS tap
│       │   ├── cpal_backend.rs      # WASAPI loopback + 物理输入（Windows / 跨平台 cpal）
│       │   ├── macos/               # （仅 macOS 编译）Core Audio tap、PCM 桥
│       │   ├── device_id.rs
│       │   └── device.rs
│       │
│       ├── dsp/                     # 【DSP 计算层】
│       │   ├── mod.rs
│       │   ├── peak.rs              # 采样峰值 + True Peak（过采样）
│       │   ├── loudness.rs          # LUFS: K-weighting + gating
│       │   ├── spectrum.rs          # rFFT + Hann；RTA 带内分数 bin 积分
│       │   ├── paths.rs             # 频谱 SVG path（与前端 scales 对齐）
│       │   ├── vectorscope.rs       # L/R → XY + 相关系数
│       │   └── filters.rs           # K-weighting 等滤波器
│       │
│       ├── engine/                  # 【编排层】
│       │   ├── mod.rs
│       │   └── meter_pipeline.rs    # PCM → 各表头 + Channel 帧 / 慢响度 emit（节流在 pipeline 内）
│       │
│       ├── ipc/                     # 【前后端通信】
│       │   ├── mod.rs
│       │   ├── commands.rs          # #[tauri::command] 定义
│       │   ├── events.rs            # emit 事件类型
│       │   └── types.rs             # 前后端共享数据结构（serde）
│       │
│       └── state.rs                 # 全局 AppState
│
├── tests/                           # 前端测试（Vitest）
│
└── docs/
    └── architecture.md              # 本文档（DSP 算法长篇注记预留为 dsp-notes.md，尚未添加）
```

### 分层设计的关键决策

**按"关注点"而非"面板"切分**：

- `audio/` 只管"从系统拿到 PCM 流"
- `dsp/` 只管"把 PCM 转成各种指标"，每个文件对应一个指标族
- `engine/` 编排 audio + dsp，是唯一一个"懂全局"的模块
- `ipc/` 是边界层，规定前后端协议

**好处**：加新表头时只在 `dsp/` 加一个文件，不会像网页版那样 hooks 和 panel 互相交织。

**前端 `ipc/` 层的硬约束**：业务组件与 hooks **不得直接**调 `invoke()`、`listen()` 或自建 Channel 订阅；一律经 `src/ipc/commands.js`、`src/ipc/events.js` 等。窗口几何、多 webview、DPI 等仅封装在 `ipc/floatWindow.js`、`ipc/floatWindowPrefs.js` 等文件内，**不得**在 Panel 里散落 `import "@tauri-apps/api"`。好处：换协议只改一处；测试可 mock；UI 不依赖具体 Tauri 细节。

---

## 5. 音频采集层

### 采集库：`cpal`

使用 [`cpal`](https://github.com/RustAudio/cpal) 作为跨平台音频 I/O 库。

**理由**：

- Rust 音频圈事实标准，文档、example、AI 熟悉度都最高。
- v0.15+ 原生支持 WASAPI Loopback（Windows 上直接把 output device 当 input stream 打开）。
- 同一套抽象在 **macOS** 上与 **Core Audio tap + cpal 输入** 并存（见 `audio/platform_backend.rs`），复用 `dsp/` / `meter_pipeline`。

**被否决的替代**：

- **`wasapi` crate**：控制力更强但只管 Windows，macOS 要再学一套，工作量不划算。
- **直接 FFI 调 Win32 / Core Audio**：开发量爆炸，无必要。

### 抽象层设计

在 `cpal` 之外包一层薄的 `AudioCapture` trait：

```rust
// src-tauri/src/audio/capture.rs（节选；以仓库为准）
pub trait AudioCaptureSession: Send {
    fn request_clear_peak_history(&self);
}
pub trait AudioCapture: Send + Sync {
    fn list_devices(&self) -> Result<Vec<DeviceInfo>, String>;
    fn start_session(
        &self,
        device_id: &str,
        frame_subscribers: FrameSubscribers, // 主窗 Channel + 浮窗订阅者，代替单一 Channel
        app: tauri::AppHandle,
        meter_history: MeterHistoryBuf,
    ) -> Result<Box<dyn AudioCaptureSession>, String>;
}
// `FrameSubscribers` 定义见 `ipc/types.rs`。`CaptureSession` 在 `cpal_backend.rs`；macOS tap 路径在 `audio/macos/`。
// `build_device_list` 为 `pub(crate)`，外部只经 `AudioCapture::list_devices`。
```

**为什么要这层抽象**：

- **macOS** 已实现为 **独立 tap 路径 + cpal 输入**，由 `AppAudioBackend` 选用；上层 **DSP / `meter_pipeline` 不感知**具体是 loopback 还是 tap。
- 如果某天发现 `cpal` 在某平台有硬伤，可以局部换实现。
- **不是过度设计**——这层很薄，只是归口设备枚举与 `start_session`。

### 设备 `id`：稳定句柄与兼容

- **当前**：列表项使用稳定 id —— `lb-{32 hex}`（渲染端 loopback）与 `cap-{32 hex}`（采集端），由设备名 + 通道数 + 默认采样率 + 盐值哈希得到；枚举顺序变化不会改变同一物理设备的 id。
- **兼容**：仍接受旧版 `out:N` / `in:N`（cpal 枚举下标），便于已持久化的偏好平滑迁移。
- **实时桥**：cpal 回调 → 计量线程通过 `sync_channel<Vec<f32>>` 传递交错 PCM（不再经自定义字节打包）；队列满时丢弃并计数，worker 侧周期性 `warn` 日志。

### PCM 数据结构：为多声道做准备（**重要**）

v1.0 实际显示立体声，但底层数据结构**必须**支持任意通道数：

```rust
pub struct PcmFrame {
    pub samples: Vec<f32>,      // interleaved: [L0, R0, L1, R1, ...] 或多声道
    pub channels: u16,          // ← 关键：跟着设备走，不写死
    pub sample_rate: u32,
    pub timestamp_ns: u64,
}
```

**UI 渲染原则**：前端面板按"收到几个通道画几个通道"，不硬编码 L / R。

**用户体验**：用户选哪个设备就自动切换到对应通道数——选 stereo 扬声器显示 2 通道，选 5.1 设备显示 6 通道，选 mono 麦克风显示 1 通道。

**多声道与 Vectorscope（v1.0 已落地）**：`channels > 2` 时，Rust 侧 **Peak（采样峰值 L/R）/ Loudness（BS.1770 立体声路径）/ Vectorscope + 相关** 仍从交错 PCM **每帧取前两路**（与常见「表头 = ch1/ch2」降级一致）。但 **Spectrum** 的口径不同：当 `channels > 2` 时，Spectrum 显示为 **单条聚合曲线**，其每个频带读数为 **对所有通道的线性功率/能量求和后再转 dB**（stereo/mono 行为不变）。**未做**：隐藏 VS、或 UI 任选两路、或多通道相关矩阵——仍列为后续产品项（见 §13 候选）。

---

## 6. DSP 层

### 需要实现的指标（v1.0 完整保留网页版功能）

| 面板 | 指标 | 算法要点 |
|---|---|---|
| **Peak** | 采样峰值 (L/R)、峰值保持、TP MAX | True Peak 用 4x 过采样（EBU R128 / ITU-R BS.1770） |
| **Loudness** | Momentary / Short-term / Integrated / M Max / ST Max / LRA / PSR / PLR | ITU-R BS.1770-4 + EBU R128 gating（-70 LUFS absolute + -10 LU relative） |
| **Spectrum** | 实时频率响应曲线（RTA 显示口径） | 见下节 **「Spectrum / RTA（实现口径）」** |
| **Vectorscope** | L vs R 李萨如图 + Correlation | 相关系数标准 Pearson 公式 |

### Spectrum / RTA（实现口径 · 已拍板）

与**专业音频 / 母带类频谱软件**的常见做法对齐，**不**按 **IEC 61260** 计量级「逐档数字带通滤波器组 + Class 1/2 验收」实现（那是噪声计 / 合规分析仪路径）。

| 采用（v1.0） | 说明 |
|---|---|
| **FFT 型 RTA 显示** | 短时 **rFFT + Hann 窗** → 各 bin 幅度经 **N 归一** 后得**线性功率**；对每个 **按倍频程几何划分的 f_lo～f_hi** 档，将各 bin 的功率按 **连续 Hz 边界** 做带内积分：**假定功率在每个 bin 对应的 Hz 子区间内均匀分布**，用该档与 bin 子区间的**重叠长度占 bin 宽度的比例**加权累加（**分数 bin / partial band integration**），再 `10·log10` 得档内 dB。**不再**用 `floor`/`ceil` 把整档映射到整数 bin 全计入（否则在低频、对数横轴上易出现「横线台阶」）。其后叠加 **Z/A/C**、邻频/时间平滑。与多数 DAW / 监听类插件的「常 Q / 倍频程条带」观感一致，**低延迟、实现成本可控**。 |
| **与 IEC 61260 的关系** | IEC 61260-1 规定的是**带通滤波器**的相对衰减与允差；若未来要**对外宣称**符合该标准，须改为（或并行提供）**标准滤波器组或经认证的等效结构**，单独立项。 |
| **与 Loudness 的关系** | Spectrum 为 **dBFS 域**带内能量示意；**LUFS** 为 **K 计权 + gating + 积分时间常数**；**数值不可横向等同**。 |

#### 纵轴单位与参考（dBFS，精确定义）

- **叫什么**：纵轴表示各 RTA 档在 **数字采样域** 内的 **带内线性能量**（对经 Hann 窗与 **N 归一** 后的 bin 线性功率做档内加权积分，见上表），再取 **`10·log10`** 得到的分贝读数；参考量为 **数字满刻度（full scale）**，工程命名应为 **dBFS**（decibels relative to full scale）。也可表述为 **dB re. FS** 或 **band / spectrum level in dBFS**。
- **不是什么**：**不是**声压级（**dB SPL**，re. 20 µPa）；**不是**模拟线路电平（**dBu** / **dBV**）；**不是**响度（**LUFS** / **LKFS**，K 计权 + gating + 积分时间常数，见 **Loudness** 路径）。
- **与 Peak 表「dBFS」的差别（易混点）**：AES / 常见数字音频语境下，**dBFS** 最狭义的用法是 **相对满幅的采样峰值**（例如 0 dBFS = 可编码最大幅度）。Spectrum 纵轴是 **各倍频程档内的谱功率估计**（FFT 型 RTA），**检波/定义与采样峰值表不同**，但 **参考域仍是同一套数字满幅与实现中的 FFT 归一约定**，因此单位名称仍用 **dBFS** 是正确且与多数 DAW / 监听类插件表述一致；对比两条表头时，应理解成 **「同一参考域、不同物理量」**，不可把两列数值当作同一检波器的重复读数。
- **UI 与文档**：界面刻度可能只标数字、悬停写 **`dB`** 而未写 **`FS`**；对外说明或帮助文案若需严谨，应明确为 **dBFS（带内能量，数字满幅为参考）**。

### 迁移策略

当前网页版 `public/worklets/loudness-meter.js` 是参考实现。**算法是对的，只是要从 JS 翻成 Rust**。这是纯体力活，无算法风险。

**推荐 Rust 侧使用的库**：

- `rustfft` — FFT
- `biquad` 或手写 — K-weighting 滤波器（二阶 IIR）
- 无锁环形缓冲：`ringbuf` crate（**可选**；当前实现未引入，若以后在回调线程与 worker 间硬分核再考虑）

### 历史数据：ring buffer 下沉到 Rust（**为未来功能铺路**）

现在网页版的历史数据在前端 JS 管理。v1.0 要**把历史 buffer 移到 Rust 侧**：

- Rust 维护一个内存中的 ring buffer（当前 `HIST_RING_CAP = 36000` 行、约 **95 ms** 一行，总时长约 **57 分钟** 量级，与前端历史窗默认尺度一致，可调）
- 所有 DSP 输出**同时**：emit 给前端用于画图 + 写入 ring buffer
- 前端通过专用 command 按需访问历史（快照模式、未来的导出、对比）

**为什么要下沉**：

- 未来的"数据导出"、"两段时间对比"、"长时间分析"都基于这个 buffer，都在 Rust 做更合适。
- 前端只是 buffer 的一个 consumer，不再持有主数据。

---

## 7. 前后端通信协议

### 三种通信机制的分工

| 场景 | 机制 | 频率 |
|---|---|---|
| 前端触发操作（START / 设备切换 / 清除历史等） | `invoke` command | 按需 |
| 高频音频指标（Peak / M&ST Loudness / Spectrum / Vectorscope） | **Tauri Channel** | ~60 Hz |
| 慢指标（Integrated / LRA / Max / PSR / PLR） | **Tauri Event** | ~2 Hz |
| 全局通知（设备列表变化、引擎状态、错误） | **Tauri Event** | 按需 |

### 为什么这么分

**Channel** 用于高频单向流：Tauri 2 新增特性，专为此场景设计，比 Event 轻量。

**Event** 用于低频广播：未来多窗口时多个窗口都能收到，天然适合。

**不全用 Event**：Event 是广播语义，多窗口时每个 listener 都收到全量高频数据会浪费带宽。

**不全用 Channel**：Channel 生命周期绑在单次 command 调用上，不适合全局通知。

### 数据粒度：Rust 永远推"算好的指标"，不推 PCM（**架构硬约束**）

这是**不妥协的**原则。

- ✅ 正确：Rust 算完 LUFS / FFT / Correlation，推给前端的是少量已经成型的数值。
- ❌ 错误：Rust 把 PCM 推给前端、前端 JS 里算 FFT。

**理由**：

1. 前端是 webview，JS 单线程，大量 DSP 会拖慢 UI。
2. Phase 2 迁移目标就是消灭前端 DSP（删除 AudioWorklet）。
3. 协议按"推指标"设计，Phase 1→2 过渡只是 Rust 侧加实现，协议不变。

### Payload 形状（示意）

**Channel `audio-frame`（~60Hz）**：

```typescript
interface AudioFramePayload {
  // Per-channel 指标（用数组，不是 {l, r}，支持多声道）
  peak_db: number[];           // 每通道瞬时峰值
  peak_hold_db: number[];      // 每通道峰值保持
  true_peak_max_dbtp: number;  // 全局 TP max

  // Loudness 高频部分
  lufs_momentary: number;
  lufs_short_term: number;

  // Vectorscope
  correlation: number;         // -1 ~ +1
  vectorscope_points: [number, number][];  // 降采样后的 XY 点

  // Spectrum
  spectrum_db: number[];       // 已是 dB 值，长度固定（如 512）

  timestamp_ms: number;
}
```

**Event `loudness-slow`（~2Hz）**：

```typescript
interface LoudnessSlowPayload {
  lufs_integrated: number | null;   // 数据不足时为 null
  lufs_m_max: number;
  lufs_st_max: number;
  lra: number;
  psr: number;
  plr: number;
}
```

**Event 状态类**：

```typescript
"device-list-changed"    // payload: DeviceInfo[]
"engine-state-changed"   // payload: { state: "running"|"stopped"|"error", error?: string } — `audio_start` / `audio_stop` 成功时由 Rust emit（`src-tauri/src/ipc/commands.rs`）
"sample-rate-changed"    // payload: number — 当前设备默认采样率（Hz），在 `audio_start` 成功后 emit
"meter-history-cleared"  // 无有效 payload（unit）— `clear_audio_history` 立即清空共享 `meter_history` 后 emit，浮窗订阅并重置与主窗 Clear 等价的 ref/state
```

**浮窗（`?float=` 辅 webview）要点**（实现见 `src/FloatApp.jsx` / `src/ipc/floatWindow.js` / `src/hooks/useFloatMeteringCore.js`）：

- 与主窗共用一路采集；辅窗通过 `meter_add_frame_subscriber` 订阅同一份 `AudioFramePayload` 池。
- `index.html?float=peak|loudness|spectrum|vector`；`openFloatPanel` 按 `float-<kind>` 单例标签复用/聚焦；`tauri-plugin-store` 的 `floatWindowBoundsV1` 存 **逻辑像素** 的 **客户区宽高**（`innerSize`）与 **外框左上角**（`outerPosition`），`v: 2` 标记新格式，旧项按物理像素用主窗 `scaleFactor` 迁一次；`useFloatWindowPersistence` 中 debounce + `pagehide` 落盘；与 `WindowOptions` 的 logical 语义一致，避免高 DPI 下重开「越偏越多」。
- 主窗点 **Clear** 时，Rust 侧先清空 `meter_history` 再发 `meter-history-cleared`；辅窗在 `onMeterHistoryCleared` 中 `resetFloatMeteringState` 并 bump loudness 子树 `key`，与主窗「清空历史」语义对齐。

### 序列化：v1.0 用 JSON，必要时切 MessagePack

- Tauri 默认 JSON 序列化，开发体验好、调试友好。
- 估算带宽：60Hz × ~4KB = ~240KB/s，JSON 膨胀后 ~500–700KB/s，现代机器无压力。
- Phase 2 压测发现瓶颈再切 MessagePack（`rmp-serde` + `@msgpack/msgpack`）——几十行代码的事，不是架构级改动。

---

## 8. 设备选择 UX（以 Windows loopback 为主；macOS 同类下拉由同一 UI 驱动）

### 核心问题

用户打开软件首次点 START，怎么知道自己监听的是"麦克风"还是"系统正在播的声音"？

### 方案：统一下拉菜单 + 分组

```
┌─ Input Source ──────────────────────────────┐
│  🎤 Microphones                              │
│     Realtek Audio Input                      │
│     USB Microphone                           │
│                                              │
│  🔊 System Outputs (Loopback)                │
│     Speakers (Realtek) — what's playing     │
│     Headphones (USB) — what's playing       │
└──────────────────────────────────────────────┘
```

### 行为要点

1. **麦克风和 loopback 合在一个下拉**，不做 tab 切换——用户要选的就是"信号源"，底层技术无关。
2. **Output 分组下列出各播放端的 loopback**，展示名即系统设备名（与「扬声器 / 耳机」等资源管理器命名一致）。
3. **下拉首项 Automatic（`captureDeviceId: "default"`）**：`audio_start` 传 `"default"`，Rust 侧解析为**当前默认输出设备**（Windows 上为 cpal **`default_output_device()`**，与系统默认扬声器一致；**不是**列表按字母序第一条）。macOS 上具体解析见 `platform_backend` / 设备枚举实现。开始前 Web 端调用 **`preview_audio_device("default")`**，用返回的 `label` / `sampleRateHz` 更新状态栏与默认值。
4. **热插拔 / 列表刷新**：Rust 侧**每 2 秒**枚举设备（`CpalBackend::list_devices`），与上次结果比较，变化则 `emit("device-list-changed")`（`src-tauri/src/lib.rs` 设备轮询线程）。**不是**依赖 cpal 的 OS 级「设备已插拔」回调——轮询实现简单、与将来换后端（macOS）时行为一致；若以后要亚秒级刷新，可改为注册系统设备通知后再触发同一路枚举。
5. **记住上次选择**：桌面端用 **`tauri-plugin-store`** 写入 `audiometer-settings.json`（键 `captureDeviceId`）；前端封装在 `src/ipc/capturePrefs.js`，启动时 `Store.load` 后若缺键则从旧版 **`localStorage`**（`audiometer.captureDeviceId`）迁移一次。非 Tauri 预览仍只用 `localStorage`。

### v1.0 有意跳过的细节

- 采样率协商（用设备默认）
- exclusive mode（用 shared mode，普通仪表足够）
- WASAPI event-driven vs polling（用默认 polling）
- 多声道 UI 细节（见 §5 开放问题）

---

## 9. 平台支持

### Windows（主力）

- Windows 10 1809 及以上（**WebView2** runtime）
- 系统播放监测：**cpal + WASAPI Loopback**，无需 VB-Cable 等虚拟声卡路由（相对旧网页版的体验目标）

### macOS（main 已构建、Release 发 DMG）

- **桌面壳**：Tauri 使用系统 **WKWebView**（非 Edge WebView2）。
- **系统音频（「正在播放」）**：**macOS 14.2+** 使用 **Core Audio process tap**（Objective-C / FFI：`native/macos/tap_bridge.m`，Rust 侧 `src-tauri/src/audio/macos/`）。低于该系统版本或缺少 tap API 时的行为以当时构建与 README 为准（可能仅能选物理输入等）。
- **物理输入**：与其它平台一样经 **cpal**。
- **分发**：`.github/workflows/release.yml` 中 `build-macos` 产出 **DMG（Apple Silicon）**；未公证时首次打开可能被 Gatekeeper 拦截，README 中有 `xattr` 等说明。
- **商店 / 公证**：仍遵循 §0「不上架 Mac App Store」；代码签名与 Apple 公证为可选改进项，与 §10 一致。

原规划中的「v1.5 才上 macOS」已被 **提前并入 main**：文档保留 **v1.5** 一词时可仅指「BlackHole 回退 polish、证书公证、Intel 构建」等 **后续完善**，而非「首个 macOS 应用从零开始」。

### 永不支持

- Linux：用户基数小
- iOS / Android：定位是桌面常驻工具

---

## 10. 分发与更新（当前 main）

| 项目 | 当前方案 | 未来 |
|---|---|---|
| **Windows 安装包** | **NSIS**（`*-setup.exe`）+ **便携** `AudioMeter-<tag>-x64-portable.exe`（由 `app.exe` 复制；依赖本机 WebView2） | 同 |
| **macOS 安装包** | **DMG**（Apple Silicon），由 `release.yml` 的 `build-macos` job 产出并随 `v*` tag attach | Intel 变体、公证等按需 |
| **代码签名** | **不签名 / 无公证**（README / Release 说明 SmartScreen、Gatekeeper、`xattr` 等） | 有预算再说 |
| **自动更新** | **不做**，靠 GitHub Release 通知 | 加 `tauri-plugin-updater`（Ed25519 等） |
| **发布渠道** | GitHub Releases | 同 |

### 不签名 / 未公证的代价（用户知情）

- **Windows**：SmartScreen 首次运行会警告（用户点「更多信息 → 仍要运行」）；部分杀毒软件可能拦截。
- **macOS**：Gatekeeper 可能提示已损坏，需按 README 去掉隔离属性等。
- README / Release 说明里应写明处理方式。

### 不做自动更新的理由

- v1.0 用户基数 0，更新机制投入产出比极低
- Tauri updater 需要 Ed25519 密钥管理、CI 签名步骤、`latest.json` 生成，有初始工程量
- v1.1 有实际用户反馈后再做更到位

### 10.1 GitHub Releases 发版流程（路线 A · 当前采用）

工作流文件：`.github/workflows/release.yml`。

| 触发方式 | 行为 |
|---|---|
| `git push origin v*`（**推荐**，`v` 前缀 + SemVer） | 并行跑 **`build-windows`** 与 **`build-macos`**：`build-windows` 产出 NSIS、便携 exe 并打 tag 时 attach；**`build-macos`** 产出 DMG 并 attach。两 job 均上传 workflow **artifact** 便于仅审阅构建结果。 |
| 仅 Actions 里 **Run workflow**（`workflow_dispatch`） | 同样构建并上传 **artifact**，**不会**自动创建带附件的公开 Release。 |

**维护者操作清单（对外发版）**：

1. 将 `package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`（及必要时 `Cargo.lock`）中的 **版本号改成一致**（`npm run version:check`）。
2. 提交并 `git push origin main`。
3. `git tag -a vX.Y.Z -m "AudioMeter X.Y.Z"`，再 `git push origin vX.Y.Z`。
4. 等待 **Release** workflow 成功；在 **Releases** 核对 **Windows + macOS** 附件与版本说明。
5. 在 Release 说明中写明 **§10 不签名 / SmartScreen / Gatekeeper** 等用户须知（可复制 README）。

---

## 11. 迁移路径（Phase 0 → Phase 3）

### Phase 0：骨架搭建（1–2 天）

- `legacy-web` 分支保留旧代码 + 打 tag `v0.9.0-web-final`
- main 分支用 `npm create tauri-app` 起新骨架（或手动加 `src-tauri/`）
- 把现有 React UI **原封不动**跑进 Tauri 窗口——此时音频层仍是 Web Audio，没变
- **验收**：双击 .exe 看到现在所有四个面板，功能和网页版一致（仍需虚拟声卡）

### Phase 1：Rust 音频层接入（核心工作）

- Rust 用 `cpal` 开 WASAPI loopback，通过 Tauri Channel 推 PCM 或初步指标到前端
- 前端 hooks 层加"数据源切换"：Web Audio（保底）↔ Tauri event
- **DSP 暂时还在前端**（AudioWorklet 继续用），只是输入源换成 Rust 推来的 PCM
- **验收**：不装虚拟声卡，选系统输出设备就能监测，所有表头正常工作

### Phase 2：DSP 下沉到 Rust（架构正本清源）

- 把 `loudness-meter.js` 翻译成 Rust：K-weighting、400ms / 3s 滑窗、gating
- FFT 用 `rustfft`，Peak / True Peak / Correlation 全部下沉
- Rust 只 emit 聚合后的指标值，不再传原始 PCM
- **删除** `public/worklets/loudness-meter.js`
- 历史 ring buffer 下沉到 Rust
- **验收**：CPU 占用明显下降，前端主线程几乎无 DSP 负担

### Phase 3：v1.0 发布

- Windows 安装包打包（NSIS `.exe` + portable `.exe`）
- 写 Release 说明（含 SmartScreen 处理方法）
- 更新 README（桌面版介绍 + 旧网页版链接）
- 在 README 顶部加一行声明指向 `legacy-web` 分支
- GitHub Pages 继续指向 `legacy-web` 分支的 build

**Phase 2 可延后**：Phase 1 结束时用户可感知的 v1.0 功能已全齐。Phase 2 是架构健康度工作，为 Phase 4+ 铺路。

### 11.1 实现进度快照（对照仓库，随开发更新）

| 文档章节 / Phase | 状态 | 说明 |
|---|---|---|
| Phase 0–1：Tauri 壳 + 采集 | 已完成 | Windows：`cpal` + WASAPI loopback；macOS：`platform_backend` + tap / cpal；前端走 `src/ipc/` |
| Phase 2：DSP 在 Rust、删 worklet | **核心已完成** | `public/worklets/*` 已移除；Channel 推算好的指标；**meter 历史 ring** 在 Rust（`MeterHistoryEntry` + `get_meter_history`） |
| §6 历史 ring 在 Rust | **主 ring 在 Rust（对齐快照）** | `VecDeque<MeterHistoryEntry>` 经 `Arc<Mutex<…>>` 共享；~95ms 一行，含响度 + spectrum/vectorscope/corr 与 `audioSnap` 所需字段；Channel `loudnessHistTick` 推送最新行；`get_meter_history` 全量拉取；Clear 清空 deque 并重置 Loudness/Spectrum/Vectorscope |
| Phase 3：安装包 | **已完成** | `release.yml`：**Windows** NSIS + 便携 exe；**macOS** DMG（`build-macos`）；打 `v*` tag 时 attach **GitHub Release**（§10.1） |
| `AudioCapture` / `AudioCaptureSession` | 已实现 | `audio/capture.rs`；**Windows** `cpal_backend.rs`；**macOS** `audio/macos/` + `platform_backend.rs` |

---

## 12. v1.0 架构为未来预留的扩展点（**写代码时务必遵守**）

| 扩展点 | 在代码里怎么体现 | 为谁服务 |
|---|---|---|
| **AudioCapture trait 抽象层** | `audio/capture.rs`；`cpal_backend` + **macOS tap** 经 `platform_backend` | 跨平台采集、后续换后端 |
| **PCM 数据结构带 `channels` 字段** | `PcmFrame { samples, channels, sample_rate, timestamp_ns }` | 多声道设备支持 |
| **面板 + 辅窗口** | `FloatApp.jsx`、`?float=`、Pop out；Rust `FrameSubscribers` / `meter_add_frame_subscriber` | 浮窗已落地；可迭代 always-on-top 等 |
| **Tauri 多窗口** | 主/辅 webview 共享一路引擎；event 多 listener | 浮窗与未来多窗 |
| **PCM tap 点（预留）** | **尚未实现**：规划采集后、DSP 前可订阅 PCM（如 `broadcast` / 等价），供未来 **WAV 内录**；当前仓库**无** `broadcast::channel<PcmFrame>` | 未来录音 |
| **历史 ring buffer 在 Rust** | DSP 输出同时 emit + 写 buffer | 数据导出、对比、长时间分析 |

### 多窗口与主界面

浮窗与 **`FrameSubscribers`** 已在 main 落地（见 §7）。主界面默认仍是 **单窗口四面板**；后续多为体验与策略（置顶、多实例等），骨架已具备。

---

## 13. 未来路线图（持续演进，不排序）

**已部分落地（仍可加强）**

- **浮窗 / 辅 webview**：`?float=`、Pop out、边界持久化、与主窗共用采集与 `meter-history-cleared`（详见 §7）。可选后续：**always-on-top**、更多窗口管理策略。
- **macOS 桌面版**：**main** 已含 **14.2+ tap** 与 **DMG** 发布流程。可选后续：公证、代码签名、Intel、更老系统的 BlackHole 文档化回退等。

**其他候选**（顺序由未来决定）

- 多声道 UI 完善（Vectorscope 在多声道下的处理策略）
- 监测期间录音（需先实现 §12 **PCM tap** 或等价路径，再写 WAV）
- 数据导出（CSV / 截图 / 分析报告）
- 两段时间对比模式
- Spectrogram 面板（瀑布图，纯前端新增）
- 更多指标：相位、RMS、Crest Factor、立体声宽度、频谱一致性等
- 系统托盘小表（极简模式）
- OBS 联动 / 导出 overlay

---

## 14. 给 AI Agent 的工作指南

### 开工前必做

1. **涉及用户可见行为、新能力范围、非目标取舍时**：先读 **[`prd.md`](prd.md)** 相关章节。  
2. **再读本文 `architecture.md` 整份**，然后读项目代码。  
3. 读 `src-tauri/Cargo.toml` 和 `package.json` 看当前依赖状态。  
4. 读 `src/ipc/` 和 `src-tauri/src/ipc/` 理解前后端边界。

### 硬性约束（不要违反，违反请立刻停下和用户确认）

1. **Rust 侧绝不往前端推 PCM**，一律推算好的指标。
2. **前端业务代码不得直接调 `invoke`、`listen` 或自建 Channel**；经 `src/ipc/` 封装。窗口 / DPI 相关 API 仅出现在 `ipc/floatWindow*.js` 等（见 §4）。
3. **PCM 数据结构必须带 `channels` 字段**，不硬编码 stereo。
4. **不引入"处理声音"的代码路径**——本项目永不做 EQ / 任何音频处理。
5. **不改变目录结构**（`audio/` / `dsp/` / `engine/` / `ipc/` 的分层），新功能按关注点归入已有模块。

### 常见任务的推荐处理方式

- **"加一个新表头 / 新指标"**：
  1. 在 `src-tauri/src/dsp/` 下新建 `<指标>.rs`
  2. 在 `engine/meter_pipeline.rs` 里把它挂进主循环
  3. 在 `ipc/types.rs` 加对应 payload 字段
  4. 前端新建对应 Panel 组件 + 在 `ipc/events.js` 订阅
- **"改现有 UI 布局"**：只动 `src/components/` 和 `src/App.jsx`，不碰后端。
- **"性能优化"**：先用 `cargo flamegraph` 或前端 Performance 面板找瓶颈，别瞎优化。
- **"bug：表头跳动 / 不准确"**：先检查是前端渲染问题还是 Rust 算法问题，办法是看 Rust 端 emit 的原始数值日志。

### 环境与工具

- Rust：stable toolchain
- Node：LTS
- 包管理：`npm` + `cargo`
- 前端构建：Vite
- Tauri CLI：v2.x
- 测试：Vitest（前端），`cargo test`（后端）

---

## 15. Changelog（文档本身的修订记录）

| 日期 | 作者 | 变更 |
|---|---|---|
| 2026-04 | SounDoer + Claude（grill-me session） | 初版：完成 v1.0 全部架构决策 |
| 2026-04 | — | §6：Spectrum 明确为「专业频谱软件常用 FFT-RTA 显示」，v1.0 不采用 IEC 61260 滤波器组路径 |
| 2026-04 | — | §4 目录树：`pipeline.rs` → `meter_pipeline.rs`，补 `dsp/paths.rs`；新增 §11.1 实现进度；补充 Phase 3 `release.yml` 说明 |
| 2026-04 | — | §10.1：GitHub Releases 发版流程（tag / workflow_dispatch）；README 维护者发版小节 |
| 2026-04 | — | §11.1：响度历史主 ring 在 Rust，Channel `loudnessHistTick` + `clear_audio_history` |
| 2026-04 | — | `MeterHistoryEntry` 统一 ring；`get_meter_history`；Clear 级联重置 LoudnessMeter / SpectrumEngine / VS |
| 2026-04 | — | §5：`session.rs` 并入 `cpal_backend.rs`；`AudioCapture` + `AudioCaptureSession`（`start_session` → `Box<dyn …>`）；`build_device_list` `pub(crate)`；多声道 `ch>2` 时 VS/Spectrum/Peak/Loudness 取每帧前两路 |
| 2026-04 | — | 工程基线：`rustfmt` + Windows Rust CI；`cargo` 单测（PCM pack/unpack、多声道 peak）；Dependabot；`CONTRIBUTING.md`；`npm run version:check` / `check`；`.gitattributes` LF |
| 2026-04 | — | §8：`tauri-plugin-store` + 设备轮询说明；§7：`engine-state-changed` / `sample-rate-changed` 落地；Release 双产物（NSIS + portable `app.exe`）；§4/§11.1/§14 与实现对齐 |
| 2026-04 | — | v1.1 浮窗首版：主/辅 webview 共享一路原生采集；`FrameSubscribers`（`main` + 动态 id）、`meter_add_frame_subscriber` / `get_engine_state`；`index.html?float=` + `WebviewWindow`；面板「Pop out」 |
| 2026-04 | — | 浮窗补齐：`meter-history-cleared` + 共享 `meter_history` 同步清空；`floatWindowBoundsV1` 存位置；§7 浮窗要点；`resetFloatMeteringState` / `historyViewEpoch` |
| 2026-04 | — | 浮窗 bounds：`v:2` 逻辑像素，inner/outer 与 `scaleFactor` 对齐，修正高 DPI 重开累积误差；旧存盘按物理→逻辑迁移 |
| 2026-05 | — | 对齐 main：§0/§9 **macOS + Release DMG**；§4 目录树与 **ipc** 约束；§5 `FrameSubscribers`；§10/§10.1 双平台 CI；§12 PCM 预留未实现；§13 浮窗/macOS **已部分落地**；§14 与 §4  ipc 规则一致 |
| 2026-05 | — | 引入 **[`prd.md`](prd.md)**；文首与 **§0 / §14** 写明与 PRD 分工；非目标表注明以 PRD 为准 |
| 2026-05 | — | §6 Spectrum：**RTA 带内能量**改为按 Hz 与 FFT bin 子区间的**分数重叠**积分（`dsp/spectrum.rs`），文档与 README/PRD 计量表述对齐 |
| 2026-05 | — | §6 新增 **「纵轴单位与参考（dBFS）」**：带内谱功率 vs 峰值 dBFS、与 SPL/LUFS 的区分 |

---

## 附录 A：被讨论过但否决的方案汇总

这一节用来防止未来重复讨论同一个问题。每条都对应上文某个决策的反方案。

| 否决项 | 否决原因 | 对应章节 |
|---|---|---|
| Electron | 音频路径 GC 抖动风险；严肃音频仪表无先例；包大 | §1 |
| JUCE | 核心价值是插件生态；本项目不做插件；React UI 全丢弃 | §1 |
| `wasapi` crate | 只管 Windows，macOS 仍要另学一套 | §5 |
| 全部用 Event / 全部用 Channel | Event 广播浪费带宽；Channel 生命周期不合适低频通知 | §7 |
| 推 PCM 让前端算 DSP | 前端卡顿、违背 Phase 2 目标 | §7 |
| MessagePack（v1.0） | JSON 已够用，过早优化 | §7 |
| 新开仓库 | 丢失 git 历史、Stars、Issues | §4 |
| Monorepo（web + desktop 共存） | 过度设计，网页版明确将弃用 | §4 |
| 保留网页版目录结构 | 不为沉没成本妥协 | §4 |
| 商店上架 | 沙箱限制影响未来功能自由度 | §0 |
| 代码签名（v1.0） | ROI 低，0 用户阶段不划算 | §10 |
| 自动更新（v1.0） | 用户基数 0，工程成本不划算 | §10 |
| 真实 EQ / 音频处理 | "声音从哪输出"是架构死局；定位偏移；开发量 3-4× | §0, §13 |
| 离线文件分析 | 定位是实时监测 | §0 |
| 多设备同时监测 | 非 v1.0 范围 | §0 |
| Linux 支持 | 用户基数不值得 | §9 |
| IEC 61260 计量级倍频程滤波器（v1.0） | 与监听/制作类软件常用 FFT-RTA 不一致；认证与工程量超出 v1.0；保留为可选未来项 | §6 |

---

**文档结束。**
