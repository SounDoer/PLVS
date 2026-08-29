# Vectorscope 体检表

**状态：** 四维已测，第一项无损优化已落地：Polar 不再预取不用的 Persistence 窗口，Polar Level
直接选择 180 ms，Dock 按 slab version 复用解码结果。D1 仍有一个输出等价的字符串构建候选；D2
剩余的确定冗余是 canvas 每次 render 同步读布局；D3 已经
是 Int16 packed slab，主体没有无损压缩空间；D4 的大头是 live SVG path，适合并入统一二进制
协议轮，不适合单 panel 再发一套协议。

工具：`npm run benchmark:vectorscope-rust`（新增）、
`npm run benchmark:vectorscope-render`（新增）、`npm run profile:webview`（已有）。真实窗口 profile
走文件分析，压缩构建保留 sourcemap；同一份 10 分钟、48 kHz 立体声 WAV 在每次有效采样前重新
分析，并检查进度确实在推进。

## 0. 四条路径不是一回事

| 维度 | 路径                                                                                                       |
| ---- | ---------------------------------------------------------------------------------------------------------- |
| D1   | Rust 每个 request key 一套 `VectorscopeMeter`；高频帧输出 683 点 SVG path，visual tick 另取 100 对历史采样 |
| D2   | 默认 Lissajous 是 SVG；按住慢放切成 1 秒 Persistence canvas；Polar Sample / Level 共用另一张 canvas        |
| D3   | 每个声道 pair 一个 `VectorscopeHistorySlab`，25 行/秒，每行 100 对 Int16 packed 样本                       |
| D4   | live path 随约 62.5 Hz 主帧发送；100 对 pairs 随约 25 Hz visual tick 发送                                  |

request key 只含声道 pair：`vectorscope:pair:x:y`。显示模式不进 key，所以 Lissajous、Polar Sample、
Polar Level 共用同一份历史；换 pair 才新建 slab。请求上限是 4，但历史保留集合不受请求上限约束，
与 `AGENTS.md` 记录的其他视觉 slab 一样。

## 1. D1 — Rust 计算

### 1.1 边界与正确性

`VectorscopeMeter::push_pcm` 在 `MeterPipeline` 的 bridge thread 上运行，不在音频 callback thread；
ring 扩容、展平数组和字符串分配都不违反 callback 边界。

原有测试覆盖空输入、同相/反相 correlation、自动缩放、reset 和历史点数。本轮补了两条已知输入
对拍：

- `[0.5, 0.5]`：correlation `+1`、mid energy `1/sqrt(2)`、side energy `0`、S/M `-48 dB`；
- `[0.5, -0.5]`：correlation `-1`、mid energy `0`、side energy `1/sqrt(2)`、S/M `+48 dB`。

`cargo test --lib dsp::vectorscope::tests`：**9/9 通过**。

### 1.2 高频输出成本：约 0.12 ms/key/frame

Criterion 条件：ring 已填满 4096 对样本；production callback 块 480 帧；高频 path 按代码的
`i += 6` 取 **683 点**。

| 项目                              |             耗时 |
| --------------------------------- | ---------------: |
| `get_output()`，683 点 SVG        |   **119–128 µs** |
| 一 key：push 480 帧 + live output |   **119–133 µs** |
| 四 key：push + live output        |   **468–494 µs** |
| 100 对 history pairs              | **0.85–0.98 µs** |
| 展平两个 VecDeque                 |     0.47–0.52 µs |
| clone 两个 4096 长度 flat Vec     |     0.50–0.53 µs |

单 key 按 62.5 frame/s 折算约 **7.5–8.0 ms CPU/s（0.75–0.80% 单核）**；四 key 约
**3% 单核**。它不是最大的热点，但在请求上限处已经不是完全免费的。

### 1.3 成本几乎全在 683 次格式化，不在那两个显眼的 clone

`get_output()` 先把两个 ring 展平，又把两个 flat Vec clone 后传给 `process`。代码上四次遍历很显眼，
实测两次展平和两次 clone 各只有约 **0.5 µs**，合计不到 `get_output()` 的 1%。不要为去 clone
扭曲借用关系。

真正的大头是：每个点 `format!` 成一个小 `String`，收进 `Vec<String>`，再 `join(" L ")`：

| 同样 683 个坐标、同样两位小数、同样最终字符串 |           耗时 |
| --------------------------------------------- | -------------: |
| 小 String + Vec + join                        | **106–123 µs** |
| 预留一个 String，逐点 `write!`                |   **54–57 µs** |

直接写入大 String 快约 **一半**，且协议与输出可以逐字节不变。**值得做独立优化提交**；落地前要
用旧实现做独立对拍，钉住负数、边界、舍入和分隔符，不能只断言 path 以 `M` 开头。

### 1.4 visual history 在非 visual frame 上也会算，但不值得单独修

`meter_pipeline.rs` 在判断 `visual_hist_tick` 之前无条件构造 `vectorscope_by_key`，所以 live 主帧约
62.5 次/秒都运行 `get_history_pairs(100)`，真正写入历史的约 25 次/秒；其余结果丢弃。

但它只有 **不到 1 µs/次**。多出的约 37.5 次/秒只值约 **0.04 ms CPU/s**，分配也只有约
30 KiB/s/key。结构可以在以后改 pipeline 时顺手收紧，**不值得为它单开优化提交**。

## 2. D2 — 前端渲染

### 2.1 默认 Lissajous：不是 renderer 热点

真实窗口 profile 中，默认 Lissajous 的任何 Vectorscope 函数都未进前 30。对 SVG `d` 属性单独
包计时：文件分析期间 5 秒更新 **258 次**，共写入 2.82M 字符，而原生 `setAttribute("d")` 合计
只有 **5.0 ms**。

所以 live Lissajous 的浏览器侧很轻；它的主要成本在 D1 的 Rust 字符串生成和 D4 的传输，不在
SVG path 提交或 paint。

### 2.2 Persistence：219 ms/10s 的大头是同步布局读取

按住 Lissajous 进入慢放后，panel 画最近 1 秒的 26 行 × 100 点。真实 profile：

| 条目                                             |  10 秒自耗时 | 占 profile |
| ------------------------------------------------ | -----------: | ---------: |
| `VectorscopePanel.jsx:254` 的 persistence effect | **219.4 ms** |   **2.2%** |

对这张 canvas 的原生调用逐项包计时 5 秒：

| 调用                  |    次数 |        合计 |
| --------------------- | ------: | ----------: |
| effect / `getContext` | **301** |      0.5 ms |
| `clientWidth`         | **301** | **89.8 ms** |
| `clientHeight`        |     301 |      0.3 ms |
| `beginPath`           |    3311 |      0.6 ms |
| `stroke`              |    3311 |      3.4 ms |

effect 没有依赖数组，所以跟着父组件约 **60 Hz** render；历史明明只约 25 Hz 更新，却把同一窗口
完整重画，并在每次重画同步读 `clientWidth`。脱离应用的 JS 画笔只有 **0.030 ms/次**，与原生
stroke 数字一起证明“点太多”不是主因。

**值得改：** 用 ResizeObserver/已知 backing size 驱动尺寸变化，并让绘制只随 history version、
主题和尺寸变化。不能只粗暴加一个 history 依赖：canvas 真正 resize 时仍必须重画。

### 2.3 两种 Polar：同一个尺寸读取热点

真实 profile（各自重新驱动文件分析）：

| 模式         | `VectorscopePolarPlot.jsx:21` / 10 秒 | 占 profile |
| ------------ | ------------------------------------: | ---------: |
| Polar Sample |                          **236.0 ms** |   **2.3%** |
| Polar Level  |                          **227.3 ms** |   **2.3%** |

两者映射到 `resizeCanvas`。Polar Level 定点计时 5 秒：

| 调用              |    次数 |         合计 |
| ----------------- | ------: | -----------: |
| `clientWidth`     | **306** | **107.4 ms** |
| `clientHeight`    |     306 |       0.3 ms |
| `beginPath`       |     502 |       0.2 ms |
| `fill` + `stroke` |     502 |   **0.4 ms** |

组件虽然用 signature 跳过相同图像的重画，但 signature 判断在 `resizeCanvas` **之后**，所以父组件
每次 render 仍同步读布局。原生画图几乎免费，修法与 Persistence 相同：尺寸应该由 resize 事件
更新，而不是靠每帧读取来发现。

脱离应用的 JS 部分也很小：

| 路径                                     |         每次 |
| ---------------------------------------- | -----------: |
| Polar Sample：11 行 × 100 点投影         | **0.017 ms** |
| Polar Level：5 行 × 100 点聚合到 64 bins | **0.017 ms** |

### 2.4 已落地：Polar 只解码实际显示的窗口

原实现中 `needsHistorySlab` 在 Polar 模式为真；随后 `persistenceRows` 无条件调用
`selectPersistenceWindow`，只是 `persistenceActive = isLissajous && ...` 最后不显示它。于是每个
Polar visual tick 同时做：

| 选择                                |         每次 |                    解码/分配 |
| ----------------------------------- | -----------: | ---------------------------: |
| 不会使用的 Persistence：26 × 100 对 | **0.239 ms** | 26 个 Float32Array，20.8 KiB |
| 真正使用的 Polar：11 × 100 对       | **0.100 ms** |  11 个 Float32Array，8.8 KiB |

现在 Persistence 选择只在 Lissajous 下运行，Polar Sample 每 tick 只解码自己的 11 行。按同一
benchmark，本轮消除了每次 **0.247 ms + 20.8 KiB**，按 25 Hz 即约 **6.2 ms CPU/s** 和
**520 KiB/s** 分配；画面与历史数据不变。

另有两条次级项：

- Polar Level 现在直接按 180 ms 选择 5 行，不再先按 400 ms 解码 11 行。实测选窗由
  **0.104 ms** 降到 **0.047 ms**，剩余解码约降 55%。
- `DockVectorscope` 现在按 slab identity、version 和窗口长度 memo；父帧 render 而历史 version
  不变时不再重复选窗。

回归测试直接统计 slab 的 `rowAt`：主面板 Sample 必须是 11 次、Level 必须是 5 次；Dock 同版本
rerender 必须保持次数不变，version 增加后才允许重新解码。旧实现分别得到 37、37 和重复增长，
所以测试确实覆盖了这次优化，而不只是覆盖最终画面。

### 2.5 profile 的适用边界

上面的 profile 在文件分析模式采，整个 workspace 的其他 panel 也开着，所以不能用不同 profile 的
idle 百分比互相减。这里的证据是函数归因加定点包计时，不是跨次总 CPU 对比。文件模式的更新节奏
也与 live 不完全相同；生产 live 的 62.5/25 Hz 只用于结构折算。

## 3. D3 — 历史存储

### 3.1 四小时约 151.4 MiB/key

每行 200 个 Int16 pair values、1 个 Float64 timestamp、4 个 Float64 metrics；每个 1024 行 chunk
另带 64 个 Float64 Polar Max summary。

| 四小时（360,000 行）                       |                           字节 |
| ------------------------------------------ | -----------------------------: |
| pairs                                      |                    144,000,000 |
| timestamps                                 |                      2,880,000 |
| 4 个 metrics                               |                     11,520,000 |
| Polar Max summaries                        |                        180,224 |
| retained payload 投影                      | **158,580,224 B（151.2 MiB）** |
| 按完整 chunk 的实际 typed-array allocation |              **151.4 MiB/key** |

默认一小时约 **37.9 MiB/key**；四小时四 key 上限约 **605.7 MiB**。这比 Spectrum 单 key
1.38 GB 小很多，但不是 Waveform 那种可以忽略的 56.6 MiB 总量。

### 3.2 主体已经压到 Int16，继续压会直接碰显示下限

pairs 占 91%。它们已从 Float32 packed 成 normalized Int16，量化步长 `1/32767`；测试钉住误差。
改成 Int8 的步长约 `1/127`（约 −42 dB），而 Polar 固定显示下限是 −48 dB、signal gate 是
−90 dB，低电平形状会直接消失。减少 100 对采样也会同时降低 snapshot、Persistence 和两种 Polar
的时间/角度分辨率。

**没有无损主体优化；拒绝 Int8 和降采样。**

### 3.3 三个 metric 列没有真正读者，但只值 8.25 MiB/key

reader 盘点：`sideToMidDb`、`midEnergy`、`sideEnergy` 从 slab 复制进 snapshot result 后没有组件读取；
panel 只读 `correlation` 和 pairs。删掉三列可省四小时 **8.25 MiB/key（5.4%）**，并略减 visual
payload。

它是确定的无损清理，但绝对收益小，且会同时改 Rust IPC type、FrameIntake、slab 和 snapshot
contract。**不单开历史优化；若 D4 协议轮触碰这些类型，顺手移除。**

### 3.4 Polar Max summary 值得保留

四小时 352 chunks，查询中点/最新 Max Hold 分别约 **0.03–0.06 ms**。summary 自身仅 176 KiB/key，
换掉的是从 Clear 起重放最多 360,000 × 100 对样本。它的投入产出比很好，不动。

## 4. D4 — payload 与调度

### 4.1 单 key 约 0.73–0.76 MiB/s

用可往返 f32 的实际 JSON 数字、完整 key 和字段名测 UTF-8：

| payload 片段                           |     每次 |   节奏 |                          带宽 |
| -------------------------------------- | -------: | -----: | ----------------------------: |
| live result（683 点 path + metrics）   | 10,670 B | 62.5/s |               **651.2 KiB/s** |
| visual entry（100 对 pairs + metrics） |  4,086 B |   25/s |                **99.8 KiB/s** |
| 合计                                   |          |        | **751.0 KiB/s（0.73 MiB/s）** |

真实窗口里纯音素材的 path 是 10,927 B，比 benchmark fixture 的 10,479 B 大 4.3%；按它折算总量约
**0.76 MiB/s/key**。四 key 上限约 **3 MiB/s**。

live path 占 live fragment 约 98%、占 Vectorscope 总带宽约 87%。删 metrics、缩 key 或调容器字段
都碰不到大头。

### 4.2 panel-local 协议改法都不成立

- 把 683 对 f32 直接放 JSON：文本数组比两位小数 SVG path 更大，还把格式化成本挪到前端。
- 只发 history 的 100 对：带宽会降，但默认 Lissajous 从 683 点降到 100 点，是可见的降质。
- path 少一位小数：可能省约 1.3 KiB/frame，但先要做视觉/几何误差对拍；当前没有证据允许改精度。

真正有效的是统一二进制层：683 对 f32 是 5,464 B，Int16 是 2,732 B；visual pairs 在前端本来就会
立刻 pack 成 400 B 的 Int16，却先以约 4 KiB JSON 过线。它与 Spectrum 待议的 payload 第 3 层是
同一个问题。**记录为协议轮候选，不为 Vectorscope 单独造一种传输。**

## 5. 判定汇总

| #    | 结论                                             | 证据                                       | 判定                   |
| ---- | ------------------------------------------------ | ------------------------------------------ | ---------------------- |
| D1-1 | live SVG 约 0.12 ms/key/frame，四 key 约 3% 单核 | Criterion                                  | 可优化但不紧急         |
| D1-2 | clone/flatten 合计不到 1%                        | 微基准                                     | **不动 clone**         |
| D1-3 | 直接写一个 String 比小 String + join 快约一半    | 54–57 vs 106–123 µs                        | **值得独立提交**       |
| D1-4 | 非 visual frame 多算 100 对 history              | 0.85–0.98 µs/次                            | 不值得单开提交         |
| D2-1 | 默认 Lissajous 浏览器侧不热                      | profile + `d` 定点计时                     | 不动                   |
| D2-2 | Persistence 每 render 重画并同步读布局           | 219 ms/10s；301 次 width = 89.8 ms/5s      | **值得改**             |
| D2-3 | 两种 Polar 每 render 先读尺寸再判断是否重画      | 227–236 ms/10s；306 次 width = 107.4 ms/5s | **值得改**             |
| D2-4 | Polar 每 tick 解码不用的 1 秒 Persistence 窗口   | 0.247 ms + 20.8 KiB/次                     | **已落地**             |
| D2-5 | Polar Level 多解码 6/11 行；Dock 每 render 选窗  | benchmark + 回归测试                       | **已落地**             |
| D3-1 | 四小时 151.4 MiB/key，91% 是 packed pairs        | 字节投影                                   | 主体不动               |
| D3-2 | Int8/降点会损伤 −48/−90 dB 显示                  | codec 步长 +显示阈值                       | **拒绝有损压缩**       |
| D3-3 | 三个未读 metric 列 8.25 MiB/key                  | reader 盘点                                | 协议轮顺手清理         |
| D3-4 | Max Hold summary 176 KiB，查询 <0.1 ms           | 四小时 chunk benchmark                     | 保留                   |
| D4-1 | 0.73–0.76 MiB/s/key，87% 是 live path            | JSON UTF-8 实测                            | 值得进统一二进制协议轮 |

## 6. 建议的优化提交顺序

1. **canvas 尺寸/绘制调度**：ResizeObserver 驱动 backing size；Persistence 和 Polar 不再每 render
   同步读布局。
2. **Rust path 直接写 String**：输出逐字节对拍后替换 `Vec<String> + join`。
3. **统一二进制协议轮**：与 Spectrum 第 3 层一起讨论；届时清掉三个未读 visual metrics。

前三项都能保持视觉与协议输出不变，可以各自形成小而可验证的优化提交。
