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
模型可信。

**P-6 已结（2026-08-30）**：落地后由 Rust 侧直接量，
`ipc::frame_encode::tests::a_production_width_frame_is_far_smaller_than_its_json`
打印一行 958 band 的 JSON 字节——**Spectrum f64 行 18,370 B，Stereo Map f32 行 12,614 B**，
与上表的模型分别差 2 字节和 0 字节。**模型是对的**：`stereo-map.md` 那个 56.5 KiB 主帧折合
每行 18.8 KiB（f64 的宽度）不成立，旧数字里应该混进了别的东西。上面的 3.16 MiB/s 采信。

### 整帧的 parse 才是那个大数

单行说明的是结构，真正决定主线程负担的是整帧。脚本按四个 key、combined 视图构造一帧完整的
`AudioFramePayload`：

**299 KiB / 帧，`JSON.parse` 约 0.46 ms。**按 62.5 帧/秒折算，**光是解析这一件事就是
约 29 ms CPU/s，接近 3% 单核**，而且全部落在主线程上。这是本轮最值得砍的一项，
也是单个面板的 D2 轮永远看不见的一项——它不属于任何一个面板。

### 落地后：真实编码器量出来的降幅（2026-08-30）

第 3、4 步做完后，同一个 Rust 测试把生产宽度的一帧（958 band，一个 combined Spectrum key +
一个 Stereo Map key，带 visual tick）两种走线都量了一遍：

|                                      |                             每帧 |
| ------------------------------------ | -------------------------------: |
| 起点：全 JSON、dB 走 f64             |                    **131,886 B** |
| 第 3、4 步后：行走 f64 / f32 section |                 47,496 B（−64%） |
| **P-7 窄化后（当前）**               | **36,000 B（27.3%，累计 −73%）** |
| 其中 JSON 信封                       |                          1,506 B |
| 其中二进制 section                   |                         34,490 B |

**信封只剩 1.5 KiB。**帧里几乎所有的字节现在都是数据本身，不再是数据的十进制写法。

一行 958 band 走过的三种形态：

|                    |         Spectrum dB |   Stereo Map energy |
| ------------------ | ------------------: | ------------------: |
| 起点：JSON 文本    | **18,370 B**（f64） | **12,614 B**（f32） |
| JSON 文本，窄化后  |            10,064 B |                   — |
| **二进制 section** | **3,832 B（−79%）** | **3,832 B（−70%）** |

按 62.5 帧/秒、其中 25 帧/秒带 visual tick 折算（单 Spectrum key + 单 Stereo Map key）：
**5.85 MiB/s → 约 1.6 MiB/s**。这是线上字节的推算，webview 侧的实际 CPU 降幅仍待 P-1 / P-2。

**Int16 还是 f32，本轮不定。** Spectrum 前端最终只存 Int16 centi-dB，理论上 Rust 可以直接发
Int16，再省一半字节和三分之二 CPU。但 Stereo Map 的 pl/pr/c 是 energy 不是 dB，
它自己的 12 位量化（`stereo-map.md` D3-3）是**历史存储**的决定，不等于线上也能这么截。
把量化搬到线上会改变面板拿到的数值，需要单独对拍。**第一版统一走 f32，语义与今天完全一致；
Int16 作为后续可选层。**

## 3. 信封形态

**一条消息，不是两条。** JSON 信封和二进制分开发会引入配对与丢失问题，而 §1 已经说明
小片段发 Raw 反而更贵。所以整帧发一条 `InvokeResponseBody::Raw`：

```
[ u32 LE jsonLen ][ JSON 信封 (UTF-8) ][ 对齐填充 ][ section 0 ][ section 1 ] …
```

JSON 信封就是今天的 `AudioFramePayload`，只是被换掉的每个数组变成一个描述符：

```json
{ "$bin": 3, "dtype": "f32", "len": 958 }
```

尾部 section 按 `$bin` 顺序排列，第 n 个 section 的偏移由前面所有 section 的长度累加得出——
**不需要偏移表**，`dtype` + `len` 已经够。

**但必须对齐**（落地时发现的）：`new Float32Array(buffer, byteOffset, len)` 在 `byteOffset`
不是 4 的倍数时直接抛错，f64 要 8。所以 JSON 块之后先补到 8 字节边界，每个 section 再补到
自身元素宽度的边界。一个奇数长度的 i16 行会把游标留在 2 字节边界上，紧随其后的 f64 行就取不出
视图——两侧各有一个测试盯着这条。

前端在 `tauriFrameApply.js` 的 `applyFrame(f)` **之前**解一次：走一遍信封，把每个 `$bin`
描述符换成对应的 typed array 视图，得到与今天**形状完全相同**的对象。下游
（`reduceMeterAudioFrame`、`FrameIntake.pushFrame`、三个面板、三个 dock module）
拿到的仍是「有 `.length`、可索引」的东西。

这一层是本轮唯一的新增概念，而且是**一个纯函数**：`decodeFrameWire(ArrayBuffer) -> object`
（`src/ipc/frameWire.js`），可以脱离应用完整测试。Rust 侧的对应物是 `FrameWire`
（`src-tauri/src/ipc/wire.rs`）：`push` 收走一行、返回要嵌进信封的描述符，`encode` 排版。

**两侧不共享任何代码**，所以靠一份 golden fixture 钉在一起：同一串字节既是
`ipc::wire::tests::golden_message_matches_the_bytes_the_frontend_test_decodes` 的断言，
也是 `src/ipc/frameWire.test.js` 的输入。要改就两边一起改，否则不要动。

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
2. ~~编解码纯函数~~ **已完成**：`src/ipc/frameWire.js` 与 `src-tauri/src/ipc/wire.rs`，
   两端各自单测（6 + 10 个），由一份 golden fixture 跨语言对拍。仍未接线。
3. **接 Spectrum 一条路**，其余数组仍走 JSON（信封天然支持混合）。
   **代码已完成，真实窗口验证待做**：`src-tauri/src/ipc/frame_encode.rs` 造信封，
   `FrameSubscribers` 改发 `InvokeResponseBody::Raw`，`src/ipc/commands.js` 解码。
   第一版行按 f64 走线——DSP 本来就产 f64，所以那一步不改变前端读到的任何一个值。
   **第 7 步随后把它窄到 f32**，行从 7,664 B 降到 3,832 B。
4. **接 Stereo Map**。**代码已完成，真实窗口验证待做**：`pl` / `pr` / `c` 三行走 `f32` section。
   它们在管线里本来就是 `f32`，所以这一步连精度问题都没有——与 Spectrum 的 f64 不同，
   没有任何东西需要对拍。前端侧不需要改：`stereoMapMath.js` 的 `isNumericRow` 早就同时接受
   `Array` 和 typed array（历史 slab 一直返回后者）。
5. ~~`bandGridCentersHz` 并入~~ **暂缓，理由是量出来的**：栅格是 958 个 f64，每 64 帧重发一次
   ——JSON 里 18,370 B，折合 **17.9 KiB/s**；换成 f64 section 是 7.5 KiB/s，**只省 10.4 KiB/s**。
   而第 3、4 步一共省了约 3.7 MiB/s，这一项是它的 **0.3%**。
   代价却不小：`applyBandGrid` 的缓存喂着每个面板的 x 轴映射，改它要连带动
   `tauriFrameApply.js:79` 的 `Array.isArray` 判断，并且缓存住一个 typed array 视图会把整条帧
   消息钉在内存里（得改成拷贝出来）。**投入产出不成立，除非之后有别的理由动这块。**
6. 复测第 1 步的脚本，把实际降幅写回 `spectrum.md` / `stereo-map.md` 的判定表。

7. **dB 行窄到 f32（P-7）**。`SpectrumFrameResult` / `SpectrumVisualEntry` 的行类型从
   `Vec<f64>` 改成 `Vec<f32>`，在 payload 边界一次性窄化（`meter_pipeline.rs` 的 `narrowed`），
   所以 section 是零拷贝的，JSON 那条路也一并变小。**代码已完成，真实窗口验证待做。**

   **精度证据**：`spectrum_db_narrowing_stays_far_below_display_precision` 扫 −200…+200 dB
   全量程，最坏误差 **7.32e-6 dB**（发生在 −199.82 dB）。历史 slab 存 Int16 centi-dB，
   步长 0.01 dB——误差比它小 **1366 倍**，比面板显示的 0.1 dB 小四个数量级。另一个测试
   `narrowing_preserves_the_order_of_values_the_display_can_tell_apart` 证明任意两个相差一个
   centi-dB 的值窄化后仍可区分，即窄化不可能把显示上分得开的两条并成一条。

**验证不能只靠 `npm run check`。** 改的是 `src-tauri/src/engine` 与前端帧路径，
CI 的 runner 没有声卡（AGENTS.md）。每一步都要 `npm run smoke:capture`，
全部完成后提醒跑一次 `npm run soak:capture`。

## 8. 待测 / HYPOTHESIS

未测的一律标出来，不允许凭这些做判定：

| #       | 待测                                                  | 结果                                                               |
| ------- | ----------------------------------------------------- | ------------------------------------------------------------------ |
| ~~P-1~~ | ~~WebView2 里的解码成本是否与 Node 一致~~             | **已结**：一致。同一帧同一引擎，0.689 → 0.073 ms，见 §9            |
| ~~P-2~~ | ~~`arrayBuffer()` 与 `json()` 在 fetch 路径上的差价~~ | **已结**：并入 §9 的整帧对比；profile 里 `JSON.parse` 已完全不出现 |
| ~~P-3~~ | ~~Rust 侧省下的 `serde_json` 格式化时间~~             | **已结**：release 下 184.5 → 6.5 µs/帧（3%），见 §9.6              |
| ~~P-4~~ | ~~去掉 JSON 大字符串后 GC 压力是否下降~~              | **已结**：300 次解码，旧线 5.49 MiB、新线 0，见 §9                 |
| P-5     | Int16 centi-dB 直发对 Spectrum 显示的影响             | **不再必要**：f32 已把行降到 3,832 B，Int16 只再省 1,916 B         |
| ~~P-6~~ | ~~Stereo Map 每行的真实线上字节~~                     | **已结**：12,614 B，模型正确，见 §2                                |
| ~~P-7~~ | ~~f64 → f32 窄化对 Spectrum 显示的影响~~              | **已结**：最坏 7.32e-6 dB，见 §7 第 7 步                           |

## 9. 真实窗口验证（2026-08-30）

§9.1–§9.6 是在一台**断开**的 RDP 会话里跑的：会话保留、应用照常渲染并可被 CDP 驱动，
但音频端点全部不可用，所以那一轮只走了文件分析路径（它不需要任何音频设备）。
**§9.7 是后来在连着 RDP 时补的实时路径验证。**

素材是一个 10 分钟的合成信号，三个音落在 **100 / 1000 / 10000 Hz**，L/R 电平不同。
选这个不是为了好听：**峰的位置就是校验和**——段偏移、对齐、字节序、行顺序只要错一处，
峰就不可能落回原处。

### 9.1 端到端：字节确实按设计的样子过线

CDP 挂在 `window.fetch` 上读响应的 `content-type`——不是读我们自己的代码，而是读传输层的事实。

| 检查                 | 结果                                                   |
| -------------------- | ------------------------------------------------------ |
| 二进制帧过线         | **767 个 `application/octet-stream` 响应**             |
| 有没有帧退回 JSON    | **没有**。999 个 JSON 响应最大 296 B，全是普通命令回复 |
| section 是否铺满消息 | **0 字节富余**（对齐算法精确）                         |
| 行的类型             | `Float32Array[958]`，与 band grid 等长                 |
| 值                   | 有限，−150.8…−9.2 dB                                   |
| **三个最强峰**       | **99.3 / 1000.2 / 10002.1 Hz**                         |

UI 上的 INTEGRATED **−11.3 LUFS** / TRUE PEAK MAX **−7.2 dBTP** 与 `plvs-cli analyze` 对同一
文件的无头分析逐位一致。

### 9.2 一帧信封里还剩什么

抓一帧真实的 148,200 B 消息拆开看：

| 信封里的键                        | JSON 字节 |
| --------------------------------- | --------: |
| `bandGridCentersHz`               |    17,558 |
| `vectorscopeResultsByKey`         |    10,968 |
| `visualHistBatch`（文件模式批量） |     9,604 |
| `loudnessHistBatch`               |     5,071 |
| **`spectrumResultsByKey`**        |   **439** |
| **`stereoMapResultsByKey`**       |   **154** |

移走的两个面板只剩描述符大小。剩下的大头正是**刻意没有移走**的两项：band grid（§7 第 5 步，
省 0.3% 不值得）和 Vectorscope 的 path 字符串（§4，移走是净亏）。这张表是那两个判定的复核。

### 9.3 P-1 / P-2：WebView2 里的两种解码

同一帧、同一引擎、同一次运行，唯一变量是格式。把捕获到的帧还原成"改动前的全 JSON 形态"，
两种解码各跑 200 次取平均：

|               | 旧线（全 JSON） |           新线（二进制） |
| ------------- | --------------: | -----------------------: |
| 字节          |       580,009 B |   **148,200 B（25.6%）** |
| 解码          |     0.689 ms/帧 | **0.073 ms/帧（10.7%）** |
| 按 62.5 帧/秒 |       43.1 ms/s |             **4.6 ms/s** |

**主线程每秒省下约 38.5 ms（约 3.9% 单核）。** §2 用 Node 建模时预估四 key 约 29 ms/s，
量级吻合——**P-1 的答案是"一致"**，Node 的模型可以继续用来做设计判断。

10 秒 profile（sourcemap 已开、帧在流动、27.7% idle）里 **`JSON.parse` 一次都没有出现**。
传输侧现在合计 `fetch` + `arrayBuffer` + `decode` + `TextDecoder` = **339 ms / 10.05 s（3.4%）**。

> 采样时踩过一次 README 里那个坑：探针还挂在 `window.fetch` 上，它每个响应都 clone 一遍，
> 自己就占了 39 ms。**装着计数器采出来的 profile 量的是计数器**，重载卸掉后才是上面的数字。

### 9.4 P-4：分配压力

同样的 in-engine A/B。每轮前强制 GC，解码 300 次后读 `usedJSHeapSize`：

|                 | 300 次解码的堆增长 |     每帧 |
| --------------- | -----------------: | -------: |
| 旧线（全 JSON） |       **5.49 MiB** | 18.8 KiB |
| 新线（二进制）  |              **0** |        0 |

量的是**压力不是泄漏**（跑完没有再 GC 就读数）。新线读数恰好为 0 应理解为"没有可测量的净增长"，
不是"一个字节都没分配"——它当然要分配一个信封对象和一批 view，只是小到 GC 跟得上。

### 9.5 这一轮里那个最值得记住的教训

第一版探针挂在 `__TAURI_INTERNALS__.runCallback` 上，返回 `"installed"`，然后报告
**0 个帧**——而应用运行完全正常。原因是那个属性 `writable: false`，
**非严格模式下赋值静默失败**。

这个失败模式很坏：它看起来像"传输坏了"，而实际是"测量坏了"。如果当时信了它，就会去查一个
根本不存在的 bug。换到 `window.fetch`（可写）之后一切正常，而且那本来就是更好的观测点——
`content-type` 是传输层的事实，不需要相信任何自己写的代码。

### 9.6 P-3：Rust 侧的编码成本

同一个生产宽度的帧，`cargo test --release`，各跑 200 次取平均：

|                                |             每帧 |
| ------------------------------ | ---------------: |
| `serde_json::to_vec(&payload)` |     **184.5 µs** |
| `encode_audio_frame(&payload)` | **6.5 µs（3%）** |

按 62.5 帧/秒折算，Rust 侧每秒省下约 **11.1 ms**。这不在 UI 线程上，所以不是这一轮的主要理由，
但它是真的——把浮点写成十进制本来就是这条路上最贵的一步。

**这个 184.5 µs 还是低估的**：它序列化的是**已经窄化成 f32 的** payload。改动前的行是 f64，
`ryu` 要写更多位，只会更慢。和 §2 那张表同一个陷阱——基线自己也被这一轮改动过。

测量挂在同一个测试里，**只打印不断言**（计时当 CI 门就是等着变 flaky），并按 `debug_assertions`
标注运行档位——debug 下的数字差一个数量级，不标注就会被当成真的读。

### 9.7 实时发送点也验证了（RDP 会话内，无需 VB-Cable）

`cpal_backend.rs` 的发送点是单元测试碰不到的唯一一段。验证它**不需要 VB-Cable，也不需要出声**：
引擎在 RDP 下仍然看得见 "Remote Audio"（`isLoopback: true`），而后端的 silence stream 会让
WASAPI loopback 持续产出帧——**静音一样是帧**，而传输要验证的正是帧。

应用切 LIVE、选该设备、START，然后同一套 fetch 探针读 12 秒：

| 检查                   | 结果                                                 |
| ---------------------- | ---------------------------------------------------- |
| 实时帧以二进制过线     | **600 个 `octet-stream` / 12 s**                     |
| 有帧退回 JSON          | **没有**                                             |
| `seq` 单调、投递无缺口 | 600 帧，1768 → 2367                                  |
| section 铺满消息       | **0 字节富余**                                       |
| 行                     | `Float32Array[958]`，值有限（−183.5…−98.9 dB，静音） |

**`seq` 连续并不证明没有丢帧**：看 `cpal_backend.rs`，被背压丢弃的帧在 `sent_seq += 1` 之前就
`continue` 了，**根本不分配 seq**。所以这条只证明「已发送的帧按序、无损地到达了」，
不证明上游没有因背压丢弃。

**实测 50.1 帧/秒，不是 62.5。** 换成只计数、不 clone 的探针后仍是 50.1，所以不是测量的开销。
原因在 `meter_pipeline.rs:803`：那是**闸门不是定时器**——`elapsed() < FRAME_EMIT_MS` 只在
`push_pcm` 被调用时判断，所以真实帧率由 PCM 块到达节奏决定。1/50 正好是 **20 ms**，
WASAPI/RDP 的常见块周期。**这与本轮改动无关**：序列化发生在帧构造之后、闸门下游。
（没有改动前的基线可比，此处是结构性论证而非实测对比。）

## 10. 没能验证的部分

**`npm run smoke:capture` 与 `npm run soak:capture` 都未运行**（RDP 下没有 VB-Cable）。

**但要分清这两件事**：`smoke:capture` 走 `plvs-cli capture` → `capture_device_to_summary`，
用的是它自己的 `SummaryMeter` 消费者，**完全不碰** `frame_subscribers`、`encode_audio_frame`
或 `Raw` channel。也就是说——**它本来也覆盖不到本轮的改动**。它与实时路径共享的是设备层和 DSP，
不共享发送点。

所以：

- 本轮改动的实时路径 → **已由 §9.7 覆盖**。
- `smoke:capture` → 仍然欠着，因为它是采集层改动的发布门（`release:preflight` 没有旁路），
  而这轮确实动了 `src-tauri/src/audio`。**发版前必须过。**
- `soak:capture` → 仍然欠着。这轮改了每帧的分配形态（payload clone → bytes clone），值得跑一次。

### 10.1 断开 RDP 并不会让 VB-Cable 出现

这条值得记下来，因为它和直觉相反，而且下次还会遇到。断开后实测：

| 查的东西                                          | 结果                          |
| ------------------------------------------------- | ----------------------------- |
| VB-Cable **驱动**（`Get-PnpDevice -Class MEDIA`） | **Status OK**                 |
| VB-Cable **音频端点**（`-Class AudioEndpoint`）   | **不存在**                    |
| 其余音频端点                                      | 29 个，状态**全是 `Unknown`** |
| `plvs-cli devices`                                | **0 个设备**                  |

驱动是好的，端点没有为这个会话激活。连着 RDP 时唯一可见的是 "Remote Audio"；断开后连它也没了，
**VB-Cable 并不会因此浮现**。这不是设备问题，是会话没有附着到物理控制台。

**这不是"还没稳定下来"**：断开后用引擎自己的枚举每 15 秒查一次、连查 **2 小时**，
始终是 0 个设备。（不要用 PowerShell 代替这个探测——它能解析出端点而 WASAPI 看不见，
两者会给出相反的答案。）

真正能让硬件设备回来的是把会话挪到控制台（`tscon <id> /dest:console`），那需要提权、会切断远程
访问，而且是系统级操作——**不该由代理擅自执行**。结论：**实时采集只能在物理控制台的会话里验证。**

回到那样的会话后，上面两项要补。
