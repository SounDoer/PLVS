# 统一二进制协议轮 — 设计文档

**状态：** 设计中，未落地。八个面板的单 panel 轮已收口，三份文档（`spectrum.md` §3.5 第 3 层、
`stereo-map.md` D4-2、`vectorscope.md` D4-1）都把各自剩下的 D4 挂起来等这一轮。本文只定形态、
账目和边界，不含代码改动。

**结论先说**：Spectrum 与 Stereo Map 的数组值得走二进制，**字节和 CPU 是同向的**；
**Vectorscope 不是同一笔账**，binary 省字节但会把 0.104 ms/帧/key 的 path 构建搬到 UI 线程，
按现有证据是净亏，单列在 §4。

## 0. 范围

**做**：把 Spectrum / Stereo Map 每帧的 958 点数组、以及 `bandGridCentersHz` 的重发，
从 JSON 文本换成二进制。

**不做**：

- 不动 `AudioFramePayload` 的几十个标量字段（peak、loudness、dialogue、seq…）。它们又小又杂，
  转二进制收益接近零，却要把 Level Meter / Loudness / Stats 三个已收口的面板重新拖进来。
- 不改任何面板的渲染方式。canvas / SVG 的选择不在本轮。
- 不改 request key 语法（`spectrum.md` §5 的 1.7/1.8 是另一件事）。

## 1. 传输层实测 — Tauri channel 到底怎么发

改协议之前先确认底座能不能承。读的是 `tauri 2.11.5` 的 `src/ipc/channel.rs` 与
`scripts/ipc-protocol.js`（本仓库锁的是 2.11.1，同一实现）。

`Channel<T>` 作为命令参数时走 `JavaScriptChannelId::channel_on`，每条消息按发送顺序编号，
JS 侧 `Channel` 用 `pendingMessages` 重排——**顺序有保证，二进制不改变这一点**。

发送路径按 body 类型和大小分四种，这是关键：

| body   | 大小         | 实际怎么过线                                                                    |
| ------ | ------------ | ------------------------------------------------------------------------------- |
| `Json` | < 8192 B     | `webview.eval` 直接内联                                                         |
| `Json` | ≥ 8192 B     | fetch 路径，`response.json()`                                                   |
| `Raw`  | **< 1024 B** | **`serde_json::to_string(&bytes)` 转成整数数组再 eval**                         |
| `Raw`  | ≥ 1024 B     | fetch 路径，`content-type: application/octet-stream` → `response.arrayBuffer()` |

两条必须记住的：

1. **小的 `Raw` 比 JSON 更糟。** 低于 1024 B 时 tauri 把字节数组序列化成 `[12,255,0,…]` 再 eval，
   每字节最多 4 个字符——比原本的浮点文本还大。所以**不能把小片段单独发成 Raw**，
   必须合成一条够大的消息。当前帧是 35–70 KiB 量级，合成后远在阈值之上，不受影响。
2. **当前的 JSON 帧本来就走 fetch 路径**（远超 8192 B）。所以换成 `Raw` **不增加一次往返**，
   只是把 `response.json()` 换成 `response.arrayBuffer()`。

## 2. 实测账 — 一行 958 band 的两个方向

工具：`npm run benchmark:frame-wire`（`scripts/frame-wire-benchmark.mjs`，本轮新增）。
它同时量字节和 CPU，是这一轮改动前的基线；改完复跑同一条命令即可给出降幅。

测量环境：本机 Node v24.19.0，预热 200 次后取 500–5000 次平均。**这是 Node 里的 V8，
不是 WebView2**；同一引擎家族，但落地前要在真实窗口里复测一次（P-1）。计时项在同一台机器上
跑与跑之间有约 ±10% 浮动，下面的数字按此精度读。

fixture 全部取有限值。`serde_json` 把非有限浮点写成 `null`（4 字节），所以静音行在线上反而更便宜，
**满量程的一行才是诚实的最坏情况**。

f32 行的字节数按 `ryu` 的 f32 最短往返形式建模，不是 JS 的 `String(value)`——后者给的是 f64 的
最短形式，会把 Stereo Map 的每一行虚报约 1.8 倍。这条由 `f32ShortestString` 的单测锁住。

| 一行 958 band                 |            线上字节 |                 前端 CPU | 说明               |
| ----------------------------- | ------------------: | -----------------------: | ------------------ |
| 现状：JSON 文本（dB）         |        **18,368 B** |    **约 0.028–0.031 ms** | parse + 打包 Int16 |
| 现状：JSON 文本（f32 energy） |        **12,614 B** |    **约 0.022–0.024 ms** | 同上               |
| f32 二进制                    | **3,832 B**（−79%） | **约 0.0027 ms**（−91%） | 建视图 + 打包      |
| Int16 centi-dB 二进制         | **1,916 B**（−90%） | **约 0.0012 ms**（−96%） | 前端只需拷贝       |

**为什么 CPU 和字节同向**：前端拿到 dB 之后本来就要打包成 Int16 存进 slab
（`FrameIntake`）。JSON 那条路是「Rust 把浮点格式化成文本 → 前端解析回 number → 再转 Int16」，
中间两步是纯损耗。二进制把这两步删掉，不是搬走。

按面板折算（单 key，主帧 62.5/s + visual tick 25/s，**只算 band 行**，不含字段名与容器）：

|                              | 现状 band 行 |             f32 二进制 | 现状前端 CPU |    f32 二进制 |
| ---------------------------- | -----------: | ---------------------: | -----------: | ------------: |
| Spectrum combined（2+1 行）  |   2.63 MiB/s | **0.55 MiB/s**（−79%） |     4.6 ms/s | **0.40 ms/s** |
| Spectrum lr/ms（4+2 行）     |   5.26 MiB/s | **1.10 MiB/s**（−79%） |     9.2 ms/s | **0.80 ms/s** |
| Stereo Map（3+3 行）         |   3.16 MiB/s | **0.96 MiB/s**（−70%） |     6.4 ms/s | **0.79 ms/s** |
| `bandGridCentersHz` 兜底重发 |   17.5 KiB/s |          **3.7 KiB/s** |            — |             — |

Spectrum 这两行与 `spectrum.md` §3.6 的真实窗口实测（combined 合计 2.58 MiB/s）**相差不到 2%**，
模型可信。**Stereo Map 对不上**：`stereo-map.md` 的 56.5 KiB 主帧折合每行约 18.8 KiB，
接近 f64 的格式化宽度，而本脚本按 `Vec<f32>` 建模只有 12.6 KiB。差 33%，原因未定，
不覆盖旧数字，见 P-6。

### 整帧的 parse 才是那个大数

单行说明的是结构，真正决定主线程负担的是整帧。脚本按四个 key、combined 视图构造一帧完整的
`AudioFramePayload`：

**299 KiB / 帧，`JSON.parse` 约 0.46 ms。**按 62.5 帧/秒折算，**光是解析这一件事就是
约 29 ms CPU/s，接近 3% 单核**，而且全部落在主线程上。这是本轮最值得砍的一项，
也是单个面板的 D2 轮永远看不见的一项——它不属于任何一个面板。

**Int16 还是 f32，本轮不定。** Spectrum 前端最终只存 Int16 centi-dB，理论上 Rust 可以直接发
Int16，再省一半字节和三分之二 CPU。但 Stereo Map 的 pl/pr/c 是 energy 不是 dB，
它自己的 12 位量化（`stereo-map.md` D3-3）是**历史存储**的决定，不等于线上也能这么截。
把量化搬到线上会改变面板拿到的数值，需要单独对拍。**第一版统一走 f32，语义与今天完全一致；
Int16 作为后续可选层。**

## 3. 信封形态

**一条消息，不是两条。** JSON 信封和二进制分开发会引入配对与丢失问题，而 §1 已经说明
小片段发 Raw 反而更贵。所以整帧发一条 `InvokeResponseBody::Raw`：

```
[ u32 jsonLen ][ JSON 信封 (UTF-8) ][ section 0 ][ section 1 ] …
```

JSON 信封就是今天的 `AudioFramePayload`，只是被换掉的每个数组变成一个描述符：

```json
{ "$bin": 3, "dtype": "f32", "len": 958 }
```

尾部 section 按序紧排，第 n 个 section 的偏移由前面所有 section 的长度累加得出——
**不需要偏移表**，`dtype` + `len` 已经够。

前端在 `tauriFrameApply.js` 的 `applyFrame(f)` **之前**解一次：走一遍信封，把每个 `$bin`
描述符换成对应的 typed array 视图，得到与今天**形状完全相同**的对象。下游
（`reduceMeterAudioFrame`、`FrameIntake.pushFrame`、三个面板、三个 dock module）
拿到的仍是「有 `.length`、可索引」的东西。

这一层是本轮唯一的新增概念，而且是**一个纯函数**：`decodeFrame(ArrayBuffer) -> object`，
可以脱离应用完整测试。

**已知需要改的 duck-typing**：`tauriFrameApply.js:79` 的
`Array.isArray(frame.bandGridCentersHz)`——如果栅格也走二进制，这个判断要改成长度判断。
其余 `Array.isArray` 落在 `peakDb` / `rmsDb`（每通道标量，留在 JSON）和 `visualHistBatch`
（数组容器本身，不变），不受影响。全仓 `Array.isArray` 在相关文件里只有 5 处，已逐条看过。

## 4. Vectorscope 是反例，不能跟着一起改

三份文档都把 Vectorscope 的 live path 列成本轮候选，**但实测不支持**。

Rust 现在发的是**画好的 SVG path 字符串**。换成二进制坐标，就意味着前端要自己拼这条
path——而 JS 侧的拼装函数 `buildVectorscopeSvgFromPairs`（`src/math/vectorscopeMath.js`）
**已经存在**，snapshot 路径一直在用它，所以这笔账不用推，可以直接量。
同样出自 `npm run benchmark:frame-wire`：

| 一帧 683 点               |                字节 |                                   CPU |
| ------------------------- | ------------------: | ------------------------------------: |
| 现状：Rust 发 path 字符串 |            10,584 B |            `JSON.parse` **0.0028 ms** |
| Int16 pairs 二进制        | **2,732 B**（−74%） | 解码 0.0028 ms + **拼 path 0.103 ms** |

拼 path 的 0.103 ms 里几乎全是 1,366 次 `toFixed(2)` 加一次 `join`，是这种输出形态的固有成本，
不是实现问题。按 62.5 帧/秒折算，单 key **+6.4 ms CPU/s（0.64% 单核）加在主线程上**，
四 key 约 2.6%。换来的是省 0.47 MiB/s 传输。

而 Rust 侧生成这条 path 只要约 0.06 ms/key/frame（`vectorscope.md` D1-1，已优化过），
而且**不在 UI 线程上**。所以这笔交换是：把一件更便宜的活，从空闲的线程搬到最紧张的线程。

**判定：Vectorscope 的 live path 不进本轮。** 它真正的出路是让面板不再需要 path 字符串
（改 canvas 直接画坐标），那是渲染改动，属于另一轮，**不应该被伪装成协议改动**。

`vectorscope.md` D3-3 提到的三个无 reader 的 visual metric 列可以顺手清掉——那是删字段，
与 wire format 无关，不需要等本轮。

## 5. 兼容与丢帧

Rust 与前端一起发布，没有跨版本兼容需求，但**丢帧有**：`cpal_backend` 在 webview 落后时会丢帧
（`MAX_FRAMES_INFLIGHT = 120`），帧是先构造再被丢弃的。

`bandGridCentersHz` 已经踩过这个坑，方案是「变化时发 + 每 64 帧兜底重发」
（`spectrum.md` §3.6）。本轮的信封**必须自描述**：每一帧的 `$bin` 描述符都带 `dtype` 和 `len`，
不引入任何「只发一次的格式声明」。一帧丢了就是丢了一帧，不会毁掉整个 session。

信封里保留一个 `wireVersion` 常量，只为在解码失败时给出可读的错误，不做协商。

## 6. 会被触碰的既有测试

按 §3 的设计（解码后形状不变），冲击面很小：

- `src/lib/tauriFrameApply.test.js` — 唯一必须动的。要新增 `decodeFrame` 的直接测试，
  并让现有 fixture 走一遍编码/解码往返。
- `src/components/panels/{Spectrum,StereoMap,Vectorscope}Panel.test.jsx`、
  `src/dock/modules/Dock{Spectrum,StereoMap,Vectorscope}.test.jsx` — 六份用纯 JS 数组构造
  fixture。若断言依赖 `Array.isArray` 或 `toEqual([...])` 与 typed array 的差异，需要逐条确认。
- Rust 侧 `ipc/types.rs` 的序列化测试与 `engine/meter_pipeline.rs` 的帧构造测试。

**fixture 写法有坑（AGENTS.md 已记录）**：f32 往返会改值，`Math.fround(-0.4)` 是
`-0.4000000059604645`。新测试一律用 `Math.fround` 或 2 的幂次可精确表示的值，
不要用容差掩盖。

## 7. 落地顺序建议

每步都能单独验证、单独回滚：

1. ~~固化基线脚本~~ **已完成**：`scripts/frame-wire-benchmark.mjs` +
   `npm run benchmark:frame-wire`，§2 的数字全部出自它，纯函数部分由
   `scripts/frame-wire-benchmark.test.js` 覆盖。
2. **`decodeFrame` / `encodeFrame` 纯函数**，两端各自单测，往返对拍。不接线。
3. **接 Spectrum 一条路**，其余数组仍走 JSON（信封天然支持混合）。真实窗口里跑
   `profile:webview` + `webview-draw-count`，确认帧还在动、面板还对。
4. **接 Stereo Map**，同样验证。
5. **`bandGridCentersHz` 并入**，顺带把 `tauriFrameApply.js:79` 的 duck-typing 改掉。
6. 复测第 1 步的脚本，把实际降幅写回 `spectrum.md` / `stereo-map.md` 的判定表。

**验证不能只靠 `npm run check`。** 改的是 `src-tauri/src/engine` 与前端帧路径，
CI 的 runner 没有声卡（AGENTS.md）。每一步都要 `npm run smoke:capture`，
全部完成后提醒跑一次 `npm run soak:capture`。

## 8. 待测 / HYPOTHESIS

未测的一律标出来，不允许凭这些做判定：

| #   | 待测                                                                | 怎么测                                                             |
| --- | ------------------------------------------------------------------- | ------------------------------------------------------------------ |
| P-1 | WebView2 里的解码成本是否与 Node 一致                               | 真实窗口 `profile:webview`，对比 §2                                |
| P-2 | `response.arrayBuffer()` 与 `response.json()` 在 fetch 路径上的差价 | 同上，看 IPC 回调自耗时                                            |
| P-3 | Rust 侧省下的 `serde_json` 格式化时间                               | Criterion，整帧序列化对拍                                          |
| P-4 | 去掉 JSON 大字符串后 GC 压力是否下降                                | 真实窗口内存采样；**这条最容易脑补，必须实测**                     |
| P-5 | Int16 centi-dB 直发对 Spectrum 显示的影响                           | 与 f32 版本逐 band 对拍，看是否低于显示精度                        |
| P-6 | Stereo Map 每行的真实线上字节（12.6 KiB 模型 vs 18.8 KiB 旧实测）   | Rust 侧对 `StereoMapFrameResult` 直接 `serde_json::to_vec().len()` |
