# Multichannel Support — Design Spec

**Date:** 2026-06-03  
**Scope:** Direction B — macOS peak bug fix + 7.1 preset + Peak meter UI improvements  
**Out of scope:** Platform-level channel role auto-detection (Direction C), Quad/7.1.4 presets, ITU 7.1 loudness weighting

---

## Background

PLVS supports multichannel audio (5.1, 7.1) on Windows via WASAPI with no known issues. On macOS, user reports indicate that the Peak meter breaks for multichannel devices. Other panels (Loudness, Spectrum, Vectorscope) appear unaffected. The root cause is a format mismatch in the macOS Core Audio tap path.

---

## Root Cause: macOS Non-Interleaved Format

Windows (WASAPI) always delivers interleaved PCM — all channels packed into one contiguous buffer per callback:

```
[FL₁ FR₁ C₁ LFE₁ SL₁ SR₁ | FL₂ FR₂ C₂ LFE₂ SL₂ SR₂ | ...]
```

macOS Core Audio IOProc callbacks can deliver non-interleaved PCM — one `AudioBuffer` per channel:

```
Buffer 0: [FL₁ FL₂ FL₃ ...]
Buffer 1: [FR₁ FR₂ FR₃ ...]
...
Buffer 5: [SR₁ SR₂ SR₃ ...]
```

Current `tap_io_proc` in `tap_bridge.m` loops over `inInputData->mNumberBuffers` and calls `pcm_bridge` once per buffer. For a 5.1 non-interleaved stream this produces 6 separate calls, each with `channels=1`.

`MeterPipeline` is initialized with `self.channels=6` (from cpal device enumeration). When it receives a 1-channel buffer and calls `sample_peak_db_per_channel_interleaved(data, 6)`, it computes `frames = data.len() / 6` — a fraction of the real frame count — and reads sample positions that don't correspond to actual channel boundaries. The resulting `peak_db` Vec has 6 entries of garbage or −∞, causing the Peak meter to show empty bars with no values.

Other DSP paths (Loudness, Spectrum, Vectorscope) are less sensitive to this misinterpretation and produce plausible-looking output, so the bug appears isolated to Peak.

---

## Module 1: tap_bridge.m — Non-Interleaved Fix

**File:** `src-tauri/native/macos/tap_bridge.m`

### Change

Add a pre-allocated scratch buffer to `TapHandle`:

```c
typedef struct {
  AudioObjectID tap_id;
  AudioObjectID aggregate_id;
  AudioDeviceIOProcID io_proc_id;
  void *pcm_userdata;
  float *interleave_buf;        // new
  size_t interleave_buf_frames; // new: capacity in frames
  uint32_t interleave_buf_ch;   // new: channel count scratch was sized for
} TapHandle;
```

Allocate in `macos_tap_create` before registering the IOProc:

- Size: `2048 frames × 16 channels = 32768 floats` (~128 KB)
- Free in `macos_tap_destroy`

In `tap_io_proc`, replace the current per-buffer loop with a branching strategy:

**Single buffer** (`mNumberBuffers == 1`): existing behaviour, call `pcm_bridge` directly — no allocation, no copy.

**Multiple buffers** (`mNumberBuffers > 1`): interleave all channel buffers into the scratch buffer, then call `pcm_bridge` once with `channels = total_ch`. If actual frame count × total channels exceeds scratch capacity, skip the callback and log a warning — no malloc on the audio thread.

Channel ordering follows `AudioBufferList` buffer order, which Core Audio guarantees matches the device's channel order.

### Why this works

After the fix, the Rust side always receives one interleaved call per hardware callback period, with the correct channel count. `MeterPipeline`, `PcmBufferPool`, and all DSP paths require no changes.

---

## Module 2: 7.1 ChannelLayoutSetting

**File:** `src-tauri/src/engine/channel_layout.rs`

Add `Surround71` variant:

```rust
Surround71,  // FL FR C LFE BL BR SL SR  (ITU-R BS.1770 8-channel order)
```

- `serde` rename: `"7.1"`
- `from_str_lossy`: parse `"7.1"`, `"7_1"`, `"surround71"`, `"surround-7.1"`
- `as_str`: returns `"7.1"`

**File:** `src-tauri/src/engine/meter_pipeline.rs` — `loudness_layout_meta`

```
Surround71 + ch >= 8  →  ("7.1", true)
Surround71 + ch < 8   →  ("stereo", false)   // same downgrade pattern as 5.1
```

**Loudness weighting for 7.1:** Deferred. ITU BS.1770 does not define a standard 7.1 weighting table that is universally agreed upon. For now, the loudness meter marks 7.1 the same way as stereo/5.1 structurally but the weighting is not guaranteed to be broadcast-accurate. This is a separate DSP task.

---

## Module 3: Channel Label Metadata

No new IPC field is needed. The existing `loudness_layout` string (`"stereo"`, `"5.1"`, `"unknown"`) already flows from backend to frontend. Extending it to emit `"7.1"` (Module 2) is sufficient.

**File:** `src/math/channelLayoutResolver.js`

- Add `"7.1"` to `ChannelLayoutSetting` and `ResolvedChannelLayout` typedefs
- Add case: `if (s === "7.1") return { mode: "manual", setting: "7.1", resolved: "7.1" }`

**File:** `src/math/peakMeterChannelLabels.js`

`surround71` is already defined:
```js
surround71: { id: "surround71", channels: 8, labels: ["L", "R", "C", "LFE", "Ls", "Rs", "Lb", "Rb"] }
```
No changes needed here.

**File:** `src/math/getPeakMeterChannelLabels` (in `peakMeterChannelLabels.js`)

Add an early exit when layout is unknown — **before** the exact-count matching step:

```js
if (ctx.resolvedLayout === "unknown") {
  return Array.from({ length: n }, (_, i) => `Ch ${i + 1}`);
}
```

**Why:** Without this, a 6-channel stream in Auto mode falls through to `labelsForExactChannelCount`, matches `surround51`, and displays ITU names even though the channel assignment is unverified. Per design decision: Auto mode shows numbered labels only.

### Label resolution summary

| Layout setting | Actual ch | Resolved layout | Labels shown |
|---|---|---|---|
| Auto | 2 | unknown | Ch 1, Ch 2 *(falls back to L/R via `sampleL`/`sampleR`)* |
| Auto | 6 | unknown | Ch 1 … Ch 6 |
| Auto | 8 | unknown | Ch 1 … Ch 8 |
| Stereo | any | stereo | L, R |
| 5.1 | ≥6 | 5.1 | L, R, C, LFE, Ls, Rs |
| 5.1 | <6 | stereo (downgraded) | Ch 1 … Ch N |
| 7.1 | ≥8 | 7.1 | L, R, C, LFE, Ls, Rs, Lb, Rb |
| 7.1 | <8 | stereo (downgraded) | Ch 1 … Ch N |

---

## Module 4: Peak Meter UI

### 16-channel cap

**File:** `src/math/peakChannelMath.js`

```js
const peakDb = Array.isArray(displayAudio?.peakDb)
  ? displayAudio.peakDb.slice(0, 16)
  : null;
```

Applied before label derivation and channel mapping. Channels beyond index 15 are silently dropped. No UI indication needed — 16+ channel setups are outside PLVS's target use case.

### Equal-width bar layout

`PeakPanel.jsx` already uses `grid-cols-[repeat(auto-fit,minmax(0,1fr))]`. N bars automatically share available width equally. No CSS changes needed.

### Auto mode footer prompt

**File:** `src/App.jsx` — inside `<footer>`

Condition: `layoutResolution.resolved === "unknown" && channelCount > 2`

Both values are already available in `App.jsx` scope. When the condition is true, append a new segment to the footer row after the existing Ref divider:

```
Device  [name]  |  Ref  [X LUFS]  |  Multichannel detected (N ch) · Select layout in Settings
```

Where `N = channelCount`. Styling matches the existing footer: 10px, `text-muted-foreground/60` label + truncated value. The prompt disappears automatically when the user selects a layout in Settings (resolvedLayout becomes `"stereo"`, `"5.1"`, or `"7.1"`).

---

## Formats explicitly NOT added

| Format | Reason |
|---|---|
| Quad (4 ch) | Rarely used in modern production; Auto + "Ch 1–4" is sufficient |
| 7.1.4 / Atmos (12 ch) | No standardized channel order across DAWs/renderers; ITU has no weighting; labeled as Auto |
| Anything beyond 8 ch | Handled by the 16-ch cap + numbered labels |

---

## Files Changed

| File | Change |
|---|---|
| `src-tauri/native/macos/tap_bridge.m` | Non-interleaved → interleaved fix in `tap_io_proc`; scratch buffer in `TapHandle` |
| `src-tauri/src/engine/channel_layout.rs` | Add `Surround71` variant |
| `src-tauri/src/engine/meter_pipeline.rs` | `loudness_layout_meta` handles `"7.1"` |
| `src/math/channelLayoutResolver.js` | Add `"7.1"` setting and resolved layout |
| `src/math/peakMeterChannelLabels.js` | Add `resolvedLayout === "unknown"` early exit in `getPeakMeterChannelLabels` |
| `src/math/peakChannelMath.js` | Slice `peakDb` to 16 before use |
| `src/App.jsx` | Footer: conditional multichannel prompt |

`PeakPanel.jsx`, `AudioFramePayload` (Rust IPC types), `peakMeterChannelLabels.js` format definitions — **no changes.**
