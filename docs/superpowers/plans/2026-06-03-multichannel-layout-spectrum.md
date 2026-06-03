# Multichannel Layout Detection & Spectrum Channel Selection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement correct multichannel layout auto-detection, user-facing mismatch notifications, proper 7.1 loudness measurement, and per-channel-pair spectrum analysis selection.

**Architecture:** Two independent subsystems shipped together. Part A (Tasks 1–5) wires auto-detection through `channelLayoutResolver.js` → `App.jsx` → `loudness_layout_meta` → `LoudnessMeter`. Part B (Tasks 6–12) adds a `SpectrumChannelSel` type that travels from frontend settings through a new IPC command to `SpectrumMeter.push_selected`.

**Tech Stack:** React + Vite (frontend), Rust/Tauri (backend), Vitest (JS tests), `cargo test` (Rust tests).

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/math/channelLayoutResolver.js` | Modify | Auto-detect mono/stereo/5.1/7.1 from channelCount |
| `src/math/channelLayoutResolver.test.js` | Modify | Tests for auto-detection |
| `src/App.jsx` | Modify | Unified mismatch notification; spectrum channel state |
| `src/math/spectrumChannelOptions.js` | **Create** | Build spectrum selector option list |
| `src/math/spectrumChannelOptions.test.js` | **Create** | Tests for option builder |
| `src/components/SettingsPanel.jsx` | Modify | Spectrum channel selector UI |
| `src/components/SettingsPanel.test.jsx` | Modify | Update prop snapshot |
| `src/ipc/commands.js` | Modify | Add `setSpectrumChannel` IPC wrapper |
| `src-tauri/src/dsp/spectrum.rs` | Modify | Replace power-sum with `push_selected(sel)` |
| `src-tauri/src/dsp/meter.rs` | Modify | Add `spectrum_channel: SpectrumChannelSel` to `PcmContext` |
| `src-tauri/src/state.rs` | Modify | Add `spectrum_channel: Arc<Mutex<SpectrumChannelSel>>` |
| `src-tauri/src/engine/meter_pipeline.rs` | Modify | Resolve effective layout; pass spectrum_channel |
| `src-tauri/src/dsp/loudness.rs` | Modify | Add 7.1 BS.1770 path |
| `src-tauri/src/ipc/commands.rs` | Modify | Add `set_spectrum_channel` Tauri command |

---

## Part A — Layout Detection & Notifications

---

### Task 1: Frontend auto-detection in `channelLayoutResolver.js`

**Files:**
- Modify: `src/math/channelLayoutResolver.js`
- Modify: `src/math/channelLayoutResolver.test.js`

- [ ] **Step 1: Write failing tests for the new auto-detection cases**

Replace the existing auto-mode test in `src/math/channelLayoutResolver.test.js` with:

```js
import { describe, expect, it } from "vitest";
import { resolveChannelLayout } from "./channelLayoutResolver.js";

describe("resolveChannelLayout", () => {
  // --- manual presets (unchanged) ---
  it("resolves manual stereo preset", () => {
    expect(resolveChannelLayout("stereo")).toEqual({
      mode: "manual", setting: "stereo", resolved: "stereo",
    });
  });
  it("resolves manual 5.1 preset", () => {
    expect(resolveChannelLayout("5.1")).toEqual({
      mode: "manual", setting: "5.1", resolved: "5.1",
    });
  });
  it("resolves manual 7.1 preset", () => {
    expect(resolveChannelLayout("7.1")).toEqual({
      mode: "manual", setting: "7.1", resolved: "7.1",
    });
  });
  it("treats invalid setting as auto", () => {
    // @ts-expect-error - runtime safety test
    expect(resolveChannelLayout("quad")).toEqual({
      mode: "auto", setting: "auto", resolved: "unknown",
    });
  });

  // --- auto-detection ---
  it("auto: 1ch → mono", () => {
    expect(resolveChannelLayout("auto", { channelCount: 1 })).toEqual({
      mode: "auto", setting: "auto", resolved: "mono",
    });
  });
  it("auto: 2ch → stereo", () => {
    expect(resolveChannelLayout("auto", { channelCount: 2 })).toEqual({
      mode: "auto", setting: "auto", resolved: "stereo",
    });
  });
  it("auto: 6ch → 5.1", () => {
    expect(resolveChannelLayout("auto", { channelCount: 6 })).toEqual({
      mode: "auto", setting: "auto", resolved: "5.1",
    });
  });
  it("auto: 8ch → 7.1", () => {
    expect(resolveChannelLayout("auto", { channelCount: 8 })).toEqual({
      mode: "auto", setting: "auto", resolved: "7.1",
    });
  });
  it("auto: 0ch (not running) → unknown", () => {
    expect(resolveChannelLayout("auto", { channelCount: 0 })).toEqual({
      mode: "auto", setting: "auto", resolved: "unknown",
    });
  });
  it("auto: 3ch → unknown", () => {
    expect(resolveChannelLayout("auto", { channelCount: 3 })).toEqual({
      mode: "auto", setting: "auto", resolved: "unknown",
    });
  });
  it("auto: 5ch → unknown", () => {
    expect(resolveChannelLayout("auto", { channelCount: 5 })).toEqual({
      mode: "auto", setting: "auto", resolved: "unknown",
    });
  });
  it("auto: 7ch → unknown", () => {
    expect(resolveChannelLayout("auto", { channelCount: 7 })).toEqual({
      mode: "auto", setting: "auto", resolved: "unknown",
    });
  });
  it("auto: no ctx → unknown", () => {
    expect(resolveChannelLayout("auto")).toEqual({
      mode: "auto", setting: "auto", resolved: "unknown",
    });
  });
});
```

- [ ] **Step 2: Run tests to confirm failures**

```
npm test -- channelLayoutResolver
```

Expected: new auto-detection tests FAIL with `resolved: "unknown"` instead of the expected value.

- [ ] **Step 3: Implement auto-detection in `channelLayoutResolver.js`**

Replace the entire file:

```js
/**
 * Single owner for deciding the effective channel layout.
 *
 * @typedef {"auto" | "stereo" | "5.1" | "7.1"} ChannelLayoutSetting
 * @typedef {"unknown" | "mono" | "stereo" | "5.1" | "7.1"} ResolvedChannelLayout
 *
 * @typedef {object} ChannelLayoutResolution
 * @property {"auto" | "manual"} mode
 * @property {ChannelLayoutSetting} setting
 * @property {ResolvedChannelLayout} resolved
 */

/**
 * @param {ChannelLayoutSetting} setting
 * @param {{ channelCount?: number | null | undefined } | undefined} ctx
 * @returns {ChannelLayoutResolution}
 */
export function resolveChannelLayout(setting, ctx) {
  const s =
    setting === "stereo" || setting === "5.1" || setting === "7.1" || setting === "auto"
      ? setting
      : "auto";

  if (s === "stereo") return { mode: "manual", setting: "stereo", resolved: "stereo" };
  if (s === "5.1")    return { mode: "manual", setting: "5.1",    resolved: "5.1" };
  if (s === "7.1")    return { mode: "manual", setting: "7.1",    resolved: "7.1" };

  // Auto mode: detect standard channel counts.
  const ch = Number.isFinite(ctx?.channelCount) ? Math.floor(Number(ctx.channelCount)) : 0;
  /** @type {ResolvedChannelLayout} */
  const resolved =
    ch === 1 ? "mono" :
    ch === 2 ? "stereo" :
    ch === 6 ? "5.1" :
    ch === 8 ? "7.1" :
    "unknown";
  return { mode: "auto", setting: "auto", resolved };
}
```

- [ ] **Step 4: Run tests to confirm all pass**

```
npm test -- channelLayoutResolver
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```
git add src/math/channelLayoutResolver.js src/math/channelLayoutResolver.test.js
git commit -m "feat(layout): auto-detect mono/stereo/5.1/7.1 from channel count"
```

---

### Task 2: Frontend notification logic in `App.jsx`

**Files:**
- Modify: `src/App.jsx` (lines ~731–738 for the notification block; lines ~235–238 for layoutResolution)

- [ ] **Step 1: Locate the notification block in `App.jsx`**

The current notification (around line 731) reads:

```jsx
{layoutResolution.resolved === "unknown" && channelCount > 2 && (
  <>
    <div className="mx-3.5 h-3 w-px shrink-0 bg-border" />
    <span className="min-w-0 truncate text-muted-foreground">
      Multichannel detected ({channelCount} ch) · Select layout in Settings
    </span>
  </>
)}
```

Replace it with:

```jsx
{(() => {
  // Auto mode: unknown channel count — user needs to pick a layout manually.
  if (channelLayout === "auto" && layoutResolution.resolved === "unknown" && channelCount > 0) {
    return (
      <>
        <div className="mx-3.5 h-3 w-px shrink-0 bg-border" />
        <span className="min-w-0 truncate text-muted-foreground">
          {channelCount}-channel detected · Select layout in Settings
        </span>
      </>
    );
  }
  // Manual mode: selection doesn't match what auto would detect.
  const autoResolved = resolveChannelLayout("auto", { channelCount }).resolved;
  if (channelLayout !== "auto" && channelLayout !== autoResolved) {
    return (
      <>
        <div className="mx-3.5 h-3 w-px shrink-0 bg-border" />
        <span className="min-w-0 truncate text-muted-foreground">
          Device is {autoResolved === "unknown" ? `${channelCount}-ch` : autoResolved} · selected {channelLayout}
        </span>
      </>
    );
  }
  return null;
})()}
```

- [ ] **Step 2: Verify `resolveChannelLayout` is already imported in `App.jsx`**

Search for the import near the top of `App.jsx`:
```
grep "resolveChannelLayout" src/App.jsx
```
It should already be imported. If not, add:
```js
import { resolveChannelLayout } from "./math/channelLayoutResolver.js";
```

- [ ] **Step 3: Manual smoke-test**

Run `npm run tauri dev` (or `npm run dev` for browser preview).

- With a stereo device, select "5.1" in Settings → notification appears: `"Device is stereo · selected 5.1"`
- With a stereo device, select "Auto" → no notification (auto resolves to stereo).
- With a multichannel device (3/5/7ch), select "Auto" → notification appears with channel count.

- [ ] **Step 4: Commit**

```
git add src/App.jsx
git commit -m "feat(layout): unified mismatch notification for manual layout selection"
```

---

### Task 3: Backend `loudness_layout_meta` — auto mode detects 5.1/7.1

**Files:**
- Modify: `src-tauri/src/engine/meter_pipeline.rs`

- [ ] **Step 1: Write a Rust test for the new auto-detection metadata**

In `meter_pipeline.rs`, find the `loudness_layout_meta` function. Add a `#[cfg(test)]` block **immediately after the function** (or append to any existing test block in the file):

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::ChannelLayoutSetting;

    #[test]
    fn auto_layout_meta_1ch_is_mono() {
        assert_eq!(loudness_layout_meta(1, ChannelLayoutSetting::Auto), ("mono".to_string(), true));
    }
    #[test]
    fn auto_layout_meta_2ch_is_stereo() {
        assert_eq!(loudness_layout_meta(2, ChannelLayoutSetting::Auto), ("stereo".to_string(), true));
    }
    #[test]
    fn auto_layout_meta_6ch_is_51() {
        assert_eq!(loudness_layout_meta(6, ChannelLayoutSetting::Auto), ("5.1".to_string(), true));
    }
    #[test]
    fn auto_layout_meta_8ch_is_71() {
        assert_eq!(loudness_layout_meta(8, ChannelLayoutSetting::Auto), ("7.1".to_string(), true));
    }
    #[test]
    fn auto_layout_meta_3ch_is_unknown() {
        assert_eq!(loudness_layout_meta(3, ChannelLayoutSetting::Auto), ("unknown".to_string(), false));
    }
    #[test]
    fn manual_71_on_6ch_falls_back() {
        assert_eq!(loudness_layout_meta(6, ChannelLayoutSetting::Surround71), ("stereo".to_string(), false));
    }
}
```

- [ ] **Step 2: Run tests to confirm failures**

```
npm run rust:test -- --test auto_layout_meta_1ch_is_mono 2>&1 | tail -20
```

Expected: `auto_layout_meta_6ch_is_51` and `auto_layout_meta_8ch_is_71` and `auto_layout_meta_1ch_is_mono` FAIL.

- [ ] **Step 3: Update `loudness_layout_meta` in `meter_pipeline.rs`**

Replace the `ChannelLayoutSetting::Auto` arm:

```rust
ChannelLayoutSetting::Auto => {
    match ch {
        1 => ("mono".to_string(),    true),
        2 => ("stereo".to_string(),  true),
        6 => ("5.1".to_string(),     true),
        8 => ("7.1".to_string(),     true),
        _ => ("unknown".to_string(), false),
    }
}
```

- [ ] **Step 4: Run tests to confirm all pass**

```
npm run rust:test
```

Expected: all tests in `meter_pipeline` PASS.

- [ ] **Step 5: Commit**

```
git add src-tauri/src/engine/meter_pipeline.rs
git commit -m "feat(backend): auto mode detects mono/5.1/7.1 in loudness_layout_meta"
```

---

### Task 4: Backend 7.1 BS.1770 loudness path in `loudness.rs`

**Files:**
- Modify: `src-tauri/src/dsp/loudness.rs`

- [ ] **Step 1: Write a Rust test for 7.1 loudness measurement**

Add to the existing `#[cfg(test)]` block in `loudness.rs`:

```rust
#[test]
fn surround71_lufs_uses_all_channels_except_lfe() {
    // 7.1: FL FR C LFE SL SR BL BR. LFE (ch index 3) should have 0 weight.
    // Put signal on every channel except LFE; verify measured loudness equals
    // what the same signal on a single 1.0-weighted stereo pair would give.
    let sr = 48000.0_f64;
    let frames = (sr * 0.4) as usize; // ~2 blocks
    let channels = 8_usize;
    let hz = 1000.0_f64;
    // Build 8-ch interleaved: tone on all channels
    let mut pcm = vec![0.0_f32; frames * channels];
    for i in 0..frames {
        let s = (2.0 * std::f64::consts::PI * hz * i as f64 / sr).sin() as f32;
        for ch in 0..channels {
            pcm[i * channels + ch] = s;
        }
    }
    // Measure 7.1
    let mut m71 = LoudnessMeter::new(sr);
    let b71 = m71.push_interleaved_multichannel(&pcm, 8, ChannelLayoutSetting::Surround71)
        .expect("should produce a block in 0.4s");

    // Measure stereo with same signal — 7 active channels (excl. LFE) all equal power,
    // so 7.1 result should be ~10*log10(7) ≈ 8.45 dB higher than a single-channel stereo reading.
    // We just verify it's finite and above the stereo reading.
    let mut mst = LoudnessMeter::new(sr);
    let stereo_pcm: Vec<f32> = (0..frames)
        .flat_map(|i| {
            let s = (2.0 * std::f64::consts::PI * hz * i as f64 / sr).sin() as f32;
            [s, s]
        })
        .collect();
    let bst = mst.push_interleaved(&stereo_pcm).expect("stereo block");

    assert!(b71.momentary.is_finite(), "7.1 momentary should be finite");
    assert!(
        b71.momentary > bst.momentary,
        "7.1 with 7 active channels should be louder than stereo: {} vs {}",
        b71.momentary,
        bst.momentary
    );
}

#[test]
fn surround71_lfe_has_zero_weight() {
    // LFE-only signal on a 7.1 device should read the same as silence.
    let sr = 48000.0_f64;
    let frames = (sr * 0.4) as usize;
    let channels = 8_usize;
    let mut pcm = vec![0.0_f32; frames * channels];
    // Put tone only on LFE (index 3)
    for i in 0..frames {
        let s = (2.0 * std::f64::consts::PI * 60.0 * i as f64 / sr).sin() as f32;
        pcm[i * channels + 3] = s;
    }
    let mut m = LoudnessMeter::new(sr);
    let b = m.push_interleaved_multichannel(&pcm, 8, ChannelLayoutSetting::Surround71)
        .expect("should produce a block");
    // With only LFE active, momentary should be -inf (or very low)
    assert!(
        !b.momentary.is_finite() || b.momentary < -70.0,
        "LFE-only 7.1 should be near silence: {}",
        b.momentary
    );
}
```

- [ ] **Step 2: Run tests to confirm failures**

```
npm run rust:test -- --test surround71_lufs_uses_all_channels_except_lfe 2>&1 | tail -20
```

Expected: FAIL — no 7.1 path exists yet.

- [ ] **Step 3: Add 7.1 measurement path in `push_interleaved_multichannel`**

In `loudness.rs`, in `push_interleaved_multichannel`, add the 7.1 arm **before** the stereo fallback. Place it immediately after the 5.1 block (around line 317):

```rust
// Manual 7.1 preset: Ch1..Ch8 => FL FR C LFE SL SR BL BR.
// LFE (index 3) has 0 weight per BS.1770-4.
if channel_layout == ChannelLayoutSetting::Surround71 && ch >= 8 {
    if self.kf_mc.len() != 8 {
        self.kf_mc = (0..8).map(|_| KWeightMono::new(self.sample_rate)).collect();
    }
    let mut out = None;
    let frames = interleaved.len() / ch;
    for i in 0..frames {
        let base = i * ch;
        let mut sum_ms = 0.0_f64;
        for (ci, w) in [1.0_f64, 1.0, 1.0, 0.0, 1.0, 1.0, 1.0, 1.0].into_iter().enumerate() {
            let x = interleaved[base + ci] as f64;
            let kw = self.kf_mc[ci].tick(x);
            if w != 0.0 {
                sum_ms += w * kw * kw;
            }
        }
        self.ba[0] += sum_ms;
        self.ba[1] += 0.0;
        let xl = interleaved[base] as f64;
        let xr = interleaved[base + 1] as f64;
        let tp0 = self.tp_sample(xl, 0);
        let tp1 = self.tp_sample(xr, 1);
        if tp0 > self.tp_block { self.tp_block = tp0; }
        if tp1 > self.tp_block { self.tp_block = tp1; }
        if tp0 > self.tp_block_ch[0] { self.tp_block_ch[0] = tp0; }
        if tp1 > self.tp_block_ch[1] { self.tp_block_ch[1] = tp1; }
        self.bn += 1;
        if self.bn >= self.bsz {
            let m0 = self.ba[0] / self.bn as f64;
            let m1 = 0.0_f64;
            let idx = self.rh * 2;
            self.ring[idx] = m0;
            self.ring[idx + 1] = m1;
            self.rh = (self.rh + 1) % self.rn;
            self.rc = (self.rc + 1).min(self.rn);
            self.ibl.push([m0, m1]);
            if self.ibl.len() > IBL_CAP { self.ibl.remove(0); }
            out = Some(self.compute_block());
            self.ba = [0.0, 0.0];
            self.bn = 0;
        }
    }
    return out;
}
```

- [ ] **Step 4: Run tests to confirm all pass**

```
npm run rust:test
```

Expected: `surround71_lufs_uses_all_channels_except_lfe` and `surround71_lfe_has_zero_weight` PASS.

- [ ] **Step 5: Commit**

```
git add src-tauri/src/dsp/loudness.rs
git commit -m "feat(backend): implement BS.1770 7.1 loudness measurement"
```

---

### Task 5: Backend — auto mode uses correct loudness path

**Files:**
- Modify: `src-tauri/src/engine/meter_pipeline.rs`

- [ ] **Step 1: Write a Rust test verifying auto mode routes to 5.1/7.1 measurement**

Add to the test block in `meter_pipeline.rs`:

```rust
#[test]
fn auto_mode_6ch_produces_finite_loudness() {
    use crate::dsp::loudness::LoudnessMeter;
    use crate::ipc::types::MeterHistoryBuf;
    use std::sync::{Arc, Mutex};
    use std::collections::VecDeque;

    let sr = 48000_u32;
    let channels = 6_u16;
    let hist: MeterHistoryBuf = Arc::new(Mutex::new(VecDeque::new()));
    let mut pipeline = MeterPipeline::new(sr, channels, hist);

    // Feed ~300ms of 1kHz tone on all 6 channels
    let frames = (sr as usize / 1000) * 300;
    let mut pcm = vec![0.0_f32; frames * 6];
    for i in 0..frames {
        let s = (2.0 * std::f64::consts::PI * 1000.0 * i as f64 / sr as f64).sin() as f32;
        for ch in 0..6usize { pcm[i * 6 + ch] = s; }
    }

    let mut got_frame = false;
    let result = pipeline.push_pcm_f32(&pcm, (0, 1), ChannelLayoutSetting::Auto);
    if let (Some(f), _) = result {
        assert_eq!(f.loudness_layout, "5.1", "auto 6ch should report 5.1 layout");
        assert!(f.loudness_layout_known, "auto 6ch layout should be known");
        got_frame = true;
    }
    // Feed more to guarantee a frame was emitted
    if !got_frame {
        let result2 = pipeline.push_pcm_f32(&pcm, (0, 1), ChannelLayoutSetting::Auto);
        if let (Some(f), _) = result2 {
            assert_eq!(f.loudness_layout, "5.1");
            assert!(f.loudness_layout_known);
        }
    }
}
```

- [ ] **Step 2: Run test to confirm it fails (layout still reports "unknown" for auto 6ch)**

```
npm run rust:test -- --test auto_mode_6ch_produces_finite_loudness 2>&1 | tail -20
```

Expected: FAIL — `loudness_layout` is `"unknown"`.

- [ ] **Step 3: Add effective-layout resolution in `push_pcm_f32` in `meter_pipeline.rs`**

Find `push_pcm_f32`. At the very top of the method body, after computing `ch`, add:

```rust
// Resolve effective layout for auto mode before passing to DSP.
let effective_layout = match channel_layout {
    ChannelLayoutSetting::Auto => match ch {
        6 => ChannelLayoutSetting::Surround51,
        8 => ChannelLayoutSetting::Surround71,
        _ => channel_layout,
    },
    other => other,
};
```

Then replace the two places where `channel_layout` is used for DSP context (the `PcmContext` construction and the `loudness_layout_meta` call) with `effective_layout`:

```rust
let (loudness_layout, loudness_layout_known) = loudness_layout_meta(ch, effective_layout);

let ctx = PcmContext {
    interleaved,
    channels: ch,
    now_sec,
    channel_layout: effective_layout,   // ← was channel_layout
    vectorscope_pair,
};
```

- [ ] **Step 4: Run all Rust tests**

```
npm run rust:test
```

Expected: all tests PASS including `auto_mode_6ch_produces_finite_loudness`.

- [ ] **Step 5: Commit**

```
git add src-tauri/src/engine/meter_pipeline.rs
git commit -m "feat(backend): auto mode routes 6ch→5.1 and 8ch→7.1 loudness paths"
```

---

## Part B — Spectrum Channel Selection

---

### Task 6: Backend — `SpectrumChannelSel` type, `PcmContext`, `AppState`

**Files:**
- Modify: `src-tauri/src/dsp/spectrum.rs` (add type + `Default`)
- Modify: `src-tauri/src/dsp/meter.rs` (add field to `PcmContext`)
- Modify: `src-tauri/src/state.rs` (add `spectrum_channel` to `AppState`)

- [ ] **Step 1: Add `SpectrumChannelSel` to `spectrum.rs`**

At the top of `src-tauri/src/dsp/spectrum.rs`, after the existing `use` declarations, add:

```rust
/// Which channel(s) to use for spectrum analysis.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SpectrumChannelSel {
    /// Average of two channels (0-based indices). Default: (0, 1) = L+R.
    Pair(u16, u16),
    /// Single channel (0-based index).
    Single(u16),
}

impl Default for SpectrumChannelSel {
    fn default() -> Self {
        Self::Pair(0, 1)
    }
}
```

- [ ] **Step 2: Add `spectrum_channel` to `PcmContext` in `meter.rs`**

```rust
use crate::dsp::spectrum::SpectrumChannelSel;  // add this import

pub struct PcmContext<'a> {
    pub interleaved: &'a [f32],
    pub channels: u16,
    pub now_sec: f64,
    pub channel_layout: ChannelLayoutSetting,
    pub vectorscope_pair: (u16, u16),
    pub spectrum_channel: SpectrumChannelSel,   // ← new field
}
```

- [ ] **Step 3: Fix compile errors — add `spectrum_channel` to `PcmContext` construction in `meter_pipeline.rs`**

In `push_pcm_f32`, find the `PcmContext { ... }` block and add:

```rust
let ctx = PcmContext {
    interleaved,
    channels: ch,
    now_sec,
    channel_layout: effective_layout,
    vectorscope_pair,
    spectrum_channel,   // ← add (will be passed as a new parameter in Task 8)
};
```

`spectrum_channel` will be added as a parameter to `push_pcm_f32` in Task 8. For now, use the default:

```rust
spectrum_channel: SpectrumChannelSel::default(),
```

- [ ] **Step 4: Add `spectrum_channel` to `AppState` in `state.rs`**

```rust
use crate::dsp::spectrum::SpectrumChannelSel;  // add import

pub struct AppState {
    pub capture: Mutex<Option<Box<dyn AudioCaptureSession>>>,
    pub meter_history: MeterHistoryBuf,
    pub frame_subscribers: Mutex<Option<FrameSubscribers>>,
    pub vectorscope_pair: Arc<Mutex<(u16, u16)>>,
    pub channel_layout: Arc<Mutex<ChannelLayoutSetting>>,
    pub spectrum_channel: Arc<Mutex<SpectrumChannelSel>>,  // ← new
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            capture: Mutex::new(None),
            meter_history: Arc::new(Mutex::new(VecDeque::new())),
            frame_subscribers: Mutex::new(None),
            vectorscope_pair: Arc::new(Mutex::new((0, 1))),
            channel_layout: Arc::new(Mutex::new(ChannelLayoutSetting::default())),
            spectrum_channel: Arc::new(Mutex::new(SpectrumChannelSel::default())),  // ← new
        }
    }
}
```

- [ ] **Step 5: Confirm project compiles**

```
npm run rust:check
```

Expected: compiles with no errors (warnings OK).

- [ ] **Step 6: Commit**

```
git add src-tauri/src/dsp/spectrum.rs src-tauri/src/dsp/meter.rs src-tauri/src/state.rs src-tauri/src/engine/meter_pipeline.rs
git commit -m "feat(backend): add SpectrumChannelSel type and thread it through PcmContext/AppState"
```

---

### Task 7: Backend — `SpectrumMeter` uses channel selection

**Files:**
- Modify: `src-tauri/src/dsp/spectrum.rs`

- [ ] **Step 1: Write a Rust test for single-channel and pair spectrum extraction**

Add to the test block in `spectrum.rs`:

```rust
#[test]
fn pair_selection_extracts_chosen_channels() {
    use super::SpectrumChannelSel;
    let sr = 48000.0;
    let mut m = SpectrumMeter::new(sr);
    // Feed 6-ch interleaved: 1kHz on ch0+ch1 only.
    let frames = FFT_LEN * 4;
    let channels = 6_usize;
    let mut pcm = vec![0.0_f32; frames * channels];
    for i in 0..frames {
        let s = (2.0 * std::f64::consts::PI * 1000.0 * i as f64 / sr).sin() as f32;
        pcm[i * channels + 0] = s;
        pcm[i * channels + 1] = s;
    }
    let result = m.push_selected(&pcm, channels as u16, 0.0, SpectrumChannelSel::Pair(0, 1));
    // May need multiple calls to fill the ring
    let result = (0..8).fold(result, |acc, _| {
        if acc.is_some() { acc } else {
            m.push_selected(&pcm, channels as u16, 0.0, SpectrumChannelSel::Pair(0, 1))
        }
    });
    assert!(result.is_some(), "should produce output after filling ring");
}

#[test]
fn single_channel_selection_ignores_others() {
    use super::SpectrumChannelSel;
    let sr = 48000.0;
    let mut m = SpectrumMeter::new(sr);
    // 6-ch: tone only on ch2 (C channel).
    let frames = FFT_LEN * 12;
    let channels = 6_usize;
    let mut pcm = vec![0.0_f32; frames * channels];
    for i in 0..frames {
        let s = (2.0 * std::f64::consts::PI * 500.0 * i as f64 / sr).sin() as f32;
        pcm[i * channels + 2] = s;
    }
    // Pair(0,1) should produce near-silence (no signal on L or R).
    let mut m_lr = SpectrumMeter::new(sr);
    let res_lr = (0..12).fold(None, |_, _| {
        m_lr.push_selected(&pcm, channels as u16, 0.0, SpectrumChannelSel::Pair(0, 1))
    });
    // Single(2) should produce a signal.
    let mut m_c = SpectrumMeter::new(sr);
    let res_c = (0..12).fold(None, |_, _| {
        m_c.push_selected(&pcm, channels as u16, 0.0, SpectrumChannelSel::Single(2))
    });
    let (smooth_lr, _) = res_lr.expect("lr should produce output");
    let (smooth_c,  _) = res_c.expect("c should produce output");
    // The C-channel spectrum should have more energy than the L/R spectrum.
    let peak_lr = smooth_lr.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    let peak_c  = smooth_c.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    assert!(peak_c > peak_lr, "C channel should be louder than silent L/R: {} vs {}", peak_c, peak_lr);
}
```

- [ ] **Step 2: Run tests to confirm failures**

```
npm run rust:test -- --test pair_selection_extracts_chosen_channels 2>&1 | tail -10
```

Expected: FAIL — `push_selected` method does not exist.

- [ ] **Step 3: Add `push_selected` to `SpectrumMeter` in `spectrum.rs`**

Add this method inside the `impl SpectrumMeter` block, after `push_interleaved`:

```rust
/// Spectrum analysis on a specific channel pair (averaged) or single channel.
/// Synthesizes a 2-ch buffer and delegates to `push_interleaved` — reuses all ring/smoothing logic.
/// Returns `Option<(smooth_db, peak_db)>` — same shape as `push_interleaved`.
pub fn push_selected(
    &mut self,
    interleaved: &[f32],
    channels: u16,
    now_sec: f64,
    sel: SpectrumChannelSel,
) -> Option<(Vec<f64>, Vec<f64>)> {
    let ch = channels.max(1) as usize;
    let frames = interleaved.len() / ch;
    let mut stereo = Vec::with_capacity(frames * 2);
    for i in 0..frames {
        let base = i * ch;
        let (l, r) = match sel {
            SpectrumChannelSel::Pair(x, y) => {
                let xi = (x as usize).min(ch - 1);
                let yi = (y as usize).min(ch - 1);
                (interleaved[base + xi], interleaved[base + yi])
            }
            SpectrumChannelSel::Single(c) => {
                let ci = (c as usize).min(ch - 1);
                let s = interleaved[base + ci];
                (s, s)
            }
        };
        stereo.push(l);
        stereo.push(r);
    }
    self.push_interleaved(&stereo, 2, now_sec)
}
```

- [ ] **Step 4: Update `Meter` impl for `SpectrumMeter` to use `push_selected`**

In `impl Meter for SpectrumMeter`, update `push_pcm`:

```rust
fn push_pcm(&mut self, ctx: &PcmContext<'_>) {
    let result = if ctx.channels == 1 {
        self.push_mono_duplex(ctx.interleaved, ctx.now_sec)
    } else if ctx.channels > 2 {
        self.push_selected(ctx.interleaved, ctx.channels, ctx.now_sec, ctx.spectrum_channel)
    } else {
        self.push_interleaved(ctx.interleaved, ctx.channels, ctx.now_sec)
    };
    if let Some((sm, pk)) = result {
        self.smooth_db = sm;
        self.peak_db = pk;
    }
}
```

- [ ] **Step 5: Run all Rust tests**

```
npm run rust:test
```

Expected: all tests PASS including the new spectrum selection tests.

- [ ] **Step 6: Commit**

```
git add src-tauri/src/dsp/spectrum.rs
git commit -m "feat(backend): SpectrumMeter uses channel selection instead of all-channel power sum"
```

---

### Task 8: Backend IPC — `set_spectrum_channel` command

**Files:**
- Modify: `src-tauri/src/ipc/commands.rs`
- Modify: `src-tauri/src/engine/meter_pipeline.rs` (pass `spectrum_channel` from `AppState`)
- Modify: `src-tauri/src/audio/cpal_backend.rs` (thread `spectrum_channel` to pipeline worker)

- [ ] **Step 1: Add `set_spectrum_channel` to `commands.rs`**

After `set_vectorscope_pair`, add:

```rust
use crate::dsp::spectrum::SpectrumChannelSel;

/// Update spectrum channel selection. Applied on the capture thread for subsequent frames.
#[tauri::command]
pub fn set_spectrum_channel(
    sel_type: String,
    ch_x: u16,
    ch_y: u16,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let sel = match sel_type.as_str() {
        "pair"   => SpectrumChannelSel::Pair(ch_x, ch_y),
        "single" => SpectrumChannelSel::Single(ch_x),
        _        => return Err(format!("unknown spectrum_channel sel_type: {sel_type}")),
    };
    let mut g = state
        .inner()
        .spectrum_channel
        .lock()
        .map_err(|_| "spectrum channel lock poisoned".to_string())?;
    *g = sel;
    Ok(())
}
```

- [ ] **Step 2: Register the command in `main.rs` or wherever commands are registered**

Find the `.invoke_handler(tauri::generate_handler![...])` call. Add `set_spectrum_channel` to the list:

```rust
tauri::generate_handler![
    // ... existing commands ...
    ipc::commands::set_spectrum_channel,
]
```

- [ ] **Step 3: Thread `spectrum_channel` from `AppState` to the pipeline worker in `cpal_backend.rs`**

Find where `vectorscope_pair` and `channel_layout` are cloned from state and passed to the meter worker. Add the same for `spectrum_channel`:

```rust
let spectrum_channel = state.inner().spectrum_channel.clone();
```

Then pass it to the worker function (alongside the other `Arc<Mutex<...>>` params). In the worker loop, read it the same way as `vectorscope_pair`:

```rust
let spectrum_sel = spectrum_channel
    .lock()
    .map(|g| *g)
    .unwrap_or(SpectrumChannelSel::default());
```

Then pass it to `pipeline.push_pcm_f32(...)`:

```rust
let (frame, slow) = pipeline.push_pcm_f32(&floats, pair, layout, spectrum_sel);
```

- [ ] **Step 4: Update `push_pcm_f32` signature in `meter_pipeline.rs`**

```rust
pub fn push_pcm_f32(
    &mut self,
    interleaved: &[f32],
    vectorscope_pair: (u16, u16),
    channel_layout: ChannelLayoutSetting,
    spectrum_channel: SpectrumChannelSel,  // ← new param
) -> (Option<AudioFramePayload>, Option<LoudnessSlowPayload>) {
```

And update the `PcmContext` construction:

```rust
let ctx = PcmContext {
    interleaved,
    channels: ch,
    now_sec,
    channel_layout: effective_layout,
    vectorscope_pair,
    spectrum_channel,  // ← replace the default
};
```

- [ ] **Step 5: Build and fix any remaining compile errors**

```
npm run rust:check
```

Fix any errors until it compiles cleanly.

- [ ] **Step 6: Commit**

```
git add src-tauri/src/ipc/commands.rs src-tauri/src/engine/meter_pipeline.rs src-tauri/src/audio/cpal_backend.rs
git commit -m "feat(backend): add set_spectrum_channel IPC command and wire spectrum_channel to pipeline"
```

---

### Task 9: Frontend `spectrumChannelOptions.js`

**Files:**
- Create: `src/math/spectrumChannelOptions.js`
- Create: `src/math/spectrumChannelOptions.test.js`

- [ ] **Step 1: Write failing tests**

Create `src/math/spectrumChannelOptions.test.js`:

```js
import { describe, expect, it } from "vitest";
import { buildSpectrumChannelOptions, defaultSpectrumChannel } from "./spectrumChannelOptions.js";

describe("buildSpectrumChannelOptions", () => {
  it("stereo (2ch): returns only L+R", () => {
    const opts = buildSpectrumChannelOptions(2, ["L", "R"]);
    expect(opts).toHaveLength(1);
    expect(opts[0]).toMatchObject({ key: "p-0-1", label: "L+R", sel: { type: "pair", x: 0, y: 1 } });
  });

  it("5.1 (6ch): returns L+R, Ls+Rs, C, LFE", () => {
    const labels = ["L", "R", "C", "LFE", "Ls", "Rs"];
    const opts = buildSpectrumChannelOptions(6, labels);
    expect(opts.map((o) => o.key)).toEqual(["p-0-1", "p-4-5", "s-2", "s-3"]);
    expect(opts.map((o) => o.label)).toEqual(["L+R", "Ls+Rs", "C", "LFE"]);
    expect(opts[2].sel).toEqual({ type: "single", ch: 2 });
    expect(opts[3].sel).toEqual({ type: "single", ch: 3 });
  });

  it("7.1 (8ch): returns L+R, Ls+Rs, Lb+Rb, C, LFE", () => {
    const labels = ["L", "R", "C", "LFE", "Ls", "Rs", "Lb", "Rb"];
    const opts = buildSpectrumChannelOptions(8, labels);
    expect(opts.map((o) => o.key)).toEqual(["p-0-1", "p-4-5", "p-6-7", "s-2", "s-3"]);
    expect(opts[2].label).toBe("Lb+Rb");
  });

  it("unknown multichannel (4ch, generic labels): pairs (0,1) and (2,3), no singles", () => {
    const opts = buildSpectrumChannelOptions(4, ["Ch 1", "Ch 2", "Ch 3", "Ch 4"]);
    expect(opts.map((o) => o.key)).toEqual(["p-0-1", "p-2-3"]);
  });

  it("mono (1ch): returns empty (no selector needed)", () => {
    expect(buildSpectrumChannelOptions(1, ["M"])).toHaveLength(0);
  });

  it("0ch: returns empty", () => {
    expect(buildSpectrumChannelOptions(0, [])).toHaveLength(0);
  });
});

describe("defaultSpectrumChannel", () => {
  it("returns pair 0-1 for stereo", () => {
    expect(defaultSpectrumChannel()).toEqual({ type: "pair", x: 0, y: 1 });
  });
});
```

- [ ] **Step 2: Run tests to confirm failures**

```
npm test -- spectrumChannelOptions
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `spectrumChannelOptions.js`**

Create `src/math/spectrumChannelOptions.js`:

```js
/**
 * @typedef {{ type: "pair"; x: number; y: number } | { type: "single"; ch: number }} SpectrumChannelSel
 * @typedef {{ key: string; label: string; sel: SpectrumChannelSel }} SpectrumChannelOption
 */

// Known standard layouts and their pair/single definitions.
const KNOWN_LAYOUTS = {
  // [stereoChans, singleChans] where stereoChans = [[x,y],...], singleChans = [ch,...]
  "stereo": { pairs: [[0, 1]],           singles: [] },
  "5.1":    { pairs: [[0, 1], [4, 5]],   singles: [2, 3] },
  "7.1":    { pairs: [[0, 1], [4, 5], [6, 7]], singles: [2, 3] },
};

/**
 * @param {number} channelCount
 * @param {string[]} labels — from getPeakMeterChannelLabels
 * @returns {SpectrumChannelOption[]}
 */
export function buildSpectrumChannelOptions(channelCount, labels) {
  const n = Math.max(0, Math.floor(Number(channelCount)));
  if (n < 2) return [];

  // Identify the layout by channel count.
  const layout = n === 2 ? "stereo" : n === 6 ? "5.1" : n === 8 ? "7.1" : null;

  if (layout) {
    const { pairs, singles } = KNOWN_LAYOUTS[layout];
    const opts = [];
    for (const [x, y] of pairs) {
      const lx = labels[x] ?? `Ch ${x + 1}`;
      const ly = labels[y] ?? `Ch ${y + 1}`;
      opts.push({ key: `p-${x}-${y}`, label: `${lx}+${ly}`, sel: { type: "pair", x, y } });
    }
    for (const ch of singles) {
      const lc = labels[ch] ?? `Ch ${ch + 1}`;
      opts.push({ key: `s-${ch}`, label: lc, sel: { type: "single", ch } });
    }
    return opts;
  }

  // Unknown channel count: adjacent pairs only.
  const opts = [];
  for (let i = 0; i + 1 < n; i += 2) {
    const lx = labels[i] ?? `Ch ${i + 1}`;
    const ly = labels[i + 1] ?? `Ch ${i + 2}`;
    opts.push({ key: `p-${i}-${i + 1}`, label: `${lx}+${ly}`, sel: { type: "pair", x: i, y: i + 1 } });
  }
  return opts;
}

/** @returns {SpectrumChannelSel} */
export function defaultSpectrumChannel() {
  return { type: "pair", x: 0, y: 1 };
}

/**
 * If the stored selection is not valid for the current options list, return the first option's sel.
 * @param {SpectrumChannelSel | null} sel
 * @param {SpectrumChannelOption[]} options
 * @returns {SpectrumChannelSel}
 */
export function clampSpectrumChannelToAvailable(sel, options) {
  if (!sel || options.length === 0) return defaultSpectrumChannel();
  const key =
    sel.type === "pair" ? `p-${sel.x}-${sel.y}` : `s-${sel.ch}`;
  return options.some((o) => o.key === key) ? sel : (options[0]?.sel ?? defaultSpectrumChannel());
}
```

- [ ] **Step 4: Run tests to confirm all pass**

```
npm test -- spectrumChannelOptions
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```
git add src/math/spectrumChannelOptions.js src/math/spectrumChannelOptions.test.js
git commit -m "feat(frontend): add spectrumChannelOptions builder"
```

---

### Task 10: Frontend IPC wrapper for `set_spectrum_channel`

**Files:**
- Modify: `src/ipc/commands.js`

- [ ] **Step 1: Add `setSpectrumChannel` to `commands.js`**

After `setVectorscopePair`:

```js
/**
 * @param {{ type: "pair"; x: number; y: number } | { type: "single"; ch: number }} sel
 */
export function setSpectrumChannel(sel) {
  const selType = sel.type;
  const chX = sel.type === "pair" ? sel.x : sel.ch;
  const chY = sel.type === "pair" ? sel.y : 0;
  return invoke("set_spectrum_channel", { selType, chX, chY });
}
```

- [ ] **Step 2: Commit**

```
git add src/ipc/commands.js
git commit -m "feat(frontend): add setSpectrumChannel IPC wrapper"
```

---

### Task 11: Frontend `App.jsx` — spectrum channel state and IPC

**Files:**
- Modify: `src/App.jsx`

This mirrors the `vectorscopePairUi` pattern exactly.

- [ ] **Step 1: Add imports**

At the top of `App.jsx`, add:

```js
import { setSpectrumChannel } from "./ipc/commands.js";
import {
  buildSpectrumChannelOptions,
  clampSpectrumChannelToAvailable,
  defaultSpectrumChannel,
} from "./math/spectrumChannelOptions.js";
```

- [ ] **Step 2: Add persistence helper alongside `readPersistedVectorscopePair`**

Find `readPersistedVectorscopePair` (in `src/preferences/layoutPersistence.js` or inline in App.jsx). Add alongside it (or in the same file):

```js
export function readPersistedSpectrumChannel() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return defaultSpectrumChannel();
    const s = JSON.parse(raw);
    if (s.spectrumChannelType === "pair" &&
        typeof s.spectrumChannelX === "number" &&
        typeof s.spectrumChannelY === "number") {
      return { type: "pair", x: s.spectrumChannelX, y: s.spectrumChannelY };
    }
    if (s.spectrumChannelType === "single" && typeof s.spectrumChannelCh === "number") {
      return { type: "single", ch: s.spectrumChannelCh };
    }
  } catch (_) {}
  return defaultSpectrumChannel();
}
```

- [ ] **Step 3: Add state in `App.jsx`**

Near `vectorscopePairUi` state:

```js
const [spectrumChannelUi, setSpectrumChannelUi] = useState(() => readPersistedSpectrumChannel());
const spectrumChannelRef = useRef(readPersistedSpectrumChannel());
```

- [ ] **Step 4: Build options memo**

Near `vectorscopePairOptions`:

```js
const spectrumChannelOptions = useMemo(() => {
  const n = channelCount >= 2 ? channelCount : 2;
  const labels = getPeakMeterChannelLabels(n, peakLabelContext);
  return buildSpectrumChannelOptions(n, labels);
}, [channelCount, peakLabelContext]);
```

- [ ] **Step 5: Clamp selection when channel count changes**

Near the `vectorscopePairUi` clamp effect:

```js
useEffect(() => {
  const next = clampSpectrumChannelToAvailable(spectrumChannelUi, spectrumChannelOptions);
  const curKey = spectrumChannelUi.type === "pair"
    ? `p-${spectrumChannelUi.x}-${spectrumChannelUi.y}`
    : `s-${spectrumChannelUi.ch}`;
  const nxtKey = next.type === "pair"
    ? `p-${next.x}-${next.y}`
    : `s-${next.ch}`;
  if (curKey === nxtKey) return;
  setSpectrumChannelUi(next);
  if (isTauri() && running) void setSpectrumChannel(next);
}, [channelCount, spectrumChannelOptions, running]);
```

- [ ] **Step 6: Add change handler**

```js
const onSpectrumChannelChange = async (sel) => {
  setSpectrumChannelUi(sel);
  spectrumChannelRef.current = sel;
  if (!isTauri()) return;
  try { await setSpectrumChannel(sel); } catch (_) {}
};
```

- [ ] **Step 7: Keep ref in sync**

```js
useEffect(() => {
  spectrumChannelRef.current = spectrumChannelUi;
}, [spectrumChannelUi]);
```

- [ ] **Step 8: Send on engine start**

In `useAudioEngine.js`, alongside `setVectorscopePair`:

```js
// Pass spectrumChannelRef as a prop to useAudioEngine (mirrors vectorscopePairRef)
try {
  await setSpectrumChannel(spectrumChannelRef?.current ?? defaultSpectrumChannel());
} catch (_) {}
```

- [ ] **Step 9: Persist**

In the localStorage persistence effect, add:

```js
spectrumChannelType: spectrumChannelUi.type,
spectrumChannelX: spectrumChannelUi.type === "pair" ? spectrumChannelUi.x : 0,
spectrumChannelY: spectrumChannelUi.type === "pair" ? spectrumChannelUi.y : 0,
spectrumChannelCh: spectrumChannelUi.type === "single" ? spectrumChannelUi.ch : 0,
```

And add `spectrumChannelUi` to the dependency array of that effect.

- [ ] **Step 10: Pass to SettingsPanel**

```jsx
<SettingsPanel
  ...
  spectrumChannelOptions={spectrumChannelOptions}
  spectrumChannelSel={spectrumChannelUi}
  onSpectrumChannelChange={onSpectrumChannelChange}
/>
```

- [ ] **Step 11: Commit**

```
git add src/App.jsx src/preferences/layoutPersistence.js src/hooks/useAudioEngine.js
git commit -m "feat(frontend): spectrum channel state, persistence, and engine wire-up"
```

---

### Task 12: Frontend `SettingsPanel.jsx` — spectrum channel selector UI

**Files:**
- Modify: `src/components/SettingsPanel.jsx`
- Modify: `src/components/SettingsPanel.test.jsx`

- [ ] **Step 1: Add props to `SettingsPanel`**

Add to the destructured props:

```js
/** @type {import("../math/spectrumChannelOptions.js").SpectrumChannelOption[]} */
spectrumChannelOptions = [],
spectrumChannelSel = null,
onSpectrumChannelChange,
```

- [ ] **Step 2: Add selector JSX after the Vectorscope selector**

After the closing `</div>` of the Vectorscope section, add:

```jsx
{spectrumChannelOptions.length > 1 &&
typeof onSpectrumChannelChange === "function" && (
  <>
    <Separator />
    <div className="grid gap-2">
      <Label htmlFor="settings-spectrum-channel">Spectrum channel</Label>
      <Select
        value={(() => {
          if (!spectrumChannelSel) return spectrumChannelOptions[0]?.key ?? "";
          const key = spectrumChannelSel.type === "pair"
            ? `p-${spectrumChannelSel.x}-${spectrumChannelSel.y}`
            : `s-${spectrumChannelSel.ch}`;
          return spectrumChannelOptions.some((o) => o.key === key)
            ? key
            : (spectrumChannelOptions[0]?.key ?? "");
        })()}
        onValueChange={(key) => {
          const opt = spectrumChannelOptions.find((o) => o.key === key);
          if (opt) onSpectrumChannelChange(opt.sel);
        }}
      >
        <SelectTrigger id="settings-spectrum-channel">
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper">
          {spectrumChannelOptions.map((o) => (
            <SelectItem key={o.key} value={o.key}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  </>
)}
```

- [ ] **Step 3: Update `SettingsPanel.test.jsx` default props**

In the `defaultProps` object, add:

```js
spectrumChannelOptions: [],
spectrumChannelSel: null,
onSpectrumChannelChange: vi.fn(),
```

- [ ] **Step 4: Run all frontend tests**

```
npm test
```

Expected: all tests PASS.

- [ ] **Step 5: Manual smoke test**

Run `npm run tauri dev`.  
- With stereo device: no Spectrum channel selector visible.  
- With 5.1/7.1 device: Spectrum channel selector appears in Settings with `L+R`, `Ls+Rs`, `C`, `LFE` (and `Lb+Rb` for 7.1).  
- Changing selection updates the spectrum display in real time.

- [ ] **Step 6: Final commit**

```
git add src/components/SettingsPanel.jsx src/components/SettingsPanel.test.jsx
git commit -m "feat(frontend): add spectrum channel selector to SettingsPanel"
```

---

## Verification Checklist

After all tasks, confirm:

- [ ] Auto 6ch device: layout shows "5.1" labels (L R C LFE Ls Rs), no notification
- [ ] Auto 8ch device: layout shows "7.1" labels, no notification
- [ ] Auto 1ch device: single M bar, no notification
- [ ] Auto 3ch device: Ch 1 Ch 2 Ch 3 labels + "3-channel detected" notification
- [ ] Manual stereo on 6ch device: notification "Device is 5.1 · selected stereo"
- [ ] Manual 7.1 on 6ch device: notification "Device is 5.1 · selected 7.1"
- [ ] Manual 5.1 on 6ch device: no notification (exact match)
- [ ] 7.1 loudness: `npm run rust:test` — `surround71_lfe_has_zero_weight` PASS
- [ ] Spectrum on 5.1 device: selecting "C" shows C-channel spectrum, not L/R
- [ ] Spectrum selector hidden on stereo device
- [ ] All settings persist across app restart
- [ ] `npm test && npm run rust:test` — all green
