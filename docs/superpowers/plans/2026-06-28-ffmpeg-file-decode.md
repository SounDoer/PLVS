# FFmpeg File-Decode Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Symphonia with a trimmed FFmpeg sidecar so File mode can analyze any common audio/video container (AC-3, E-AC-3, DTS, Opus, HE-AAC, AAC-LC, PCM).

**Architecture:** A bundled, trimmed `ffmpeg`/`ffprobe` pair runs as Tauri sidecars (separate processes, no FFI). `ffprobe` returns track metadata as JSON; `ffmpeg` decodes the selected audio track to interleaved `f32le` PCM on stdout, which feeds the existing `MeterPipeline` unchanged. Symphonia is removed entirely. Windows-only this phase.

**Tech Stack:** Rust (`std::process`, `serde_json`), Tauri 2 externalBin sidecars, React frontend (file dialog only), trimmed LGPL FFmpeg.

---

## Design Notes Locked In

- **Progress payload is unchanged.** `FileAnalysisProgressPayload` keeps its current fields. Internally `progress` is now computed from media time (`out_time_us / (duration_ms * 1000)`) instead of frames. `total_frames` is emitted as `None` (ffmpeg does not report a reliable frame total); `decoded_frames` is still counted from PCM bytes. The frontend (`useFileAnalysisEngine`) reads only `payload.progress` and `payload.path`, so it needs **no change**.
- **No sample-rate / channel conversion.** ffmpeg is told to output the source track's native `-ar`/`-ac`, preserving measurement fidelity.
- **ffprobe for metadata** (structured JSON), not stderr scraping.
- **Binaries are not committed to git.** They are produced manually, placed in `src-tauri/binaries/`, and (later) hosted as GitHub Release assets. `.gitignore` excludes them.

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `src-tauri/src/file_analysis/ffmpeg/mod.rs` | Submodule index | Create |
| `src-tauri/src/file_analysis/ffmpeg/locate.rs` | Resolve sidecar binary paths (dev + bundled) | Create |
| `src-tauri/src/file_analysis/ffmpeg/probe.rs` | ffprobe JSON → `FileAnalysisProbeResult` (pure parse + spawn) | Create |
| `src-tauri/src/file_analysis/ffmpeg/decode.rs` | Build ffmpeg args, parse `out_time_us`, bytes→f32 | Create |
| `src-tauri/src/file_analysis/probe.rs` | Thin wrapper: `probe_file` → `ffmpeg::probe` | Rewrite |
| `src-tauri/src/file_analysis/session.rs` | Drive ffmpeg subprocess, feed `MeterPipeline` | Rewrite `analyze_file_core` |
| `src-tauri/src/file_analysis/decode.rs` | Old symphonia interleave helper | **Delete** |
| `src-tauri/src/file_analysis/mod.rs` | Module list | Modify |
| `src-tauri/Cargo.toml` | Remove `symphonia` dependency | Modify |
| `src-tauri/tauri.conf.json` | Add `externalBin` | Modify |
| `src-tauri/capabilities/default.json` | Allow sidecar execution | Modify |
| `src-tauri/binaries/` (+ `.gitignore`) | Hold sidecar binaries (untracked) | Create |
| `src/ipc/fileDialog.js` | Add `.mov` + more extensions | Modify |
| `docs/ffmpeg-sidecar-build.md` | How to build/place the trimmed binaries | Create |

---

## Task 1: ffprobe JSON parser (pure, TDD)

**Files:**
- Create: `src-tauri/src/file_analysis/ffmpeg/mod.rs`
- Create: `src-tauri/src/file_analysis/ffmpeg/probe.rs`
- Modify: `src-tauri/src/file_analysis/mod.rs`

- [ ] **Step 1: Register the submodule**

In `src-tauri/src/file_analysis/mod.rs` add:

```rust
pub mod decode;
pub mod ffmpeg;
pub mod probe;
pub mod session;
```

In a new `src-tauri/src/file_analysis/ffmpeg/mod.rs`:

```rust
pub mod decode;
pub mod locate;
pub mod probe;
```

> Note: `ffmpeg/decode.rs` and `ffmpeg/locate.rs` are created in later tasks; if the build is run between tasks, temporarily comment those two lines. The recommended subagent flow implements tasks in order, so they will exist by the time the module is compiled in Task 6.

- [ ] **Step 2: Write the failing test**

In `src-tauri/src/file_analysis/ffmpeg/probe.rs`:

```rust
#[cfg(test)]
mod tests {
  use super::*;

  const SAMPLE: &str = r#"{
    "streams": [
      {"index": 0, "codec_type": "video", "codec_name": "h264"},
      {"index": 1, "codec_type": "audio", "codec_name": "ac3",
       "sample_rate": "48000", "channels": 6, "tags": {"language": "eng"}}
    ],
    "format": {"format_name": "mov,mp4,m4a,3gp,3g2,mj2", "duration": "180.5"}
  }"#;

  #[test]
  fn parses_first_audio_stream_metadata() {
    let result = parse_ffprobe_json(SAMPLE, "/m/clip.mkv", "clip.mkv").expect("parse");
    assert_eq!(result.file_name, "clip.mkv");
    assert_eq!(result.container.as_deref(), Some("mov"));
    assert_eq!(result.duration_ms, Some(180_500));
    assert_eq!(result.selected_track.index, 1);
    assert_eq!(result.selected_track.codec, "ac3");
    assert_eq!(result.selected_track.sample_rate_hz, Some(48_000));
    assert_eq!(result.selected_track.channels, Some(6));
    assert_eq!(result.selected_track.language.as_deref(), Some("eng"));
  }

  #[test]
  fn errors_when_no_audio_stream() {
    let json = r#"{"streams":[{"index":0,"codec_type":"video","codec_name":"h264"}],"format":{}}"#;
    let err = parse_ffprobe_json(json, "/m/x.mp4", "x.mp4").expect_err("no audio");
    assert_eq!(err, "No audio track found in media file");
  }
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cargo test -p plvs file_analysis::ffmpeg::probe`
Expected: FAIL — `parse_ffprobe_json` not found.

- [ ] **Step 4: Write minimal implementation**

At the top of `src-tauri/src/file_analysis/ffmpeg/probe.rs`:

```rust
use serde::Deserialize;

use crate::ipc::types::{FileAnalysisProbeResult, FileAudioTrackMetadata};

#[derive(Deserialize)]
struct ProbeRoot {
  #[serde(default)]
  streams: Vec<ProbeStream>,
  #[serde(default)]
  format: ProbeFormat,
}

#[derive(Deserialize)]
struct ProbeStream {
  index: u32,
  codec_type: String,
  #[serde(default)]
  codec_name: String,
  #[serde(default)]
  sample_rate: Option<String>,
  #[serde(default)]
  channels: Option<u16>,
  #[serde(default)]
  tags: Option<ProbeTags>,
}

#[derive(Deserialize, Default)]
struct ProbeFormat {
  #[serde(default)]
  format_name: Option<String>,
  #[serde(default)]
  duration: Option<String>,
}

#[derive(Deserialize)]
struct ProbeTags {
  #[serde(default)]
  language: Option<String>,
}

/// Parse `ffprobe -print_format json -show_streams -show_format` output into the UI metadata shape.
/// Selects the first audio stream; its absolute `index` is reused verbatim by the decoder's
/// `-map 0:<index>`.
pub fn parse_ffprobe_json(
  json: &str,
  path: &str,
  file_name: &str,
) -> Result<FileAnalysisProbeResult, String> {
  let root: ProbeRoot =
    serde_json::from_str(json).map_err(|err| format!("Unable to read media metadata: {err}"))?;

  let audio = root
    .streams
    .iter()
    .find(|s| s.codec_type == "audio")
    .ok_or_else(|| "No audio track found in media file".to_string())?;

  let sample_rate_hz = audio
    .sample_rate
    .as_deref()
    .and_then(|s| s.parse::<u32>().ok());
  let language = audio.tags.as_ref().and_then(|t| t.language.clone());
  let container = root
    .format
    .format_name
    .as_deref()
    .and_then(|name| name.split(',').next())
    .map(|s| s.to_string());
  let duration_ms = root
    .format
    .duration
    .as_deref()
    .and_then(|d| d.parse::<f64>().ok())
    .map(|secs| (secs * 1000.0).round() as u64);

  Ok(FileAnalysisProbeResult {
    path: path.to_string(),
    file_name: file_name.to_string(),
    container,
    duration_ms,
    selected_track: FileAudioTrackMetadata {
      index: audio.index,
      codec: audio.codec_name.clone(),
      sample_rate_hz,
      channels: audio.channels,
      language,
    },
  })
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cargo test -p plvs file_analysis::ffmpeg::probe`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/file_analysis/ffmpeg/mod.rs src-tauri/src/file_analysis/ffmpeg/probe.rs src-tauri/src/file_analysis/mod.rs
git commit -m "feat: parse ffprobe json into file probe metadata"
```

---

## Task 2: ffmpeg decode helpers (pure, TDD)

**Files:**
- Create: `src-tauri/src/file_analysis/ffmpeg/decode.rs`

- [ ] **Step 1: Write the failing tests**

In `src-tauri/src/file_analysis/ffmpeg/decode.rs`:

```rust
#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn builds_decode_args_for_selected_track() {
    let args = build_decode_args("/m/clip.mkv", 1, 6, 48_000);
    let joined = args.join(" ");
    assert!(joined.contains("-map 0:1"), "got: {joined}");
    assert!(joined.contains("-vn"));
    assert!(joined.contains("-ac 6"));
    assert!(joined.contains("-ar 48000"));
    assert!(joined.contains("-f f32le"));
    assert!(joined.ends_with("pipe:1"));
    assert!(joined.contains("-progress pipe:2"));
  }

  #[test]
  fn parses_out_time_us_progress() {
    assert_eq!(parse_out_time_us("out_time_us=1500000"), Some(1_500_000));
    assert_eq!(parse_out_time_us("out_time_ms=1500"), None);
    assert_eq!(parse_out_time_us("frame=10"), None);
  }

  #[test]
  fn converts_le_bytes_to_f32() {
    // 1.0_f32 little-endian = 00 00 80 3F ; -1.0 = 00 00 80 BF
    let bytes = [0x00, 0x00, 0x80, 0x3F, 0x00, 0x00, 0x80, 0xBF];
    assert_eq!(bytes_to_f32_le(&bytes), vec![1.0, -1.0]);
  }

  #[test]
  fn ignores_trailing_partial_sample() {
    // 5 bytes: one full f32 + 1 leftover byte the caller must carry over.
    let bytes = [0x00, 0x00, 0x80, 0x3F, 0xAB];
    assert_eq!(bytes_to_f32_le(&bytes), vec![1.0]);
  }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test -p plvs file_analysis::ffmpeg::decode`
Expected: FAIL — functions not found.

- [ ] **Step 3: Write minimal implementation**

At the top of `src-tauri/src/file_analysis/ffmpeg/decode.rs`:

```rust
/// Build the ffmpeg argument vector that decodes one audio track to interleaved f32le on stdout.
/// `track_index` is the absolute ffprobe stream index. Sample rate / channels are forced to the
/// source values so metering sees the native stream (no resample, no downmix).
pub fn build_decode_args(
  path: &str,
  track_index: u32,
  channels: u16,
  sample_rate: u32,
) -> Vec<String> {
  vec![
    "-nostdin".into(),
    "-loglevel".into(),
    "error".into(),
    "-progress".into(),
    "pipe:2".into(),
    "-i".into(),
    path.into(),
    "-map".into(),
    format!("0:{track_index}"),
    "-vn".into(),
    "-ac".into(),
    channels.to_string(),
    "-ar".into(),
    sample_rate.to_string(),
    "-f".into(),
    "f32le".into(),
    "pipe:1".into(),
  ]
}

/// Parse a single `-progress` line, returning decoded media time in microseconds for `out_time_us`.
/// Other keys (including the misleadingly-named `out_time_ms`) return `None`.
pub fn parse_out_time_us(line: &str) -> Option<u64> {
  line.trim().strip_prefix("out_time_us=")?.parse().ok()
}

/// Convert a little-endian f32 byte slice to samples, dropping any trailing partial sample. The
/// caller is responsible for carrying the remainder bytes (`len % 4`) into the next read.
pub fn bytes_to_f32_le(bytes: &[u8]) -> Vec<f32> {
  bytes
    .chunks_exact(4)
    .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
    .collect()
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test -p plvs file_analysis::ffmpeg::decode`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/file_analysis/ffmpeg/decode.rs
git commit -m "feat: add ffmpeg decode arg builder and pcm/progress parsers"
```

---

## Task 3: Build the trimmed sidecar binaries (manual, Windows)

**Files:**
- Create: `src-tauri/binaries/` (holds untracked binaries)
- Create/Modify: `src-tauri/binaries/.gitignore`
- Create: `docs/ffmpeg-sidecar-build.md`

> This task produces `ffmpeg.exe` + `ffprobe.exe`. It is a one-time manual environment step (MSYS2 + MinGW64). The implementer is authorized to install MSYS2 and compile without prompting the user.

- [ ] **Step 1: Add the gitignore so binaries never enter git**

Create `src-tauri/binaries/.gitignore`:

```gitignore
# Sidecar binaries are produced out-of-band (see docs/ffmpeg-sidecar-build.md) and hosted as
# GitHub Release assets, never committed.
*
!.gitignore
```

- [ ] **Step 2: Build trimmed ffmpeg + ffprobe** (in the MSYS2 MINGW64 shell)

```bash
pacman -Syu
pacman -S --needed base-devel mingw-w64-x86_64-toolchain \
  mingw-w64-x86_64-yasm nasm git make pkgconf diffutils
git clone --branch n7.1 --depth 1 https://git.ffmpeg.org/ffmpeg.git
cd ffmpeg
./configure \
  --disable-everything --disable-gpl --disable-nonfree \
  --disable-doc --disable-avdevice --disable-postproc --disable-swscale \
  --disable-network --disable-encoders --disable-muxers --disable-filters \
  --enable-small --enable-static --disable-shared --extra-ldflags=-static \
  --enable-ffmpeg --enable-ffprobe \
  --enable-filter=aresample --enable-protocol=file \
  --enable-demuxer=mov,matroska,wav,aiff,flac,mp3,ogg,aac,ac3,eac3,dts,w64 \
  --enable-decoder=aac,aac_latm,ac3,eac3,dca,opus,vorbis,flac,mp3,alac,pcm_s16le,pcm_s24le,pcm_s32le,pcm_f32le,pcm_f64le,pcm_u8
make -j$(nproc)
strip ffmpeg.exe ffprobe.exe
```

Verify the configure summary lists `ac3`, `eac3`, `dca`, `opus` decoders before running `make`.

- [ ] **Step 3: Place binaries with the Tauri sidecar naming**

Determine the Rust host triple: `rustc -vV` → read the `host:` line (expected `x86_64-pc-windows-msvc`). Copy and rename:

```bash
cp ffmpeg.exe  src-tauri/binaries/ffmpeg-x86_64-pc-windows-msvc.exe
cp ffprobe.exe src-tauri/binaries/ffprobe-x86_64-pc-windows-msvc.exe
```

- [ ] **Step 4: Smoke-test the binaries**

```bash
src-tauri/binaries/ffprobe-x86_64-pc-windows-msvc.exe -version
# On any AC-3 video sample:
src-tauri/binaries/ffmpeg-x86_64-pc-windows-msvc.exe -nostdin -loglevel error -i SAMPLE.mkv -map 0:a:0 -vn -f f32le pipe:1 > /dev/null && echo OK
```

Expected: `-version` prints; the decode prints `OK` with no codec error.

- [ ] **Step 5: Document the process**

Create `docs/ffmpeg-sidecar-build.md` capturing the configure command, the host-triple naming rule, the LGPL flags rationale, and the "upload as GitHub Release asset" note. Then commit the docs + gitignore (binaries stay untracked):

```bash
git add src-tauri/binaries/.gitignore docs/ffmpeg-sidecar-build.md
git commit -m "docs: document trimmed ffmpeg sidecar build and ignore binaries"
```

---

## Task 4: Sidecar locator

**Files:**
- Create: `src-tauri/src/file_analysis/ffmpeg/locate.rs`

- [ ] **Step 1: Write the failing test**

In `src-tauri/src/file_analysis/ffmpeg/locate.rs`:

```rust
#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn binary_name_has_platform_suffix() {
    let name = sidecar_binary_name("ffmpeg");
    #[cfg(windows)]
    assert_eq!(name, "ffmpeg.exe");
    #[cfg(not(windows))]
    assert_eq!(name, "ffmpeg");
  }

  #[test]
  fn env_override_takes_precedence() {
    std::env::set_var("PLVS_FFMPEG_DIR", "/custom/dir");
    let path = locate_sidecar("ffmpeg");
    assert!(path.ends_with(sidecar_binary_name("ffmpeg")));
    assert!(path.to_string_lossy().contains("custom"));
    std::env::remove_var("PLVS_FFMPEG_DIR");
  }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p plvs file_analysis::ffmpeg::locate`
Expected: FAIL — functions not found.

- [ ] **Step 3: Write minimal implementation**

```rust
use std::path::PathBuf;

/// Platform-correct on-disk name for a bundled sidecar (Tauri strips the target triple at bundle
/// time, leaving e.g. `ffmpeg.exe`).
pub fn sidecar_binary_name(stem: &str) -> String {
  #[cfg(windows)]
  {
    format!("{stem}.exe")
  }
  #[cfg(not(windows))]
  {
    stem.to_string()
  }
}

/// Resolve a sidecar binary path. `PLVS_FFMPEG_DIR` (dev/test escape hatch) wins; otherwise the
/// binary is expected next to the running executable, where Tauri places externalBin sidecars.
pub fn locate_sidecar(stem: &str) -> PathBuf {
  let name = sidecar_binary_name(stem);
  if let Ok(dir) = std::env::var("PLVS_FFMPEG_DIR") {
    return PathBuf::from(dir).join(name);
  }
  let base = std::env::current_exe()
    .ok()
    .and_then(|p| p.parent().map(|d| d.to_path_buf()))
    .unwrap_or_else(|| PathBuf::from("."));
  base.join(name)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test -p plvs file_analysis::ffmpeg::locate`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/file_analysis/ffmpeg/locate.rs
git commit -m "feat: resolve ffmpeg sidecar binary path"
```

---

## Task 5: Rewrite probe to call ffprobe

**Files:**
- Rewrite: `src-tauri/src/file_analysis/probe.rs`

- [ ] **Step 1: Replace the file body**

Replace the entire contents of `src-tauri/src/file_analysis/probe.rs` with:

```rust
use std::path::Path;
use std::process::Command;

use crate::file_analysis::ffmpeg::locate::locate_sidecar;
use crate::file_analysis::ffmpeg::probe::parse_ffprobe_json;
use crate::ipc::types::FileAnalysisProbeResult;

fn file_name_from_path(path: &Path) -> String {
  path
    .file_name()
    .and_then(|name| name.to_str())
    .unwrap_or("Untitled media")
    .to_string()
}

pub fn probe_file(path: impl AsRef<Path>) -> Result<FileAnalysisProbeResult, String> {
  let path = path.as_ref();
  let path_str = path.to_string_lossy().to_string();
  let ffprobe = locate_sidecar("ffprobe");

  let output = Command::new(&ffprobe)
    .args([
      "-v",
      "quiet",
      "-print_format",
      "json",
      "-show_streams",
      "-show_format",
    ])
    .arg(&path_str)
    .output()
    .map_err(|err| format!("FFmpeg component missing or unrunnable: {err}"))?;

  if !output.status.success() {
    return Err("Unsupported or unreadable media file".to_string());
  }

  let json = String::from_utf8_lossy(&output.stdout);
  parse_ffprobe_json(&json, &path_str, &file_name_from_path(path))
}
```

> All symphonia-era helpers (`select_first_decodable_track`, `track_candidate_from_symphonia`, `duration_ms_from_symphonia`, `hint_from_path`, `duration_ms_from_frames`) are removed here. Their last consumer, `session.rs`, is rewritten in Task 6.

- [ ] **Step 2: Verify it compiles in isolation is not possible yet** (session.rs still imports removed helpers). Proceed to Task 6; the build is checked at the end of Task 6.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/file_analysis/probe.rs
git commit -m "refactor: probe metadata via ffprobe sidecar"
```

---

## Task 6: Rewrite session to drive ffmpeg

**Files:**
- Rewrite: `src-tauri/src/file_analysis/session.rs` (the `analyze_file_core` function and its symphonia imports/helpers)
- Modify: `src-tauri/src/file_analysis/mod.rs` (drop `pub mod decode;`)
- Delete: `src-tauri/src/file_analysis/decode.rs`

- [ ] **Step 1: Delete the old symphonia interleave module**

```bash
git rm src-tauri/src/file_analysis/decode.rs
```

In `src-tauri/src/file_analysis/mod.rs` remove the `decode` line:

```rust
pub mod ffmpeg;
pub mod probe;
pub mod session;
```

- [ ] **Step 2: Replace imports and `analyze_file_core` in `session.rs`**

Replace the top-of-file `use` block (lines importing symphonia + the old decode/probe helpers) with:

```rust
use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::mpsc::{self, Receiver, Sender};
use std::thread::{self, JoinHandle};

use tauri::{AppHandle, Emitter, Manager};

use crate::engine::{ChannelLayoutSetting, MeterPipeline};
use crate::file_analysis::ffmpeg::decode::{build_decode_args, bytes_to_f32_le, parse_out_time_us};
use crate::file_analysis::ffmpeg::locate::locate_sidecar;
use crate::file_analysis::probe::probe_file;
use crate::ipc::types::{
  AnalysisRequests, AudioFramePayload, FileAnalysisCompletedPayload, FileAnalysisErrorPayload,
  FileAnalysisProgressPayload, FileAnalysisSummaryMetrics, FrameSubscribers,
};
```

Keep `WorkerConfig`, `snapshot_config`, `FileAnalysisSession`, `Drop`, and `send_frame` exactly as they are. Replace `analyze_file_core` with:

```rust
/// Decode `path` via the ffmpeg sidecar and feed PCM to the metering pipeline. Returns `Ok(None)`
/// when cancelled before completion, `Ok(Some((decoded_frames, summary)))` at end of stream.
fn analyze_file_core(
  path: &str,
  config: &WorkerConfig,
  mut on_frame: impl FnMut(AudioFramePayload) -> Result<(), String>,
  mut on_progress: impl FnMut(FileAnalysisProgressPayload),
  should_stop: impl Fn() -> bool,
) -> Result<Option<(u64, FileAnalysisSummaryMetrics)>, String> {
  let probe = probe_file(Path::new(path))?;
  let track = &probe.selected_track;
  let sample_rate = track
    .sample_rate_hz
    .ok_or_else(|| "Selected audio track has no sample rate".to_string())?;
  let channels = track
    .channels
    .ok_or_else(|| "Selected audio track has no channel count".to_string())?;
  let duration_ms = probe.duration_ms;

  let ffmpeg = locate_sidecar("ffmpeg");
  let args = build_decode_args(path, track.index, channels, sample_rate);
  let mut child = Command::new(&ffmpeg)
    .args(&args)
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .stdin(Stdio::null())
    .spawn()
    .map_err(|err| format!("FFmpeg component missing or unrunnable: {err}"))?;

  let mut stdout = child.stdout.take().ok_or("ffmpeg stdout unavailable")?;
  let stderr = child.stderr.take().ok_or("ffmpeg stderr unavailable")?;

  // Progress: a reader thread parses `-progress` lines (out_time_us) off stderr and posts the
  // latest media-time microseconds. The main loop reads it without blocking decode.
  let latest_us = std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0));
  let progress_us = latest_us.clone();
  let stderr_thread = thread::spawn(move || {
    use std::io::BufRead;
    let reader = std::io::BufReader::new(stderr);
    for line in reader.lines().map_while(Result::ok) {
      if let Some(us) = parse_out_time_us(&line) {
        progress_us.store(us, std::sync::atomic::Ordering::Relaxed);
      }
    }
  });

  let mut pipeline = MeterPipeline::new_for_file(sample_rate, channels);
  let mut decoded_frames = 0_u64;
  let mut last_progress_emit_frames = 0_u64;
  let mut carry: Vec<u8> = Vec::new();
  let mut read_buf = [0_u8; 64 * 1024];

  loop {
    if should_stop() {
      let _ = child.kill();
      let _ = child.wait();
      let _ = stderr_thread.join();
      return Ok(None);
    }
    let n = stdout
      .read(&mut read_buf)
      .map_err(|err| format!("Unable to read decoded audio: {err}"))?;
    if n == 0 {
      break;
    }

    // Stitch any byte that straddles two reads onto the front of this chunk.
    carry.extend_from_slice(&read_buf[..n]);
    let usable = carry.len() - (carry.len() % 4);
    let pcm = bytes_to_f32_le(&carry[..usable]);
    carry.drain(..usable);
    if pcm.is_empty() {
      continue;
    }

    decoded_frames += (pcm.len() / channels.max(1) as usize) as u64;
    let media_time_ms = ((decoded_frames as f64 / sample_rate as f64) * 1000.0).round() as u64;
    if let Some(frame) = pipeline.push_pcm_f32_with_requests_at_media_time(
      &pcm,
      ChannelLayoutSetting::Auto,
      &config.requests,
      config.loudness_weights.clone(),
      config.dialogue_gating,
      media_time_ms,
    ) {
      on_frame(frame)?;
    }

    if decoded_frames - last_progress_emit_frames >= sample_rate as u64 {
      last_progress_emit_frames = decoded_frames;
      let out_us = latest_us.load(std::sync::atomic::Ordering::Relaxed);
      let progress = duration_ms
        .filter(|d| *d > 0)
        .map(|d| ((out_us as f64 / 1000.0) / d as f64).clamp(0.0, 1.0));
      on_progress(FileAnalysisProgressPayload {
        path: path.to_string(),
        decoded_frames,
        total_frames: None,
        progress,
      });
    }
  }

  let status = child
    .wait()
    .map_err(|err| format!("ffmpeg did not exit cleanly: {err}"))?;
  let _ = stderr_thread.join();
  if !status.success() {
    return Err("ffmpeg failed to decode the audio track".to_string());
  }

  if let Some(frame) = pipeline.flush_file_batch(&config.requests) {
    on_frame(frame)?;
  }

  let metrics = pipeline.summary_metrics();
  let summary = FileAnalysisSummaryMetrics {
    duration_ms,
    sample_rate_hz: sample_rate,
    channels,
    integrated_lufs: metrics.integrated_lufs,
    lra: metrics.lra,
    true_peak_max_dbtp: metrics.true_peak_max_dbtp,
    sample_peak_max_l_db: metrics.sample_peak_max_l_db,
    sample_peak_max_r_db: metrics.sample_peak_max_r_db,
    dialogue_integrated: metrics.dialogue_integrated,
  };
  Ok(Some((decoded_frames, summary)))
}
```

- [ ] **Step 3: Update the WAV-fixture tests in `session.rs`**

The existing `#[cfg(test)] mod tests` writes a real WAV and calls `analyze_file_core`. That path now requires the `ffmpeg` sidecar at runtime, so these become integration tests. Gate them behind the sidecar's presence so `cargo test` stays green without the binary:

At the start of each of the three tests (`analyzes_wav_fixture_end_to_end`, `cancellation_returns_without_summary`, `missing_file_reports_visible_error`), add an early skip:

```rust
    if crate::file_analysis::ffmpeg::locate::locate_sidecar("ffmpeg").exists() == false {
      eprintln!("skipping: ffmpeg sidecar not present");
      return;
    }
```

For `missing_file_reports_visible_error`, change the expected substring to match the new error path:

```rust
    assert!(
      err.contains("Unsupported or unreadable media file") || err.contains("No audio track"),
      "got: {err}"
    );
```

- [ ] **Step 4: Build and run the Rust suite**

Run: `cargo build -p plvs` then `cargo test -p plvs file_analysis`
Expected: compiles clean; ffmpeg-dependent tests skip (or pass if you set `PLVS_FFMPEG_DIR` to `src-tauri/binaries` and rename without the triple suffix for local runs).

- [ ] **Step 5: Manual end-to-end verification** (requires Task 3 binaries)

With `cargo tauri dev`, drag in real samples covering each codec and confirm a summary is produced (no "No decodable track" / codec errors):

| Codec | Container | Expect |
|---|---|---|
| AC-3 | .mkv | summary metrics shown |
| E-AC-3 | .mp4 | summary metrics shown |
| DTS | .mkv | summary metrics shown |
| Opus | .webm | summary metrics shown |
| HE-AAC | .m4a/.mp4 | summary metrics shown |
| AAC-LC | .mp4 | matches pre-change behavior |
| PCM | .wav | matches pre-change behavior |

Also confirm: progress bar advances; cancel (stop) ends without a summary; a renamed non-media file shows a visible error.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/file_analysis/session.rs src-tauri/src/file_analysis/mod.rs
git commit -m "feat: decode file audio through the ffmpeg sidecar"
```

---

## Task 7: Remove the Symphonia dependency

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Delete the symphonia line**

Remove from `src-tauri/Cargo.toml`:

```toml
symphonia = { version = "0.5.5", features = ["aac", "alac", "flac", "isomp4", "mp3", "vorbis", "aiff", "wav", "mkv"] }
```

- [ ] **Step 2: Regenerate the lockfile and verify no symphonia references remain**

Run: `cargo build -p plvs`
Run: `grep -ri symphonia src-tauri/src`
Expected: build succeeds; grep returns nothing.

- [ ] **Step 3: Run the full Rust gate**

Run: `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check`
Run: `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "chore: drop symphonia, file decode now goes through ffmpeg"
```

---

## Task 8: Bundle the sidecars

**Files:**
- Modify: `src-tauri/tauri.conf.json`
- Modify: `src-tauri/capabilities/default.json`

- [ ] **Step 1: Declare the externalBin in `tauri.conf.json`**

In the `bundle` object add (path is the stem; Tauri appends the target triple to find the file, strips it on install):

```json
  "bundle": {
    "active": true,
    "targets": "all",
    "externalBin": [
      "binaries/ffmpeg",
      "binaries/ffprobe"
    ],
    "macOS": {
      "minimumSystemVersion": "14.2"
    },
```

- [ ] **Step 2: Verify the capability**

`std::process::Command` spawning a path next to the executable does not require the Tauri shell plugin, so no `shell:allow-execute` scope is needed. Confirm `src-tauri/capabilities/default.json` is unchanged unless a build error indicates otherwise. (If a future switch to the shell-plugin sidecar API is made, add its permission here — out of scope now.)

- [ ] **Step 3: Build the bundle to confirm sidecars are picked up**

Run: `npm run tauri build -- --no-bundle` (or a full `tauri build`)
Expected: build finds `binaries/ffmpeg-x86_64-pc-windows-msvc.exe` and `binaries/ffprobe-...exe`; no "external binary not found" error.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/tauri.conf.json
git commit -m "build: bundle ffmpeg and ffprobe sidecars"
```

---

## Task 9: Widen the file dialog extensions

**Files:**
- Modify: `src/ipc/fileDialog.js`
- Test: `src/ipc/fileDialog.test.js` (create if absent)

- [ ] **Step 1: Write the failing test**

Create `src/ipc/fileDialog.test.js`:

```js
import { describe, expect, it } from "vitest";
import { MEDIA_EXTENSIONS } from "./fileDialog.js";

describe("MEDIA_EXTENSIONS", () => {
  it("includes QuickTime and common video containers", () => {
    for (const ext of ["mov", "wav", "mp4", "mkv", "webm", "avi", "ts", "m4a", "aac"]) {
      expect(MEDIA_EXTENSIONS).toContain(ext);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/ipc/fileDialog.test.js`
Expected: FAIL — `MEDIA_EXTENSIONS` not exported / missing `mov`.

- [ ] **Step 3: Export and widen the list**

In `src/ipc/fileDialog.js` change line 3 to export and extend:

```js
export const MEDIA_EXTENSIONS = [
  "wav", "aiff", "aif", "flac", "mp3", "m4a", "aac", "ogg", "opus",
  "mp4", "m4v", "mov", "mkv", "webm", "avi", "ts", "m2ts", "wmv",
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/ipc/fileDialog.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ipc/fileDialog.js src/ipc/fileDialog.test.js
git commit -m "feat: accept mov and more video containers in file picker"
```

---

## Task 10: Full verification and licensing note

**Files:**
- Modify: wherever the About/licenses text lives (locate via `grep -ri "MIT" src` / about dialog) — add FFmpeg LGPL attribution.

- [ ] **Step 1: Run the project gate**

Run: `npm run check`
Expected: format + lint + test + build + version + Rust fmt/clippy/test all pass. (ffmpeg-dependent Rust tests skip without the binary; the manual matrix in Task 6 Step 5 covers real decode.)

- [ ] **Step 2: Add FFmpeg LGPL attribution**

FFmpeg is LGPL; redistribution requires attribution and a pointer to source. Locate the About / licenses surface and add a line crediting "This software uses libraries from the FFmpeg project under the LGPLv2.1" with a link to the FFmpeg source. If no such surface exists, add the notice to `docs/ffmpeg-sidecar-build.md` and the app's NOTICE/README and flag to the user that a UI attribution may be wanted.

- [ ] **Step 3: Manual acceptance matrix**

Re-run the Task 6 Step 5 codec matrix end-to-end in `cargo tauri dev` and record pass/fail. All seven rows must pass.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs: add ffmpeg LGPL attribution"
```

---

## Self-Review Notes

- **Spec coverage:** §3 (sidecar + remove symphonia + trimmed build, Windows-only) → Tasks 3,6,7,8. §4.2 module boundaries → Tasks 1,2,4,5,6. §4.3 ffprobe → Tasks 1,5. §4.4 no resample → Task 2 (`build_decode_args` forces source `-ar/-ac`). §4.5 progress (time-based, payload unchanged) → Task 6. §4.6 lifecycle/cancel/missing-binary errors → Tasks 5,6. §5 packaging/licensing → Tasks 3,8,10. §6 tests → Tasks 1,2,4,9. `.mov` bug → Task 9.
- **PCM out-of-band reuse hook (spec §4.2):** the decode loop's `pcm` slice is the single PCM egress point; a future audio-playback phase taps the same slice. No extra interface built now (YAGNI).
- **Type consistency:** `parse_ffprobe_json`, `build_decode_args`, `parse_out_time_us`, `bytes_to_f32_le`, `locate_sidecar`, `sidecar_binary_name` are referenced with identical signatures across Tasks 1–6. `FileAnalysisProgressPayload` fields match `ipc/types.rs` (`decoded_frames`, `total_frames`, `progress`).
- **Deferred:** macOS/Linux binaries, CI auto-build, audio/video playback — out of scope per spec §9.
