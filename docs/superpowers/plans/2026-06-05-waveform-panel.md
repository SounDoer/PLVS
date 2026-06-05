# Waveform Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Waveform panel that shows a per-channel DAW-style amplitude envelope (min/max waveform shape) scrolling in time, linked to the Loudness History time window.

**Architecture:** Add `waveform_min`/`waveform_max` arrays to `MeterHistoryEntry` by accumulating per-channel PCM min/max in `MeterPipeline` and emitting on each ~10Hz history tick. The frontend slices the visible history window and renders one canvas lane per channel. Time-axis navigation reuses existing `effectiveOffsetSamples` and `visibleSamples` from `AudioDataContext` — no new IPC channels needed. One new field (`histSourceList`) must be added to the `audioData` object so panels can access raw history entries.

**Tech Stack:** Rust (serde structs, Vec<f32> accumulator), React (JSX, canvas 2D, ResizeObserver), Vitest (unit tests), Tailwind/CSS variables.

---

### Task 1: Backend — per-channel waveform accumulator + history fields

**Files:**
- Modify: `src-tauri/src/ipc/types.rs`
- Modify: `src-tauri/src/engine/meter_pipeline.rs`

- [ ] **Step 1: Add two fields to `MeterHistoryEntry` in `src-tauri/src/ipc/types.rs`**

The struct currently ends with:
```rust
  pub loudness_layout: String,
  pub loudness_layout_known: bool,
}
```

Append after `loudness_layout_known`:
```rust
  /// Per-channel linear amplitude minimum over this ~100ms history window. Length == channel count.
  pub waveform_min: Vec<f32>,
  /// Per-channel linear amplitude maximum over this ~100ms history window. Length == channel count.
  pub waveform_max: Vec<f32>,
```

- [ ] **Step 2: Add accumulator fields to `MeterPipeline` struct in `src-tauri/src/engine/meter_pipeline.rs`**

The struct currently ends with:
```rust
  pending_loudness_hist: Option<(f64, f64)>,
}
```

Append after `pending_loudness_hist`:
```rust
  /// Running per-channel min since last history tick. Sentinel INFINITY = no samples seen yet.
  waveform_min_acc: Vec<f32>,
  /// Running per-channel max since last history tick. Sentinel NEG_INFINITY = no samples seen yet.
  waveform_max_acc: Vec<f32>,
```

- [ ] **Step 3: Initialize accumulators in `MeterPipeline::new()`**

In the `Self { ... }` constructor, after `pending_loudness_hist: None,`, add:
```rust
      waveform_min_acc: vec![f32::INFINITY; channels.max(1) as usize],
      waveform_max_acc: vec![f32::NEG_INFINITY; channels.max(1) as usize],
```

- [ ] **Step 4: Accumulate min/max in `push_pcm_f32`**

In `push_pcm_f32`, find the line:
```rust
    let peak_db = sample_peak_db_per_channel_interleaved(interleaved, ch);
```

Immediately after it, add:
```rust
    // Accumulate per-channel waveform min/max for the next history tick.
    let ch_usize = ch as usize;
    let frames_count = interleaved.len() / ch_usize;
    for f in 0..frames_count {
      let base = f * ch_usize;
      for c in 0..ch_usize {
        if c < self.waveform_min_acc.len() {
          let s = interleaved[base + c];
          if s < self.waveform_min_acc[c] {
            self.waveform_min_acc[c] = s;
          }
          if s > self.waveform_max_acc[c] {
            self.waveform_max_acc[c] = s;
          }
        }
      }
    }
```

- [ ] **Step 5: Emit and reset in the history tick assembly block**

In `push_pcm_f32`, find the line:
```rust
    let loudness_hist_tick = if let Some((m, st)) = self.pending_loudness_hist.take() {
      let entry = MeterHistoryEntry {
```

Just before `let entry = MeterHistoryEntry {`, add:
```rust
      let waveform_min: Vec<f32> = self
        .waveform_min_acc
        .iter()
        .map(|&v| if v == f32::INFINITY { 0.0 } else { v })
        .collect();
      let waveform_max: Vec<f32> = self
        .waveform_max_acc
        .iter()
        .map(|&v| if v == f32::NEG_INFINITY { 0.0 } else { v })
        .collect();
      self.waveform_min_acc.fill(f32::INFINITY);
      self.waveform_max_acc.fill(f32::NEG_INFINITY);
```

Then inside the `MeterHistoryEntry { ... }` initializer, after `loudness_layout_known,`, add:
```rust
        waveform_min,
        waveform_max,
```

- [ ] **Step 6: Reset accumulators in `clear_peak_and_history()`**

In `clear_peak_and_history`, after `self.last_loudness = None;`, add:
```rust
    self.waveform_min_acc.fill(f32::INFINITY);
    self.waveform_max_acc.fill(f32::NEG_INFINITY);
```

- [ ] **Step 7: Update `dummy_history_entry()` test helper**

The `dummy_history_entry()` function in `#[cfg(test)] mod tests` constructs `MeterHistoryEntry` directly. The struct now requires the two new fields. Add after `loudness_layout_known: true,`:
```rust
      waveform_min: vec![0.0, 0.0],
      waveform_max: vec![0.0, 0.0],
```

- [ ] **Step 8: Write the new test**

Add to the `#[cfg(test)] mod tests` block:
```rust
  #[test]
  fn history_entry_captures_waveform_min_max_per_channel() {
    let sr = 48_000_u32;
    let channels = 2_u16;
    let hist: MeterHistoryBuf = Arc::new(Mutex::new(VecDeque::new()));
    let mut pipeline = MeterPipeline::new(sr, channels, hist.clone());

    // 200ms of a 100Hz sine on L, inverted on R, amplitude 0.7
    let frames = sr as usize / 5;
    let mut pcm = vec![0.0_f32; frames * 2];
    for i in 0..frames {
      let s = (2.0 * std::f64::consts::PI * 100.0 * i as f64 / sr as f64).sin() as f32 * 0.7;
      pcm[i * 2] = s;
      pcm[i * 2 + 1] = -s;
    }

    // Feed 5 × 200ms = 1s to guarantee history entries are emitted
    for _ in 0..5 {
      let _ = pipeline.push_pcm_f32(
        &pcm,
        (0, 1),
        ChannelLayoutSetting::Auto,
        SpectrumChannelSel::default(),
      );
    }

    let entries: Vec<_> = hist.lock().unwrap().iter().cloned().collect();
    assert!(!entries.is_empty(), "must emit at least one history entry");
    let e = &entries[0];
    assert_eq!(e.waveform_min.len(), 2, "waveform_min length == channel count");
    assert_eq!(e.waveform_max.len(), 2, "waveform_max length == channel count");
    // L has a full ±0.7 sine — both positive peak and negative trough must be captured
    assert!(
      e.waveform_max[0] > 0.5,
      "L max should capture positive peaks, got {}",
      e.waveform_max[0]
    );
    assert!(
      e.waveform_min[0] < -0.5,
      "L min should capture negative troughs, got {}",
      e.waveform_min[0]
    );
    // R is phase-inverted — same magnitude
    assert!(e.waveform_max[1] > 0.5, "R max, got {}", e.waveform_max[1]);
    assert!(e.waveform_min[1] < -0.5, "R min, got {}", e.waveform_min[1]);
  }
```

- [ ] **Step 9: Run all Rust tests**

```
cd src-tauri && cargo test
```

Expected: all existing tests pass, new test passes.

- [ ] **Step 10: Commit**

```bash
git add src-tauri/src/ipc/types.rs src-tauri/src/engine/meter_pipeline.rs
git commit -m "feat(backend): add per-channel waveform min/max to history entries"
```

---

### Task 2: Frontend types + waveform math helper (TDD)

**Files:**
- Modify: `src/ipc/types.js`
- Create: `src/math/waveformMath.test.js`
- Create: `src/math/waveformMath.js`

- [ ] **Step 1: Update `MeterHistoryEntry` typedef in `src/ipc/types.js`**

In the `@typedef {object} MeterHistoryEntry` block, after `@property {boolean} loudnessLayoutKnown`, add:
```js
 * @property {number[]} waveformMin
 * @property {number[]} waveformMax
```

- [ ] **Step 2: Write failing tests — create `src/math/waveformMath.test.js`**

```js
import { describe, it, expect } from "vitest";
import { sliceWaveformHistory } from "./waveformMath.js";

describe("sliceWaveformHistory", () => {
  it("returns empty per-channel arrays when histSourceList is empty", () => {
    const result = sliceWaveformHistory([], 100, 0, 2);
    expect(result.entryCount).toBe(0);
    expect(result.mins).toHaveLength(2);
    expect(result.maxes).toHaveLength(2);
    expect(result.mins[0]).toHaveLength(0);
    expect(result.maxes[0]).toHaveLength(0);
  });

  it("extracts per-channel min/max for the visible window", () => {
    const entries = [
      { waveformMin: [-0.5, -0.3], waveformMax: [0.5, 0.3] },
      { waveformMin: [-0.8, -0.2], waveformMax: [0.8, 0.2] },
    ];
    const result = sliceWaveformHistory(entries, 10, 0, 2);
    expect(result.entryCount).toBe(2);
    expect(result.mins[0]).toEqual([-0.5, -0.8]);
    expect(result.maxes[0]).toEqual([0.5, 0.8]);
    expect(result.mins[1]).toEqual([-0.3, -0.2]);
    expect(result.maxes[1]).toEqual([0.3, 0.2]);
  });

  it("respects effectiveOffsetSamples — skips the most-recent N entries", () => {
    const entries = [
      { waveformMin: [-0.1, 0], waveformMax: [0.1, 0] }, // oldest
      { waveformMin: [-0.5, 0], waveformMax: [0.5, 0] },
      { waveformMin: [-0.9, 0], waveformMax: [0.9, 0] }, // newest — skipped
    ];
    // effectiveOffsetSamples=1 → exclude last 1 entry; show indices 0 and 1
    const result = sliceWaveformHistory(entries, 10, 1, 1);
    expect(result.entryCount).toBe(2);
    expect(result.maxes[0]).toEqual([0.1, 0.5]);
  });

  it("limits to visibleSamples entries", () => {
    const entries = Array.from({ length: 20 }, (_, i) => ({
      waveformMin: [-i * 0.01],
      waveformMax: [i * 0.01],
    }));
    const result = sliceWaveformHistory(entries, 5, 0, 1);
    expect(result.entryCount).toBe(5);
  });

  it("falls back to 0 for missing channel data", () => {
    const entries = [{ waveformMin: [-0.5], waveformMax: [0.5] }]; // only 1 channel
    const result = sliceWaveformHistory(entries, 10, 0, 2);           // requesting 2
    expect(result.mins[1][0]).toBe(0);
    expect(result.maxes[1][0]).toBe(0);
  });
});
```

- [ ] **Step 3: Run tests — expect failure**

```bash
npx vitest run src/math/waveformMath.test.js
```

Expected: FAIL — `Cannot find module './waveformMath.js'`

- [ ] **Step 4: Implement `src/math/waveformMath.js`**

```js
/**
 * Slice the visible history window and return per-channel waveform min/max arrays.
 *
 * @param {import('../ipc/types.js').MeterHistoryEntry[]} histSourceList
 * @param {number} visibleSamples          how many entries to show
 * @param {number} effectiveOffsetSamples  how many recent entries to skip (0 = live edge)
 * @param {number} channelCount
 * @returns {{ mins: number[][], maxes: number[][], entryCount: number }}
 *   mins[ch][i] and maxes[ch][i] are the linear amplitude bounds for the i-th visible entry.
 */
export function sliceWaveformHistory(
  histSourceList,
  visibleSamples,
  effectiveOffsetSamples,
  channelCount
) {
  const total = histSourceList.length;
  const end = Math.max(0, total - effectiveOffsetSamples);
  const start = Math.max(0, end - visibleSamples);
  const visible = histSourceList.slice(start, end);
  const n = visible.length;

  const mins = Array.from({ length: channelCount }, () => new Array(n).fill(0));
  const maxes = Array.from({ length: channelCount }, () => new Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    const entryMins = visible[i].waveformMin ?? [];
    const entryMaxes = visible[i].waveformMax ?? [];
    for (let ch = 0; ch < channelCount; ch++) {
      mins[ch][i] = entryMins[ch] ?? 0;
      maxes[ch][i] = entryMaxes[ch] ?? 0;
    }
  }

  return { mins, maxes, entryCount: n };
}
```

- [ ] **Step 5: Run tests — expect pass**

```bash
npx vitest run src/math/waveformMath.test.js
```

Expected: 5 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/ipc/types.js src/math/waveformMath.js src/math/waveformMath.test.js
git commit -m "feat(frontend): waveform math helper with tests"
```

---

### Task 3: WaveformPanel component + wiring

**Files:**
- Modify: `src/App.jsx` — expose `histSourceList` via `AudioDataContext`
- Modify: `src/lib/shellLayout.js` — add `PANEL_MIN_WAVEFORM`
- Create: `src/components/panels/WaveformPanel.jsx`
- Modify: `src/workspace/registry.jsx`

- [ ] **Step 1: Add `histSourceList` to `audioData` in `src/App.jsx`**

In `App.jsx`, find the `const audioData = {` object (around line 822). Add `histSourceList,` as a property — place it alongside the other Loudness History fields, e.g. after `hasHistoryData,`:

```js
    histSourceList,
```

`histSourceList` is already a local variable in `AppContent` (destructured from `useSnapshot` near line 270), so no new state is needed.

- [ ] **Step 2: Add `PANEL_MIN_WAVEFORM` to `src/lib/shellLayout.js`**

After the line:
```js
export const PANEL_MIN_SPECTROGRAM = "min-h-[120px]";
```

Add:
```js
export const PANEL_MIN_WAVEFORM = "min-h-[80px]";
```

- [ ] **Step 3: Create `src/components/panels/WaveformPanel.jsx`**

```jsx
import { useRef, useEffect, useState } from "react";
import { useAudioData } from "../../workspace/AudioDataContext.jsx";
import { cn } from "@/lib/utils";
import { PANEL_MIN_WAVEFORM } from "@/lib/shellLayout";
import { getPeakMeterChannelLabels } from "../../math/peakMeterChannelLabels.js";
import { sliceWaveformHistory } from "../../math/waveformMath.js";

const LABEL_WIDTH_PX = 28;

export function WaveformPanel({ compact = false }) {
  const {
    histSourceList,
    visibleSamples,
    effectiveOffsetSamples,
    channelCount,
    peakLabelContext,
  } = useAudioData();

  // Match idle fallback used by other multi-channel panels
  const effectiveChannels = channelCount >= 2 ? channelCount : Math.max(1, channelCount || 2);
  const labels = getPeakMeterChannelLabels(effectiveChannels, peakLabelContext ?? {});
  const { mins, maxes, entryCount } = sliceWaveformHistory(
    histSourceList ?? [],
    visibleSamples ?? 0,
    effectiveOffsetSamples ?? 0,
    effectiveChannels
  );

  return (
    <div
      className={cn(
        PANEL_MIN_WAVEFORM,
        "@container flex min-h-0 flex-1 flex-col overflow-hidden gap-0.5",
        "py-[var(--ui-panel-pad-y)] pl-[var(--ui-panel-pad-x)] pr-[var(--ui-panel-pad-x)]"
      )}
    >
      {Array.from({ length: effectiveChannels }, (_, ch) => (
        <WaveformLane
          key={ch}
          label={labels[ch] ?? `Ch${ch + 1}`}
          mins={mins[ch]}
          maxes={maxes[ch]}
          entryCount={entryCount}
          compact={compact}
        />
      ))}
    </div>
  );
}

function WaveformLane({ label, mins, maxes, entryCount, compact }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  // canvasSize triggers redraw when the container is resized
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 });

  // Resize observer — updates canvas buffer dimensions and triggers redraw via state
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const w = Math.round(container.clientWidth * dpr);
      const h = Math.round(container.clientHeight * dpr);
      canvas.width = w;
      canvas.height = h;
      setCanvasSize({ w, h });
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // Draw — re-runs when data changes or when canvas is resized
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || canvasSize.w === 0 || canvasSize.h === 0) return;

    const ctx = canvas.getContext("2d");
    const W = canvas.width;
    const H = canvas.height;

    ctx.clearRect(0, 0, W, H);

    // Subtle center baseline (silence line)
    const cy = H / 2;
    ctx.strokeStyle = "rgba(128,128,128,0.18)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, cy);
    ctx.lineTo(W, cy);
    ctx.stroke();

    if (!entryCount || !mins?.length) return;

    // Build filled waveform shape:
    //   top edge traces waveformMax (positive peaks → above center)
    //   bottom edge traces waveformMin (negative troughs → below center)
    ctx.beginPath();
    for (let i = 0; i < entryCount; i++) {
      const x = (i / entryCount) * W;
      const y = cy - maxes[i] * cy; // cy maps amplitude 1.0 to the top
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    for (let i = entryCount - 1; i >= 0; i--) {
      const x = (i / entryCount) * W;
      const y = cy - mins[i] * cy;
      ctx.lineTo(x, y);
    }
    ctx.closePath();

    // Read primary color from CSS variable (supports light/dark themes)
    const primaryHsl = getComputedStyle(document.documentElement)
      .getPropertyValue("--primary")
      .trim();
    ctx.fillStyle = primaryHsl ? `hsl(${primaryHsl} / 0.6)` : "rgba(99,179,237,0.6)";
    ctx.fill();
  }, [mins, maxes, entryCount, canvasSize]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 items-stretch">
      <div
        className="flex shrink-0 items-center justify-end pr-1 text-[length:var(--ui-fs-axis)] text-muted-foreground"
        style={{ width: LABEL_WIDTH_PX }}
      >
        {compact ? null : label}
      </div>
      <div ref={containerRef} className="relative min-h-0 min-w-0 flex-1 rounded bg-muted">
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full rounded" />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Register the panel in `src/workspace/registry.jsx`**

Add the import at the top, after the existing panel imports:
```jsx
import { WaveformPanel } from "../components/panels/WaveformPanel";
```

Extend the existing lucide import to include `AudioWaveform`:
```jsx
import { Activity, AudioLines, AudioWaveform, BarChart2, Crosshair, Layers, List } from "lucide-react";
```

Add the registry entry after the `spectrogram` entry:
```js
  waveform: {
    id: "waveform",
    title: "Waveform",
    minWidth: 200,
    minHeight: 80,
    Component: WaveformPanel,
    Icon: () => <AudioWaveform size={16} />,
  },
```

- [ ] **Step 5: Run the dev server and verify visually**

```bash
npm run dev
```

Open the app. Click the Layout & modules icon (grid icon in the toolbar header) → enable **Waveform**. Start capture. Confirm:

1. One lane per channel appears (stereo = 2 lanes, 5.1 = 6 lanes)
2. While audio is playing, each lane fills with a symmetric waveform shape (wider for louder signals)
3. Silence shows a thin horizontal line at the lane center
4. The waveform scrolls in time — if Loudness History is also visible, both panels show the same time window and move together when you scroll or zoom

- [ ] **Step 6: Commit**

```bash
git add src/App.jsx src/lib/shellLayout.js src/components/panels/WaveformPanel.jsx src/workspace/registry.jsx
git commit -m "feat: add Waveform panel with per-channel DAW-style amplitude envelope"
```
