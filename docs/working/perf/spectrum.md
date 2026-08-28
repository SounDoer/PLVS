# Spectrum 体检表

**状态：** D1 合理性已判定并落地（§1.5、§1.6）；D4 的 payload 第 1 层已削减（§3.5）。其余待测。

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

- **`weighting` 是死参数。** 生产路径恒为 `"z"`，`weighting_db` 恒返回 0，
  `set_weighting` 无调用方。这个参数贯穿整条 Rust 频谱链路；`src/config/scales.js:168-188`
  还有一份前端的 A/C 加权实现同样没人用。不是性能问题，是清理项。
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
本次改动**保持现状**：Spectrogram 依旧按同一个值施加 tilt。要不要给它自己的控件、或者干脆不加
tilt，是产品决定，未处理。

## 1.7 移除的测试及原因

- Rust `every_ui_tilt_step_affects_an_actual_postprocessed_output_row`、
  `default_slope_tilts_curve_upward`、`zero_tilt_disables_default_slope`：主题移到前端，
  由 `spectrumMath.test.js` 的 `spectrumTiltOffsets` / `applySpectrumTilt` 用例
  与 SpectrumPanel、DockSpectrum 的渲染用例接手。
- 差分矩阵去掉 25 个 tilt 步（`4 * (101 + 25 + 4)` → `4 * (101 + 4)`）。
- `legacy_payload_comparison_rejects_path_and_visual_mutations` 改名为
  `..._rejects_row_and_visual_mutations`，突变对象从 path 换成 dB 行。

## 2. D2 — 前端渲染

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

## 3. D3 — 历史存储

涉及：`lib/SpectrumHistorySlab.js`(455)

| # | 待测 | 怎么测 |
| --- | --- | --- |
| 3.1 | 实际 slab 结构与 4h 占用复算（已知量级 1.38 GB/key） | `benchmark:history` + heap 预算测试 |
| 3.2 | 同时存在的 key 数在真实操作下的上限 | `deriveRetainedAnalysisKeys` 的行为 + 一次典型调参会话 |
| 3.3 | 时间轴是否值得分层（min/max 摘要 + 原始行，参照 `PowerOfTwoMinMaxIndex`） | 先看快照读取路径的实际访问模式，再决定 |
| 3.4 | 频率轴是否可按显示分辨率降采样存 | 与 2.2 同源：若显示端本就用不了那么多 bin，存全分辨率的收益是什么 |
| ~~3.5~~ | ~~f32 是否必要~~ | 已作废：slab 存 Int16 centi-dB，见 §1.5 |

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

## 4. D4 — 其他

| # | 待测 | 怎么测 |
| --- | --- | --- |
| 4.1 | 每帧 Channel payload 字节数与 bin 数 | 实测；乘以帧率得带宽 |
| 4.2 | 序列化/反序列化成本 | profiling 中 IPC 回调的占比 |
| 4.3 | 面板不可见时是否真的停止 ingest | 已有 `useIntakeRouting` 逻辑，需确认 Spectrum 走到了 |

## 5. 协议改动候选（跨 panel，单独记）

- 1.7 / 1.8 若成立 → request key 语法变化，Rust 的 `OctaveSmoothing::key_token` 镜像同步，
  `analysisRequestKeyFormat.test.js` 需要改。这会同时影响 Spectrogram 和 Stereo Map（后者复用同一批 token）。
- 3.4 / 3.5 若成立 → payload 元素类型或长度变化。

## 6. 既有测试的合理性存疑项

（实测过程中填写。判据：断言了不该锁死的实现细节 / 用容差掩盖真实误差 / 锁死了本轮想改的协议。）
