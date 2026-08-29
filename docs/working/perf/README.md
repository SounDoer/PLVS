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
[...document.querySelectorAll('[role=menuitemradio]')].find(b => b.textContent.trim() === 'FILE').click();

// 2. 把文件"拖"进去。拖放走的是 Tauri 的 webview 事件而不是 HTML5 dataTransfer,
//    而事件插件可以从 JS 侧 emit——这是这条路能通的关键。
await window.__TAURI_INTERNALS__.invoke('plugin:event|emit', {
  event: 'tauri://drag-drop',
  payload: { type: 'drop', paths: ['C:\path\to\file.wav'], position: { x: 10, y: 10 } },
});
```

文件要够长：分析比实时快得多，一个 10 分钟的 WAV 大约跑 65 秒，够采一次 10 秒的样。

### 已经从 profile 里消失的两条

第一次采样的两条原生 API 线索都已处理，第二次采样（同样方法、重建后的构建）里**两者都不再进
前 14**：

| | 第一次 | 第二次 | 改动 |
| --- | --- | --- | --- |
| `getPropertyValue` | 311 ms (3.1%) | 未进榜 | 主题 token 按主题缓存（`theme/cssTokens.js`） |
| `addColorStop` | 211 ms (2.1%) | 未进榜 | Stereo Map 一个 run 一个渐变 |

**两次采样不是受控实验**：构建不同，面板布局也未必相同（第一次有 719 ms 的 idle，第二次没有），
所以这只是"不再是热点"的证据，不是一个精确的减少量。

第二次采样的新头名是 `qN`（910 ms，9.0%），压缩名，要归因得先开 sourcemap。

### 读 profile 的一个限制

生产构建是压缩过的，所以自有函数在排行里只剩 `BN`、`nL` 这类名字，落在
`index-<hash>.js:<line>` 上——**能定位到文件，定位不到函数**。

浏览器原生 API 不受影响（`getPropertyValue`、`addColorStop`、`setAttribute` 都是原名），
所以第一轮的可行动线索往往来自它们。要拿到自有函数的名字，得开 sourcemap 重新构建再做映射；
在原生 API 的线索用尽之前不值得。

另外 profile 反映的是**当时那台机器上恢复出来的布局**，不是默认布局——归因到具体面板之前
要先确认哪些面板开着。

## 顺序

Spectrum → Spectrogram → Stereo Map → Waveform → Vectorscope → Level Meter / Loudness / Stats

前三个既是渲染大头也是 slab 大头，投入产出比最高。

## 四个维度与各自的证据来源

| 维度 | 问题 | 证据来源 |
| --- | --- | --- |
| D1 Rust 计算 | 算得对吗？算得有没有冗余？ | `npm run rust:test` + 新增对拍测试（已知输入 → 期望 dB）；Rust 侧单帧耗时 |
| D2 前端渲染 | 单帧预算超了吗？还有多少空间？ | `npm run benchmark:spectrum-render`（纯计算部分）+ `npm run profile:webview`（commit 与 paint，见下） |
| D3 历史存储 | 结构合理吗？占用是多少？ | `npm run benchmark:history` + heap 预算测试 |
| D4 其他 | 每帧 payload、IPC、调度 | payload 字节数实测；`npm run soak:capture`（只作线索，阈值未校准） |

## 状态

| Panel | D1 | D2 | D3 | D4 |
| --- | --- | --- | --- | --- |
| Spectrum | 合理性已落地，正确性已有覆盖 | 计算部分已测并优化，paint 待测 | 已测，无水分，有损手段均拒绝 | payload 第 1、2 层已落地，第 3 层待议 |
| Spectrogram | 继承 Spectrum | 已测并优化（−87%/−95%） | 继承 Spectrum | 继承 Spectrum |
| Stereo Map | 待测 | 渐变已减半，其余待测 | 待测 | 已落地（−23%） |
| Waveform | — | — | — | — |
| Vectorscope | — | — | — | — |
| Level Meter | — | — | — | — |
| Loudness | — | — | — | — |
| Stats | — | — | — | — |
