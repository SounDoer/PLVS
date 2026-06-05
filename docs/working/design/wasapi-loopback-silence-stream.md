# WASAPI Loopback 静音流方案

## 问题背景

### 现象
1. 使用 WASAPI Loopback 捕获系统音频时，当没有音频播放，时间轴停止滚动
2. 但 session timer 仍在计时，造成用户困惑
3. 打开 YouLean Loudness Meter 后，PLVS 的时间轴也开始滚动

### 根本原因
WASAPI Loopback 的设计行为：
- 当没有音频流（audio stream）时，WASAPI **不会发送回调**
- 这不是 bug，而是 Windows 音频引擎的设计
- 但如果有"静音流"（silent stream）在播放，回调会继续

参考：
- [Audacity Forum - Cannot record silence](https://forum.audacityteam.org/t/cannot-record-silence/55561)
- [Mixing Microphone input and Speaker output (Windows)](https://mathewsachin.github.io/blog/2017/07/28/mixing-audio.html)

## 解决方案

### 核心思路
在 loopback 捕获期间，同时在目标输出设备上播放一个**静音流**（silent stream），保持音频引擎活跃。

### 技术实现

#### 1. 在 Rust 端创建静音流

**位置**: `src-tauri/src/audio/cpal_backend.rs`

**修改 `run_capture_worker` 函数**：

```rust
fn run_capture_worker(args: RunCaptureArgs) -> Result<(), String> {
  // ... 现有代码 ...

  // 创建静音输出流（仅对 loopback 设备）
  let silence_stream = if is_loopback_device {
    create_silence_stream(&device, &stream_config)?
  } else {
    None
  };

  // ... 现有的输入流创建代码 ...

  // 在 cleanup 时同时停止静音流
  // drop(silence_stream) 会在函数退出时自动执行
}
```

#### 2. 静音流创建函数

```rust
/// 为 loopback 设备创建静音输出流，保持音频引擎活跃
fn create_silence_stream(
  device: &cpal::Device,
  config: &StreamConfig,
) -> Option<cpal::Stream> {
  let stream = device.build_output_stream(
    config,
    move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
      // 写入静音（全零）
      for sample in data.iter_mut() {
        *sample = 0.0;
      }
    },
    |e| log::error!("silence stream error: {e}"),
    None,
  );

  match stream {
    Ok(s) => {
      if s.play().is_ok() {
        log::info!("Silence stream started for loopback capture");
        return Some(s);
      }
    }
    Err(e) => {
      log::warn!("Failed to create silence stream: {e}");
    }
  }
  None
}
```

#### 3. 判断是否为 Loopback 设备

**位置**: `src-tauri/src/audio/device_enum.rs`

```rust
/// 检查设备是否为 loopback（输出设备用作捕获）
pub(crate) fn is_loopback_capture(device_id: &str) -> bool {
  device_id.is_empty()
    || device_id == "default"
    || device_id::is_stable_loopback_id(device_id)   // 稳定 id: lb-<32 hex>
    || device_id::parse_legacy_output_index(device_id).is_some()  // 旧格式 id: out:N
}
```

覆盖全部 loopback 相关的 device id 格式：
- 空字符串 / `"default"` → 默认输出设备（走 `resolve_default_output`）
- `lb-*` → 新稳定格式 loopback id
- `out:N` → 旧格式 legacy output 索引（老 session 保存的 id 可能是这种格式）

注意：`cap-*` 和 `in:N` 是真正的输入设备（即使名称里包含 "Stereo Mix" 等），不走 WASAPI loopback 路径，不需要静音流，故不在此函数中处理。

### 数据流示意

```
┌─────────────────────────────────────────────────────────────┐
│                    Windows Audio Engine                      │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐     ┌──────────────┐                      │
│  │ 其他应用播放  │     │ PLVS 静音流  │                      │
│  │ (Spotify等)  │     │  (全零样本)  │                      │
│  └──────┬───────┘     └──────┬───────┘                      │
│         │                    │                               │
│         ▼                    ▼                               │
│  ┌────────────────────────────────────┐                     │
│  │         音频混音器 (Mixer)          │                     │
│  │   (始终有流在流动 = 回调持续触发)    │                     │
│  └──────────────────┬─────────────────┘                     │
│                     │                                        │
│                     ▼                                        │
│  ┌────────────────────────────────────┐                     │
│  │        WASAPI Loopback 捕获         │                     │
│  │     (回调持续触发，即使静音)         │                     │
│  └──────────────────┬─────────────────┘                     │
│                     │                                        │
└─────────────────────┼────────────────────────────────────────┘
                      │
                      ▼
         ┌────────────────────────┐
         │   PLVS 音频处理管线    │
         │  (History 持续更新)    │
         └────────────────────────┘
```

### 行为对比

| 场景 | 修复前 | 修复后 |
|------|--------|--------|
| 有音频播放 | ✅ 回调触发 | ✅ 回调触发 |
| 无音频播放 | ❌ 回调停止 | ✅ 回调触发（静音数据） |
| Session Timer | ⚠️ 与 History 不一致 | ✅ 与 History 一致 |
| 时间轴滚动 | ❌ 停止 | ✅ 持续滚动 |

### 资源消耗

静音流的资源消耗极低：
- CPU: 几乎为零（只写入 0.0）
- 内存: 仅缓冲区大小
- 对系统无实际音频输出

### 兼容性考虑

1. **非 Loopback 设备**：不创建静音流（麦克风等输入设备不需要）
2. **设备切换**：静音流随主捕获流一起创建/销毁
3. **错误处理**：静音流创建失败不应阻止主捕获

## 实现步骤

### Phase 1: 核心实现
1. [ ] 在 `device_enum.rs` 添加 `is_loopback_capture` 函数
2. [ ] 在 `cpal_backend.rs` 添加 `create_silence_stream` 函数
3. [ ] 修改 `run_capture_worker` 在 loopback 捕获时创建静音流

### Phase 2: 测试验证
1. [ ] 无音频播放时，时间轴持续滚动
2. [ ] Session timer 与 History 行为一致
3. [ ] 静音数据正确处理（M/S 值为 -inf）
4. [ ] 设备切换时静音流正确创建/销毁

### Phase 3: 边缘情况
1. [ ] 静音流创建失败时的降级处理
2. [ ] 多设备同时捕获的情况
3. [ ] 独占模式（Exclusive Mode）的兼容性

## 替代方案

### 方案 B: 前端时间驱动
不修改 Rust 端，在前端用定时器驱动时间轴滚动。

**优点**：
- 实现简单
- 不消耗额外音频资源

**缺点**：
- 时间轴滚动但无实际数据
- 与真实音频时间可能不同步
- 治标不治本

### 方案 C: 检测静默状态并提示
检测音频静默，在 UI 上显示"无音频信号"指示器。

**优点**：
- 用户知道当前状态
- 不改变现有行为

**缺点**：
- 不解决时间轴停止的问题
- 用户体验不如方案 A

## 平台差异

### macOS 行为（待验证）

macOS 使用 **CoreAudio Process Tap** 捕获系统音频，与 Windows WASAPI Loopback 有本质区别：

**理论行为**（基于 Apple Developer Forums 讨论）：
- `AudioHardwareCreateProcessTap` + `AudioHardwareCreateAggregateDevice` 组合会持续触发回调
- 即使没有音频播放，回调仍会触发，返回**全零缓冲区**（不是空缓冲区）
- 这意味着时间轴应该会持续滚动

**但需要实际验证**：
1. Apple Developer Forums 的帖子描述的是"every PCM sample is exactly 0.0f"，意味着缓冲区有数据
2. 但 PLVS 的 `tap_io_proc` 会检查 `mDataByteSize == 0`，如果是空缓冲区则不推送数据
3. **需要实际测试**：在没有音频播放时，macOS 返回的是空缓冲区还是全零缓冲区？

**验证方法**：
1. 在 macOS 上启动 PLVS，选择 loopback 设备
2. 停止所有音频播放
3. 观察时间轴是否持续滚动

**参考**：
- [Apple Developer Forums - AudioHardwareCreateProcessTap delivers all-zero buffers](https://developer.apple.com/forums/thread/825780)
- PLVS macOS 实现：[tap_bridge.m](file:///c:/Users/shenxichen/repos/PLVS/src-tauri/native/macos/tap_bridge.m)

### Linux 行为（待确认）

Linux 使用 PulseAudio/PipeWire 的 monitor 设备实现 loopback，行为可能与 macOS 类似。需要实际测试确认。

## 结论

推荐 **方案 A（静音流）**，原因：
1. 从根本上解决问题
2. 与专业工具（YouLean 等）行为一致
3. 资源消耗极低
4. 用户体验最佳
5. **仅针对 Windows 平台**，macOS 不需要此处理
