# File 模式 FFmpeg 解码覆盖 — 设计文档

- 日期：2026-06-28
- 范围标签：**A（扩展解码覆盖）**。音频回放（B）、视频画面回放（C）不在本期。
- 分支：`worktree-ffmpeg-file-decode`

## 1. 背景与问题

File 模式当前用 **Symphonia 0.5.5**（纯 Rust）解码：`fileDialog.js`（选文件）→ `probe.rs`（探测轨道）→ `session.rs`（解封装 + 解码 → PCM → `MeterPipeline` → 汇总指标）。

WAV/MP3/FLAC/AAC-LC 等大多正常，但**视频文件支持差**，根因是 Symphonia 的 codec 覆盖有限，解不了视频里常见的音轨：

| 编码 | 出现场景 | Symphonia 0.5 |
|---|---|---|
| AC-3 / E-AC-3（Dolby Digital） | 影视、广播、mkv/mp4 | ❌ 不支持 |
| DTS | 电影 | ❌ 不支持 |
| Opus | webm/mkv、网络视频 | ❌ 无解码器 |
| HE-AAC（SBR/PS） | 流媒体低码率 | ⚠️ 只支持 AAC-LC |

这些音轨在 `select_first_decodable_track` 处被判不可解码，报 "No decodable audio track found"。

附带 bug：`fileDialog.js` 扩展名白名单缺 `.mov`，QuickTime 视频选不进来。

## 2. 目标

让 File 模式"拖入任意常见音视频文件，都能正确提取音轨并完成计量分析"。

成功标准：
- 一组覆盖 AC-3 / E-AC-3 / DTS / Opus / HE-AAC / AAC-LC / PCM 的真实音视频样本，全部能成功解码并产出汇总指标。
- 现有 WAV/MP3/FLAC 路径行为不回退（指标与改造前一致）。
- 不支持/损坏的文件给出清晰可见的错误，而非崩溃或静默。

## 3. 方案选型（已敲定）

- **FFmpeg 作为 Tauri sidecar**（独立子进程，非 FFI）。理由：CI 三平台构建链不动、子进程崩溃隔离、跨平台只换二进制。
- **全量走 FFmpeg，删除 Symphonia 依赖**。Symphonia 仅服务 `file_analysis/`，删除不影响实时 cpal 采集。一条解码路径，符合 simplicity-first。
- **自己编裁剪版 FFmpeg**（LGPL，~15-25MB），**手动编译 + GitHub Release 资产**产出。
- **本期只做 Windows**；macOS/Linux 二进制后补。

被否决的替代：GStreamer/libVLC（更重无优势）、OS 原生框架（每平台单写、Linux 缺失）、拼装单编码库（AC-3/DTS/HE-AAC 优质库多为 GPL，传染 MIT）。详见对话记录。

## 4. 架构

### 4.1 数据流（改造后）

```
fileDialog.js (选文件, 扩展名放宽)
  → commands.js (probe IPC)
  → [Rust] ffprobe_file: 调 ffprobe 取轨道元数据/时长
  → 前端展示 metadata
  → [用户开始分析] start IPC
  → [Rust] FileAnalysisSession: spawn ffmpeg 子进程
       ffmpeg -i <path> -map 0:a:<idx> -f f32le -acodec pcm_f32le \
              -ac <ch> -ar <sr> pipe:1
  → 从 stdout 读 interleaved f32 PCM 分块
  → MeterPipeline.push_pcm_f32... (复用现有计量管线)
  → 进度: 解析 ffmpeg stderr 的 time= 时间戳
  → 完成: summary_metrics() → file-analysis-completed
```

### 4.2 模块边界（`src-tauri/src/file_analysis/`）

| 模块 | 职责 | 依赖 |
|---|---|---|
| `ffmpeg/locate.rs` | 定位 sidecar 二进制路径（打包资源 / 开发期回退） | tauri 资源 API |
| `ffmpeg/probe.rs` | 调 ffprobe，解析 JSON → `FileAnalysisProbeResult`（替代旧 symphonia probe.rs） | serde_json |
| `ffmpeg/decode.rs` | 构造 ffmpeg 解码命令、从 stdout 读 f32 PCM 块、从 stderr 解析进度 | std::process |
| `session.rs` | 驱动子进程生命周期、喂 PCM 给 MeterPipeline、取消、错误透传（保留壳，替换内部） | 上面三者 |

- **PCM 出口接口**：`decode.rs` 暴露 `on_pcm_chunk(&[f32])` 回调式接口，与 MeterPipeline 解耦。本期只接计量；为下一期音频回放（B）预留同一出口。
- 旧 `decode.rs`（symphonia AudioBufferRef → f32 交织）整体删除，由 ffmpeg 直接输出 f32le 替代。

### 4.3 元数据探测：ffprobe

用 `ffprobe -v quiet -print_format json -show_streams -show_format <path>` 取：
- 轨道列表 → 选第一条 audio 流（`codec_type == "audio"`）。
- `codec_name` / `sample_rate` / `channels` / `tags.language` / `duration`。
- 容器名取自 `format.format_name`。

> 决策点：ffprobe 是独立二进制（裁剪构建可一并产出），比解析 ffmpeg stderr 更结构化可靠。若不想多带一个二进制，备选是 `ffmpeg -i` 解析 stderr。**本设计选 ffprobe**（结构化、可靠），裁剪构建时一并编出 `ffprobe.exe`。

### 4.4 解码与采样格式

- 让 ffmpeg 直接输出 `pcm_f32le`，interleaved，**不让 ffmpeg 改采样率/声道**（`-ar`/`-ac` 用源轨道的值，保持原始计量输入），与现有 `MeterPipeline::new_for_file(sample_rate, channels)` 对齐。
- 从 stdout 按固定字节块读取，每块 `len / channels` 帧，转 `&[f32]` 喂管线。
- 块大小取约 0.1–0.5s 音频，平衡 IPC 频率与 UI 刷新。

### 4.5 进度

- ffmpeg stderr 周期打印 `time=HH:MM:SS.xx`。解析它 / 总时长 = 进度。
- 总时长来自 4.3 的 ffprobe duration。
- 复用现有 `FileAnalysisProgressPayload`（字段可能从 frames 改为 ms，见 §7 待定）。

### 4.6 子进程生命周期与取消

- `FileAnalysisSession` 持有子进程 handle + stop 通道（沿用现结构）。
- 取消：kill 子进程，worker 线程退出，不发 completion。
- 子进程非零退出 / stderr 含 fatal → 转成可见错误 `file-analysis-error`。
- 二进制缺失（sidecar 没打进包/开发期没放）：探测阶段即返回明确错误"FFmpeg 组件缺失"，不进入分析。

## 5. 打包：sidecar 二进制

- 裁剪 ffmpeg（见 §8 构建步骤）产出 `ffmpeg.exe` + `ffprobe.exe`。
- Tauri `externalBin` 机制，命名带 target triple：`ffmpeg-x86_64-pc-windows-msvc.exe`。
- 二进制**不进 Git 仓库**，挂 GitHub Release 资产；打包/开发期脚本拉取到 `src-tauri/binaries/`。
- `src-tauri/capabilities` 需放行 sidecar 执行权限（`shell:allow-execute` / sidecar scope）。
- 许可证：构建用 `--disable-gpl --disable-nonfree`，产物 LGPL，保 PLVS 的 MIT。需在 about/许可证处附 FFmpeg LGPL 声明与源码获取方式。

## 6. 测试策略

- **Rust 单元测试**：
  - ffprobe JSON 解析 → `FileAnalysisProbeResult`（喂固定 JSON 字符串，不依赖真二进制）。
  - stderr `time=` 进度解析（纯函数，喂样本行）。
  - 轨道选择规则（沿用现有 `select_first_decodable_track` 测试思路）。
- **解码端到端**：保留现有"代码内生成 WAV fixture"思路验证管线连通；真实 AC-3/DTS/Opus 样本作为**手动验收清单**（二进制 + 版权样本不进仓库 CI）。
- **前端**：`fileDialog` 扩展名集合、错误/进度事件流（沿用现有 `useFileAnalysisEngine.test.jsx` 模式）。
- 不破坏现有 `npm run check`（前端 + Rust fmt/clippy/test）。

## 7. 待定细节（实现计划阶段定）

- `FileAnalysisProgressPayload` 是否从 `frames`/`total_frames` 改为 `time_ms`/`duration_ms`——影响前端进度消费，需同步改 `useFileAnalysisEngine`。
- 块大小与读取缓冲的具体数值。
- ffprobe 不可用时是否回退到 ffmpeg stderr 解析（默认不回退，缺二进制直接报错）。
- sidecar 二进制拉取脚本放在 npm script 还是 build.rs。

## 8. 裁剪 FFmpeg 构建步骤（Windows，一次性手工）

环境 MSYS2 + MinGW64。configure 关键开关：

```
--disable-everything --disable-gpl --disable-nonfree
--disable-doc --disable-avdevice --disable-postproc --disable-swscale
--disable-network --disable-encoders --disable-muxers --disable-filters
--enable-small --enable-static --disable-shared --extra-ldflags=-static
--enable-filter=aresample --enable-protocol=file
--enable-demuxer=mov,matroska,wav,aiff,flac,mp3,ogg,aac,ac3,eac3,dts,w64
--enable-decoder=aac,aac_latm,ac3,eac3,dca,opus,vorbis,flac,mp3,alac,pcm_s16le,pcm_s24le,pcm_s32le,pcm_f32le,pcm_f64le,pcm_u8
```

- `dca` = DTS，`eac3` = E-AC-3。视频解码器全不开（只读音轨）。
- 需同时产出 `ffprobe`（默认 `--enable-ffprobe`，或确认未被 `--disable-programs` 砍掉）。
- 编完 `strip`，目标 15-25MB，挂 Release 资产。
- 该步骤由实现阶段自动执行（用户已授权自行安装/编译，无需打扰）。

## 9. 不做（明确排除）

- CI 自动编译 ffmpeg（手动 + Release 资产即可）。
- macOS / Linux 二进制（后补）。
- 音频回放 B（仅预留 PCM 出口接口）。
- 视频画面回放 C（独立立项）。
- 体积深度优化。
