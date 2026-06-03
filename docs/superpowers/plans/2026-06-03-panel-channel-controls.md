# Panel Channel Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Vectorscope, Spectrum, and Spectrogram channel controls into panel headers while preserving snapshot and history semantics.

**Architecture:** Keep selection state in `App.jsx` and render a small `PanelChannelSelector` from `LeafView` for supported active tabs. Extend `FrameIntake` with aligned frequency markers and per-tick channel metadata so Spectrogram history stays linked to Loudness history. Reset only `SpectrumMeter` when the selected frequency channel changes by detecting the change inside `MeterPipeline`.

**Tech Stack:** React 19, Radix Select wrappers in `src/components/ui/select.jsx`, Vitest + Testing Library, Rust/Tauri, Cargo tests.

---

## File Structure

- Create `src/components/PanelChannelSelector.jsx`
  - Small header chip selector for `vectorscope`, `spectrum`, and `spectrogram`.
  - Pure UI plus callback dispatch; no history or DSP logic.
- Create `src/components/PanelChannelSelector.test.jsx`
  - Component-level coverage for visibility, labels, and callbacks.
- Modify `src/workspace/LeafView.jsx`
  - Render `PanelChannelSelector` in the header action area before fullscreen/hide.
- Modify `src/App.jsx`
  - Pass selector options, live labels, snapshot labels, and callbacks through `AudioDataContext`.
  - Exit snapshot before applying channel changes from header controls.
  - Record pending frequency markers and per-tick metadata through `FrameIntake`.
- Modify `src/components/SettingsPanel.jsx`
  - Remove Vectorscope and Spectrum channel selector props and UI.
- Modify `src/components/SettingsPanel.test.jsx`
  - Assert removed controls are absent.
- Modify `src/components/panels/SpectrumPanel.jsx`
  - Remove the legacy `All channels (summed)` overlay.
- Modify `src/components/panels/SpectrogramPanel.jsx`
  - Render visible frequency channel change markers.
- Modify `src/lib/FrameIntake.js`
  - Add aligned marker and metadata rings.
- Modify `src/lib/FrameIntake.test.js`
  - Cover pending marker write, ring alignment, and metadata lookup.
- Modify `src/hooks/useSnapshot.js`
  - Freeze and return selected tick channel metadata.
- Modify `src/hooks/useSnapshot.test.jsx`
  - Cover snapshot-aware labels.
- Modify `src-tauri/src/engine/meter_pipeline.rs`
  - Track previous `SpectrumChannelSel` and reset `SpectrumMeter` when it changes.
- Modify `src-tauri/src/dsp/spectrum.rs`
  - Keep existing selected-channel tests passing after the pipeline reset change.

---

## Task 1: Backend Frequency Reset

**Files:**
- Modify: `src-tauri/src/engine/meter_pipeline.rs`
- Test: `src-tauri/src/engine/meter_pipeline.rs`

- [ ] **Step 1: Add the failing Rust test**

Add this test module case near existing `meter_pipeline.rs` tests, or create the `#[cfg(test)] mod tests` block at the bottom if the file does not have one:

```rust
#[cfg(test)]
mod tests {
  use super::*;
  use crate::dsp::SpectrumChannelSel;
  use crate::engine::ChannelLayoutSetting;
  use std::collections::VecDeque;
  use std::sync::{Arc, Mutex};

  fn tone_on_channel(frames: usize, channels: usize, sr: f64, hz: f64, ch: usize) -> Vec<f32> {
    let mut pcm = vec![0.0_f32; frames * channels];
    for i in 0..frames {
      let s = (2.0 * std::f64::consts::PI * hz * i as f64 / sr).sin() as f32;
      pcm[i * channels + ch] = s;
    }
    pcm
  }

  #[test]
  fn changing_spectrum_channel_resets_frequency_meter_without_clearing_history() {
    let sr = 48_000_u32;
    let channels = 6_u16;
    let history = Arc::new(Mutex::new(VecDeque::new()));
    let mut pipeline = MeterPipeline::new(sr, channels, history.clone());
    let pcm_lr = tone_on_channel(4096 * 8, channels as usize, sr as f64, 1000.0, 0);
    let pcm_c = tone_on_channel(4096 * 8, channels as usize, sr as f64, 500.0, 2);

    let _ = pipeline.push_pcm_f32(
      &pcm_lr,
      (0, 1),
      ChannelLayoutSetting::Auto,
      SpectrumChannelSel::Pair(0, 1),
    );
    pipeline.clear_peak_and_history();
    assert_eq!(history.lock().unwrap().len(), 0);

    let _ = pipeline.push_pcm_f32(
      &pcm_lr,
      (0, 1),
      ChannelLayoutSetting::Auto,
      SpectrumChannelSel::Pair(0, 1),
    );
    let (_, before_change, _) = pipeline.spectrum.last_output();
    assert!(
      !before_change.is_empty(),
      "spectrum should produce output before the channel change"
    );

    let _ = pipeline.push_pcm_f32(
      &pcm_c,
      (0, 1),
      ChannelLayoutSetting::Auto,
      SpectrumChannelSel::Single(2),
    );
    let (_, immediately_after_change, _) = pipeline.spectrum.last_output();
    assert!(
      immediately_after_change.is_empty(),
      "spectrum output should be reset immediately after selecting a new channel"
    );
    assert_eq!(
      history.lock().unwrap().len(),
      0,
      "frequency reset must not repopulate or clear global meter history"
    );
  }
}
```

- [ ] **Step 2: Run the backend test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml changing_spectrum_channel_resets_frequency_meter_without_clearing_history`

Expected: FAIL because `MeterPipeline` does not yet track `last_spectrum_channel`, or because the test cannot access `pipeline.spectrum` while it is private.

- [ ] **Step 3: Make the minimal backend implementation**

Change `MeterPipeline` so tests and implementation can verify the reset. Add a field and initialize it:

```rust
pub struct MeterPipeline {
  channels: u16,
  loudness: LoudnessMeter,
  pub(crate) spectrum: SpectrumMeter,
  vectorscope: VectorscopeMeter,
  last_spectrum_channel: SpectrumChannelSel,
  last_loudness: Option<LoudnessBlock>,
  m_max: f64,
  st_max: f64,
  tp_max_db: f64,
  sample_peak_max_l: f64,
  sample_peak_max_r: f64,
  meter_history: MeterHistoryBuf,
  t0: Instant,
  last_frame_emit: Instant,
  last_slow_emit: Instant,
  last_hist_emit: Instant,
  pending_loudness_hist: Option<(f64, f64)>,
}
```

In `MeterPipeline::new`:

```rust
last_spectrum_channel: SpectrumChannelSel::default(),
```

In `push_pcm_f32`, before creating `PcmContext`:

```rust
if spectrum_channel != self.last_spectrum_channel {
  self.spectrum.reset();
  self.last_spectrum_channel = spectrum_channel;
}
```

- [ ] **Step 4: Run the backend test to verify it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml changing_spectrum_channel_resets_frequency_meter_without_clearing_history`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/engine/meter_pipeline.rs
git commit -m "fix(backend): reset spectrum state on channel change"
```

---

## Task 2: FrameIntake Marker And Metadata Rings

**Files:**
- Modify: `src/lib/FrameIntake.js`
- Test: `src/lib/FrameIntake.test.js`

- [ ] **Step 1: Add failing `FrameIntake` tests**

Add these tests to `src/lib/FrameIntake.test.js`:

```js
it("writes a pending frequency marker on the next history row", () => {
  const intake = new FrameIntake();
  intake.setCurrentChannelMetadata({
    frequencyLabel: "C",
    vectorscopePairLabel: "L/R",
  });
  intake.setPendingFrequencyMarker({ from: "L/R", to: "C" });

  intake.pushHistRow(makeRow(), HIST_MAX, SR);

  expect(intake.getFrequencyChannelMarkers()).toEqual([
    { type: "frequencyChannelChange", from: "L/R", to: "C" },
  ]);
  expect(intake.getChannelMetadataSnap()).toEqual([
    { frequencyLabel: "C", vectorscopePairLabel: "L/R" },
  ]);
});

it("keeps frequency markers and metadata aligned with loudness history", () => {
  const intake = new FrameIntake();
  intake.setCurrentChannelMetadata({
    frequencyLabel: "L/R",
    vectorscopePairLabel: "L/R",
  });

  intake.pushHistRow(makeRow(), HIST_MAX, SR);
  intake.pushHistRow(makeRow(), HIST_MAX, SR);

  expect(intake.getLoudnessHistory()).toHaveLength(2);
  expect(intake.getFrequencyChannelMarkers()).toEqual([null, null]);
  expect(intake.getChannelMetadataSnap()).toEqual([
    { frequencyLabel: "L/R", vectorscopePairLabel: "L/R" },
    { frequencyLabel: "L/R", vectorscopePairLabel: "L/R" },
  ]);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- src/lib/FrameIntake.test.js`

Expected: FAIL because the new methods do not exist.

- [ ] **Step 3: Implement marker and metadata rings**

In the constructor, add:

```js
this._frequencyChannelMarkers = [];
this._channelMetadataSnap = [];
this._pendingFrequencyMarker = null;
this._currentChannelMetadata = {
  frequencyLabel: "L/R",
  vectorscopePairLabel: "L/R",
};
```

Add methods:

```js
setPendingFrequencyMarker(marker) {
  this._pendingFrequencyMarker = marker
    ? { type: "frequencyChannelChange", from: marker.from, to: marker.to }
    : null;
}

setCurrentChannelMetadata(metadata) {
  this._currentChannelMetadata = {
    frequencyLabel: metadata?.frequencyLabel || this._currentChannelMetadata.frequencyLabel,
    vectorscopePairLabel:
      metadata?.vectorscopePairLabel || this._currentChannelMetadata.vectorscopePairLabel,
  };
}

getFrequencyChannelMarkers() {
  return this._frequencyChannelMarkers;
}

getChannelMetadataSnap() {
  return this._channelMetadataSnap;
}
```

In `pushHistRow`, after the existing spectrum data ring push:

```js
ringPush(this._frequencyChannelMarkers, this._pendingFrequencyMarker, histMaxSamples);
ringPush(this._channelMetadataSnap, { ...this._currentChannelMetadata }, histMaxSamples);
this._pendingFrequencyMarker = null;
```

In `reset`, add:

```js
this._frequencyChannelMarkers = [];
this._channelMetadataSnap = [];
this._pendingFrequencyMarker = null;
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test -- src/lib/FrameIntake.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/FrameIntake.js src/lib/FrameIntake.test.js
git commit -m "feat(frontend): track frequency channel history markers"
```

---

## Task 3: Snapshot-Aware Channel Labels

**Files:**
- Modify: `src/hooks/useSnapshot.js`
- Test: `src/hooks/useSnapshot.test.jsx`

- [ ] **Step 1: Add failing snapshot metadata test**

Add or extend a `useSnapshot` test with a fake intake:

```jsx
it("returns channel metadata for the selected snapshot tick", () => {
  const intake = {
    getLoudnessHistory: () => [{ m: -20, st: -18 }, { m: -21, st: -19 }],
    getSpectrumSnap: () => ["old-spectrum", "new-spectrum"],
    getSpectrumDataSnap: () => [{ dbList: [-20] }, { dbList: [-30] }],
    getVectorSnap: () => ["old-vector", "new-vector"],
    getCorrSnap: () => [0.1, 0.2],
    getAudioSnap: () => [{ correlation: 0.1 }, { correlation: 0.2 }],
    getSpectrumData: () => ({ dbList: [-1] }),
    getChannelMetadataSnap: () => [
      { frequencyLabel: "L/R", vectorscopePairLabel: "L/R" },
      { frequencyLabel: "C", vectorscopePairLabel: "L/C" },
    ],
  };

  const { result } = renderHook(() =>
    useSnapshot({
      selectedOffset: 0,
      sampleSec: 0.1,
      intake,
      audio: { correlation: 0 },
      spectrumPath: "live-spectrum",
      spectrumPeakPath: "live-peak",
      vectorPath: "live-vector",
    })
  );

  expect(result.current.channelMetadata).toEqual({
    frequencyLabel: "C",
    vectorscopePairLabel: "L/C",
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm test -- src/hooks/useSnapshot.test.jsx`

Expected: FAIL because `channelMetadata` is not returned.

- [ ] **Step 3: Extend `useSnapshot`**

Update `freezeSnapshot`:

```js
function freezeSnapshot(intake) {
  return {
    loudness: [...intake.getLoudnessHistory()],
    spectrum: [...intake.getSpectrumSnap()],
    spectrumData: [...intake.getSpectrumDataSnap()],
    vector: [...intake.getVectorSnap()],
    corr: [...intake.getCorrSnap()],
    audio: [...intake.getAudioSnap()],
    channelMetadata: [...(intake.getChannelMetadataSnap?.() ?? [])],
  };
}
```

Add source and selected metadata:

```js
const snapChannelMetadataList = snapSource
  ? snapSource.channelMetadata
  : (intake.getChannelMetadataSnap?.() ?? []);
const channelMetadata =
  snapIdx >= 0 && snapChannelMetadataList[snapIdx] ? snapChannelMetadataList[snapIdx] : null;
```

Return it:

```js
channelMetadata,
```

- [ ] **Step 4: Run test to verify pass**

Run: `npm test -- src/hooks/useSnapshot.test.jsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useSnapshot.js src/hooks/useSnapshot.test.jsx
git commit -m "feat(frontend): expose snapshot channel metadata"
```

---

## Task 4: Header Channel Selector Component

**Files:**
- Create: `src/components/PanelChannelSelector.jsx`
- Create: `src/components/PanelChannelSelector.test.jsx`

- [ ] **Step 1: Add failing component tests**

Create `src/components/PanelChannelSelector.test.jsx`:

```jsx
/** @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PanelChannelSelector } from "./PanelChannelSelector.jsx";

beforeEach(() => {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});

describe("PanelChannelSelector", () => {
  it("does not render below multichannel", () => {
    const { container } = render(
      <PanelChannelSelector
        activeTab="spectrum"
        channelCount={2}
        spectrumOptions={[{ key: "p-0-1", label: "L/R", sel: { type: "pair", x: 0, y: 1 } }]}
        spectrumValueKey="p-0-1"
        spectrumDisplayLabel="L/R"
        onSpectrumChange={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders spectrum label for Spectrum and Spectrogram", () => {
    for (const activeTab of ["spectrum", "spectrogram"]) {
      render(
        <PanelChannelSelector
          activeTab={activeTab}
          channelCount={6}
          spectrumOptions={[{ key: "s-2", label: "C", sel: { type: "single", ch: 2 } }]}
          spectrumValueKey="s-2"
          spectrumDisplayLabel="C"
          onSpectrumChange={vi.fn()}
        />
      );
      expect(screen.getByLabelText(`${activeTab} channel`)).toBeTruthy();
      expect(screen.getByText("C")).toBeTruthy();
    }
  });

  it("calls vectorscope change with the selected pair", () => {
    const onVectorscopeChange = vi.fn();
    render(
      <PanelChannelSelector
        activeTab="vectorscope"
        channelCount={6}
        vectorscopeOptions={[
          { key: "0-1", label: "L/R", x: 0, y: 1 },
          { key: "0-2", label: "L/C", x: 0, y: 2 },
        ]}
        vectorscopeValueKey="0-1"
        vectorscopeDisplayLabel="L/R"
        onVectorscopeChange={onVectorscopeChange}
      />
    );

    fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
    fireEvent.click(screen.getByText("L/C"));

    expect(onVectorscopeChange).toHaveBeenCalledWith({ x: 0, y: 2 });
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- src/components/PanelChannelSelector.test.jsx`

Expected: FAIL because `PanelChannelSelector.jsx` does not exist.

- [ ] **Step 3: Implement `PanelChannelSelector`**

Create `src/components/PanelChannelSelector.jsx`:

```jsx
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function ChannelTrigger({ label, ariaLabel }) {
  return (
    <SelectTrigger
      aria-label={ariaLabel}
      className="h-6 min-w-0 max-w-[6rem] rounded-md border-border/70 bg-transparent px-2 py-0 text-[11px] text-muted-foreground shadow-none hover:bg-secondary hover:text-foreground focus:ring-0 focus:ring-offset-0"
    >
      <SelectValue>{label}</SelectValue>
    </SelectTrigger>
  );
}

export function PanelChannelSelector({
  activeTab,
  channelCount = 0,
  vectorscopeOptions = [],
  vectorscopeValueKey = "",
  vectorscopeDisplayLabel = "",
  onVectorscopeChange,
  spectrumOptions = [],
  spectrumValueKey = "",
  spectrumDisplayLabel = "",
  onSpectrumChange,
}) {
  if (!Number.isFinite(channelCount) || channelCount <= 2) return null;

  if (activeTab === "vectorscope" && vectorscopeOptions.length > 0) {
    return (
      <Select
        value={vectorscopeValueKey}
        onValueChange={(key) => {
          const opt = vectorscopeOptions.find((o) => o.key === key);
          if (opt && typeof onVectorscopeChange === "function") {
            onVectorscopeChange({ x: opt.x, y: opt.y });
          }
        }}
      >
        <ChannelTrigger label={vectorscopeDisplayLabel} ariaLabel="vectorscope channel" />
        <SelectContent align="end" sideOffset={6}>
          {vectorscopeOptions.map((opt) => (
            <SelectItem key={opt.key} value={opt.key}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if ((activeTab === "spectrum" || activeTab === "spectrogram") && spectrumOptions.length > 0) {
    return (
      <Select
        value={spectrumValueKey}
        onValueChange={(key) => {
          const opt = spectrumOptions.find((o) => o.key === key);
          if (opt && typeof onSpectrumChange === "function") onSpectrumChange(opt.sel);
        }}
      >
        <ChannelTrigger label={spectrumDisplayLabel} ariaLabel={`${activeTab} channel`} />
        <SelectContent align="end" sideOffset={6}>
          {spectrumOptions.map((opt) => (
            <SelectItem key={opt.key} value={opt.key}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  return null;
}
```

- [ ] **Step 4: Run component tests**

Run: `npm test -- src/components/PanelChannelSelector.test.jsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/PanelChannelSelector.jsx src/components/PanelChannelSelector.test.jsx
git commit -m "feat(frontend): add panel channel selector"
```

---

## Task 5: Wire Header Selector Through App And LeafView

**Files:**
- Modify: `src/App.jsx`
- Modify: `src/workspace/LeafView.jsx`
- Test: `src/components/PanelChannelSelector.test.jsx`

- [ ] **Step 1: Add wiring expectations to component tests**

Extend tests to include snapshot label props:

```jsx
it("uses snapshot display label when provided by the caller", () => {
  render(
    <PanelChannelSelector
      activeTab="spectrum"
      channelCount={6}
      spectrumOptions={[{ key: "p-0-1", label: "L/R", sel: { type: "pair", x: 0, y: 1 } }]}
      spectrumValueKey="p-0-1"
      spectrumDisplayLabel="Historical L/R"
      onSpectrumChange={vi.fn()}
    />
  );

  expect(screen.getByText("Historical L/R")).toBeTruthy();
});
```

- [ ] **Step 2: Run test to verify it passes before wiring**

Run: `npm test -- src/components/PanelChannelSelector.test.jsx`

Expected: PASS.

- [ ] **Step 3: Add selector data to `App.jsx`**

Import `formatVectorscopePairLabel` if it is not already imported:

```js
import {
  buildVectorscopePairOptions,
  clampVectorscopePairToAvailable,
  formatVectorscopePairLabel,
} from "./math/vectorscopePairMath.js";
```

Add helpers near spectrum options:

```js
const spectrumValueKey =
  spectrumChannelUi.type === "pair"
    ? `p-${spectrumChannelUi.x}-${spectrumChannelUi.y}`
    : `s-${spectrumChannelUi.ch}`;
const spectrumLiveLabel =
  spectrumChannelOptions.find((o) => o.key === spectrumValueKey)?.label ??
  spectrumChannelOptions[0]?.label ??
  "L/R";
const vectorscopeValueKey = `${vectorscopePairUi.x}-${vectorscopePairUi.y}`;
const vectorscopeChannelLabels = getPeakMeterChannelLabels(
  channelCount >= 2 ? channelCount : 2,
  vectorscopeLabelContext
);
const vectorscopeLiveLabel = formatVectorscopePairLabel({
  x: vectorscopePairUi.x,
  y: vectorscopePairUi.y,
  channelLabels: vectorscopeChannelLabels,
});
```

When `channelMetadata` comes from `useSnapshot`, compute display labels:

```js
const spectrumDisplayLabel = channelMetadata?.frequencyLabel ?? spectrumLiveLabel;
const vectorscopeDisplayLabel = channelMetadata?.vectorscopePairLabel ?? vectorscopeLiveLabel;
```

Add to `audioData`:

```js
vectorscopePairOptions,
vectorscopeValueKey,
vectorscopeDisplayLabel,
onVectorscopePairChange,
spectrumChannelOptions,
spectrumValueKey,
spectrumDisplayLabel,
onSpectrumChannelChange,
```

- [ ] **Step 4: Update metadata before history ticks**

Add an effect:

```js
useEffect(() => {
  intakeRef.current.setCurrentChannelMetadata({
    frequencyLabel: spectrumLiveLabel,
    vectorscopePairLabel: vectorscopeLiveLabel,
  });
}, [spectrumLiveLabel, vectorscopeLiveLabel]);
```

Update `onSpectrumChannelChange`:

```js
const onSpectrumChannelChange = async (sel) => {
  const prevLabel = spectrumLiveLabel;
  const nextKey = sel.type === "pair" ? `p-${sel.x}-${sel.y}` : `s-${sel.ch}`;
  const nextLabel = spectrumChannelOptions.find((o) => o.key === nextKey)?.label ?? prevLabel;
  if (selectedOffsetRef.current >= 0) setSelectedOffset(-1);
  setSpectrumChannelUi(sel);
  spectrumChannelRef.current = sel;
  if (running && prevLabel !== nextLabel) {
    intakeRef.current.setPendingFrequencyMarker({ from: prevLabel, to: nextLabel });
  }
  if (!isTauri()) return;
  try {
    await setSpectrumChannel(sel);
  } catch (_) {}
};
```

Update `onVectorscopePairChange`:

```js
const onVectorscopePairChange = async (pair) => {
  if (selectedOffsetRef.current >= 0) setSelectedOffset(-1);
  setVectorscopePairUi(pair);
  if (!isTauri()) return;
  try {
    await setVectorscopePair({ x: pair.x, y: pair.y });
  } catch (_) {}
};
```

- [ ] **Step 5: Render in `LeafView`**

Import:

```js
import { useAudioData } from "./AudioDataContext.jsx";
import { PanelChannelSelector } from "../components/PanelChannelSelector.jsx";
```

Inside `LeafView`:

```js
const audioData = useAudioData();
```

Before the fullscreen button:

```jsx
<PanelChannelSelector
  activeTab={activeTab}
  channelCount={audioData?.channelCount ?? 0}
  vectorscopeOptions={audioData?.vectorscopePairOptions ?? []}
  vectorscopeValueKey={audioData?.vectorscopeValueKey ?? ""}
  vectorscopeDisplayLabel={audioData?.vectorscopeDisplayLabel ?? ""}
  onVectorscopeChange={audioData?.onVectorscopePairChange}
  spectrumOptions={audioData?.spectrumChannelOptions ?? []}
  spectrumValueKey={audioData?.spectrumValueKey ?? ""}
  spectrumDisplayLabel={audioData?.spectrumDisplayLabel ?? ""}
  onSpectrumChange={audioData?.onSpectrumChannelChange}
/>
```

- [ ] **Step 6: Run focused frontend checks**

Run: `npm test -- src/components/PanelChannelSelector.test.jsx src/hooks/useSnapshot.test.jsx src/lib/FrameIntake.test.js`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/App.jsx src/workspace/LeafView.jsx src/components/PanelChannelSelector.test.jsx
git commit -m "feat(frontend): wire channel selector into panel headers"
```

---

## Task 6: Settings And Spectrum Cleanup

**Files:**
- Modify: `src/components/SettingsPanel.jsx`
- Modify: `src/components/SettingsPanel.test.jsx`
- Modify: `src/components/panels/SpectrumPanel.jsx`

- [ ] **Step 1: Add failing Settings cleanup test**

Add to `SettingsPanel.test.jsx`:

```jsx
it("does not render panel-specific channel selectors", () => {
  render(
    <SettingsPanel
      {...BASE_PROPS}
      vectorscopePairOptions={[{ key: "0-1", label: "L/R", x: 0, y: 1 }]}
      spectrumChannelOptions={[{ key: "p-0-1", label: "L/R", sel: { type: "pair", x: 0, y: 1 } }]}
    />
  );

  expect(screen.queryByText("Vectorscope channels")).toBeNull();
  expect(screen.queryByText("Spectrum channel")).toBeNull();
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm test -- src/components/SettingsPanel.test.jsx`

Expected: FAIL because the labels still render.

- [ ] **Step 3: Remove Settings selector props and UI**

In `SettingsPanel.jsx`, remove these props:

```js
vectorscopePairOptions = [],
vectorscopePairX = 0,
vectorscopePairY = 1,
onVectorscopePairChange,
spectrumChannelOptions = [],
spectrumChannelSel = null,
onSpectrumChannelChange,
```

Remove:

```js
const vsKey = `${vectorscopePairX}-${vectorscopePairY}`;
```

Delete the JSX blocks that render `Vectorscope channels` and `Spectrum channel`, including their separators when they only exist for those controls.

In `App.jsx`, remove the matching props from `<SettingsPanel />`.

- [ ] **Step 4: Remove Spectrum legacy caption**

In `SpectrumPanel.jsx`, delete:

```js
const isSummedMultichannel = Number.isFinite(channelCount) && channelCount > 2;
```

Delete the JSX block that renders:

```jsx
All channels (summed)
```

Keep `channelCount` only if another part of `SpectrumPanel` still uses it; otherwise remove it from the destructured audio data.

- [ ] **Step 5: Run Settings tests**

Run: `npm test -- src/components/SettingsPanel.test.jsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/SettingsPanel.jsx src/components/SettingsPanel.test.jsx src/components/panels/SpectrumPanel.jsx src/App.jsx
git commit -m "refactor(frontend): move channel controls out of settings"
```

---

## Task 7: Spectrogram Marker Rendering

**Files:**
- Modify: `src/components/panels/SpectrogramPanel.jsx`

- [ ] **Step 1: Add marker data to audio context in `App.jsx`**

Add a ref-compatible accessor:

```js
const frequencyMarkerRef = useMemo(
  () => ({
    get current() {
      return intakeRef.current.getFrequencyChannelMarkers();
    },
  }),
  []
);
```

Add to `audioData`:

```js
frequencyMarkerRef,
```

- [ ] **Step 2: Render visible markers in `SpectrogramPanel`**

Destructure:

```js
frequencyMarkerRef,
```

Compute visible markers:

```js
const visibleFrequencyMarkers = useMemo(() => {
  const markers = frequencyMarkerRef?.current ?? [];
  if (!markers.length || visibleSamples <= 0 || totalSamples <= 0) return [];
  const newestVisible = totalSamples - 1 - effectiveOffsetSamples;
  const oldestVisible = newestVisible - visibleSamples + 1;
  return markers
    .map((marker, idx) => ({ marker, idx }))
    .filter(({ marker, idx }) => marker && idx >= oldestVisible && idx <= newestVisible)
    .map(({ marker, idx }) => ({
      marker,
      x: ((idx - oldestVisible) / Math.max(1, visibleSamples - 1)) * 1000,
    }));
}, [frequencyMarkerRef, effectiveOffsetSamples, visibleSamples, totalSamples]);
```

Inside the chart overlay SVG that already renders the selection line, render marker lines:

```jsx
{visibleFrequencyMarkers.map(({ marker, x }) => (
  <line
    key={`${x}-${marker.from}-${marker.to}`}
    x1={x}
    x2={x}
    y1={0}
    y2={1000}
    stroke="var(--muted-foreground)"
    strokeWidth="1"
    strokeDasharray="2 4"
    opacity="0.55"
    vectorEffect="non-scaling-stroke"
  >
    <title>{`Frequency channel changed: ${marker.from} -> ${marker.to}`}</title>
  </line>
))}
```

If the selection-line SVG only exists when `selectedOffset >= 0`, split it into an always-present overlay SVG whenever markers or selection are visible:

```jsx
{(selectedOffset >= 0 && showSelLine) || visibleFrequencyMarkers.length > 0 ? (
  <svg
    viewBox="0 0 1000 1000"
    preserveAspectRatio="none"
    className="pointer-events-none absolute inset-0 h-full w-full"
  >
    {/* marker lines first, selection line after */}
  </svg>
) : null}
```

- [ ] **Step 3: Run focused frontend tests**

Run: `npm test -- src/lib/FrameIntake.test.js src/hooks/useSnapshot.test.jsx`

Expected: PASS. If a Spectrogram component test exists or is added, run it too.

- [ ] **Step 4: Commit**

```bash
git add src/App.jsx src/components/panels/SpectrogramPanel.jsx
git commit -m "feat(frontend): show spectrogram channel change markers"
```

---

## Task 8: Final Verification

**Files:**
- Verify all changed files.

- [ ] **Step 1: Run frontend focused tests**

Run: `npm test -- src/components/PanelChannelSelector.test.jsx src/components/SettingsPanel.test.jsx src/lib/FrameIntake.test.js src/hooks/useSnapshot.test.jsx`

Expected: PASS.

- [ ] **Step 2: Run Rust focused tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml changing_spectrum_channel_resets_frequency_meter_without_clearing_history`

Expected: PASS.

- [ ] **Step 3: Run lint**

Run: `npm run lint`

Expected: PASS.

- [ ] **Step 4: Run broader test suites**

Run: `npm test`

Expected: PASS.

Run: `npm run rust:test`

Expected: PASS.

- [ ] **Step 5: Manual smoke test**

Run: `npm run desktop`

Expected checks:

- Settings has no Vectorscope/Spectrum channel selectors.
- Vectorscope header shows a pair chip only for multichannel input.
- Spectrum and Spectrogram headers show the same frequency chip for multichannel input.
- Changing Spectrum chip changes Spectrogram chip.
- Changing Spectrogram chip changes Spectrum chip.
- Spectrogram timeline stays aligned with Loudness after a channel change.
- Spectrogram shows a vertical marker at the channel-change point.
- Selecting a history snapshot changes header labels to the selected tick's metadata.
- Changing a chip while in snapshot mode returns to live.

- [ ] **Step 6: Commit any verification fixes**

If verification required fixes in the files covered by this plan:

```bash
git add src/App.jsx src/workspace/LeafView.jsx src/components/PanelChannelSelector.jsx src/components/PanelChannelSelector.test.jsx src/components/SettingsPanel.jsx src/components/SettingsPanel.test.jsx src/components/panels/SpectrumPanel.jsx src/components/panels/SpectrogramPanel.jsx src/lib/FrameIntake.js src/lib/FrameIntake.test.js src/hooks/useSnapshot.js src/hooks/useSnapshot.test.jsx src-tauri/src/engine/meter_pipeline.rs
git commit -m "fix(frontend): polish panel channel controls"
```

If no fixes were needed, do not create an empty commit.

---

## Self-Review

- Spec coverage: The plan covers header selectors, Settings cleanup, Spectrum caption removal, shared Spectrum/Spectrogram selection, Spectrogram markers, snapshot-aware labels, backend frequency reset, tests, and manual checks.
- Red-flag scan: Each task names exact files, commands, and expected outcomes.
- Type consistency: `spectrumChannelUi`, `vectorscopePairUi`, `frequencyLabel`, `vectorscopePairLabel`, `frequencyMarkerRef`, `getFrequencyChannelMarkers`, and `getChannelMetadataSnap` are introduced once and reused consistently.
