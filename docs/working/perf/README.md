# Panel 性能体检（live-only）

逐个 panel 走一遍四维体检：Rust 计算、前端渲染、历史存储、其他（传输/协议/调度）。
只覆盖 live 路径，file analysis 不在本轮范围。

## 规则

- **一个 panel 一份文档**，先只写「测到的数字 + 判定 + 值不值得改」，不带代码改动。
  确认结论后再单独开优化提交，调查与实现不混在一个 diff 里。
- **每条判定必须挂一个证据来源**（测试输出 / benchmark 数字 / profiler 截取）。
  没有证据的条目标记为 `HYPOTHESIS`，不允许直接进入优化提交。
- **"测了但决定不改"也要写下来**，连同理由——这类结论最容易丢失。
- 允许改 Rust → 前端的 payload 协议；协议改动单独列一节，因为它会波及多个 panel。
- 发现写得不合理的既有测试（断言了实现细节、锁死了本该可改的协议、用容差掩盖真实误差）
  单列一节，不要在优化提交里顺手改掉。

## 采 renderer profile

计算部分可以脱离应用测；**commit 与 paint 只在真实窗口里存在**，要走 CDP。WebView2 暴露的是和
Chrome 同一套协议，靠环境变量开端口，不需要改代码：

```
WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 npm run desktop
npm run profile:webview -- --seconds 10 --out spectrum.cpuprofile
```

脚本会写出 `.cpuprofile`（可拖进 Chrome DevTools）**并在终端直接打印自耗时排行**——后者才是重点，
它让一份 profile 不用 GUI 也能读。

**前提是音频真的在流动。** 空转的窗口采出来的是一份没有样本的 profile，比没有更糟；脚本会明说
"No samples"，但它没法替你把声音放起来。采样时把要测的面板开着。

### 让帧流动起来：两条路

**本机会话**：`scripts/capture-rig.mjs` 能自己起 VLC 循环播进 VB-Cable
（`resolveRenderEndpointId` + `startPlayer` / `stopPlayer`）。

**远程桌面会话**：默认设置下实时采集这条路是断的。RDP 把音频端点换成了 "Remote Audio"，引擎的
`list_audio_devices` 只返回这一个设备，VB-Cable 对 WASAPI 不可见（哪怕 PowerShell 仍能解析出它的
render endpoint——**别拿 PowerShell 当探测**，两者会给出相反的答案）。

**但这条路是可以打通的**：把 RDP 客户端的音频改成在远程计算机上播放，真实设备就全部出现，
并且在断开和重连时都保住。细节和另一个反直觉的坑（断开前启动的播放器活不过会话切换，
而且不报错，只是安静地采静音）见 `protocol.md` §10.3。

**但文件分析这条路是通的，而且不需要任何音频设备。** 应用分析一个文件时照样按同一节奏发帧、
照样驱动所有面板。全程可以从 CDP 驱动：

```js
// 1. 切到 File 模式
document.querySelector('[aria-label^="Source:"]').click();
[...document.querySelectorAll("[role=menuitemradio]")]
  .find((b) => b.textContent.trim() === "FILE")
  .click();

// 2. 把文件"拖"进去。拖放走的是 Tauri 的 webview 事件而不是 HTML5 dataTransfer,
//    而事件插件可以从 JS 侧 emit——这是这条路能通的关键。
await window.__TAURI_INTERNALS__.invoke("plugin:event|emit", {
  event: "tauri://drag-drop",
  payload: { type: "drop", paths: ["C:\path\to\file.wav"], position: { x: 10, y: 10 } },
});
```

文件要够长：分析比实时快得多，一个 10 分钟的 WAV 大约跑 65 秒，够采一次 10 秒的样。

### 已经从 profile 里消失的两条

第一次采样的两条原生 API 线索都已处理，第二次采样（同样方法、重建后的构建）里**两者都不再进
前 14**：

|                    | 第一次        | 第二次 | 改动                                          |
| ------------------ | ------------- | ------ | --------------------------------------------- |
| `getPropertyValue` | 311 ms (3.1%) | 未进榜 | 主题 token 按主题缓存（`theme/cssTokens.js`） |
| `addColorStop`     | 211 ms (2.1%) | 未进榜 | Stereo Map 一个 run 一个渐变                  |

**两次采样不是受控实验**：构建不同，面板布局也未必相同（第一次有 719 ms 的 idle，第二次没有），
所以这只是"不再是热点"的证据，不是一个精确的减少量。

第二次采样的新头名是 `qN`（910 ms，9.0%），压缩名，要归因得先开 sourcemap。

### 给压缩过的帧还原名字

生产构建是压缩的，排行里只会是 `qN`、`soe` 这类名字。开 sourcemap 重新构建，
profiler 会自己做映射：

```
PLVS_BUILD_SOURCEMAP=1 npx tauri build --no-bundle
npm run profile:webview -- --seconds 10 --dist dist
```

`PLVS_BUILD_SOURCEMAP` 与 `TAURI_DEBUG` 是两回事，**这是关键**：后者会同时关掉压缩，
那就改变了要测量的东西本身。这个开关只在照常压缩的产物旁边多写一份 map。

映射由 `scripts/sourcemap-lookup.mjs` 完成（自己解 VLQ，不引依赖）。没有 map 的构建照常出报告，
只是保留压缩名，profiler 会明说。

### 数绘制命令：profile 回答不了的那两个问题

profile 说的是时间花在哪。它不说**一个面板每秒重画几次**，也不说**一次重画提交了多少条绘制
命令**。两者都是结构事实而不是计时，而且都被推断错过——Waveform 的重画频率从依赖链推了三次，
三次都不对（`waveform.md` §2.0）。

```
node scripts/webview-draw-count.mjs --seconds 5
```

读数面板（Level Meter、Loudness、Stats）不画东西，只写属性，canvas 计数器对它们是盲的。
对应的仪器是 DOM 变更计数：挂 MutationObserver，按 `data-leaf-path` 归属到面板，
报每秒变更数、写得最多的属性名和具体目标元素，用完卸载。

```bash
node scripts/webview-dom-count.mjs --seconds 5
```

前提和 profiler 完全一样（同一个调试端口，帧必须真的在动）。它在
`CanvasRenderingContext2D.prototype` 上包一层计数，按 canvas 分开报，用 `clearRect` /
`putImageData` 作为"一次重画"的标记——`fill` 不能当除数，因为"一次重画发几个 fill"正是要测的
东西。输出长这样（Frequency Color 打开、lane 宽 340 px）：

```
  waveform lane #1 [1,1,0] 340x72  31.4/s   fill 341.0   stroke 342.0   beginPath 683.0
  waveform lane #2 [1,1,0] 340x72  31.4/s   fill 341.0   stroke 342.0   beginPath 683.0
  canvas [1,1,1] 680x146           31.4/s   putImageData 1.0
```

一行就说清了两种画法的区别：一个每列提交一次，一个整幅传一次。

**计数器自己有开销**，每秒两万多次调用都要过一次查找。脚本跑完会把原方法装回去，
但**别在装着计数器的时候采 profile**——那量的是计数器。

### 采样前置检查：一个空场景和一次成功的优化长得一模一样

**重启应用后，采集源会回到默认输出。** 那通常是一块没人在放音的声卡，于是采集正常、帧照常到达、
面板照常重画，只是画的是一个几乎空白的场景——而空场景便宜得多。这一轮里它连续污染了三组读数，
其中一组被当成「Lines 改后只剩 3.0%」报了出去（真实值 4.58%）。**每次重启应用都要重新选一次
VB-Cable**，测量脚本每次启动也别假设上一次的选择还在。

检查要自动化，别靠记性。最省事的判据是画布上到底画了多少东西：

```js
const c = [...document.querySelectorAll("canvas")].sort((a, b) => b.width - a.width)[0];
const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
let n = 0;
for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n += 1;
console.log((100 * n) / (c.width * c.height)); // 覆盖率 %
```

采样前后各读一次：**低于约 8% 判定这次采样无效**，两次差得多则说明历史窗口还在填，也不能用于
跨臂比较。同一个数字还能当"窗口填满了没有"的等待条件——3D Surface 满窗口约 37%，只填了一半时
每次重画便宜三成，两臂比较必须落在同一个覆盖率上。

**别拿「VLC 还活着」当信号在流的证据。** 它可以健康地播进一个没人听的设备，`protocol.md` §10.3
记的是同一类陷阱的另一个版本。

### 量「画面在抖」：先确认你的分母

面板每秒重画 25 次，但可见时间窗每秒只前进 10 次（`HIST_SAMPLE_SEC`），所以**三分之二的重画画的是
同一个窗口位置，逐字节相同**。一个按帧平均的画面差异指标会把这些静止帧一起除进去，任何真实差异都
被摊薄五六倍——摊薄之后，所有对照臂看起来都一样，而"什么都不影响"读起来非常像"这个改动无效"。

这一轮里它连着骗了三次：0.75 缩放"对抖动毫无影响"、坡度着色长基线"无效"、两个渲染分辨率"完全一致"。
换成只统计**画面真正变化的帧**之后，同一台机器上的数字立刻和离线实验对上了（每次更新：轮廓形变
0.64 px、47% 的列跳 ≥1 px），三个臂也立刻分得开。

判据很简单：先和上一帧比一次，全等就跳过，别计入分母。

**同一类错误的另一面：合成地形不等于真实地形。** 离线注入的每格独立噪声让"坡度着色放大噪声"这个
假设看起来成立（闪烁 10.5 → 3.3），真实窗口里同一改动却毫无作用甚至略差——真实数据过了两个平滑器
之后，闪烁来自地形本身在两次更新之间就变了，不是静态噪声被梯度放大。**离线实验用来筛假设，判决必须
回真实窗口。**

### 量 GPU：前两把尺子都够不到的那一段

**`ctx.stroke()` 在任何东西被光栅化之前就返回了。** 面板自己的 rAF 计时器（`beginPanelCpuSample`）
和 renderer profile 量的都是主线程，两者都停在「绘制命令提交完毕」那一刻；真正的三角形细分和填色
发生在之后的 GPU 进程里，不在任何一个计时器的账上。所以一个面板可以在现有两把尺子上都很便宜，
同时比它的对照组更贵——Spectrogram 的 3D Lines 与 Surface 就是这样，见 `spectrogram.md` §1。

Windows 把每进程的 GPU 时间开在 `GPU Engine` 计数器集里，也就是任务管理器 GPU 那一列的同一个源。
不需要调试端口，也不需要改代码，应用跑着就行：

```bash
node scripts/webview-gpu-usage.mjs --seconds 10 --label "3D Lines"
```

脚本沿 `GPU 进程 → WebView2 browser 进程 → plvs.exe` 这条父子链定位归属，不会把机器上别的
WebView2 应用算进来；同时报出 GPU 进程自己的 CPU（把活交给驱动也要花 CPU，而这段 CPU 和那段
GPU 时间一样，在 renderer profile 里是隐形的）。

三条决定这个数字怎么用的性质：

- **它是整个应用，不是一个面板。** 一个 GPU 进程负责所有面板加窗口本身，所以单独一个读数没有意义。
  必须配一个底线读数（面板关掉，或切到已经判定便宜的 mode），读**差值**。窗口尺寸、布局、信号都要
  保持一致——device 像素是这里影响最大的自变量。
- **`Utilization Percentage` 是按引擎算的。** 一个进程可以同时跑在 3d、copy、video 引擎上，几个引擎
  加起来可以超过 100%。任务管理器只显示最大的那个；脚本给的是分引擎明细加它们的和，因为对 canvas
  来说 3d 与 copy 的分布本身就是结论（细分几何 vs 上传纹理）。
- **计数器一秒一采。** 10 秒就是 10 个样本，max 那一列是真实观测但很粗，别把一个尖峰当帧时间读。

**窗口被遮挡会让读数归零**，而这和「这个 mode 不花 GPU」在输出上长得一模一样。采样时把窗口露在外面。

### 看 UI 有没有因背压丢帧

音频回调丢块和 UI 丢帧不是一回事：前者由 `droppedChunks` 报告；后者发生在 Rust 已经完成分析、
但 WebView 尚未消费完此前发送的帧时。主 UI 积压达到 120 帧后，bridge 会丢弃新的显示帧以阻止
Tauri Channel 无界增长。被丢弃的帧不会分配 `seq`，所以前端看到的序号仍然连续。

生产构建提供一个只读诊断 command，不接 React，也不显示给普通用户。在 DevTools Console 读取：

```js
await window.__TAURI_INTERNALS__.invoke("get_ui_frame_diagnostics");
// {
//   sentFrames,
//   droppedFrames,
//   audioDroppedChunks,
//   currentInflightFrames,
//   maxInflightFrames,
//   inflightLimit: 120
// }
```

每次开始新的 Live 或 File session 都归零。`droppedFrames > 0` 才证明 UI bridge 实际丢过帧；
`maxInflightFrames` 接近 120 则是尚未丢帧但已逼近上限的预警。它不改变发送、ack 或丢弃策略，
热路径只增加少量 relaxed atomic 计数。

`audioDroppedChunks` 是同一 session 内音频回调到分析队列的累计丢块数；它和 UI 丢帧分开计数，
整机压测可以用一次读取同时判断采集端和显示端。

#### 自动验收与整机 soak

`verify:ui-backpressure` 自己启动 release app 和 VB-Cable 信号，先量正常流，再阻塞 WebView 主线程
4 秒，最后等它恢复。它验收四个结构事实：正常时持续发帧且不丢，阻塞时到 120 上限并
增加丢帧计数，恢复后发帧继续且当前积压回到上限以下。

```bash
npm run verify:ui-backpressure
npm run soak:desktop -- --scenario heavy --seconds 1800 --every 10 --out desktop-soak.jsonl
```

`soak:desktop` 和原有 `soak:capture` 的分工不同：后者是无 UI 的 CLI 采集稳定性，前者每 10 秒
记录 UI 丢帧/积压、音频丢块、JS heap、long task、rAF 间隔，以及 host/browser/renderer/GPU/
utility 进程的 working set 和 CPU 累计值。`heavy` 不会更改布局；它只验证启动 preset
至少有 8 个可见 leaf 且包含 Stereo Map，避免脚本悄悄量到错的场景。

2026-09-01 的 Heavy 真实窗口基线（8 个可见 panel，VB-Cable，30 分钟，180 样本）：

| 指标               |                             结果 | 判定                                                   |
| ------------------ | -------------------------------: | ------------------------------------------------------ |
| UI 丢帧 / 音频丢块 |                          `0 / 0` | 通过                                                   |
| 积压峰值           |                       `39 / 120` | 有 81 帧余量                                           |
| long task          |          `112` 次，最大 `670 ms` | 有交互尖峰线索，但未造成 bridge 丢帧                   |
| JS heap            | `22.2 → 40.8 MB`，峰值 `57.2 MB` | 预热后斜率约 `+0.12 MB/min`，没有 JS heap 线性泄漏证据 |
| 整组 working set   |              `706.1 → 1196.9 MB` | 预热后约 `+11.0 MB/min`，其中 renderer `+427.5 MB`     |

working set 增长不能单独判为泄漏：本场景的视觉历史按 retention 持续填充 TypedArray，而且
host 仅 `-0.1 MB`、GPU `+21.7 MB`，增量集中在 renderer。这份 30 分钟记录能排除短时间的
无界 IPC 增长，但不取代填满 retention 窗口后的长 soak。原始序列在
[`desktop-soak-heavy-2026-09-01.jsonl`](./desktop-soak-heavy-2026-09-01.jsonl)。

上表的 `670 ms` 只有 Long Tasks 累计值，没有函数或渲染阶段归因。后续已在同一探针里加入
Chromium Long Animation Frames（LoAF）：每个 >50 ms 动画帧记录 task/render/style-layout 拆分，
以及最重 8 个脚本的 invoker、函数、bundle 位置和 forced layout。来源字段按 Chromium 的
[Long Animation Frames API](https://developer.chrome.com/docs/web-platform/long-animation-frames) 定义记录。

2026-09-01 的 Heavy LoAF 对照（5 分钟，60 样本）仅捕到 3 个启动阶段的长帧，它们的
`startTime` 全部在导航后 1.3 秒内；后续稳态 5 分钟没有新 Long Task/LoAF，UI 丢帧与音频丢块
仍为 0，积压峰值 7/120。

|   启动长帧 | 拆分                                       | 归因                                                              |
| ---------: | ------------------------------------------ | ----------------------------------------------------------------- |
| `197.3 ms` | work `196.0`，render `1.3`，blocking `0`   | React Scheduler `MessagePort.onmessage`；没有单个 >50 ms 阻塞脚本 |
|  `91.2 ms` | work `89.3`，render `1.9`，blocking `37.6` | React Scheduler 提交，其中 forced style/layout `23.8 ms`          |
|  `79.5 ms` | work `41.3`，render `38.2`，blocking `0`   | Spectrogram 3D `requestAnimationFrame` 回调 `37.6 ms`             |

压缩 bundle 位置 `10493` 落在 React Scheduler 的 `MessagePort` work loop；`883772` 落在
Spectrogram 3D 的 scheduled rAF callback。这里的结论是“启动有尖峰，稳态未复现”，不是已定位 30 分钟
记录里的那个 `670 ms`。后者保留为 `HYPOTHESIS`：可能受窗口遮挡/调度状态影响，下一个受控实验应比较
前台、被遮挡和最小化，而不应直接修某个 panel。原始 LoAF 序列在
[`desktop-soak-heavy-loaf-2026-09-01.jsonl`](./desktop-soak-heavy-loaf-2026-09-01.jsonl)。

### 两条读 profile 时的注意

**跨次采样不可直接比较。** 构建、恢复出来的面板布局、素材位置都会变。观察到的 idle 占比在
0% 到 28% 之间浮动过——所以 profile 适合回答"谁是热点"，不适合回答"降了百分之几"。

**文件分析模式不等于实时模式。** 用文件驱动是这套方法能在远程会话里跑起来的原因，但两种模式的
窗口推进方式不同，实时路径上的优化在文件模式下未必会被触发。归因到某个优化是否生效之前，
先确认那条路径在采样时真的走到了。

## 顺序

Spectrum → Spectrogram → Stereo Map → Waveform → Vectorscope → Level Meter / Loudness / Stats

前三个既是渲染大头也是 slab 大头，投入产出比最高。

八个面板走完之后是唯一的跨面板项：统一二进制协议，设计、实测与判定见 `protocol.md`。
Spectrum 与 Stereo Map 的行已移出 JSON（生产宽度一帧 131,886 B → 36,000 B，−73%）；
Vectorscope 实测后**没有并进去**；band grid 实测后**判定不做**。
真实窗口、`smoke:capture`、4 小时 soak 均已验证（`protocol.md` §9、§10）。

## 四个维度与各自的证据来源

| 维度         | 问题                           | 证据来源                                                                                                                                                                                                                                       |
| ------------ | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1 Rust 计算 | 算得对吗？算得有没有冗余？     | `npm run rust:test` + 新增对拍测试（已知输入 → 期望 dB）；Rust 侧单帧耗时                                                                                                                                                                      |
| D2 前端渲染  | 单帧预算超了吗？还有多少空间？ | `npm run benchmark:spectrum-render` / `benchmark:spectrogram-render` / `benchmark:waveform-render` / `benchmark:vectorscope-render`（纯计算部分）+ `npm run profile:webview`（commit 与 paint，见下）+ `webview-gpu-usage.mjs`（光栅化，见下） |
| D3 历史存储  | 结构合理吗？占用是多少？       | `npm run benchmark:history` + heap 预算测试                                                                                                                                                                                                    |
| D4 其他      | 每帧 payload、IPC、调度        | payload 字节数实测；`npm run soak:capture`（留存记录的漂移带是 0.0028–0.0036 dB，对着它读，别对着 0.01 上限）                                                                                                                                  |

## 状态

| Panel       | D1                                     | D2                                                                                                                                                                                                                                      | D3                                                      | D4                                           |
| ----------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------- |
| Spectrum    | 合理性已落地，正确性已有覆盖           | 计算部分已优化；Live 实测动画层 `opacity`/`style` 稳态写入归零                                                                                                                                                                          | 已测，无水分，有损手段均拒绝                            | 三层全部已落地，dB 行 −79%/行；真实窗口已验  |
| Spectrogram | 继承 Spectrum                          | 2D 已优化（−87%/−95%，92.0% 脏帧走滚动条带）；3D Lines 已优化（脊线走 hairline 快路径，GPU 14–17% → 4.6%，GPU 进程 CPU 330 → 5.5 ms/s）；3D Surface 已优化（渲染缩放 0.75，主线程每次重画 12.6 → 7.1 ms）；两者共有的推进抖动已定位未修 | 继承 Spectrum                                           | 继承 Spectrum                                |
| Stereo Map  | 已测，约 50.6 µs/批；零分配，不改      | 已测，派生 <0.11 ms；canvas 调度合理                                                                                                                                                                                                    | 已优化，1.29 → 0.647 GiB/key（约 −50%）；4-bit 视觉已验 | 已落地（栅格 −23%，行再 −70%）；真实窗口已验 |
| Waveform    | 边界与正确性已查，成本未测             | 已测并优化三处（谱线 seek、默认不计算、颜色循环），已在真实窗口验证                                                                                                                                                                     | 已测，占历史约 1%，拒绝                                 | 已测，11.29 KiB/s，拒绝                      |
| Vectorscope | SVG path 字符串构建已优化约 52%        | 选窗和 canvas 尺寸/绘制调度冗余均已优化                                                                                                                                                                                                 | 未读列已删，143.2 MiB/key；拒绝有损主体压缩             | 已测，0.73–0.76 MiB/s/key；协议轮实测后否决  |
| Level Meter | true peak 测试已补；成本可忽略         | 约 23 Hz、每次约 4.8 处 DOM 变更；profile 未进前 20                                                                                                                                                                                     | 无自有历史                                              | 已删 `peak_hold_db`（无消费者）              |
| Loudness    | BS.1770 断言已补（此前唯一测试不断言） | 时间轴节点重挂已修（三面板）；历史查询 −36%                                                                                                                                                                                             | 标量历史，无水分                                        | 标量随帧，无独立开销                         |
| Stats       | 无独立计算，由其余轮覆盖               | 87% 为文本写入、零节点增删；profile 前 40 无其帧                                                                                                                                                                                        | 无自有历史                                              | 无自有 payload                               |
