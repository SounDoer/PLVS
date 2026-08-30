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

**远程桌面会话**：实时采集这条路是断的。RDP 把音频端点换成了 "Remote Audio"，引擎的
`list_audio_devices` 只返回这一个设备，VB-Cable 对 WASAPI 不可见（哪怕 PowerShell 仍能解析出它的
render endpoint）。唯一的音频替代是播进 "Remote Audio"，而那就是操作者的扬声器。

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

### 两条读 profile 时的注意

**跨次采样不可直接比较。** 构建、恢复出来的面板布局、素材位置都会变。观察到的 idle 占比在
0% 到 28% 之间浮动过——所以 profile 适合回答"谁是热点"，不适合回答"降了百分之几"。

**文件分析模式不等于实时模式。** 用文件驱动是这套方法能在远程会话里跑起来的原因，但两种模式的
窗口推进方式不同，实时路径上的优化在文件模式下未必会被触发。归因到某个优化是否生效之前，
先确认那条路径在采样时真的走到了。

## 顺序

Spectrum → Spectrogram → Stereo Map → Waveform → Vectorscope → Level Meter / Loudness / Stats

前三个既是渲染大头也是 slab 大头，投入产出比最高。

## 四个维度与各自的证据来源

| 维度         | 问题                           | 证据来源                                                                                                                                                                                              |
| ------------ | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1 Rust 计算 | 算得对吗？算得有没有冗余？     | `npm run rust:test` + 新增对拍测试（已知输入 → 期望 dB）；Rust 侧单帧耗时                                                                                                                             |
| D2 前端渲染  | 单帧预算超了吗？还有多少空间？ | `npm run benchmark:spectrum-render` / `benchmark:spectrogram-render` / `benchmark:waveform-render` / `benchmark:vectorscope-render`（纯计算部分）+ `npm run profile:webview`（commit 与 paint，见下） |
| D3 历史存储  | 结构合理吗？占用是多少？       | `npm run benchmark:history` + heap 预算测试                                                                                                                                                           |
| D4 其他      | 每帧 payload、IPC、调度        | payload 字节数实测；`npm run soak:capture`（只作线索，阈值未校准）                                                                                                                                    |

## 状态

| Panel       | D1                                           | D2                                                                  | D3                                    | D4                                    |
| ----------- | -------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------- | ------------------------------------- |
| Spectrum    | 合理性已落地，正确性已有覆盖                 | 计算部分已测并优化，paint 待测                                      | 已测，无水分，有损手段均拒绝          | payload 第 1、2 层已落地，第 3 层待议 |
| Spectrogram | 继承 Spectrum                                | 已测并优化（−87%/−95%）                                             | 继承 Spectrum                         | 继承 Spectrum                         |
| Stereo Map  | 已测，约 50.6 µs/批；零分配，不改           | 已测，派生 <0.11 ms；canvas 调度合理                                | 已测，1.29 GiB/key；Uint8 energy 待评 | 已落地（−23%）                        |
| Waveform    | 边界与正确性已查，成本未测                   | 已测并优化三处（谱线 seek、默认不计算、颜色循环），已在真实窗口验证 | 已测，占历史约 1%，拒绝               | 已测，11.29 KiB/s，拒绝               |
| Vectorscope | SVG path 字符串构建已优化约 52%            | 选窗和 canvas 尺寸/绘制调度冗余均已优化                           | 已测，151.4 MiB/key；拒绝有损主体压缩 | 已测，0.73–0.76 MiB/s/key；并入协议轮 |
| Level Meter | —                                            | —                                                                   | —                                     | —                                     |
| Loudness    | —                                            | —                                                                   | —                                     | —                                     |
| Stats       | —                                            | —                                                                   | —                                     | —                                     |
