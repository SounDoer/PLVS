# Level Meter 体检表

**状态：** 四维已测。D1 补上了 true peak 的 DSP 测试（此前**没有任何**测试覆盖），成本可忽略；
D2 在八面板全开的 profile 里根本没进前 20；D3 没有自己的历史；D4 删掉了一个从未被读取的
per-channel 字段。

工具：`scripts/webview-dom-count.mjs`（新增，DOM 面板专用）、`npm run profile:webview`（已有）。

## 0. 数据路径

面板读的是 frame 上的标量：`peakDb` / `rmsDb` 每声道一个值，加上 M/ST 两个 loudness 标量。
没有 request key、没有历史 slab、不画 canvas——它是一个 DOM 读数面板。

Peak/RMS 在 `meter_pipeline` 里算，而那跑在**桥接线程**（从 cpal 回调队列取数，并且会 `lock()`
若干 mutex），不是 audio callback 线程。所以那里的 `Vec` 分配是合法的，不违反
`AGENTS.md` 的回调线程规则。

## 1. D1 — Rust 计算

### 1.1 true peak 此前没有任何测试

`peak.rs` 有 7 个测试覆盖 sample peak 与 RMS 窗口（含多声道）。但 **true peak 一个都没有**：
全仓库对 true peak 的断言只有两处 CLI 管道测试，一个断 `None`，一个断硬编码值的 JSON 透传。
`init_true_peak_filters()` 那段 BS.1770 4 倍过采样多相 FIR——**唯一真正可能算错的部分**——
没有任何测试量过，而 TP Max 正是这个面板显示的东西。

已补三个测试（`dsp::loudness::tests`）：

| 测试 | 构造 | 结果 |
| --- | --- | --- |
| 采样点之间的峰值 | fs/4 正弦、相位偏 π/4，采样点全落在 ±0.707 | 采样峰 **−3.0103 dBFS**，真峰 **−0.0634 dBTP** |
| 峰值落在采样点上 | 同一正弦、相位 0 | 两者一致（对照组） |
| 每声道独立 | 右声道半幅 | 右 ≈ −6 dBTP，总体仍 ≈ 0 |

第一个是 true peak 存在的理由：采样峰表读 −3 dB，而下游录音机照样削波。**实现是对的**——
距离真值 0 dBFS 只差 0.06 dB。对照组是关键：它把"正确的过采样器"和"给所有信号加了增益"区分开。

### 1.2 成本可忽略

`sample_peak_db_per_channel_interleaved` 与 `RmsWindow::push_interleaved` 都是 O(samples)：
48 kHz 立体声一帧 16 ms = 1536 个样本的 abs/max 与 mul/add。每帧几个小 `Vec` 分配（桥接线程）。
**不改。**

## 2. D2 — 前端渲染

### 2.1 DOM 变更计数器（新增）

canvas 计数器管不到读数面板——它们不画，只写属性。新增 `scripts/webview-dom-count.mjs`：
挂一个 MutationObserver，按 `data-leaf-path` 归属到面板，报每秒变更数与写得最多的属性名，
用完卸载。Level Meter、Loudness、Stats 三轮都用得上。

八面板全开、文件分析驱动，6 秒实测：

| 面板 | 变更/秒 | 构成 |
| --- | ---: | --- |
| Spectrum | 471.5 | 属性 369.7（`d` 155、`opacity` 112、`style` 103）+ 文本 101.8 |
| Loudness | 180.1 | 属性 103.3（全是 `d`）+ **节点增删 76.8** |
| Stats | 169.8 | 文本 141.6 + 属性 28.2 |
| **Level Meter** | **110.7** | 属性 87.4（`style` 64.3、`data-level-meter-fill-value` 23.1）+ 文本 23.3 |
| Vectorscope | 103.3 | 属性 103.3（`d` 51.7、`style` 51.7） |
| Waveform / Spectrogram | 76.8 各 | 全是节点增删 |

`data-level-meter-fill-value` 每秒 23.1 次 ≈ 一次 visual tick（25/s），所以 Level Meter
**本来就不是每帧更新**，而是约 23 Hz；每次更新约 **4.8 处 DOM 变更**。

### 2.2 profile 里根本没出现

同一状态下 10 秒 profile：**62.2% 空闲**，Level Meter 的任何函数都没进前 20
（第 20 名是 0.29%）。**不改。**

## 3. D3 — 历史存储

**没有自己的历史。** M/ST 模式复用 Loudness 面板的 LUFS Y 范围与其历史；Playback Max 是
前端 hook 里的一个滚动最大值，不是 slab。这一维**无内容**。

## 4. D4 — payload：删掉一个从未被读取的字段

`AudioFramePayload.peak_hold_db` 是 `peak_db.clone()`，每帧序列化一份 per-channel f64 数组。
前端把它存进 `INITIAL_METER_AUDIO` / `CLEARED_METER_AUDIO`、在 `tauriFrameApply` 里透传、
在 typedef 里声明、在夹具里构造——**但没有任何面板、dock 或快照读它**。

面板显示的 Playback Max 是前端 `useLevelMeterPlaybackMax` 自己算的，所以 Rust 这份是死的。

| | 每帧 | 62.5 fps |
| --- | ---: | ---: |
| 立体声 | 50 B | 3.05 KiB/s |
| 5.1 | 92 B | 5.62 KiB/s |

字节数本身微不足道。删它的理由是**它是死的**：一次每帧的 `Vec` 克隆，加上五处必须同步维护的
声明。和 Spectrum 那轮删掉"后端生成、前端丢弃的 SVG 路径"是同一个形状。

## 5. 判定汇总

| # | 结论 | 判定 |
| --- | --- | --- |
| D1-1 | true peak 无任何 DSP 测试；实现正确（误差 0.06 dB） | **已补测试** |
| D1-2 | peak/RMS 为 O(samples)，跑在桥接线程 | **不改** |
| D2-1 | 约 23 Hz 更新，每次约 4.8 处 DOM 变更 | **不改** |
| D2-2 | 八面板全开 profile 中未进前 20 | **不改** |
| D3 | 无自有历史 | 无内容 |
| D4 | `peak_hold_db` 无消费者 | **已删除** |

## 6. 给后续轮次的线索

DOM 计数器顺带量到了另外三条，各自留给对应轮次：

- **Spectrum 当时是 DOM 写入最重的面板**（471.5/s），其中 `opacity` 112/s 和 `style` 103/s
  与 `d` 155/s 是同一批元素。后续已移除 Live/Snapshot 动画层并完成真实窗口复测，见
  `spectrum.md` §2.11。
- **Loudness 每秒有 76.8 次节点增删**，而不是属性更新。节点增删比属性写贵。
- **Waveform 与 Spectrogram 也各有 76.8 次/秒节点增删**，数字与 Loudness 完全相同，
  说明来自三者共用的某个组件，不是各自的绘制。
