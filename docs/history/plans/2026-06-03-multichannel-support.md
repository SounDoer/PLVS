# Multichannel Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix macOS multichannel peak metering bug, add 7.1 channel layout preset, and improve Peak meter UI labels and footer prompt for auto mode.

**Architecture:** Six independent tasks in order: Rust backend (7.1 preset) → Frontend label system (resolver + label fn + channel math) → Frontend UI (settings + footer) → C backend (tap_bridge non-interleaved fix). Each task has its own test/commit cycle. The C task has no unit tests but the build verifies it compiles.

**Tech Stack:** Rust (cargo test), Objective-C/C (tap_bridge.m, macOS only), Vitest (npm test), React/JSX

---

## File Map

| File | Change |
|---|---|
| `src-tauri/src/engine/channel_layout.rs` | Add `Surround71` variant |
| `src-tauri/src/engine/meter_pipeline.rs` | Update `loudness_layout_meta` for 7.1 |
| `src/math/channelLayoutResolver.js` | Add `"7.1"` setting |
| `src/math/channelLayoutResolver.test.js` | Add test for 7.1 |
| `src/math/peakMeterChannelLabels.js` | Early exit when `resolvedLayout === "unknown"` |
| `src/math/peakMeterChannelLabels.test.js` | Add tests for unknown layout |
| `src/math/peakChannelMath.js` | `peakDb.slice(0, 16)` cap |
| `src/math/peakChannelMath.test.js` | Add cap + unknown layout tests |
| `src/components/SettingsPanel.jsx` | Add `<SelectItem value="7.1">` |
| `src/App.jsx` | Footer multichannel prompt |
| `src-tauri/native/macos/tap_bridge.m` | Scratch buffer + interleave in IOProc |

---

## Task 1: Rust — Surround71 ChannelLayoutSetting

**Files:**
- Modify: `src-tauri/src/engine/channel_layout.rs`
- Modify: `src-tauri/src/engine/meter_pipeline.rs`

- [ ] **Step 1: Add failing tests to channel_layout.rs**

Append inside the existing `mod tests` block in `src-tauri/src/engine/channel_layout.rs`:

```rust
#[test]
fn from_str_lossy_surround71_variants() {
  assert_eq!(
    ChannelLayoutSetting::from_str_lossy("7.1"),
    ChannelLayoutSetting::Surround71
  );
  assert_eq!(
    ChannelLayoutSetting::from_str_lossy("7_1"),
    ChannelLayoutSetting::Surround71
  );
  assert_eq!(
    ChannelLayoutSetting::from_str_lossy("surround71"),
    ChannelLayoutSetting::Surround71
  );
  assert_eq!(
    ChannelLayoutSetting::from_str_lossy("surround-7.1"),
    ChannelLayoutSetting::Surround71
  );
}

#[test]
fn as_str_round_trips_surround71() {
  assert_eq!(ChannelLayoutSetting::Surround71.as_str(), "7.1");
}
```

- [ ] **Step 2: Run to verify failure**

```
npm run rust:test 2>&1 | Select-String "FAILED|error"
```

Expected: compilation error — `Surround71` variant does not exist.

- [ ] **Step 3: Implement Surround71 in channel_layout.rs**

Replace the entire `ChannelLayoutSetting` enum and `impl` block:

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ChannelLayoutSetting {
  #[default]
  Auto,
  Stereo,
  /// 5.1 (FL, FR, C, LFE, SL, SR).
  #[serde(rename = "5.1")]
  Surround51,
  /// 7.1 (FL, FR, C, LFE, BL, BR, SL, SR).
  #[serde(rename = "7.1")]
  Surround71,
}

impl ChannelLayoutSetting {
  pub fn from_str_lossy(s: &str) -> Self {
    match s.trim().to_ascii_lowercase().as_str() {
      "stereo" => Self::Stereo,
      "5.1" | "5_1" | "surround51" | "surround-5.1" | "surround_5.1" => Self::Surround51,
      "7.1" | "7_1" | "surround71" | "surround-7.1" | "surround_7.1" => Self::Surround71,
      _ => Self::Auto,
    }
  }

  pub fn as_str(&self) -> &'static str {
    match self {
      Self::Auto => "auto",
      Self::Stereo => "stereo",
      Self::Surround51 => "5.1",
      Self::Surround71 => "7.1",
    }
  }
}
```

Also update the existing test `from_str_lossy_unknown_falls_back_to_auto` — remove the `"7.1"` assertion since it now maps to `Surround71`, not `Auto`:

```rust
#[test]
fn from_str_lossy_unknown_falls_back_to_auto() {
  assert_eq!(
    ChannelLayoutSetting::from_str_lossy(""),
    ChannelLayoutSetting::Auto
  );
  assert_eq!(
    ChannelLayoutSetting::from_str_lossy("mono"),
    ChannelLayoutSetting::Auto
  );
}
```

- [ ] **Step 4: Add failing tests to meter_pipeline.rs**

Append inside the existing `mod tests` block in `src-tauri/src/engine/meter_pipeline.rs`:

```rust
#[test]
fn loudness_layout_meta_marks_71_for_manual_71() {
  let (s, known) = loudness_layout_meta(8, ChannelLayoutSetting::Surround71);
  assert_eq!(s, "7.1");
  assert!(known);
}

#[test]
fn loudness_layout_meta_downgrades_manual_71_when_channels_too_low() {
  let (s, known) = loudness_layout_meta(6, ChannelLayoutSetting::Surround71);
  assert_eq!(s, "stereo");
  assert!(!known);
}
```

- [ ] **Step 5: Update loudness_layout_meta in meter_pipeline.rs**

Replace the `loudness_layout_meta` function body:

```rust
fn loudness_layout_meta(channels: u16, channel_layout: ChannelLayoutSetting) -> (String, bool) {
  let ch = channels.max(1);
  match channel_layout {
    ChannelLayoutSetting::Stereo => ("stereo".to_string(), true),
    ChannelLayoutSetting::Surround51 => {
      if ch >= 6 {
        ("5.1".to_string(), true)
      } else {
        ("stereo".to_string(), false)
      }
    }
    ChannelLayoutSetting::Surround71 => {
      if ch >= 8 {
        ("7.1".to_string(), true)
      } else {
        ("stereo".to_string(), false)
      }
    }
    ChannelLayoutSetting::Auto => {
      if ch <= 2 {
        ("stereo".to_string(), true)
      } else {
        ("unknown".to_string(), false)
      }
    }
  }
}
```

- [ ] **Step 6: Run tests to verify all pass**

```
npm run rust:test 2>&1 | Select-String "test result|FAILED"
```

Expected: `test result: ok. N passed; 0 failed`

- [ ] **Step 7: Commit**

```
git add src-tauri/src/engine/channel_layout.rs src-tauri/src/engine/meter_pipeline.rs
git commit -m "feat(engine): add Surround71 channel layout preset"
```

---

## Task 2: Frontend — channelLayoutResolver adds 7.1

**Files:**
- Modify: `src/math/channelLayoutResolver.js`
- Modify: `src/math/channelLayoutResolver.test.js`

- [ ] **Step 1: Add failing test**

Append inside the `describe` block in `src/math/channelLayoutResolver.test.js`:

```js
it("resolves manual 7.1 preset", () => {
  expect(resolveChannelLayout("7.1")).toEqual({
    mode: "manual",
    setting: "7.1",
    resolved: "7.1",
  });
});
```

- [ ] **Step 2: Run to verify failure**

```
npm test -- channelLayoutResolver
```

Expected: FAIL — `received { mode: "auto", setting: "auto", resolved: "unknown" }`

- [ ] **Step 3: Update channelLayoutResolver.js**

Replace the entire file content:

```js
/**
 * Single owner for deciding the effective channel layout.
 *
 * Detection is not implemented yet. For now:
 * - Manual presets resolve directly.
 * - Auto resolves to `unknown` (until detection exists).
 */

/**
 * @typedef {"auto" | "stereo" | "5.1" | "7.1"} ChannelLayoutSetting
 * @typedef {"unknown" | "stereo" | "5.1" | "7.1"} ResolvedChannelLayout
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
  const channelCount = Number.isFinite(ctx?.channelCount) ? Number(ctx?.channelCount) : null;

  if (s === "stereo") return { mode: "manual", setting: "stereo", resolved: "stereo" };
  if (s === "5.1") return { mode: "manual", setting: "5.1", resolved: "5.1" };
  if (s === "7.1") return { mode: "manual", setting: "7.1", resolved: "7.1" };

  // Auto mode: detection not implemented yet.
  void channelCount;
  return { mode: "auto", setting: "auto", resolved: "unknown" };
}
```

- [ ] **Step 4: Run tests to verify all pass**

```
npm test -- channelLayoutResolver
```

Expected: all pass.

- [ ] **Step 5: Commit**

```
git add src/math/channelLayoutResolver.js src/math/channelLayoutResolver.test.js
git commit -m "feat(ui): add 7.1 channel layout resolver"
```

---

## Task 3: Frontend — Auto mode shows numbered labels

**Files:**
- Modify: `src/math/peakMeterChannelLabels.js`
- Modify: `src/math/peakMeterChannelLabels.test.js`

- [ ] **Step 1: Add failing tests**

Append inside the `describe` block in `src/math/peakMeterChannelLabels.test.js`:

```js
it("shows numbered labels when resolvedLayout is unknown, regardless of channel count", () => {
  expect(getPeakMeterChannelLabels(6, { resolvedLayout: "unknown" })).toEqual([
    "Ch 1", "Ch 2", "Ch 3", "Ch 4", "Ch 5", "Ch 6",
  ]);
  expect(getPeakMeterChannelLabels(8, { resolvedLayout: "unknown" })).toEqual([
    "Ch 1", "Ch 2", "Ch 3", "Ch 4", "Ch 5", "Ch 6", "Ch 7", "Ch 8",
  ]);
  expect(getPeakMeterChannelLabels(2, { resolvedLayout: "unknown" })).toEqual(["Ch 1", "Ch 2"]);
});

it("shows ITU labels when resolvedLayout is a known format", () => {
  expect(getPeakMeterChannelLabels(8, { resolvedLayout: "7.1" })).toEqual(
    ["L", "R", "C", "LFE", "Ls", "Rs", "Lb", "Rb"]
  );
  expect(getPeakMeterChannelLabels(6, { resolvedLayout: "5.1" })).toEqual(
    ["L", "R", "C", "LFE", "Ls", "Rs"]
  );
});
```

- [ ] **Step 2: Run to verify the unknown-layout test fails**

```
npm test -- peakMeterChannelLabels
```

Expected: FAIL on the unknown-layout test — `"Ch 1"` expected but `"L"` received for 6-channel case.

- [ ] **Step 3: Add early exit in getPeakMeterChannelLabels**

In `src/math/peakMeterChannelLabels.js`, update `getPeakMeterChannelLabels` to add the early exit **after** the `formatId` block and **before** `labelsForExactChannelCount`:

```js
export function getPeakMeterChannelLabels(channelCount, ctx = {}) {
  const n = Math.max(0, Math.floor(Number(channelCount)));
  if (n === 0) {
    return [];
  }

  if (ctx.formatId) {
    const def = PEAK_METER_CHANNEL_FORMATS[ctx.formatId];
    if (def && def.channels === n) {
      return [...def.labels];
    }
  }

  // Auto mode with unknown layout: skip name matching to avoid mislabelling channels.
  if (ctx.resolvedLayout === "unknown") {
    return Array.from({ length: n }, (_, i) => `Ch ${i + 1}`);
  }

  const exact = labelsForExactChannelCount(n);
  if (exact) {
    return exact;
  }

  return Array.from({ length: n }, (_, i) => `Ch ${i + 1}`);
}
```

- [ ] **Step 4: Run tests to verify all pass**

```
npm test -- peakMeterChannelLabels
```

Expected: all pass. Note: the existing `"maps mono, stereo, and 5.1"` and `"maps 7.1 eight-channel strip"` tests continue to pass because they call without `resolvedLayout`, so `ctx.resolvedLayout` is `undefined` (not `"unknown"`) and the early exit does not fire.

- [ ] **Step 5: Commit**

```
git add src/math/peakMeterChannelLabels.js src/math/peakMeterChannelLabels.test.js
git commit -m "fix(ui): show numbered labels in auto mode for unknown multichannel layout"
```

---

## Task 4: Frontend — 16-channel cap in peakChannelMath

**Files:**
- Modify: `src/math/peakChannelMath.js`
- Modify: `src/math/peakChannelMath.test.js`

- [ ] **Step 1: Add failing tests**

Append inside the `describe` block in `src/math/peakChannelMath.test.js`:

```js
it("caps peakDb at 16 channels", () => {
  const peakDb = Array.from({ length: 20 }, (_, i) => -(i + 1));
  const ch = getPeakChannels({ peakDb });
  expect(ch).toHaveLength(16);
  expect(ch[15].valueDb).toBe(-16);
});

it("shows numbered labels in auto/unknown layout for multichannel peakDb", () => {
  const ch = getPeakChannels(
    { peakDb: [-1, -2, -3, -4, -5, -6] },
    { resolvedLayout: "unknown" }
  );
  expect(ch.map((c) => c.label)).toEqual(["Ch 1", "Ch 2", "Ch 3", "Ch 4", "Ch 5", "Ch 6"]);
  expect(ch[0].valueDb).toBe(-1);
  expect(ch[5].valueDb).toBe(-6);
});
```

- [ ] **Step 2: Run to verify failure**

```
npm test -- peakChannelMath
```

Expected: FAIL on cap test — length is 20, expected 16.

- [ ] **Step 3: Update peakChannelMath.js**

Replace the `getPeakChannels` function:

```js
export function getPeakChannels(displayAudio, labelCtx) {
  const peakDb = Array.isArray(displayAudio?.peakDb)
    ? displayAudio.peakDb.slice(0, 16)
    : null;
  if (peakDb && peakDb.length > 0) {
    const labels = getPeakMeterChannelLabels(peakDb.length, labelCtx || {});
    return peakDb.map((v, i) => ({
      label: labels[i] ?? `Ch ${i + 1}`,
      valueDb: Number.isFinite(v) ? v : -Infinity,
    }));
  }

  const l = Number.isFinite(displayAudio?.sampleL) ? displayAudio.sampleL : -Infinity;
  const r = Number.isFinite(displayAudio?.sampleR) ? displayAudio.sampleR : -Infinity;
  return [
    { label: "L", valueDb: l },
    { label: "R", valueDb: r },
  ];
}
```

- [ ] **Step 4: Run tests to verify all pass**

```
npm test -- peakChannelMath
```

Expected: all pass.

- [ ] **Step 5: Commit**

```
git add src/math/peakChannelMath.js src/math/peakChannelMath.test.js
git commit -m "fix(ui): cap peak meter at 16 channels and propagate unknown layout labels"
```

---

## Task 5: Frontend — Settings 7.1 option + footer prompt

**Files:**
- Modify: `src/components/SettingsPanel.jsx`
- Modify: `src/App.jsx`

- [ ] **Step 1: Add 7.1 SelectItem to SettingsPanel.jsx**

In `src/components/SettingsPanel.jsx`, find the channel layout `<SelectContent>` block and add the 7.1 option after 5.1:

```jsx
<SelectContent position="popper">
  <SelectItem value="auto">Auto</SelectItem>
  <SelectItem value="stereo">Stereo</SelectItem>
  <SelectItem value="5.1">5.1</SelectItem>
  <SelectItem value="7.1">7.1</SelectItem>
</SelectContent>
```

- [ ] **Step 2: Add multichannel footer prompt to App.jsx**

In `src/App.jsx`, find the `<footer className={SHELL_FOOTER}>` block. After the closing `</span>` of the Ref LUFS value, add:

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

`layoutResolution` and `channelCount` are already in scope at this location (defined at lines 234–241 in the current file).

- [ ] **Step 3: Run full frontend test suite**

```
npm test
```

Expected: all pass.

- [ ] **Step 4: Commit**

```
git add src/components/SettingsPanel.jsx src/App.jsx
git commit -m "feat(ui): add 7.1 layout option and multichannel footer prompt"
```

---

## Task 6: C — tap_bridge.m non-interleaved fix

**File:**
- Modify: `src-tauri/native/macos/tap_bridge.m`

This task is macOS-only C code. There are no unit tests. Correctness is verified by: (a) the Rust build picking up the compiled object, and (b) manual testing on a macOS machine with a multichannel output device.

- [ ] **Step 1: Add scratch buffer fields to TapHandle**

Find the `TapHandle` typedef and replace it:

```c
typedef struct {
  AudioObjectID tap_id;
  AudioObjectID aggregate_id;
  AudioDeviceIOProcID io_proc_id;
  void *pcm_userdata;
  float *interleave_buf;
  size_t interleave_buf_capacity;
} TapHandle;
```

- [ ] **Step 2: Allocate scratch buffer in macos_tap_create**

Find the block that allocates `TapHandle *h` and sets its fields. After setting `h->pcm_userdata`, add:

```c
h->interleave_buf_capacity = 2048 * 16;
h->interleave_buf = (float *)malloc(h->interleave_buf_capacity * sizeof(float));
if (!h->interleave_buf) {
  AudioHardwareDestroyAggregateDevice(aggregate_id);
  AudioHardwareDestroyProcessTap(tap_id);
  free(h);
  if (err_out && err_cap > 0) {
    snprintf(err_out, err_cap, "failed to allocate interleave scratch buffer");
  }
  return NULL;
}
```

- [ ] **Step 3: Free scratch buffer in macos_tap_destroy**

In `macos_tap_destroy`, add before `free(h)`:

```c
if (h->interleave_buf) {
  free(h->interleave_buf);
  h->interleave_buf = NULL;
}
```

- [ ] **Step 4: Replace tap_io_proc with interleaving implementation**

Replace the entire `tap_io_proc` function:

```c
static OSStatus tap_io_proc(AudioObjectID inDevice, const AudioTimeStamp *inNow,
                             const AudioBufferList *inInputData,
                             const AudioTimeStamp *inInputTime, AudioBufferList *outOutputData,
                             const AudioTimeStamp *inOutputTime, void *inClientData) {
  (void)inDevice;
  (void)inNow;
  (void)outOutputData;
  (void)inOutputTime;
  (void)inInputTime;
  TapHandle *tap = (TapHandle *)inClientData;
  if (!tap || !inInputData || !tap->pcm_userdata) {
    return noErr;
  }

  if (inInputData->mNumberBuffers == 1) {
    const AudioBuffer *buf = &inInputData->mBuffers[0];
    if (!buf->mData || buf->mDataByteSize == 0) {
      return noErr;
    }
    UInt32 channels = buf->mNumberChannels;
    UInt32 frame_count = (UInt32)(buf->mDataByteSize / (channels * sizeof(float)));
    pcm_bridge(tap->pcm_userdata, (const float *)buf->mData, frame_count, channels);
    return noErr;
  }

  // Non-interleaved: verify consistency across buffers, then interleave into scratch buffer.
  UInt32 nbufs = inInputData->mNumberBuffers;
  UInt32 total_ch = 0;
  UInt32 frame_count = 0;
  for (UInt32 i = 0; i < nbufs; i++) {
    const AudioBuffer *buf = &inInputData->mBuffers[i];
    if (!buf->mData || buf->mDataByteSize == 0) {
      return noErr;
    }
    UInt32 ch = buf->mNumberChannels;
    UInt32 fc = (UInt32)(buf->mDataByteSize / (ch * sizeof(float)));
    if (i == 0) {
      frame_count = fc;
    } else if (fc != frame_count) {
      return noErr;
    }
    total_ch += ch;
  }
  if (frame_count == 0 || total_ch == 0) {
    return noErr;
  }
  if ((size_t)frame_count * total_ch > tap->interleave_buf_capacity) {
    return noErr;
  }

  float *dst = tap->interleave_buf;
  UInt32 ch_offset = 0;
  for (UInt32 i = 0; i < nbufs; i++) {
    const AudioBuffer *buf = &inInputData->mBuffers[i];
    UInt32 buf_ch = buf->mNumberChannels;
    const float *src = (const float *)buf->mData;
    for (UInt32 f = 0; f < frame_count; f++) {
      for (UInt32 c = 0; c < buf_ch; c++) {
        dst[f * total_ch + ch_offset + c] = src[f * buf_ch + c];
      }
    }
    ch_offset += buf_ch;
  }

  pcm_bridge(tap->pcm_userdata, tap->interleave_buf, frame_count, total_ch);
  return noErr;
}
```

- [ ] **Step 5: Verify Rust build picks up the change (Windows CI — compilation only)**

```
npm run rust:check
```

Note: the `.m` file only compiles on macOS. On Windows this step verifies the Rust side still compiles and tests pass. The Objective-C compilation is confirmed by the macOS build.

- [ ] **Step 6: Commit**

```
git add src-tauri/native/macos/tap_bridge.m
git commit -m "fix(macos): interleave non-interleaved Core Audio buffers before peak metering"
```

- [ ] **Step 7: Manual verification on macOS**

On a macOS machine with a multichannel output device (5.1 or 7.1):
1. Select the multichannel output as the capture device
2. Play multichannel audio
3. Confirm Peak meter shows N filled bars (not empty / -∞)
4. Confirm bar count matches the device's channel count
5. Confirm Loudness and Spectrum panels continue to work normally
