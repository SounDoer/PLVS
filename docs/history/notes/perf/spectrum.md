# Spectrum 体检表

**状态：** D1 合理性已判定并落地（§1.5、§1.6）；D4 的 payload 三层全部已削减
（§3.5、§3.6、§3.7）——第 3 层是跨面板的统一二进制协议轮，设计与实测在 `protocol.md`。
协议轮的真实窗口验证已完成（`protocol.md` §9）。

## 0. 控制维度拆解

Spectrum 的控制项不是一个 72 项的组合矩阵，而是按「进不进 analysis request key」天然分成两组。
这个划分决定了每一项该在哪个 harness 上测。

**进 key 的（走 Rust，每个取值 = 一条 pipeline + 一块 slab）**
`spectrumRequestKeyFromControls` → `spectrum:{single|pair}:{ch...}:{view}:sp{speed}:tilt{centidb}:sm{token}`

| 控制 | 取值 |
| --- | --- |
| `spectrumChannel` | single(ch) / pair(x,y) |
| `spectrumView` | combined / lr / ms |
| `spectrumSpeedPercent` | 0–100（`commitOnRelease`） |
| `spectrumTiltDbPerOctave` | 0–6（`commitOnRelease`） |
| `spectrumOctaveSmoothing` | off / 1/12 / 1/6 / 1/3 |

**不进 key 的（纯前端）**

| 控制 | 取值 |
| --- | --- |
| `spectrumMaxMode` | off / decay / hold |
| `spectrumPeakLabels` | on / off |
| `spectrumXMinFreq`–`XMaxFreq` | log range |
| `spectrumYMinDb`–`YMaxDb` | linear range |

Spectrum 与 Spectrogram **共用同一个 request key**（`analysisRequests.js` 里同一分支），
所以本表的 D1/D3 结论会直接决定 Spectrogram 那一份的起点。

## 1. D1 — Rust 计算是否正确且合理

涉及：`dsp/shared_spectral_engine.rs`(1866) `spectrum.rs`(912) `spectrum_bank.rs`(714)
`spectrum_differential.rs`(959) `spectrum_consumer.rs`(1384) `spectral_transform.rs`(250)

### 正确性

| # | 待验证 | 怎么判 |
| --- | --- | --- |
| 1.1 | 窗函数 + 重叠 + 归一化：满幅正弦读出的 dB 是否等于理论值 | 合成 0 dBFS 正弦（bin 中心 / bin 之间两种），断言峰值 dB 与相邻 bin 泄漏在容差内 |
| 1.2 | 白噪的频谱密度是否平坦、量级是否正确 | 合成白噪，断言各 octave 带能量一致 |
| 1.3 | `ms` view 的 M/S 是否做了正确的归一（M=(L+R)/2 还是 /√2） | 已知 L/R 输入对拍；与 Stereo Map 的 M/S 口径是否一致 |
| 1.4 | octave smoothing 的带宽是否真的是 1/3、1/6、1/12 oct | 单频正弦输入，测平滑后的 -3 dB 带宽 |
| 1.5 | tilt 是否为纯频率相关的常数增益、且以哪个频率为支点 | 白噪输入，断言 dB 随 log2(f) 线性上升，斜率 = 设定值 |
| 1.6 | speed 的时间常数：0/100 两端的实际 attack/release | 阶跃输入，测到达 63% 的帧数 |

### 合理性（这一节是本轮最大的候选发现）

| # | 质疑 | 为什么值得查 |
| --- | --- | --- |
| 1.7 | **tilt 进 request key 是否必要** | tilt 看起来是纯显示变换（每个 bin 乘一个只与频率相关的常数）。若成立，它不该进 key：目前改一次 tilt 就换一条 Rust pipeline 并新铸一块 slab（4h 单块 1.38 GB），这正是它需要 `commitOnRelease` 的唯一原因。移出 key 可同时消灭 slab 爆炸和该 workaround |
| 1.8 | **octave smoothing 是否也能移到前端** | 同上，但风险更高：平滑若在 Rust 的 bin 域做，前端拿到的是已经降过分辨率的数据；要先确认前端拿到的 bin 数是否足以复现 |
| 1.9 | speed 呢 | 时间平滑有状态，跨帧递推，**大概率必须留在 Rust**。此条预期结论是「不动」，但要写下来 |
| 1.10 | 同一 view 下多个 key 是否重复算 FFT | 例如两个 Spectrum 面板只有 tilt 不同：是否共享 FFT 只在末端分叉？`shared_spectral_engine` 的名字暗示已共享，需确认边界在哪 |
| 1.11 | Rust 单帧耗时随 smoothing / view 的变化 | 建立基线，供协议改动前后对比 |

**依赖关系：1.7/1.8 必须先答**，它们的结论会大幅改变 D3 的工作量，甚至可能让 D3 的一半问题消失。

## 1.5 D1 合理性 — 判定结果（2026-08-28，纯读码 + 既有 Rust 测试）

### 1.7 tilt 应当移出 request key — **成立**

证据：`spectrum_consumer.rs:186-190`，tilt 以 `tilt_db_per_octave * (log2(f) - log2(1000))`
的形式逐 grid point 加到 dB 值上，位置在 `apply_envelope` 之前，之后**没有任何 clamp 或 floor**。
`apply_envelope`（`spectrum.rs:62-110`）对一个逐点常数偏移是精确可交换的：
attack/release 递推在 dB 域是线性的，`alpha` 的选择只取决于 `sign(inc - prev)`，
peak hold / decay 是 dB 域的 max 与减法——三者都不受同时平移输入与状态的影响。
所以 tilt 是纯显示变换，放在 Rust 的 envelope 前和放在前端渲染时，结果逐点相同。

它现在在 key 里，代价有四项：

1. 改 tilt → 新 key → `shared_spectral_engine.rs:648-700` 的 `retain` 丢弃旧 consumer，
   `RuntimeConsumer::new` 从零重建 → EMA 与 envelope 状态清空，曲线要重新收敛。
2. 新 key → 新 slab → 面板已积累的可视历史被清空。**改一个纯外观的斜率控制会抹掉历史。**
3. 两个只有 tilt 不同的面板（包括一个 Spectrum 配一个 Spectrogram，二者共用同一 key 语法）
   各自持有一整份 `CurveState`，每帧重复做 3 个 FFT size 的 EMA 累加与 output，并各占一块 slab。
4. 这是 `spectrumTiltDbPerOctave` 需要 `commitOnRelease` 的唯一原因。

原地更新的机制**已经存在**（`apply_settings`，`shared_spectral_engine.rs:484-490`），
只是因为 tilt 属于 identity 的一部分而永远走不到。

判定的一句话形式：**key 应当标识「测量」，不标识「显示整形」。**

### 1.8 octave smoothing 移到前端 — **不成立，维持现状**

证据：`spectrum_consumer.rs:169-176`，`box_average_into` 作用在**线性 PSD 行**上，
在转 dB 之前、在 envelope 之前。envelope 在 dB 域且 alpha 依赖符号，与线性域的 box average
不可交换——移到前端会改变实际弹道，不是等价重构。且 `spectrum.rs:1-18` 的模块文档明确写着
smoothing 是要平均**测量**本身。结论：留在 Rust，留在 key 里。

### 1.9 speed — **必须留在 Rust 与 key 里**（符合预期）

`attack_release_ms_for_speed_percent` 与 `analysis_average_sec_for_speed_percent` 同时喂给
bank 内部的有状态 EMA。历史行是在某个 speed 下算出来的，换 speed 就该换 key，否则一块 slab
里会混进两种弹道的数据。

### 1.10 多 key 之间重复了什么 — 已界定

FFT **是共享的**：`SharedSpectralEngine` 广播 `ComplexSpectralFrame`，所有 consumer 复用。
每多一个 key 多出来的是「3 个 FFT size 的 EMA 累加 + 一次 output（box average + dB 转换 +
envelope）」，量级 O(bins×3) 每帧，不是多一次 FFT。所以 1.7 的 Rust 侧收益是实的但有限，
真正的大头在第 2 条（slab）。

### 附带发现（非本轮目标，记录待办）

- ~~**`weighting` 是死参数。**~~ **已删（2026-09-01）。** 生产路径恒为 `"z"`，`weighting_db` 恒返回 0，
  `set_weighting` 的唯一调用方是它自己的单元测试；前端 `getWeightingDb` 的唯一引用者是
  `scales.test.js`。两端的 A/C 加权实现、`SpectralConsumer` 与 `SpectrumMeter` 的 `weighting`
  字段、`SPECTRUM_SETTINGS.weighting` 已一并移除。这不是性能改动：删掉的加权项在生产路径上
  恒为 0，`spectrum_differential` 那套对拍测试逐值不变。
- **grid 是 96 点/八度**（`spectrum_bank.rs:10`），20 Hz–20 kHz ≈ **958 个点**。
  直接进入 D2 的 2.2（958 个点 vs 面板 CSS 像素宽度）与 D3。
- **修正本文件 3.5：f32 之问不成立。** slab 已经存 Int16 centi-dB
  （`SpectrumHistorySlab.js` 的 `encodeCentiDb`），2 字节/点，这一项已经做过了。

## 1.6 已落地的改动（2026-08-28）

**tilt 移出 request key，改在前端渲染时施加。** 用户已确认接受行为变化：今天改 tilt 会重置
曲线并清空历史，改完之后 tilt 即时重新整形整段已有历史。

- Rust：`SpectralConsumer` / `SpectrumMeter` 不再施加 tilt；`ConsumerSettings`、
  `SpectrumAnalysisRequest`、key 语法（`expected_spectrum_request_key`）中的 tilt 全部移除。
- 前端：`spectrumTiltOffsets` / `applySpectrumTilt`（`math/spectrumMath.js`）与
  `buildYTiltDb`（`math/spectrogramMath.js`）在显示端施加，覆盖 Spectrum 曲线、峰值、Max Hold、
  快照回放，以及 Spectrogram 的 2D 与 3D 绘制。
- `spectrumTiltDbPerOctave` 的 `commitOnRelease` 已摘除，曲线重新跟随滑块。
- 跨端 key fixture `shared/analysis-request-key-fixtures.json` 同步。

**顺带删除：Rust 生成的 SVG path 字符串**（§3.5 第 1 层）。`dsp/paths.rs` 整个删除，
`SpectrumFrameResult` 去掉 `path/peakPath/pathB/peakPathB`，快照 resolver 也不再产 path。
删除的直接理由有两条：前端本来就无条件重建；tilt 移走之后那份兜底 path 会变成未加 tilt 的哑弹。

每帧 payload：combined 82.4 → **52.7 KiB**，lr/ms 147.6 → **88.1 KiB**（约 −36%/−40%）。

**发现：Spectrogram 一直在用一个它不暴露的控件。** Tilt 只在 Spectrum 面板的设置里出现
（`PanelSettingsContent.jsx` 的 `showDisplayControls` 限定 `activeTab === "spectrum"`），
但 Spectrogram 共用同一份扁平控件对象，所以它的配色一直被默认的 3 dB/oct 悄悄整形，
而且一个 Spectrum 和一个 Spectrogram 只要这个看不见的值不同，就会各占一条 pipeline 和一块 slab。
**处理方式：给 Spectrogram 加上 Tilt 控件**（在 `panelControls.js` 的有序行表里，`order: 15`，
落在 Mode 与 Smoothing 之间；Spectrum 侧仍由 `SpectrumDisplaySettingsRows` 渲染，两边不重复）。去掉 tilt
不是清理而是视觉回退——热图把 dB 映射成固定范围的颜色，而节目素材的频谱本来就往下斜，不加斜率
高频会常年贴着色阶底部；颜色的可辨识动态范围又比可缩放的 y 轴小，所以它比曲线更需要这个斜率。
Speed 和 Smoothing 没有一起放出来，那是另一个范围的决定。Dock 的 spectrogram 控件集保持精简，
未加。

## 1.7 移除的测试及原因

- Rust `every_ui_tilt_step_affects_an_actual_postprocessed_output_row`、
  `default_slope_tilts_curve_upward`、`zero_tilt_disables_default_slope`：主题移到前端，
  由 `spectrumMath.test.js` 的 `spectrumTiltOffsets` / `applySpectrumTilt` 用例
  与 SpectrumPanel、DockSpectrum 的渲染用例接手。
- 差分矩阵去掉 25 个 tilt 步（`4 * (101 + 25 + 4)` → `4 * (101 + 4)`）。
- `legacy_payload_comparison_rejects_path_and_visual_mutations` 改名为
  `..._rejects_row_and_visual_mutations`，突变对象从 path 换成 dB 行。

## 1.8 D1 正确性 — 已有覆盖盘点（2026-08-28）

写对拍测试之前先查了既有覆盖，结论是**§1 正确性清单的六项基本都已经被钉住了**，补测试等于重复。
逐条对应如下：

| # | 待验证 | 已有的测试 |
| --- | --- | --- |
| 1.1 | 窗函数 + 重叠 + 归一化：0 dBFS 正弦读数 | `spectrum_bank::calibration_mid_band_full_scale_sine_near_zero`（1 kHz，容差 2.5 dB）、`spectrum::full_scale_sine_reads_near_zero_dbfs` |
| 1.2 | 白噪平坦、跨界连续 | `spectrum_bank::bank_broadband_continuous_across_crossovers`（接缝 < 1 dB）、`octave_smoothing_keeps_broadband_noise_flat` |
| 1.3 | M/S 归一口径 | `spectrum_consumer::projection_consumer_applies_half_scale_before_power_and_exposes_expected_curves` 与同文件的 `projected_power` 用例：**M = (L+R)/2，S = (L−R)/2**，在取功率之前就是半幅 |
| 1.4 | smoothing 的实际带宽 | `spectrum_bank::octave_smoothing_half_widths_are_constant_grid_points`：半宽 16/8/4 个格点，栅格是 96 点/八度，所以恰好是 1/3、1/6、1/12 八度。外加 `octave_smoothing_lowers_and_widens_a_tone_peak` |
| 1.5 | tilt 的支点与斜率 | 已移到前端，由 `spectrumMath.test.js` 的 `spectrumTiltOffsets` 用例覆盖（1 kHz 支点，逐八度线性） |
| 1.6 | speed 的时间常数 | `spectrum::speed_percent_50_matches_current_attack_release` 与 100% 的对应用例，外加 `spectrum_consumer::every_ui_speed_step_...` 对全部 101 档做差分比对 |

**顺带确认**：Stereo Map 不与 Spectrum 共享 M/S 口径——它走的是左右功率加互谱（`left * right.conj()`）
那条路，所以两者之间没有需要对齐的约定，1.3 原本设想的"跨面板口径一致性"是个不存在的问题。

### 唯一的边缘缺口

1.1 只测了 1 kHz 这一个**非 bin 中心**的音调，容差 2.5 dB。bin 正中心的音调没有单独用例。
考虑到这是显示参考的分析器（PSD 归一化下，同一正弦在 `FFT_BIG` 与 `FFT_SMALL` 上本就相差
±6 dB，见 `CAL_OFFSET_DB` 的注释），补这一例的价值有限。**记录，不做。**

## 2.5 D2 判定结果与已落地的改动（2026-08-28，实测）

测量工具：`npm run benchmark:spectrum-render`（`scripts/spectrum-render-benchmark.mjs`）。
它跑的是面板每帧重做的纯计算部分，脱离 React，所以可以在应用之外复现。
**它不覆盖 React 的 commit 与浏览器的 paint**——那两项要在真实窗口里 profiling。

### 结论：path 构建是唯一的大头，其余全是噪声

| 阶段 | 每帧 | 占 16 ms 预算 |
| --- | --- | --- |
| tilt 一行 | 0.003 ms | 0.0% |
| `buildSpectrumDataSnapshot` | 0.001 ms | 0.0% |
| 解包 band centers | 0.006 ms | 0.0% |
| **一条 path** | **0.099 ms** | **0.6%** |
| Max hold 折叠 | 0.004 ms | 0.0% |
| 峰值标签候选 | 0.008 ms | 0.0% |

一个面板每帧最多画 6 条 path（主/副曲线、主/副峰值、主/副 Max hold），所以帧成本几乎就是
`0.099 × path 条数`：combined+Max off 是 0.10 ms，lr/ms+Max on 是 0.59 ms（4% 预算）。

### 已落地：把 x 坐标缓存下来（−60%，输出逐字节相同）

曲线上每个点的 x **只由栅格和频率范围决定，与 dB 行无关**——但它在一帧的 4~6 条 path 里各算
一遍，下一帧再算一遍，每次都要 `log10` 加一次 `toFixed(2)` 的字符串分配。按 (栅格形状, 频率
范围) 缓存这 958 个 x 字符串之后：**每条 path 0.20 ms → 0.08 ms**。

同时把 `spectrumDbToYViewBox` 每点都要做的量程归一化提了出来（新增
`spectrumDbToYProjector`，与原函数的一致性有测试保证），并把 band→centers 的解包从每帧 6 次
收敛成 1 次。

量过但**没有收益**的候选，一并记下来免得重查：

- **band 对象解包不是瓶颈**（0.006 ms）。改之前我的假设是"每帧 6 次 958 元素的 map 很贵"，
  测出来是错的；收敛成 1 次只是顺手，不是收益来源。
- **绕开 `toFixed` 单独用**只到 0.147 ms；x 缓存之后再叠加它没有额外收益（0.079 vs 0.080）。
- **按像素跨步降采样**在 x 缓存之后只剩 0.099 → 0.083 ms（−16%），却要改变画出来的东西。
  作为 CPU 手段已经不划算——除非 paint 那一侧证明 14671 字符的 path 本身是问题。

### 仍然未知

React 的 commit 与浏览器 paint。一条 path 是 **14671 个字符**，一帧最多 6 条；这些字符串交给
DOM 之后的成本，benchmark 看不见。这是 D2 剩下的唯一问题，需要一次真实窗口的 profiling。

## 2. D2 — 前端渲染（原始清单）

涉及：`components/panels/SpectrumPanel.jsx`(1008) `math/spectrumMath.js` `math/spectrumMaxHold.js`

| # | 待测 | 怎么测 |
| --- | --- | --- |
| 2.1 | `displayPaths` useMemo 每帧重建 SVG path 字符串的耗时 | CDP profiling；同时记录点数与 path string 长度 |
| 2.2 | 点数是否远超面板像素宽度 | 对比 bin 数与 CSS 宽度；超出部分是纯浪费 |
| 2.3 | React 每帧 reconcile 这些 `<path>` 的成本 | profiling 里 commit 阶段占比 |
| 2.4 | `spectrumPeakLabelList` + `AnimatePresence` 在 60fps 面板里的成本 | peakLabels on/off 两档对比 |
| 2.5 | `spectrumMaxMode` 三档各自的增量成本 | off / decay / hold 三档对比；hold 还带 `releaseHoldSmoothing` 副作用 |
| 2.6 | 单面板 vs 八面板同屏的帧预算 | 两档都要测；同屏才是真实卡顿场景 |

候选方向（先测再定，不预设）：canvas 化、path 数据复用、按像素宽度降采样。

## 2.9 paint 侧的第一个实测（2026-08-30，由 Level Meter 轮的 DOM 计数器带出）

D2 长期记着"paint 待测"。后续轮次为读数面板做的 `scripts/webview-dom-count.mjs` 顺带量到了它，
八面板全开、文件分析驱动：

| | 每秒 |
| --- | ---: |
| 合计 | **471.5（八个面板里最高）** |
| 属性 | 373.0 —— `d` 156.0、`opacity` 113.0、`style` 104.0 |
| 文本 | 102.3 |
| 节点增删 | 0 |

最初把 `d`、`opacity`、`style` 数量接近解释成了“同一批元素每次更新写三个属性”。这个归因
**不成立**：计数器只按属性名汇总，并不报告目标元素。回到渲染树后，`d` 的 156 次/秒恰好是
最重配置的 6 条路径 × 约 26 次/秒；路径本身没有动态 `opacity` 或 `style`。后两项来自包住路径的
Framer Motion `<motion.g>`：它原本只为 Live/Snapshot 切换提供 180 ms 的轻微淡变，却跟着父组件
的每个数据帧重新提交动画属性。

同期 profile 中 `aC src/math/spectrumMath.js:38`（`buildSpectrumSvgFromBandsAndDb`）为 1.5%，
`setAttribute` 合计约 1.6%。**这是量到的第一个 paint 侧数字，不是结论**。

### 2.10 已落地：删除 Spectrum 独有的 Live/Snapshot 淡变（2026-08-31）

其余历史面板都直接切换 Live/Snapshot；Spectrum 这层淡变是 2026-05-11 的通用 motion 改动留下的
特例，不再是产品设计。删除 `AnimatePresence`、`motion.g` 和 `useReducedMotion`，改回普通 `<g>`：

- Live/Snapshot 的数据与颜色直接切换，与其余面板一致；
- 频谱曲线、填充、双平面和 Max Hold 点击热区不变；
- 稳态不再有动画层反复写 `opacity` / `style`；
- `d` 仍随真实数据更新，这是有效工作，不以降采样或改变交互来换取更低计数。

原始计数里约 217 次/秒 `opacity` / `style` 写入应当全部消失；总 DOM 变更还会随素材、View、Max
模式与峰值标签变化，不能脱离同一输入直接相减。

### 2.11 删除淡变后的真实 Live 验证（2026-08-31）

Windows WebView2、VB-Cable + VLC 实时信号，Spectrum 为 M/S + Decay。先用 panel CPU 计数器确认
父组件确实在持续处理新帧：10 秒内 `buildPaths` **426 次（42.6/s）**，不是一张静止页面。
随后用增强后的 `webview-dom-count.mjs` 计 10 秒：

| | 每秒 |
| --- | ---: |
| Spectrum DOM 变更 | **26.0** |
| `d` | **26.0** |
| `opacity` | **0** |
| `style` | **0** |
| 节点增删 / 文本 | **0 / 0** |

目标归属也吻合：25.8/s 是 `path[data-spectrum-live][d]`，0.2/s 是
`path[data-spectrum-max-fill][d]`。这段素材是稳态双声道正弦，未变化的副路径会被 React 留在原值，
所以总数不能和 §2.9 的文件素材直接比较；但在 426 次 path 重建期间，动画层的两种属性写入都严格
为零，已经足够关闭这一项。剩下的 DOM 工作只有真实数据改变时才提交的路径坐标，不继续改渲染形态。

## 3.0 D3 判定结果（2026-08-28，实测）

**结论：结构已经在一个好的局部最优，剩下的手段全是有损的，每一条都有具体的拒绝理由。**

### 实测占用

用真实 `SpectrumHistorySlab` 灌 4000 行，按 schema 自己的 `payloadBytes` 累加实际 chunk：

| view | 每行 | 理论下限（纯 dB 平面） | 开销 | 4 小时单 key |
| --- | --- | --- | --- | --- |
| combined | 1972 B | 1916 B | **+2.9%** | **0.66 GiB** |
| lr/ms | 3937 B | 3832 B | **+2.7%** | **1.32 GiB** |

开销不到 3%（时间戳 Float64、每 chunk 一份 max 平面、每行一个 hasB 标志）。**没有水分可挤。**

前几轮已经做掉的事，这里确认仍然成立：值是 Int16 centi-dB 而不是 Float32；副平面 `dbB` 直到
真有一行带它才分配（`SpectrumHistorySlab.js` 的 `createChunk`），所以 combined 会话只付一份。

### 量过并拒绝的三条

| 候选 | 收益 | 为什么不做 |
| --- | --- | --- |
| Int16 → 8 位 | 减半（0.66 → 0.33 GiB） | 用户可设的量程跨度约 120 dB，256 级即 **0.47 dB/步**；而悬停读数显示到 **0.1 dB**（`toFixed(1)`）。会看得见 |
| 减少频带数 | 与减少的比例同步 | Spectrum 拖动回放画的曲线**真的用满 958 个点**，不是只喂给 spectrogram 的色带 |
| 分层 / 老数据抽稀 | 可观 | 与既定方案冲突：保留策略在所有面板间保持统一，没有 per-panel 特例（见 `AGENTS.md`） |

### 没有动的一条

行节奏是 40 ms（25 行/秒），由 `VISUAL_EMIT_MS` 决定，和 spectrogram 的时间分辨率绑定。
改它会同时改变 spectrogram 的横轴精度，属于产品决定，不在性能范围内。

## 3. D3 — 历史存储（原始清单）

涉及：`lib/SpectrumHistorySlab.js`(455)

| # | 待测 | 怎么测 |
| --- | --- | --- |
| 3.1 | 实际 slab 结构与 4h 占用复算（已知量级 1.38 GB/key） | `benchmark:history` + heap 预算测试 |
| 3.2 | 同时存在的 key 数在真实操作下的上限 | `deriveRetainedAnalysisKeys` 的行为 + 一次典型调参会话 |
| 3.3 | 时间轴是否值得分层（min/max 摘要 + 原始行，参照 `PowerOfTwoMinMaxIndex`） | 先看快照读取路径的实际访问模式，再决定 |
| 3.4 | 频率轴是否可按显示分辨率降采样存 | 与 2.2 同源：若显示端本就用不了那么多 bin，存全分辨率的收益是什么 |
| ~~3.5~~ | ~~f32 是否必要~~ | 已作废：slab 存 Int16 centi-dB，见 §1.5、§3.0 |

注：写任何 fixture 都用 `Math.fround` 或 2 的幂次可精确表示的值（AGENTS.md 已记录的坑）。

## 3.5 D4 提前触发的发现 — 每帧 payload（2026-08-28，实测）

在为 tilt 改动找「前端在哪里施加」时，撞上了比 tilt 大一个数量级的问题，先记在这里。

**Rust 每帧为每个 spectrum key 生成并发送 4 条 SVG path 字符串，前端全部丢弃。**

- `meter_pipeline.rs:70-108` 调 `spectrum_paths_from_bands` 生成 `path/peakPath/pathB/peakPathB`。
- `paths.rs` 的 dB→y 映射把 `SPEC_DB_MIN/-MAX` 和 20 Hz–20 kHz **写死**，因此这些 path 只在
  默认量程下正确。
- 前端两个消费者都无条件用 bands + dB 自己重建：`SpectrumPanel.jsx:621-660` 的 `displayPaths`、
  `DockSpectrum.jsx:10-16` 的 `spectrumPath`。Rust 的 path 只在 `bandCentersHz`/dB 缺失或长度不匹配
  时才作为兜底，正常帧走不到。

**实测 payload 规模**（grid = 96 点/八度 → 20 Hz–20 kHz **958 点**；帧节奏
`FRAME_EMIT_MS = 16` → 62.5 帧/秒；JSON 经 `tauri::ipc::Channel`）：

| view | 每帧 | 其中 path | 其中 bandCentersHz | 每个 key 的带宽 |
| --- | --- | --- | --- | --- |
| combined | 82.4 KiB | 29.7 KiB (36%) | 17.1 KiB | **5.03 MiB/s** |
| lr / ms | 147.6 KiB | 59.5 KiB (40%) | 17.1 KiB | **9.01 MiB/s** |

最多同时四个 key。三层可削减：

1. **path 字符串**：36–40%，前端根本不用。纯删除。
2. **bandCentersHz**：17.1 KiB/帧，但它对给定 sample rate + 频率范围是**常量**，每秒重发 62.5 次。
   改成握手时发一次。
3. **dB 数组以 JSON 文本发 f64**：每个数约 19 字节，而 f32 二进制只要 4 字节。
   前端最终也只存 Int16 centi-dB。

前两项就能砍掉 52–57%；三项都做，82 KiB → 约 4 KiB 量级。

## 3.6 D4 第 2 层已落地：栅格移出每帧（2026-08-28）

`bandCentersHz` 那 958 个频率只由采样率决定，却随每一行重发：主帧 62.5 次/秒，visual history
tick 再 25 次/秒，每份 17.1 KiB。

**做法**：栅格升到帧级别，配一个 id。`SpectrumFrameResult` 与 `SpectrumVisualEntry` 都不再带
`bandCentersHz`；`AudioFramePayload` 带 `spectrumBandGridId`（每帧都有）和
`spectrumBandCentersHz`（只在需要时有）。前端 `applyBandGrid` 按 id 缓存，把栅格写回每一行。

**为什么不是"只发一次"**：`cpal_backend` 在 webview 落后时会丢帧（`MAX_FRAMES_INFLIGHT = 120`），
而帧是先由 pipeline 构造、再被丢弃的——只发一次的话，承载栅格的那一帧一旦被丢，整个 session
的频谱面板都会空白。所以是**变化时发 + 每 64 帧（约 1 秒）兜底重发一次**，代价约 17 KiB/秒。
前端见到不认识的 id 就丢掉该帧的频谱行（面板本来就把"该 key 还没有结果"当作待渲染状态），
下一次重发即恢复。

**实测**（单个 key，主帧 62.5/s + visual tick 25/s 合计）：

| view | 主帧 | visual tick | 合计带宽 |
| --- | --- | --- | --- |
| combined | 52.3 → **35.3 KiB** | 34.7 → **17.6 KiB** | 4.04 → **2.58 MiB/s**（−36%） |
| lr / ms | 87.5 → **70.5 KiB** | 52.3 → **35.2 KiB** | 6.62 → **5.16 MiB/s**（−22%） |

**Stereo Map 还没接**：它的行落在同一个栅格上（同样是 `spectrum_frequency_bounds` + 96 点/八度
的 `LogGrid`），所以 `StereoMapFrameResult` / `StereoMapVisualEntry` 的 `bandCentersHz` 可以直接
复用这个帧级栅格，不需要再改一次协议。留给 Stereo Map 自己那一轮。

## 3.7 D4 第 3 层已落地：dB 行不再是文本（2026-08-30）

统一二进制协议轮的第 3 步。dB 行不再由 `serde_json` 写成十进制、再由 webview 解析回来，而是作为
二进制 section 跟在 JSON 信封后面，信封里留一个 `{"$bin":0,"dtype":"f64","len":958}` 描述符。
设计见 `protocol.md`，实现是 `src-tauri/src/ipc/frame_encode.rs` 与 `src/ipc/frameWire.js`。

**实测每行 958 band**（`ipc::frame_encode::tests::a_production_width_frame_is_far_smaller_than_its_json`）：

| | 每行 |
| --- | ---: |
| 旧：JSON 文本 f64 | **18,370 B** |
| 二进制 section，f64 | 7,664 B（−58%） |
| **二进制 section，f32（当前）** | **3,832 B（−79%）** |

按此折算单 key 带宽：combined **2.58 → 约 0.54 MiB/s**，lr/ms **5.16 → 约 1.08 MiB/s**。

**分两步走是有意的**：先只换传输（f64，不改变前端读到的任何一个值），再单独做精度决定。
第二步把 `SpectrumFrameResult` 的行类型改成 `Vec<f32>`，在 payload 边界一次性窄化。

**精度证据**（`spectrum_db_narrowing_stays_far_below_display_precision`）：扫 −200…+200 dB
全量程，f64→f32 最坏误差 **7.32e-6 dB**。历史 slab 存 Int16 centi-dB，步长 0.01 dB——
误差比它小 **1366 倍**，比面板显示的 0.1 dB 小四个数量级。另有一个测试证明任意两个相差一个
centi-dB 的值窄化后仍可区分，即窄化不可能把显示上分得开的两条并成一条。

**真实窗口已验证**：WebView2 解码从 0.689 降到 0.073 ms/帧，`JSON.parse` 从 profile 中消失；
完整 P-1 / P-2 结果见 `protocol.md` §9.3。

## 4. D4 — 其他

| # | 待测 | 怎么测 |
| --- | --- | --- |
| 4.1 | ~~每帧 Channel payload 字节数与 bin 数~~ **已测**，见 §3.5–§3.7 | 实测；乘以帧率得带宽 |
| 4.2 | ~~序列化/反序列化成本~~ **已测**，见 `protocol.md` §9.3 | WebView2 同帧 A/B + profile |
| 4.3 | 面板不可见时是否真的停止 ingest | 已有 `useIntakeRouting` 逻辑，需确认 Spectrum 走到了 |

## 5. 协议改动候选（跨 panel，单独记）

- 1.7 / 1.8 若成立 → request key 语法变化，Rust 的 `OctaveSmoothing::key_token` 镜像同步，
  `analysisRequestKeyFormat.test.js` 需要改。这会同时影响 Spectrogram 和 Stereo Map（后者复用同一批 token）。
- 3.4 / 3.5 若成立 → payload 元素类型或长度变化。
- **3.5 第 3 层已落地**（§3.7）：dB 行改走二进制 section。`AudioFramePayload` 的 JSON 形状不再是
  线上形状，镜像在 `ipc/frame_encode.rs` 的 `WireFrame`——**给 payload 加字段必须同时加到镜像里**，
  两个 key-set 对拍测试盯着这条。

## 6. 既有测试的合理性存疑项

（实测过程中填写。判据：断言了不该锁死的实现细节 / 用容差掩盖真实误差 / 锁死了本轮想改的协议。）

### 6.1 `production_spectrum_payload_matches_legacy_...` 有一处时钟竞争（2026-08-31 发现）

`meter_pipeline.rs:3125` 断言 `visual.timestamp_ms == frame.timestamp_ms`。这两个值来自
**两次独立的时钟读数**：live 模式下 `timestamp_ms()` 是 `self.t0.elapsed().as_millis()`，
在构造 visual tick（第 905 行）和构造 frame（第 1016 行）时各读一次。中间只要跨过一个毫秒边界，
两者就差 1。

**实测**：0.14.3 的 `release:preflight` 里失败一次（`left: 1609, right: 1610`）；
单独重跑 8 次全过。只在完整并行套件下复现，也就是 CPU 竞争最激烈的时候。

**这是测试断言强于实现承诺**，不是产品缺陷：一帧和它自带的 visual tick 时间戳差 1 ms 无害。
**没有在 0.14.3 里修**——修它要动 `meter_pipeline.rs`，而那会让该版本已经跑完的
`smoke:capture` 与 4 小时 soak 不再对应被发布的代码。为了让门变绿去改引擎是本末倒置。

**已修（2026-08-31，0.14.3 之后）**：`push_pcm_f32_optional` 现在在发射段开头读一次
`emit_timestamp_ms`，frame、visual tick、loudness tick 三处共用，断言由构造成立。
没有给断言加容差——那是掩盖，不是修。

file 模式那两处 `timestamp_ms()`（第 765、1056 行）**没有并进来**：它们是 checkpoint 的调度判断
和各自 batch 条目的媒体时间戳，共用会改变语义。

新增 `a_frame_and_the_ticks_it_carries_share_one_timestamp` 钉住这个不变式。
**但要清楚它值多少**：如果有人重新引入第二次读数，它也只在毫秒边界恰好落在两次读数之间时才失败，
和原来那个 flake 一样。真正的保证在"一次 push 只读一个时钟值"这个结构上，不在这个测试上。
