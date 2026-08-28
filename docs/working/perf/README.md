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

`scripts/capture-rig.mjs` 可以自己起 VLC 循环播进 VB-Cable（`resolveRenderEndpointId` +
`startPlayer` / `stopPlayer`），所以音频这一半是能自动化的——**但只在本机会话里**。

**远程桌面会话里采不了。** RDP 把音频端点换成了 "Remote Audio"：引擎的
`list_audio_devices` 在这种会话里只返回这一个设备，VB-Cable 对 WASAPI 不可见，哪怕 PowerShell
仍然能解析出它的 render endpoint。唯一的替代是把信号播进 "Remote Audio"，而那就是操作者的
扬声器——一分钟的 1 kHz 正弦，不能这么干。**这类采样要在本机会话做。**

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
| Spectrogram | — | — | — | — |
| Stereo Map | — | — | — | — |
| Waveform | — | — | — | — |
| Vectorscope | — | — | — | — |
| Level Meter | — | — | — | — |
| Loudness | — | — | — | — |
| Stats | — | — | — | — |
