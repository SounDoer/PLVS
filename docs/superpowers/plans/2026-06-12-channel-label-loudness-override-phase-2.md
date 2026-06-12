# Channel Label Override — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Phase 1 channel role overrides affect BS.1770 loudness aggregation by sending a per-channel dynamic weight vector to the Rust engine.

**Architecture:** Frontend role tokens map to finite linear loudness weights. `App.jsx` sends the active vector to Rust through a new `set_loudness_weights` IPC before capture starts and whenever the override changes. Rust stores the vector in shared state, passes it into `MeterPipeline`, and `LoudnessMeter` uses it ahead of hardcoded 5.1/7.1 layout paths when length matches the current channel count.

**Tech Stack:** React + Vite, Vitest, Tauri IPC, Rust DSP, `cargo test`.

**Spec:** `docs/superpowers/specs/2026-06-12-channel-label-loudness-override-design.md`

**Existing context:** Phase 1 is already implemented. Spectrum channel selection, 5.1/7.1 auto loudness routing, and `SpectrumChannelSel` already exist; do not reimplement them.

---

## File Map

| File | Action | Responsibility |
| --- | --- | --- |
| `src/math/channelRoles.js` | Modify | Add role token → loudness weight helper |
| `src/math/channelRoles.test.js` | Modify | Test loudness weight mapping |
| `src/ipc/commands.js` | Modify | Add `setLoudnessWeights(weights)` wrapper |
| `src/App.jsx` | Modify | Compute active weights and keep engine state in sync |
| `src/App.toolbar.test.js` | Modify | Source-level regression for App wiring |
| `src/hooks/useAudioEngine.js` | Modify | Send weights before `audio_start` |
| `src-tauri/src/state.rs` | Modify | Store shared dynamic loudness weights |
| `src-tauri/src/ipc/commands.rs` | Modify | Add validating `set_loudness_weights` command |
| `src-tauri/src/lib.rs` | Modify | Register the new Tauri command |
| `src-tauri/src/audio/capture.rs` | Modify | Thread loudness weights through backend abstraction |
| `src-tauri/src/audio/cpal_backend.rs` | Modify | Read weights in capture worker and pass to pipeline |
| `src-tauri/src/dsp/meter.rs` | Modify | Add `loudness_weights` to `PcmContext` |
| `src-tauri/src/engine/meter_pipeline.rs` | Modify | Track/reset/apply dynamic weight vectors |
| `src-tauri/src/dsp/loudness.rs` | Modify | Dynamic weighted loudness aggregation |

---

### Task 1: Frontend role-token loudness weights

**Files:**
- Modify: `src/math/channelRoles.js`
- Modify: `src/math/channelRoles.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `src/math/channelRoles.test.js`:

```js
describe("roleTokensToLoudnessWeights", () => {
  it("maps full-band front, mono, height, and generic roles to unity", () => {
    expect(roleTokensToLoudnessWeights(["M", "L", "R", "C", "Ltf", "Rtr", "generic"])).toEqual([
      1,
      1,
      1,
      1,
      1,
      1,
      1,
    ]);
  });

  it("maps LFE to zero", () => {
    expect(roleTokensToLoudnessWeights(["L", "LFE", "R"])).toEqual([1, 0, 1]);
  });

  it("maps surround and back roles to the BS.1770 +1.5 dB energy multiplier", () => {
    const surroundWeight = 10 ** (1.5 / 10);
    expect(roleTokensToLoudnessWeights(["Ls", "Rs", "Lb", "Rb", "Cs"])).toEqual([
      surroundWeight,
      surroundWeight,
      surroundWeight,
      surroundWeight,
      surroundWeight,
    ]);
  });

  it("maps the default 7.0 role order to front + surround/back weights", () => {
    const surroundWeight = 10 ** (1.5 / 10);
    expect(roleTokensToLoudnessWeights(["L", "R", "C", "Ls", "Rs", "Lb", "Rb"])).toEqual([
      1,
      1,
      1,
      surroundWeight,
      surroundWeight,
      surroundWeight,
      surroundWeight,
    ]);
  });

  it("maps unknown defensive tokens to unity", () => {
    expect(roleTokensToLoudnessWeights(["zzz"])).toEqual([1]);
  });
});
```

Update the import:

```js
import {
  CHANNEL_ROLE_VOCABULARY,
  roleTokensToLabels,
  roleTokensToLoudnessWeights,
  seedTokensFromLabels,
  sanitizeChannelLabelOverrides,
} from "./channelRoles.js";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/math/channelRoles.test.js`

Expected: FAIL with `roleTokensToLoudnessWeights` export missing.

- [ ] **Step 3: Add the minimal helper**

In `src/math/channelRoles.js`, after `seedTokensFromLabels`, add:

```js
const SURROUND_LOUDNESS_WEIGHT = 10 ** (1.5 / 10);
const LOUDNESS_WEIGHT_BY_ROLE_ID = new Map([
  ["M", 1],
  ["L", 1],
  ["R", 1],
  ["C", 1],
  ["LFE", 0],
  ["Ls", SURROUND_LOUDNESS_WEIGHT],
  ["Rs", SURROUND_LOUDNESS_WEIGHT],
  ["Lb", SURROUND_LOUDNESS_WEIGHT],
  ["Rb", SURROUND_LOUDNESS_WEIGHT],
  ["Cs", SURROUND_LOUDNESS_WEIGHT],
  ["Ltf", 1],
  ["Rtf", 1],
  ["Ltr", 1],
  ["Rtr", 1],
  ["generic", 1],
]);

/**
 * @param {string[]} tokens
 * @returns {number[]} Linear BS.1770 energy multipliers, one per channel.
 */
export function roleTokensToLoudnessWeights(tokens) {
  return tokens.map((token) => LOUDNESS_WEIGHT_BY_ROLE_ID.get(token) ?? 1);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/math/channelRoles.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/math/channelRoles.js src/math/channelRoles.test.js
git commit -m "feat(channel-labels): map channel roles to loudness weights"
```

---

### Task 2: Rust shared state and validating IPC

**Files:**
- Modify: `src/ipc/commands.js`
- Modify: `src-tauri/src/state.rs`
- Modify: `src-tauri/src/ipc/commands.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Write frontend IPC wrapper source regression**

Add this source-level regression to `src/App.toolbar.test.js`:

```js
it("has a frontend IPC wrapper for dynamic loudness weights", () => {
  const commandsSource = readFileSync(join(currentDir, "ipc", "commands.js"), "utf8");
  expect(commandsSource).toContain("export function setLoudnessWeights(weights)");
  expect(commandsSource).toContain('return invoke("set_loudness_weights", { weights });');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/App.toolbar.test.js`

Expected: FAIL because `setLoudnessWeights` is not defined.

- [ ] **Step 3: Add frontend IPC wrapper**

In `src/ipc/commands.js`, after `setSpectrumChannel`, add:

```js
/** @param {number[] | null} weights */
export function setLoudnessWeights(weights) {
  return invoke("set_loudness_weights", { weights });
}
```

- [ ] **Step 4: Add Rust state field**

In `src-tauri/src/state.rs`, add a field:

```rust
pub loudness_weights: Arc<Mutex<Option<Vec<f64>>>>,
```

Initialize it in `Default`:

```rust
loudness_weights: Arc::new(Mutex::new(None)),
```

- [ ] **Step 5: Add Rust IPC command**

In `src-tauri/src/ipc/commands.rs`, after `set_spectrum_channel`, add:

```rust
fn validate_loudness_weights(weights: &[f64]) -> Result<(), String> {
  if weights.is_empty() {
    return Err("loudness weights cannot be empty".to_string());
  }
  if weights.len() > 64 {
    return Err("loudness weights cannot exceed 64 channels".to_string());
  }
  if weights.iter().any(|w| !w.is_finite() || *w < 0.0) {
    return Err("loudness weights must be finite non-negative numbers".to_string());
  }
  Ok(())
}

#[tauri::command]
pub fn set_loudness_weights(
  weights: Option<Vec<f64>>,
  state: State<'_, AppState>,
) -> Result<(), String> {
  if let Some(ref ws) = weights {
    validate_loudness_weights(ws)?;
  }
  let mut g = state
    .inner()
    .loudness_weights
    .lock()
    .map_err(|_| "loudness weights lock poisoned".to_string())?;
  *g = weights;
  Ok(())
}
```

- [ ] **Step 6: Add Rust command tests**

At the bottom of `src-tauri/src/ipc/commands.rs`, add:

```rust
#[cfg(test)]
mod tests {
  use super::validate_loudness_weights;

  #[test]
  fn loudness_weights_validation_accepts_finite_non_negative_vectors() {
    assert!(validate_loudness_weights(&[1.0, 0.0, 1.4125375446]).is_ok());
  }

  #[test]
  fn loudness_weights_validation_rejects_empty_vectors() {
    assert!(validate_loudness_weights(&[]).is_err());
  }

  #[test]
  fn loudness_weights_validation_rejects_negative_values() {
    assert!(validate_loudness_weights(&[1.0, -1.0]).is_err());
  }

  #[test]
  fn loudness_weights_validation_rejects_nan_values() {
    assert!(validate_loudness_weights(&[1.0, f64::NAN]).is_err());
  }

  #[test]
  fn loudness_weights_validation_rejects_overlong_vectors() {
    let weights = vec![1.0; 65];
    assert!(validate_loudness_weights(&weights).is_err());
  }
}
```

- [ ] **Step 7: Register command**

In `src-tauri/src/lib.rs`, add `ipc::commands::set_loudness_weights` to `tauri::generate_handler![...]`, near `set_spectrum_channel`.

- [ ] **Step 8: Run tests**

Run:

```bash
npx vitest run src/App.toolbar.test.js
npm run rust:test
```

Expected: both pass.

- [ ] **Step 9: Commit**

```bash
git add src/ipc/commands.js src/App.toolbar.test.js src-tauri/src/state.rs src-tauri/src/ipc/commands.rs src-tauri/src/lib.rs
git commit -m "feat(channel-labels): add loudness weights IPC state"
```

---

### Task 3: Rust dynamic loudness aggregation

**Files:**
- Modify: `src-tauri/src/dsp/meter.rs`
- Modify: `src-tauri/src/dsp/loudness.rs`
- Modify: `src-tauri/src/engine/meter_pipeline.rs`

- [ ] **Step 1: Write failing loudness tests**

In `src-tauri/src/dsp/loudness.rs`, add these tests to the existing `#[cfg(test)] mod tests`:

```rust
#[test]
fn dynamic_weights_ignore_lfe_channel() {
  let sr = 48_000.0;
  let frames = 4_800usize;
  let ch = 3usize;
  let mut pcm = vec![0.0_f32; frames * ch];
  for f in 0..frames {
    let base = f * ch;
    pcm[base] = 0.1;
    pcm[base + 1] = 0.1;
    pcm[base + 2] = 0.8;
  }

  let weights_without_lfe = vec![1.0, 1.0, 0.0];
  let weights_with_lfe = vec![1.0, 1.0, 1.0];

  let mut a = LoudnessMeter::new(sr);
  let mut b = LoudnessMeter::new(sr);
  let block_a = a
    .push_interleaved_weighted(&pcm, ch as u16, &weights_without_lfe)
    .expect("weighted block");
  let block_b = b
    .push_interleaved_weighted(&pcm, ch as u16, &weights_with_lfe)
    .expect("weighted block");

  assert!(
    block_b.momentary > block_a.momentary + 3.0,
    "including LFE channel should be much louder than zero-weighting it: {} vs {}",
    block_b.momentary,
    block_a.momentary
  );
}

#[test]
fn dynamic_surround_weight_increases_loudness_against_unity() {
  let sr = 48_000.0;
  let frames = 4_800usize;
  let ch = 1usize;
  let pcm = vec![0.1_f32; frames * ch];
  let surround_weight = 10_f64.powf(1.5 / 10.0);

  let mut unity = LoudnessMeter::new(sr);
  let mut surround = LoudnessMeter::new(sr);
  let block_unity = unity
    .push_interleaved_weighted(&pcm, ch as u16, &[1.0])
    .expect("unity weighted block");
  let block_surround = surround
    .push_interleaved_weighted(&pcm, ch as u16, &[surround_weight])
    .expect("surround weighted block");

  assert!(
    (block_surround.momentary - block_unity.momentary - 1.5).abs() < 0.2,
    "surround gain should be about +1.5 dB: {} vs {}",
    block_surround.momentary,
    block_unity.momentary
  );
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run rust:test -- --test dynamic_weights_ignore_lfe_channel`

Expected: FAIL because `push_interleaved_weighted` does not exist.

- [ ] **Step 3: Add `loudness_weights` to `PcmContext`**

In `src-tauri/src/dsp/meter.rs`, add:

```rust
pub loudness_weights: Option<Vec<f64>>,
```

- [ ] **Step 4: Add weighted loudness method**

In `src-tauri/src/dsp/loudness.rs`, inside `impl LoudnessMeter`, add `push_interleaved_weighted` before `push_interleaved_multichannel`:

```rust
pub fn push_interleaved_weighted(
  &mut self,
  interleaved: &[f32],
  channels: u16,
  weights: &[f64],
) -> Option<LoudnessBlock> {
  let ch = channels.max(1) as usize;
  if weights.len() != ch {
    return self.push_interleaved_multichannel(interleaved, channels, ChannelLayoutSetting::Auto);
  }
  if ch == 1 {
    let scaled: Vec<f32> = interleaved
      .iter()
      .map(|s| (*s as f64 * weights[0].sqrt()) as f32)
      .collect();
    return self.push_mono_duplex(&scaled);
  }
  if self.kf_mc.len() != ch {
    self.kf_mc = (0..ch).map(|_| KWeightMono::new(self.sample_rate)).collect();
  }
  let mut out = None;
  let frames = interleaved.len() / ch;
  for i in 0..frames {
    let base = i * ch;
    let mut sum_ms = 0.0_f64;
    for (ci, weight) in weights.iter().copied().enumerate() {
      if weight == 0.0 {
        continue;
      }
      let x = interleaved[base + ci] as f64;
      let kw = self.kf_mc[ci].tick(x);
      sum_ms += weight * kw * kw;
    }
    self.ba[0] += sum_ms;
    self.ba[1] += 0.0;

    let xl = interleaved[base] as f64;
    let xr = if ch > 1 { interleaved[base + 1] as f64 } else { xl };
    let tp0 = self.tp_sample(xl, 0);
    let tp1 = self.tp_sample(xr, 1);
    if tp0 > self.tp_block {
      self.tp_block = tp0;
    }
    if tp1 > self.tp_block {
      self.tp_block = tp1;
    }
    if tp0 > self.tp_block_ch[0] {
      self.tp_block_ch[0] = tp0;
    }
    if tp1 > self.tp_block_ch[1] {
      self.tp_block_ch[1] = tp1;
    }
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
      if self.ibl.len() > IBL_CAP {
        self.ibl.remove(0);
      }
      let mut a0 = 0.0;
      let mut a1 = 0.0;
      let mut an = 0_usize;
      for b in 0..4.min(self.rc) {
        let idx = ((self.rh + self.rn - 1 - b) % self.rn) * 2;
        a0 += self.ring[idx];
        a1 += self.ring[idx + 1];
        an += 1;
      }
      let momentary = if an > 0 {
        lufs_from_mean_squares(a0 / an as f64, a1 / an as f64)
      } else {
        f64::NEG_INFINITY
      };
      a0 = 0.0;
      a1 = 0.0;
      an = 0;
      for b in 0..30.min(self.rc) {
        let idx = ((self.rh + self.rn - 1 - b) % self.rn) * 2;
        a0 += self.ring[idx];
        a1 += self.ring[idx + 1];
        an += 1;
      }
      let short_term = if an > 0 {
        lufs_from_mean_squares(a0 / an as f64, a1 / an as f64)
      } else {
        f64::NEG_INFINITY
      };
      if short_term.is_finite() {
        self.sth.push(short_term);
        if self.sth.len() > STH_CAP {
          self.sth.remove(0);
        }
      }
      let tp_now = if self.tp_block > 0.0 {
        20.0 * self.tp_block.log10()
      } else {
        f64::NEG_INFINITY
      };
      let tp_now_l = if self.tp_block_ch[0] > 0.0 {
        20.0 * self.tp_block_ch[0].log10()
      } else {
        f64::NEG_INFINITY
      };
      let tp_now_r = if self.tp_block_ch[1] > 0.0 {
        20.0 * self.tp_block_ch[1].log10()
      } else {
        f64::NEG_INFINITY
      };
      out = Some(LoudnessBlock {
        momentary,
        short_term,
        integrated: self.integrated(),
        lra: self.lra(),
        true_peak: tp_now,
        true_peak_l: tp_now_l,
        true_peak_r: tp_now_r,
      });
      self.ba = [0.0, 0.0];
      self.bn = 0;
      self.tp_block = 0.0;
      self.tp_block_ch = [0.0, 0.0];
    }
  }
  out
}
```

- [ ] **Step 5: Use dynamic weights in `Meter for LoudnessMeter`**

Change `push_pcm`:

```rust
fn push_pcm(&mut self, ctx: &PcmContext<'_>) {
  let block = if let Some(weights) = ctx.loudness_weights.as_ref() {
    if weights.len() == ctx.channels.max(1) as usize {
      self.push_interleaved_weighted(ctx.interleaved, ctx.channels, weights)
    } else if ctx.channels == 1 {
      self.push_mono_duplex(ctx.interleaved)
    } else {
      self.push_interleaved_multichannel(ctx.interleaved, ctx.channels, ctx.channel_layout)
    }
  } else if ctx.channels == 1 {
    self.push_mono_duplex(ctx.interleaved)
  } else {
    self.push_interleaved_multichannel(ctx.interleaved, ctx.channels, ctx.channel_layout)
  };
  if let Some(b) = block {
    self.pending_block = Some(b);
  }
}
```

- [ ] **Step 6: Add pipeline reset and metadata behavior**

In `src-tauri/src/engine/meter_pipeline.rs`, add a field to `MeterPipeline`:

```rust
last_loudness_weights: Option<Vec<f64>>,
```

Initialize it to `None`.

Change `push_pcm_f32` signature:

```rust
pub fn push_pcm_f32(
  &mut self,
  interleaved: &[f32],
  vectorscope_pair: (u16, u16),
  channel_layout: ChannelLayoutSetting,
  spectrum_channel: SpectrumChannelSel,
  loudness_weights: Option<Vec<f64>>,
) -> (Option<AudioFramePayload>, Option<LoudnessSlowPayload>) {
```

After `effective_layout`, add:

```rust
let dynamic_loudness_active = loudness_weights
  .as_ref()
  .is_some_and(|weights| weights.len() == ch as usize);

if loudness_weights != self.last_loudness_weights {
  self.loudness.reset();
  self.last_loudness = None;
  self.pending_loudness_hist = None;
  self.m_max = f64::NEG_INFINITY;
  self.st_max = f64::NEG_INFINITY;
  self.last_loudness_weights = loudness_weights.clone();
}

let (loudness_layout, loudness_layout_known) = if dynamic_loudness_active {
  ("custom".to_string(), true)
} else {
  loudness_layout_meta(ch, effective_layout)
};
```

Add the field to `PcmContext` construction:

```rust
loudness_weights,
```

- [ ] **Step 7: Update existing `push_pcm_f32` call sites in tests**

Every test call to `push_pcm_f32(..., SpectrumChannelSel::default())` now passes one more argument:

```rust
None
```

- [ ] **Step 8: Add pipeline test for custom metadata**

In `meter_pipeline.rs` tests, add:

```rust
#[test]
fn dynamic_loudness_weights_report_custom_layout() {
  use crate::dsp::SpectrumChannelSel;

  let sr = 48_000_u32;
  let channels = 3_u16;
  let mut pipeline = MeterPipeline::new(sr, channels);
  let frames = 4_800usize;
  let pcm = vec![0.1_f32; frames * channels as usize];
  let (frame, _) = pipeline.push_pcm_f32(
    &pcm,
    (0, 1),
    ChannelLayoutSetting::Auto,
    SpectrumChannelSel::default(),
    Some(vec![1.0, 1.0, 0.0]),
  );
  let frame = frame.expect("100ms chunk should emit a frame");
  assert_eq!(frame.loudness_layout, "custom");
  assert!(frame.loudness_layout_known);
}
```

If `MeterPipeline::new` currently needs additional constructor arguments in this repo, use the existing nearby tests' constructor shape and only add the new `push_pcm_f32` argument.

- [ ] **Step 9: Run Rust tests**

Run: `npm run rust:test`

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src-tauri/src/dsp/meter.rs src-tauri/src/dsp/loudness.rs src-tauri/src/engine/meter_pipeline.rs
git commit -m "feat(channel-labels): apply dynamic loudness weights in DSP"
```

---

### Task 4: Thread loudness weights through capture worker

**Files:**
- Modify: `src-tauri/src/audio/capture.rs`
- Modify: `src-tauri/src/audio/cpal_backend.rs`
- Modify: `src-tauri/src/ipc/commands.rs`

- [ ] **Step 1: Add loudness weights to `AudioCapture::start_session`**

In `src-tauri/src/audio/capture.rs`, add an argument:

```rust
loudness_weights: std::sync::Arc<std::sync::Mutex<Option<Vec<f64>>>>,
```

Place it after `spectrum_channel` to match the other shared state handles.

- [ ] **Step 2: Pass state from `audio_start`**

In `src-tauri/src/ipc/commands.rs`, inside `audio_start`, add:

```rust
let loudness_weights = state.inner().loudness_weights.clone();
```

Pass it to `AudioCapture::start_session`.

- [ ] **Step 3: Thread through `cpal_backend.rs`**

Add the same `Arc<Mutex<Option<Vec<f64>>>>` parameter to:

- `CpalBackend::start_session`
- `CaptureSession::start`
- `RunCaptureArgs`
- `run_capture_worker`

In `run_meter_pipeline_bridge_thread`, add the parameter after `spectrum_channel`:

```rust
loudness_weights: Arc<std::sync::Mutex<Option<Vec<f64>>>>,
```

Inside the PCM worker loop, replace:

```rust
let spectrum_sel = spectrum_channel.lock().map(|g| *g).unwrap_or_default();
let (frame, slow) = pipeline.push_pcm_f32(&floats, pair, layout, spectrum_sel);
```

with:

```rust
let spectrum_sel = spectrum_channel.lock().map(|g| *g).unwrap_or_default();
let loudness_weights = loudness_weights
  .lock()
  .map(|g| g.clone())
  .unwrap_or(None);
let (frame, slow) = pipeline.push_pcm_f32(&floats, pair, layout, spectrum_sel, loudness_weights);
```

In `run_capture_worker`, destructure `loudness_weights` from `RunCaptureArgs` after `spectrum_channel`, then pass it to `run_meter_pipeline_bridge_thread` after `spectrum_channel`:

```rust
run_meter_pipeline_bridge_thread(
  audio_rx,
  sample_rate,
  channels,
  frame_subscribers,
  app,
  clear_peak_history,
  vectorscope_pair,
  channel_layout,
  spectrum_channel,
  loudness_weights,
  dropped_chunks,
  bridge_pool,
);
```

Keep all existing vectorscope/spectrum behavior unchanged.

- [ ] **Step 4: Run Rust check**

Run: `npm run rust:check`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/audio/capture.rs src-tauri/src/audio/cpal_backend.rs src-tauri/src/ipc/commands.rs
git commit -m "feat(channel-labels): thread loudness weights to capture pipeline"
```

---

### Task 5: Frontend App wiring

**Files:**
- Modify: `src/App.jsx`
- Modify: `src/App.toolbar.test.js`
- Modify: `src/hooks/useAudioEngine.js`

- [ ] **Step 1: Add source-level failing test**

In `src/App.toolbar.test.js`, add:

```js
it("wires channel label overrides to loudness weights IPC", () => {
  expect(appSource).toContain("roleTokensToLoudnessWeights");
  expect(appSource).toContain("const loudnessWeights = useMemo(");
  expect(appSource).toContain("sendTrackedLoudnessWeights");
  expect(appSource).toContain("loudnessWeightsRef");
  expect(appSource).toContain("loudnessWeights={loudnessWeights}");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/App.toolbar.test.js`

Expected: FAIL because App has no loudness weights wiring.

- [ ] **Step 3: Add imports**

In `src/App.jsx`, update imports:

```js
import {
  roleTokensToLabels,
  roleTokensToLoudnessWeights,
  sanitizeChannelLabelOverrides,
  seedTokensFromLabels,
} from "./math/channelRoles.js";
import {
  clearAudioHistory,
  setLoudnessWeights,
  setSpectrumChannel,
  setVectorscopePair,
} from "./ipc/commands.js";
```

In `src/hooks/useAudioEngine.js`, import `setLoudnessWeights` from `../ipc/commands.js`.

- [ ] **Step 4: Compute and track loudness weights in `App.jsx`**

Near `overrideLabels`, add:

```js
const loudnessWeights = useMemo(
  () => (channelLabelOverride ? roleTokensToLoudnessWeights(channelLabelOverride) : null),
  [channelLabelOverride]
);
const loudnessWeightsRef = useRef(loudnessWeights);
```

Near `sendTrackedSpectrumChannel`, add:

```js
const sendTrackedLoudnessWeights = useCallback((weights) => {
  return setLoudnessWeights(weights).catch(() => {});
}, []);
```

Add an effect:

```js
useEffect(() => {
  loudnessWeightsRef.current = loudnessWeights;
  if (!isTauri() || !running) return;
  void sendTrackedLoudnessWeights(loudnessWeights);
}, [loudnessWeights, running, sendTrackedLoudnessWeights]);
```

- [ ] **Step 5: Pass ref to `useAudioEngine`**

In the `useAudioEngine({ ... })` call in `App.jsx`, add:

```js
loudnessWeightsRef,
```

In `src/hooks/useAudioEngine.js`, add `loudnessWeightsRef` to the destructured params:

```js
loudnessWeightsRef,
```

Before `startAudioCapture`, after `setSpectrumChannel(sc)`, send:

```js
try {
  await setLoudnessWeights(loudnessWeightsRef?.current ?? null);
} catch (_) {}
```

- [ ] **Step 6: Run frontend tests**

Run:

```bash
npx vitest run src/App.toolbar.test.js
npm test
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/App.jsx src/App.toolbar.test.js src/hooks/useAudioEngine.js
git commit -m "feat(channel-labels): sync label override loudness weights to engine"
```

---

### Task 6: Final verification

**Files:** none, unless formatting modifies touched files.

- [ ] **Step 1: Run frontend checks**

Run:

```bash
npm test
npm run format:check
npm run lint
npm run build
```

Expected:

- `npm test`: all tests pass.
- `format:check`: all matched files formatted.
- `lint`: 0 errors; pre-existing `react-hooks/refs` warnings may remain.
- `build`: Vite build succeeds; existing chunk-size warning is acceptable.

- [ ] **Step 2: Run Rust checks**

Run:

```bash
npm run rust:check
```

Expected: `cargo fmt --check`, `cargo clippy -D warnings`, and `cargo test` all pass.

- [ ] **Step 3: Manual smoke test**

Run: `npm run desktop`.

With an N-channel source:

- Start capture with no override: loudness follows existing auto behavior.
- Add a channel label override in Settings.
- Confirm labels update immediately.
- Confirm loudness changes without restarting capture.
- Set one active channel to `LFE`; confirm loudness drops for content isolated to that channel.
- Click `Reset to Auto`; confirm labels and loudness return to auto behavior.

- [ ] **Step 4: Check final git status**

Run:

```bash
git status --short
```

Expected: only intentional Phase 2 files are modified or the working tree is clean after the task commits.

---

## Self-Review

**Spec coverage:**
- Role token → loudness weight mapping: Task 1.
- Frontend IPC wrapper and live sync: Tasks 2 and 5.
- Rust state, command validation, and command registration: Task 2.
- Capture worker thread path: Task 4.
- Dynamic weighted aggregation: Task 3.
- Dynamic vector priority over hardcoded layout paths: Task 3.
- Reset on runtime weight changes: Task 3.
- Existing spectrum work not duplicated: File Map and context notes.

**Completeness scan:** No unresolved fill-ins. Each code-changing task includes exact files, code snippets, commands, and expected results.

**Type/name consistency:** `roleTokensToLoudnessWeights`, `setLoudnessWeights`, `set_loudness_weights`, `loudness_weights`, `loudnessWeights`, and `loudnessWeightsRef` are used consistently across frontend, IPC, Rust state, and DSP.
