# Stereo Map 体检表

**状态：** D4 已落地；D2 落地一项（profile 指出的那条）；D1、D3 待测。

## 0. 与 Spectrum 的关系

Stereo Map **不**共用 Spectrum 的 request key、consumer 或历史 slab——它有自己的一套。
唯一共用的是**频率栅格**：两者都用 `LogGrid::new` 配 `spectrum_frequency_bounds(sample_rate)`，
构造完全相同。

这一条由 `stereo_map::tests::rows_sit_on_the_same_band_grid_the_spectrum_does` 钉住——
D4 的改动整个压在它上面，而它一旦悄悄分叉，Stereo Map 的每个频带都会画错位而其他测试全绿。

M/S 口径也不共用：Stereo Map 走的是左右功率加互谱（`left * right.conj()`），
根本没有 Spectrum 那个 `(L±R)/2` 的投影。见 `spectrum.md` §1.8。

## 1. D4 已落地：复用帧级栅格（2026-08-29）

`StereoMapFrameResult` 和 `StereoMapVisualEntry` 都不再携带 `bandCentersHz`，改从帧级栅格取。
机制是 Spectrum 那一轮建好的，这里是直接接上，没有新增协议。

顺带把帧上那两个字段改名：`spectrumBandGridId` / `spectrumBandCentersHz` →
**`bandGridId` / `bandGridCentersHz`**。它们现在同时服务两种行，名字不该只写一个。
发送条件也从"有 spectrum 行"放宽成"有任何频带行"，否则只开 Stereo Map 的会话永远收不到栅格。

**实测**（单个 key，主帧 62.5/s + visual tick 25/s）：

| | 改前 | 改后 |
| --- | --- | --- |
| 主帧 | 73.5 KiB | **56.5 KiB** |
| visual tick | 73.5 KiB | **56.5 KiB** |
| 合计带宽 | 6.28 MiB/s | **4.83 MiB/s**（−23%） |

Stereo Map 的行是 f32（Spectrum 是 f64），所以前端拿到的中心频率精度比以前**高**了一点点——
同一批数字的更精确表示，用途只有 x 定位和悬停标签，无影响。

## 2. D2 已落地：一个 run 一个渐变，而不是两个

首次 renderer profile 里 `addColorStop` 占 **2.1%** 自耗时（211 ms / 10 s）。查下来是
`drawGradientRun` 对每个连续 run 建**两次**线性渐变——填充一次、描边一次，每个频带各一个
color stop 和一个颜色字符串。

两者只差填充侧一个**常数**因子，而 canvas 本来就会把 `globalAlpha` 乘进去。所以改成建一次：
stop 里仍然带沿 run 变化的 opacity（这部分是每帧真的在变的，不能挪），常数因子交给 `globalAlpha`。
每个频带的工作量减半。

原有测试保护的不变量没动——变化的 opacity 依然逐 stop 表达；只是断言现在说清楚了两者哪个是哪个。

## 3. 待测

- **D1**：它自己的 DSP（互谱、相关性、mono loss、M/S ratio）。已知 `AGENTS.md` 记着
  M/S Ratio 在 −55 dB 以下不可靠、−75 dB 以下读 −Inf，是量过并刻意不修的。
- **D3**：`StereoMapModeHistorySlab` 是它自己的。`npm run benchmark:history` 已经给了投影：
  4 小时单 key **1.29 GiB**，四个 key **5.16 GiB**。结构是否还有水分未查。
- **D2 剩余**：`buildRuns` 与颜色计算的 JS 侧成本没有单独测过；canvas 的原生成本只能靠 profile。
