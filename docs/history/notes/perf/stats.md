# Stats 体检表

**状态：** 四维已测，**四维都不改**。这是八个面板里唯一一个没有任何改动的——它读的是别人已经
算好的标量，不画、不存、不发。

## 0. 数据路径

Stats 没有自己的 Rust 计算、没有 request key、没有历史 slab、没有 canvas。它把
`buildStatsMetrics(displayAudio)` 产出的指标按用户勾选的顺序列成文本行。

`buildStatsMetrics` 在 `useLoudnessHistory` 里按 `displayAudio` memo，所以每帧最多算一次。

## 1. D1 — Rust 计算

**没有属于它的计算。** 它显示的每一项都来自别处已经覆盖的量：

- momentary / short-term / integrated / LRA —— 本轮 `loudness.md` 已补 BS.1770 断言；
- true peak / sample peak —— `level-meter.md` 已补三条测试；
- correlation / side-to-mid —— `vectorscope.md` 覆盖。

所以这一维在本轮**没有独立工作**，它的正确性是前面几轮的结果。

## 2. D2 — 前端渲染

### 2.1 写的都是最廉价的那种 DOM 变更

八面板全开、文件分析驱动，`scripts/webview-dom-count.mjs` 实测：

| | 每秒 |
| --- | ---: |
| 合计 | 169.1 |
| **文本** | **147.8** |
| 属性 | 21.3（`data-active` 10.7、`class` 10.7） |
| 节点增删 | **0** |

**87% 是文本写入**——React 只改真正变了的那个文本节点，不重建元素。这正是 Loudness 那轮
修完时间轴之后三个面板呈现的形态，而 Stats 本来就是。

### 2.2 profile 前 40 名里没有它

同一状态 10 秒 profile，**前 40 名没有任何 Stats 相关帧**（第 40 名是 0.27%）。
`statsCatalog`、`StatsPanel`、`loudnessProfileEvaluate` 都没出现。

### 2.3 一个结构性观察，量过之后决定不改

`buildStatsMetrics` 格式化**全部 16 项**指标，而面板只显示用户勾选的那些。勾 4 项时，
另外 12 项每帧都被格式化然后丢弃——和 Spectrum 那轮"后端生成、前端丢弃的路径"是同一个形状。

但这次量级完全不同：整个面板在 profile 里低于 0.27%，所以这 12 项的格式化连它的一小部分都不到。
**记录，不改。** 改它需要在多个消费者（面板可有多个实例、dock、快照）之间求可见集合的并集，
拿确定的复杂度换测不出来的收益。

### 2.4 仪器上的一个限制

`statsCatalog.js` 用的是无扩展名 import（`"../math/formatMath"`，仓库里有若干文件如此），
靠 Vite 解析，**纯 Node 加载不了**，所以没法给它写 `scripts/` 下的基准。
这一维只能用 profile 作仪器——这也是上面只给出"低于 0.27%"这个上界而不是点值的原因。

## 3. D3 — 历史存储

**没有自己的历史。** 显示的最大值（M Max / ST Max）由引擎维护并随帧发送，不是前端积累的序列。

## 4. D4 — payload

**没有自己的 payload。** 它显示的标量本来就在每帧里，供 Level Meter、Loudness 和 dock 共用。

## 5. 判定汇总

| # | 结论 | 判定 |
| --- | --- | --- |
| D1 | 无独立计算；正确性由 loudness / level-meter / vectorscope 轮覆盖 | 无内容 |
| D2-1 | 169.1 次/秒 DOM 变更，其中 87% 是文本写入，零节点增删 | **不改** |
| D2-2 | profile 前 40 名内无任何 Stats 帧（< 0.27%） | **不改** |
| D2-3 | 未勾选的指标仍被格式化 | **记录，不改**（收益低于可测阈值） |
| D3 | 无自有历史 | 无内容 |
| D4 | 无自有 payload | 无内容 |
