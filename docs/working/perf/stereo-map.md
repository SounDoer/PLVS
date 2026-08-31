# Stereo Map 体检表

**状态：** 四维已测，两层量化都已落地。D1 成本低且稳态零分配；D2 的已知 renderer 热点已经落地，
当前纯 JS 派生不超 0.11 ms；D3 的四小时单 key、单 mode 已从 **1.29 GiB 经 0.97 GiB 降到
0.81 GiB（累计 −37.2%）**，实时与历史 HUD 统一明确标为近似 energy；D4 先通过共享帧级频率栅格
降低 23%，再由统一二进制协议轮把三张 primitive row 移出 JSON（§4.1）。
协议轮的真实窗口验证已完成（`protocol.md` §9）。

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

### 3.1 四小时单 key、单 mode 已降到 0.81 GiB

25 rows/s、360,000 rows、958 bands 的投影已由 `npm run benchmark:history` 实测结构校验：

| 字段 | 字节 | 占比 |
| --- | ---: | ---: |
| mode values，12-bit | 517,320,000 | 59.63% |
| relative energy，Uint8 | 344,880,000 | 39.75% |
| timestamps | 2,880,000 | 0.33% |
| Hold chunk summaries | 1,348,864 | 0.16% |
| row peaks + presence bitmap + grid | 1,083,832 | 0.12% |
| **合计** | **867,512,696 B（0.81 GiB）** | 100% |

四 key 是 **3,470,050,784 B（3.23 GiB）**。每多保留一个显示 mode，同 key 仍会增加一张
517,320,000 B value plane；四 mode 同时打开时单 key 约 **2.25 GiB**。plane 会在 panel 关闭后
删除，但这仍是合法工作区能达到的真实上界。

结构没有“忘了删”的大列：

- mode value 不能从 energy 重建，energy 也不能从归一化 mode value 重建；
- 改存 PL/PR/ρ 三张 primitive plane **只在同时打开三个以上 mode 时才划算**。按字节算，现在是
  `1 + 1.5N`（N = 同开 mode 数），primitives 是三张 plane 且 energy 变成可推导：N≤2 时现结构更省，
  N=4 时 primitives 更省。它把存储换成查询时派生（已测 0.071~0.103 ms/行/mode），
  **不做**，但结论的适用范围只到 N≤2；
- bitmap 支持运行中新增 mode，早期 row 确实可能没有该 mode，不能删除；
- row peak 驱动相对 gate，Hold summary 让四小时查询按 chunk 合并；二者合计不到 0.2%。

因此 mode value 在 **Float/Int16 层面没有无损主体压缩空间**。但"无损"不是唯一可问的问题——
energy 减半靠的正是"显示端到底需要多少精度"，而这一问同样适用于 value plane（见 3.3）。

### 3.2b 对旧数据降采样：已否决，理由要记住

任何编码都比不过对旧行降采样。四小时铺在约 1000 px 上，一个像素是 14.4 秒 = 360 行，
看上去老数据的 40 ms 分辨率完全是浪费。

**但历史窗口可以缩到 5 秒**（`HISTORY_MIN_WINDOW_SEC`），并且能停在保留期内任意位置。
所以"三小时前的一个 5 秒窗口"是合法视图，那里的 125 行会以每行约 8 像素铺满面板——
**老行是逐行可见的**。降采样会直接毁掉这个能力。

记在这里是因为它太诱人：下一轮很可能被重新想起来，更糟的情况是有人实现了，
然后只在一个不常用的视图里悄悄坏掉。

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

### 3.2b 如果 HUD 不再报 energy 数字，plane 能小到多少（2026-08-31 实测）

工具：`npm run experiment:stereo-map-opacity-codec`（新增）。同一批 fixture，和 §3.2 可直接对比。

energy 的三个消费者里，**HUD 是唯一需要量程和精度的那个**：门控只问"在不在门限之上"，
opacity fade 只用门限往上 **12 dB** 的窗口。现役编码为了 HUD 存了 63.25 dB × 0.25 dB/step。
如果 HUD 不再显示 dB，plane 可以只存 **opacity 本身**：

```
code 0        隐藏（低于门限）
code 1..L     渐变区，每个 code 是一个等宽桶的中心，严格落在 (0,1) 内
code OPAQUE   完全不透明（门限 + 12 dB 及以上）
code INVALID  无值
```

**门控和"完全不透明"各占一个专属 code，所以这两个分类由构造精确**——量化只发生在渐变区内部。

| 编码 | gate / opaque 错分 | opacity 最大误差 | 平均误差 | plane | 单 key 总量 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 现役 8 bit | **5,760** | 0.0200 | 0.000419 | 328.9 MiB | 0.808 GiB |
| 6 bit | **0** | **0.0082** | 0.000324 | 246.7 MiB | 0.728 GiB（**−9.9%**） |
| 5 bit | **0** | 0.0172 | 0.000681 | 205.6 MiB | 0.687 GiB（**−14.9%**） |
| 4 bit | **0** | 0.0384 | 0.001519 | 164.5 MiB | 0.647 GiB（**−19.9%**） |

穷举 6,924,577 组合 + 512×958 代表性行，两个 fixture 结论一致。

**注意现役编码那 5,760 次错分**：它量化的是 energy，门限边界落在两个 step 之间，
所以有 0.083% 的 band 显隐判断是错的（全部是"该显示却被隐藏"）。
**opacity 编码把门限放在专属 code 上，这类错误降到 0——6 bit 在最大误差、平均误差、
显隐正确性三项上全面优于现役 8 bit，还省 9.9%。**

**桶中心映射是必要的**：最初用 `c/(L+1)` 等距映射并钳位，渐变区两端各吃满一步误差
（4 bit 时 0.0706），中间只吃半步。改成等宽桶的中心后误差均匀，上界是半桶。
这条是分辨率测试发现的，不是推出来的。

**代价**：HUD 不能再显示 energy 的 dB 值。门限往下全部塌成一个状态，
往上也只有 12 dB 内有分辨率。最多能显示定性状态（可见 / 淡 / 被门限挡住）。

**尚未验证**：0.017（5 bit）或 0.038（4 bit）的 alpha 阶梯在真实画面上看不看得出来。
误差是量出来的，"看不出来"是判断，需要真实窗口对比才能定。

### 3.3 12-bit value plane：把同一个问题问给最大的那张表

energy 之所以能减半，靠的是"显示端需要多少精度"，而不是无损压缩。同一问题此前没有问过
占 66% 的 value plane。

问一下的话，Int16 里有 4~6 位是画不出也读不出的：

| mode | 原精度 | HUD 显示 | 600 px 面板能分辨 |
| --- | --- | --- | --- |
| Position / Correlation | 1/32767 ≈ 0.00003 | 0.01 | ≈ 0.0033 |
| Mono Loss / M/S Ratio | 0.01 dB | 0.1 dB | 0.24 dB/px |

12 位足够，而且是可验证的足够（`packedHistoryCodecs.test.js` 穷举 20,001 个点）：

| mode | 12 位最大误差 | HUD | 每格占几像素 |
| --- | ---: | ---: | ---: |
| Position / Correlation | 0.00024 | 0.01 | 0.147 |
| M/S Ratio（最宽 −96..48） | 0.0176 dB | 0.1 dB | 0.147 |

**每一项都低于显示精度一个数量级，也低于半个像素。** 这一点和 energy codec 不同：
energy 有 59.9% 的时候会改变 HUD 上看得见的数字，所以才需要标 `≈`；value plane 的量化
用户看不出任何差别，因此**不需要**任何新的近似口径标注。

### 码空间必须保持单调

Hold summary 直接对**编码值**取 min/max 而不先解码（`updateExtreme`），所以新码空间的顺序
是承重的：`invalid` 占 0 且被显式跳过，然后 `-Infinity`、递增的有限区间、`+Infinity`。
normalized mode 没有无穷值（Position/Correlation 定义在 [-1,1]），有限区间直接铺满剩余空间，
无穷输入按边界截断——与两族共用 Int16 时的行为一致。

### 存储布局：拆成高字节 + 低半字节

不是三字节存两个值，而是 `hi`（每项一字节）+ `lo`（每两项共用一字节的两个半字节）。
这样**高字节平面仍然可直接索引**，而它承载了顺序，比较常常在这里就能结束。

实测代价（958 band 一行）：

| | Int16 | 12 位 | 差 |
| --- | ---: | ---: | ---: |
| 写一行 | 0.25 µs | 0.90 µs | +0.66 µs |
| 读一行 | 3.99 µs | 4.01 µs | **+0.02 µs** |

读几乎免费，所以原本设想的"仅在 chunk 封存时再编码、活跃 chunk 保持 Int16"那层复杂度
**不需要**——单一表示就够，也少一条容易出错的双表示读路径。

### 3.4 写入侧总成本

energy codec 落地时没有量过它加在写入路径上的成本，这里补上（每行 958 band）：

| | 每行 | 25 行/秒占单核 |
| --- | ---: | ---: |
| 旧 `encodeCentiDb` | 7.95 µs | 0.020% |
| relative-energy codec | 20.95 µs | 0.052% |
| 12 位 plane 写入（增量） | +0.66 µs | 0.002% |

贵了 2.6 倍但绝对值可忽略，四 key 也只有约 0.21% 单核。校正循环基本不触发
（22 ns/次编码，跑不了几步）。

## 4. D4 — payload / 协议

已落地：每行不再重复发送 `bandCentersHz`，Spectrum 与 Stereo Map 都引用帧级 grid。单 key 主帧与
visual tick 都从 73.5 KiB 降到 56.5 KiB，总带宽从 **6.28 MiB/s 降到 4.83 MiB/s（−23%）**。

剩余主体是三张 958-long f32 primitive row。二进制传输能显著减少 JSON，但与 Spectrum、
Vectorscope 属于同一个统一协议项目；不为 Stereo Map 单独新增 wire format。

### 4.1 primitive row 已移出 JSON（2026-08-30）

统一二进制协议轮的第 4 步。`pl` / `pr` / `c` 改走 `f32` binary section，设计见 `protocol.md`。
这是三个面板里最干净的一个：**这三行在管线里本来就是 `f32`**，所以既没有精度问题，前端也不需要
改——`stereoMapMath.js` 的 `isNumericRow` 一直同时接受 `Array` 和 typed array（历史 slab 一直
返回后者），实时路径现在只是递给它与 scrub 路径相同的形状。

**实测每行 958 band**（`ipc::frame_encode::tests::a_production_width_frame_is_far_smaller_than_its_json`）：

| | 每行 |
| --- | ---: |
| 旧：JSON 文本 f32 | **12,614 B** |
| 新：f32 二进制 section | **3,832 B（−70%）** |

三行主帧 + 三行 visual tick 折算，单 key 的 band 行部分 **3.16 → 0.96 MiB/s**。

**上面那个 4.83 MiB/s 不能直接和这个相减。** 它隐含每行约 18.8 KiB，也就是 f64 的宽度，而 Rust
直接量出来 `Vec<f32>` 经 `ryu` 只有 12,614 B。旧数字里应该混进了别的东西，经过见
`protocol.md` §2 的 P-6；以本节的每行实测为准。

**仍待验证**：以上都是线上字节，webview 侧的实际 CPU 降幅要在真实窗口里采 profile。

## 5. 判定汇总

| # | 结论 | 判定 |
| --- | --- | --- |
| D1-1 | 正确性、对齐、非有限恢复与零分配覆盖完整 | 保留 |
| D1-2 | 三档 consume + 平滑 output 约 50.6 µs | **不改** |
| D2-1 | 958-band 派生 0.071–0.103 ms | **不改** |
| D2-2 | Canvas 尺寸、重画跳过、gradient 复用已合理 | **不再猜改** |
| D3-1 | 单 mode 由 1.29 GiB 经 0.97 降到 0.81 GiB | **已落地（累计 −37.2%）** |
| D3-2 | gate/Hold 分类不变；HUD 明确标为近似 | **已落地** |
| D3-3 | 12 位 value plane，误差低于显示精度一个数量级 | **已落地（−16.6%）** |
| D3-4 | 对旧行降采样会毁掉 5 秒历史窗口 | **已否决** |
| D4-1 | grid 复用已降低 23% | 已落地 |
| D4-2 | primitive 每行 12,614 → 3,832 B，band 行 3.16 → 0.96 MiB/s | **已落地（−70%）**，真实窗口已验 |

## 6. 后续提交建议

1. ~~单 panel 全部走完后，统一设计 Spectrum / Stereo Map / Vectorscope 二进制协议。~~
   **已做**，见 `protocol.md`。Vectorscope 经实测**没有并进去**（把 path 构建搬到主线程是净亏），
   理由记在该文档 §4。
