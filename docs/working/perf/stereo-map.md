# Stereo Map 体检表

**状态：** 四维已测，energy codec 已对拍并落地。D1 成本低且稳态零分配；D2 的已知 renderer
热点已经落地，当前纯 JS 派生不超 0.11 ms；D3 的四小时单 key、单 mode 已从 **1.29 GiB 降到
0.97 GiB（−24.9%）**，实时与历史 HUD 统一明确标为近似 energy；D4 已通过共享帧级频率栅格
降低 23%。

工具：`npm run benchmark:stereo-map-rust`（新增）、
`npm run benchmark:stereo-map-render`（新增）、
`npm run experiment:stereo-map-energy-codec`（新增）、`npm run benchmark:history`（已有）。

## 0. 数据路径与 key

Stereo Map 不共用 Spectrum consumer 或历史 slab，只复用 shared spectral engine 的三档物理 FFT
和相同的 958 点 log-frequency grid。每个 request key 包含 pair、speed、smoothing，但不含显示 mode：

`stereoMap:pair:x:y:spN:smN`

同 key 的四种显示 mode 共用 Rust primitives 与一张历史 slab；历史只为当前实际打开的 mode 建
plane。不同 speed/smoothing 必须是不同 key，因为 EMA 后的 primitive 已经不同，不能共享历史。

## 1. D1 — Rust 计算

### 1.1 正确性边界完整

`StereoMapConsumer` 在 bridge/shared spectral 路径上运行，不在 audio callback。三档 FFT 由 shared
spectral engine 提供，consumer 自己只计算 `PL`、`PR`、完整复数互谱 `C`，按各档 hop 做 Speed
EMA，再插值、crossfade、octave smoothing，最后才丢弃 `Im(C)` 并发布 f32。

`cargo test --lib dsp::stereo_map::tests`：**13/13 通过**，覆盖：

- 同相、反相、正交、非等幅和单边输入的已知互谱；
- 独立噪声的互谱平均收敛到 0；
- Speed EMA 对三档 hop、PL/PR 和复数 C 的一致性；
- smoothing 在线性 power/complex 空间执行，复数两部分权重一致；
- 错位 frame 拒绝且不污染状态；非有限 triplet 整体归零并可恢复；
- wire row 为 f32、只发布 `Re(C)`，内部仍保留完整复数；
- warmed consume/output 的持久 buffer 全部复用，**0 heap allocation**。

前端公式另有 `stereoMapMath.test.js`，保护四种 mode 的边界、infinity、gate 和显示投影。
AGENTS.md 记录的 M/S Ratio 极低电平边界是已量过的产品口径，不在本轮“修正”。

### 1.2 Criterion：不是热点

48 kHz、production 958-band grid：

| 路径 | 每次 |
| --- | ---: |
| `output()`，无 smoothing | **7.57–7.67 µs** |
| `output()`，1/12 octave | **16.05–16.23 µs** |
| consume 三档 resolution + 1/12 output | **50.35–50.89 µs** |

最后一项还包含 10,755 个 complex bins 的 PL/PR/C 更新，是偏保守的“一批三档都到齐”测法；真实
三档按各自 hop 到达。即使粗按 25 批/s、四 key 上界折算也只有约 **0.51% 单核**，并且没有稳态
分配。**不改 Rust。**

## 2. D2 — 前端渲染

### 2.1 958-band 派生成本低于 0.11 ms

Node microbenchmark 使用 958 bands、有限且持续变化的 PL/PR/C：

| mode | `deriveStereoMapRow` |
| --- | ---: |
| Position | **0.071 ms** |
| Correlation | **0.084 ms** |
| Mono Loss | **0.099 ms** |
| M/S Ratio | **0.103 ms** |

历史写入所用的共享 normalization visitor：单 mode **0.046 ms**，四 mode 一起 **0.135 ms**；
normalization/gate 只做一次，没有按 mode 重复。

Workspace 已按 `liveRow/mode/range` memo 派生结果。Dock 没有 memo，但 live primitive row 本来就随
frame 更新；没有 profile 证据前，不为不到 0.11 ms 的纯计算增加跨实例缓存。

### 2.2 Canvas 调度已经合理

旧 SVG 每 band 约两个 DOM 节点，snapshot scrub 会重建近 2,000 个节点；当前 `StereoMapPlot` 已是
单 canvas。它在 mount/ResizeObserver 时读取尺寸，普通 parent render 不同步读布局；颜色来自
resolved theme。相同 source version、输入引用和绘制参数直接跳过重画；兼容重建等值数组的调用方
才退回 O(bands) hash。

首次真实 renderer profile 中 `addColorStop` 为 **211 ms/10s（2.1%）**。已落地的修复让一个
continuous run 只建一个 gradient，fill/stroke 共用，color stop 工作减半；复测后该函数未再进入
profile 前列。`buildRuns`、颜色插值与 canvas path 都是一次 redraw 的 O(958) 工作，但目前没有新的
profile 热点证据，**不继续凭结构猜测优化**。

## 3. D3 — 历史存储

### 3.1 四小时单 key、单 mode 已降到 0.97 GiB

25 rows/s、360,000 rows、958 bands 的投影已由 `npm run benchmark:history` 实测结构校验：

| 字段 | 字节 | 占比 |
| --- | ---: | ---: |
| mode values，Int16 | 689,760,000 | 66.33% |
| relative energy，Uint8 | 344,880,000 | 33.16% |
| timestamps | 2,880,000 | 0.28% |
| Hold chunk summaries | 1,348,864 | 0.13% |
| row peaks + presence bitmap + grid | 1,083,832 | 0.10% |
| **合计** | **1,039,952,696 B（0.97 GiB）** | 100% |

四 key 是 **4,159,810,784 B（3.87 GiB）**。每多保留一个显示 mode，同 key 仍会增加一张
689,760,000 B value plane；四 mode 同时打开时单 key 约 **2.90 GiB**。plane 会在 panel 关闭后
删除，但这仍是合法工作区能达到的真实上界。

结构没有“忘了删”的大列：

- mode value 不能从 energy 重建，energy 也不能从归一化 mode value 重建；
- 改存 PL/PR/C 三张 primitive plane，单 mode 反而从两张增到三张；
- bitmap 支持运行中新增 mode，早期 row 确实可能没有该 mode，不能删除；
- row peak 驱动相对 gate，Hold summary 让四小时查询按 chunk 合并；二者合计不到 0.2%。

因此 mode value 在 **Float/Int16 层面没有无损主体压缩空间**；energy 已按产品允许的近似口径
压成 Uint8。

### 3.2 Uint8 relative-energy：采用统一近似 HUD 后落地

energy 的实际消费者只有 12 dB opacity fade、60 dB gate 和一位小数 HUD。实验编码保存
`rowPeakDb - energyDb`，以 0.25 dB/step 使用 code 0–253；254 表示 `Below Gate`，255 单独表示
invalid。row peak 继续使用现有 centi-dB Int16，有限覆盖范围是 0–63.25 dB。

`npm run experiment:stereo-map-energy-codec` 对拍两组确定性输入：6,924,577 个穷举组合（peak
−120..24 dB、attenuation 0..120 dB）和 512 × 958-band 代表行。所有 baseline 值先经过现有
centi-dB codec，以免把旧 codec 误差算给候选。

| 策略 | gate 错分 | Hold 边界错分 | 最大 energy 误差 | 最大 opacity 误差 | 可见 HUD 变化 |
| --- | ---: | ---: | ---: | ---: | ---: |
| nearest | 代表集 0.055% | 0.050% | 0.12 dB | 1.0% | 59.8% |
| 仅 gate-safe | **0** | 0.050% | 0.25 dB | 1.92% | 59.8% |
| **production** | **0** | **0** | 0.25 dB | 2.0% | 59.9% |

普通 nearest 会在 absolute `−96 dB` gate 与 0.25 dB 栅格不对齐时跨过边界。生产 codec 只在
发生跨界时把 code 校正一格，并同时保护 gate 和 `gate + 12 dB` 完全不透明边界；后者也是 Hold
是否纳入一个点的条件。测试对每个 centi-dB row peak，在两个边界上下各 0.01/0.02 dB 穷举，
两种分类都保持 **零错分**。普通位置最大误差 0.125 dB，边界校正最多 0.25 dB，opacity 误差上界
约 2.1%。任何超过 63.25 dB attenuation 的值都必然已经低于当前 gate，因此 `Below Gate` 不会
删除可见曲线点。

编码把 energy plane 减半，每 key 省 344,880,000 B。产品选择统一近似口径：实时和历史都经过
同一 codec 后显示 `Energy ≈ −42.3 dB`；超出有限范围显示 `Energy: Below Gate`，invalid 保持
`Energy: -`。因此不会把量化后的值伪装成原来的精确读数，实时与历史也不会切换口径。

## 4. D4 — payload / 协议

已落地：每行不再重复发送 `bandCentersHz`，Spectrum 与 Stereo Map 都引用帧级 grid。单 key 主帧与
visual tick 都从 73.5 KiB 降到 56.5 KiB，总带宽从 **6.28 MiB/s 降到 4.83 MiB/s（−23%）**。

剩余主体是三张 958-long f32 primitive row。二进制传输能显著减少 JSON，但与 Spectrum、
Vectorscope 属于同一个统一协议项目；不为 Stereo Map 单独新增 wire format。

## 5. 判定汇总

| # | 结论 | 判定 |
| --- | --- | --- |
| D1-1 | 正确性、对齐、非有限恢复与零分配覆盖完整 | 保留 |
| D1-2 | 三档 consume + 平滑 output 约 50.6 µs | **不改** |
| D2-1 | 958-band 派生 0.071–0.103 ms | **不改** |
| D2-2 | Canvas 尺寸、重画跳过、gradient 复用已合理 | **不再猜改** |
| D3-1 | 单 mode 由 1.29 GiB 降到 0.97 GiB | **已落地（−24.9%）** |
| D3-2 | gate/Hold 分类不变；HUD 明确标为近似 | **已落地** |
| D4-1 | grid 复用已降低 23% | 已落地 |
| D4-2 | primitive JSON 仍大 | 并入统一二进制协议轮 |

## 6. 后续提交建议

1. 单 panel 全部走完后，统一设计 Spectrum / Stereo Map / Vectorscope 二进制协议。
