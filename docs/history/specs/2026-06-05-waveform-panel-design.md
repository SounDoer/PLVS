# Waveform Panel Design

**Date:** 2026-06-05
**Status:** Draft

## Overview

Add a new Waveform panel to PLVS that displays a DAW-style amplitude envelope for each audio channel, scrolling in time and linked to the Loudness History time window.

## Goals

- Show per-channel amplitude history as a DAW-style waveform (min/max envelope from center line)
- Follow the active channel layout (stereo, 5.1, 7.1, etc.)
- Stacked lanes — one row per channel, same pattern as Peak panel
- Time axis linked with Loudness History (same window, scroll, zoom)

## Data Layer

### Backend — `MeterHistoryEntry` (Rust)

Add two fields to `MeterHistoryEntry` in `src-tauri/src/ipc/types.rs`:

```rust
pub waveform_min: Vec<f32>,   // per-channel minimum linear amplitude in this tick
pub waveform_max: Vec<f32>,   // per-channel maximum linear amplitude in this tick
```

Length of both vecs equals the channel count at capture time.

### Backend — `meter_pipeline.rs`

In `push_pcm_f32`, at the history tick assembly point, compute per-channel min/max by scanning every PCM sample in the current block (using `interleaved` which is already in scope). This is a full scan — no sampling — so transients are captured accurately.

Populate `waveform_min` and `waveform_max` in the `MeterHistoryEntry` before pushing to the ring.

### Frontend — `src/ipc/types.js`

Add to the `MeterHistoryEntry` typedef:

```js
@property {number[]} waveformMin   // per-channel min linear amplitude
@property {number[]} waveformMax   // per-channel max linear amplitude
```

## Visual Design

### Lane layout

```
[ L   ] [▓▓▓▓▓███████████▓▓▓░░░░░░░░░░░░░░░░]
[ R   ] [▓▓▓▓████████████▓▓░░░░░░░░░░░░░░░░░]
[ C   ] [▓▓▓████▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░]
[ LFE ] [▓▓████████▓▓▓░░░░░░░░░░░░░░░░░░░░░░]
[ Ls  ] [▓▓▓▓▓▓▓████▓░░░░░░░░░░░░░░░░░░░░░░░]
[ Rs  ] [▓▓▓▓▓████████▓░░░░░░░░░░░░░░░░░░░░░]
```

- **Left column:** channel label (L / R / C / LFE / Ls / Rs / etc.), fixed width (~28px), same label logic as Peak panel via `getPeakMeterChannelLabels` + `peakLabelContext`
- **Right column:** canvas filling remaining width — the waveform envelope
- **Y-axis:** linear amplitude, center = 0 (silence), top = +1.0, bottom = −1.0. Drawn symmetrically: `max` goes above center, `min` goes below
- **Fill:** single filled shape per lane — top edge traces `waveformMax`, bottom edge traces `waveformMin`, filled with the theme's chart color for that channel (same palette as Peak panel)
- **Silence:** when both min and max are near zero, the fill collapses to a thin line at center
- **No explicit Y-axis ticks** — lanes are narrow; a subtle center line at y=0 is sufficient

### Panel chrome

- Header: standard `PanelHeaderControls` with title "Waveform"
- Icon: `AudioWaveform` from lucide-react
- No channel selector control (all channels always shown, consistent with layout)
- Compact mode: lanes shrink in height; label text hides below a height threshold (same pattern as other panels)

### Sizing

- `minWidth: 240`
- `minHeight`: dynamic — 40px header + (channelCount × 32px). For stereo: ~104px; for 5.1: ~232px
- Lanes divide available height equally

## Data Flow

### AudioDataContext additions

None. The waveform panel reads values already present in `AudioDataContext`:

- `histSourceList` — already passed in for Loudness History
- `effectiveOffsetSamples`, `visibleSamples` — already passed in for Spectrogram
- `channelCount`, `peakLabelContext`, `running`, `selectedOffset` — already present

No new state, no new props in `App.jsx`.

### In `WaveformPanel.jsx`

Reads from `useAudioData()`:

- `histSourceList` — the history ring entries (each has `waveformMin`, `waveformMax`)
- `effectiveOffsetSamples`, `visibleSamples` — for the visible time slice
- `channelCount`, `peakLabelContext` — for channel labels
- `running`, `selectedOffset` — for live vs snapshot state

Slices the visible entries, maps each entry's `waveformMin[ch]` / `waveformMax[ch]` to canvas Y coordinates, draws the filled path.

### Rendering

Canvas-based, one `<canvas>` per lane. On each render:

1. Slice `histSourceList` to the visible window using `effectiveOffsetSamples` + `visibleSamples`
2. For each channel `ch`:
   - Map entry index → X pixel
   - Map `waveformMax[ch]` → Y pixel above center; `waveformMin[ch]` → Y pixel below center
   - Draw filled path: trace top edge left→right, then bottom edge right→left, close and fill
3. Draw a 1px center line at y=0 in a subdued color

No animation loop needed — re-renders driven by React state updates (same cadence as other panels, ~10Hz from history).

## Integration

### `src/workspace/registry.jsx`

```js
import { WaveformPanel } from "../components/panels/WaveformPanel";
import { AudioWaveform } from "lucide-react";

waveform: {
  id: "waveform",
  title: "Waveform",
  minWidth: 240,
  minHeight: 104,   // updated dynamically per channel count in panel
  Component: WaveformPanel,
  Icon: () => <AudioWaveform size={16} />,
},
```

## Accuracy and Precision

- **Min/max scan is exact:** every PCM sample in each ~100ms block is inspected — transients are not missed
- **Time resolution:** ~10Hz (one data point per ~100ms), the same as all other history panels. At short window zoom levels the waveform will look stepped, but this is a known characteristic shared with Loudness History and Spectrogram
- **This is the standard approach** used by DAWs for waveform overviews at equivalent zoom levels

## Out of Scope

- Waveform zoom to sub-100ms resolution (requires raw PCM in history, significant scope increase)
- Independent time window per panel (time axis is always shared with Loudness History)
- RMS vs peak display toggle
