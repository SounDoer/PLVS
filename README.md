# AudioMeter

> **桌面版（Windows / macOS）**：产品范围与承诺见 **[`docs/prd.md`](docs/prd.md)**；技术架构与协议见 **[`docs/architecture.md`](docs/architecture.md)**。本地运行桌面壳：`npm install` → `npm run desktop`（需安装 [Rust](https://rustup.rs/) 与对应平台 Tauri 前置依赖）。参与开发与合并前自检见 [`CONTRIBUTING.md`](CONTRIBUTING.md)（一键 `npm run check`）。  
> **网页版**：不再随 `main` 演进。最后冻结的浏览器版代码在 **`legacy-web` 分支**（标签 **`v0.9.0-web-final`**）；GitHub Pages 构建由该分支触发。若仍使用浏览器版，请查看该分支的 README。

### 维护者：发版到 GitHub Releases（Windows · macOS）

正式对外发安装包时，用 **打 Git 标签** 触发 CI（见 [`docs/architecture.md`](docs/architecture.md) §10.1）：

1. **对齐版本号**：同时修改 `package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml` 中的 `version`；运行 `npm run version:check` 确认三者一致；在 `src-tauri` 目录执行 `cargo check`，若有变动则一并提交 `Cargo.lock`。
2. **提交并推送** `main`。
3. **打附注标签并推送**（示例 `v0.0.3`，请换成真实版本）：

   ```bash
   git tag -a v0.0.3 -m "AudioMeter 0.0.3"
   git push origin v0.0.3
   ```

4. 在仓库 **Actions** 中查看 **Release** 运行结果；成功后到 **Releases** 页面会自动挂上：
   - **Windows**：NSIS 安装包（`.exe`）+ 便携版（`.exe`）
   - **macOS**：DMG 安装包（`-aarch64.dmg`，Apple Silicon）

说明：**仅**在 Actions 里手动运行 **Release**（`workflow_dispatch`）时，只会得到该次运行的 **Artifacts**，不会自动创建带附件的公开 Release；要给用户装包，请使用 **`v*` 标签推送** 这一条路径。

#### macOS：首次打开提示"已损坏"

未经 Apple 公证的 app 会被 Gatekeeper 拦截，在终端执行以下命令去掉隔离标记即可正常打开：

```bash
xattr -cr /Applications/AudioMeter.app
```

根本解法是配置代码签名 + Apple 公证（需 Apple Developer Program），届时用户直接双击即可，无需额外操作。

---

以下为 **legacy 网页版** 的说明（在 `legacy-web` 分支上仍然适用）。

无需安装的浏览器实时音频分析工具，打开即用。支持 **峰值表（Peak）**、**LUFS 响度**（Momentary / Short-term / Integrated / LRA / True Peak）、**频谱分析（Spectrum）** 与 **矢量示波器（Vectorscope）**。音频仅在本机处理，不上传任何服务器。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Stack](https://img.shields.io/badge/stack-React%20%2B%20Vite-lightgrey)

---

## 使用前准备

### 浏览器要求

需要支持 Web Audio API 和 AudioWorklet 的现代桌面浏览器，推荐 Chrome / Edge / Firefox 最新版。页面必须通过 HTTPS 或 `localhost` 访问，否则浏览器会拒绝麦克风权限。

### 麦克风权限

首次点击 **START** 时，浏览器会弹出权限请求，选择「允许」即可。如果之前选了「拒绝」，需要在浏览器地址栏左侧的权限图标里手动重新开启。

### 监测系统播放的声音（虚拟声卡）

浏览器只能采集**输入设备**（麦克风或线路输入）。如果想测量系统正在播放的音频信号，需要安装虚拟声卡，把系统输出路由到虚拟输入：

- **Windows**：安装 [VB-Audio Virtual Cable](https://vb-audio.com/Cable/)，然后完成以下设置：
  1. 「声音 → 播放」将默认播放设备改为 **CABLE Input**（音频从这里进入虚拟线缆）。
  2. 「声音 → 录制」右键 **CABLE Output** → 属性 → **Listen** 标签页，勾选 **Listen to this device**，并在下方选择你实际在用的声卡设备。这一步让声音在进入虚拟线缆的同时也能从真实设备播出，否则你将听不到任何声音。
  3. AudioMeter 打开后，将默认录音设备设为 CABLE Output 即可采集到信号。
- **macOS**：安装 [BlackHole](https://existential.audio/blackhole/)（2ch 版本即可），然后完成以下设置：
  1. 打开 **Audio MIDI Setup**（应用程序 → 实用工具）。
  2. 左下角点 **+** → **Create Multi-Output Device**，在右侧同时勾选你的真实扬声器/耳机和 **BlackHole 2ch**，并将真实设备设为 **Master Device**，同时勾选 BlackHole 那行的 **Drift Correction**（防止长时间使用后出现音画不同步）。
  3. 「系统设置 → 声音 → 输出」选择刚创建的 **Multi-Output Device**，音频就会同时流向真实设备和 BlackHole。
  4. AudioMeter 打开后选择 **BlackHole 2ch** 作为输入设备即可。
  
  注意：使用 Multi-Output Device 时，系统音量调节会变灰，需要直接在真实设备上控制音量。

更换输入设备后请刷新页面并重新授权。

---

## 操作指南

### 控制栏

页面顶部有三个按钮：

- **START** — 请求麦克风权限并开始监测。
- **STOP** — 停止监测，保留当前历史数据。
- **LIVE** — 仅在进入历史快照模式后出现，点击返回实时监测。
- **Clear** — 清除所有历史数据和峰值保持记录。
- **Settings** — 打开设置面板。

---

### Peak（峰值表）

显示左（L）和右（R）两个声道的实时采样峰值，以及各声道的峰值保持线和 **TP MAX**（True Peak 最大值，单位 dBTP）。

仪表从下到上对应信号从弱到强，颜色从绿渐变为红。

---

### Loudness（响度）

分为左侧**历史图表**和右侧**指标列表**两部分。

#### 右侧指标列表

显示以下数值（单位 LUFS，LRA 单位 LU）：

| 指标 | 说明 |
|------|------|
| Momentary | 最近 400ms 瞬时响度 |
| Short-term | 最近 3 秒短期响度 |
| Integrated | 从开始监测至今的整合响度 |
| M Max | Momentary 最大值 |
| ST Max | Short-term 最大值 |
| LRA | 响度范围 |
| Dynamics (PSR) | Peak 与 Short-term 的差值 |
| Avg. Dynamics (PLR) | Peak 与 Integrated 的差值 |

点击 **Momentary** 或 **Short-term** 行可切换对应曲线在历史图中的显示与隐藏。

#### 左侧历史图表

以时间轴展示 Momentary（M）和 Short-term（ST）的历史曲线，横轴为时间，纵轴为 LUFS，虚线为当前标准的目标响度值。

**左键操作（选取快照）：**

- **左键单击**：点击图表中某个位置，进入**快照模式**——所有面板（频谱、矢量示波器、响度指标）切换为该时刻的数据，顶部按钮变为 **LIVE**。
- **左键拖拽**：按住左键拖动，实时在时间轴上滑动选取不同时刻的快照。
- **左键双击**：退出快照模式，返回实时监测。也可点击顶部 **LIVE** 按钮退出。

**右键操作（平移与重置视图）：**

- **右键拖拽**：按住右键左右拖动，平移时间轴视图（仅移动可视范围，不选取快照）。
- **右键双击**：将时间窗口和时间偏移恢复为默认值。

**滚轮操作（缩放时间窗口）：**

- **滚轮上/下**：以鼠标当前位置为锚点缩放时间窗口，即图表横轴覆盖的时间范围。

**悬停（Hover）：**

- 鼠标移入图表，显示当前位置的时间偏移、M 值和 ST 值。

图表左下角会短暂显示当前「窗口时长 / 偏移量」的提示。

---

### Spectrum（频谱）

显示实时频率响应曲线，横轴为频率（对数刻度，20 Hz–20 kHz），纵轴为幅度（dB）。

**实现口径（Rust）**：短时 FFT + Hann 窗；各倍频程几何档的读数由**带内线性功率**经 **Hz 连续边界与各 FFT bin 的频率子区间求重叠比例**后加权累加得到（分数 bin 积分），避免仅用整数 bin 边界时在低频出现台阶状「横线」。纵轴为 **dBFS 域**的带内能量（与峰值表 dBFS 同参考域、不同检波定义），精确定义见 **[`docs/architecture.md`](docs/architecture.md)** §6「Spectrum / RTA」及小节 **「纵轴单位与参考（dBFS）」**。

**悬停（Hover）**：鼠标移入图表，会显示：
- 垂直和水平两条虚线交叉定位当前位置。
- 提示框显示该点的**频率**（Hz 或 kHz）和**幅度**（dB）。

在**快照模式**下，频谱同时显示一条峰值保持虚线，对应该时刻的峰值记录。

---

### Vectorscope（矢量示波器）

以李萨如图（Lissajous）方式展示立体声信号的相位关系，中心为 Mono，左上为 L 声道，右上为 R 声道。

底部显示 **Correlation**（相关系数）：
- **+1**：左右声道完全同相（Mono 信号）
- **0**：左右声道不相关
- **-1**：左右声道完全反相（可能导致单声道播放时声音消失）

图形会根据信号幅度自动缩放，避免波形超出显示范围。

---

### 布局调整

界面分为四个主要区块（Peak、Vectorscope、Loudness、Spectrum），之间的分割线均可拖动：

- **左右主分割线**：拖动调整左侧（Peak + Vectorscope）和右侧（Loudness + Spectrum）的宽度比例。
- **左侧上下分割线**：拖动调整 Peak 和 Vectorscope 的高度比例。
- **右侧上下分割线**：拖动调整 Loudness 和 Spectrum 的高度比例。
- **响度内部分割线**：拖动调整 Loudness 面板内历史图表和指标列表的宽度比例。

所有布局比例自动保存到浏览器本地存储，下次打开时恢复。如需还原默认布局，进入 Settings → **Reset Layout**。

---

### Settings（设置）

点击顶部 **Settings** 按钮打开，点击面板外部或按 Esc 关闭。

- **Loudness Standard**：切换响度测量标准。
  - **EBU R128**：广播标准，目标 −23 LUFS。
  - **Streaming**：流媒体标准，目标 −14 LUFS。
- **Theme**：切换深色（Dark）和浅色（Light）主题。
- **Reset Layout**：将所有分割线位置恢复为默认值。

---

## 开发者

### 本地运行

**桌面（`main`）**

```bash
git clone https://github.com/SounDoer/AudioMeter.git
cd AudioMeter
npm install
npm run desktop
```

首次需安装 [Tauri 前置依赖](https://v2.tauri.app/start/prerequisites/)（Windows 含 WebView2、Visual Studio C++ Build Tools 等）。开发时 Vite 固定端口 **1420**。

**仅前端 / 旧网页流程**

```bash
npm run dev
```

浏览器访问终端输出中的本地地址（纯 `vite` 时通常为 `http://localhost:5173/`；`npm run desktop` 时为 `http://localhost:1420/`）。

### 其他命令

```bash
npm run build           # 构建生产版本，输出到 dist/
npm run desktop:build        # Tauri 打包（全平台）
npm run desktop:release-nsis # 仅打 Windows NSIS 安装包
npm run desktop:release-dmg  # 仅打 macOS DMG 安装包
npm test                # 运行单元测试（Vitest）
npm run lint            # ESLint 检查
```

### 仓库结构

```
public/worklets/
  loudness-meter.js      # 响度测量 AudioWorklet（独立线程）
src/
  App.jsx                # 页面编排（状态与布局）
  components/panels/     # Peak / Loudness / Spectrum / Vectorscope 面板
  hooks/                 # 音频引擎与交互逻辑
  math/                  # 纯数学与格式化工具函数
  scales.js              # 刻度与量程配置
  uiPreferences.js       # UI 配置与主题
```

---

## 许可

本项目采用 [MIT License](LICENSE)，可自由使用、修改和再分发，需保留原始版权声明。
