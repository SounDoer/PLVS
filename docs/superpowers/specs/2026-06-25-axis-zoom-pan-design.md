# Axis Zoom & Pan Design Spec

## Overview

Add zoom, pan, and reset gestures to panel axes across PLVS. Replaces the panel-settings-only approach with direct axis interaction while keeping panel settings as a secondary precision entry point.

## Scope

| Panel | X Axis | Y Axis |
|---|---|---|
| Spectrum | Frequency (log) — zoom/pan | dB (linear) — zoom/pan |
| Spectrogram | Time — existing behavior, no change | Frequency (log) — zoom/pan |
| Loudness | Time — existing behavior, no change | LUFS (linear) — zoom/pan |
| LevelMeter | N/A | dB/LUFS (linear) — zoom/pan, adapts to peak/m/st mode |
| Waveform | No change | No change |
| Vectorscope | N/A | N/A |
| Stats | N/A | N/A |

## Interaction Model

### Axis Hit Zone

The existing axis label area (the narrow strip where tick labels are rendered) becomes the interactive region. No new visible UI elements are added.

- **Y axis zone**: the label column on the left (or right) side of the plot, with ~8px extra padding beyond the visual label width for forgiving hit detection.
- **X axis zone**: the label row at the bottom of the plot, with similar height padding.

### Cursor Feedback

- Y axis zone: `ns-resize` (vertical arrows)
- X axis zone: `ew-resize` (horizontal arrows)

### Gestures

| Gesture | Behavior | Constraints |
|---|---|---|
| Ctrl + scroll wheel | Zoom the axis, anchored at mouse position | Clamped to min/max span and absolute bounds |
| Drag (mousedown + move) | Pan the visible range | Cannot exceed absolute bounds |
| Double-click | Reset to default range | — |

### Zoom Anchor Behavior

Zoom is anchored at the mouse cursor position. The value under the cursor stays fixed while the range expands or contracts around it. For log-scale axes (frequency), the calculation operates in log space.

## Per-Panel Axis Parameters

### Spectrum

| | X Axis (Frequency) | Y Axis (dB) |
|---|---|---|
| Default range | 20 Hz – 20 kHz | -96 dB – -12 dB |
| Absolute bounds | 20 Hz – 20 kHz | -120 dB – +6 dB |
| Min span | ~1 octave | 12 dB |
| Max span | Full range (20–20k) | 126 dB (full bounds) |
| Scale type | Logarithmic | Linear |

### Spectrogram

| | Y Axis (Frequency) |
|---|---|
| Default range | 20 Hz – 20 kHz |
| Absolute bounds | 20 Hz – 20 kHz |
| Min span | ~1 octave |
| Max span | Full range |
| Scale type | Logarithmic |

X axis (time) follows existing history interaction behavior — no change.

### Loudness

| | Y Axis (LUFS) |
|---|---|
| Default range | -64 – 0 LUFS |
| Absolute bounds | -64 – 0 LUFS |
| Min span | 12 dB |
| Max span | 64 dB (full range) |
| Scale type | Linear |

X axis (time) follows existing history interaction behavior — no change.

### LevelMeter

| | Y Axis |
|---|---|
| Default range | Peak: -60 – +3 dBFS; Momentary/Short-term: -64 – 0 LUFS |
| Absolute bounds | Same as default (or slightly extended) |
| Min span | 12 dB |
| Max span | Full range |
| Scale type | Linear |

On mode switch (peak/momentary/short-term): if the user has not manually zoomed, follow the mode's default range. If manually zoomed, preserve the user's setting.

## State Model & Persistence

### State Structure

Zoom/pan state is stored in the existing `panelControls` object per panel instance, persisted to workspace store.

New fields:

```
// Spectrum
spectrumXMinFreq: 20        // Hz
spectrumXMaxFreq: 20000     // Hz
spectrumYMaxDb: -12         // dB (reuse existing field)
spectrumYMinDb: -96         // dB (replaces spectrumYRangeDb)

// Spectrogram
spectrogramYMinFreq: 20
spectrogramYMaxFreq: 20000

// Loudness
loudnessYMinDb: -64         // LUFS
loudnessYMaxDb: 0

// LevelMeter
levelMeterYMinDb: -60       // default depends on mode
levelMeterYMaxDb: 3
```

### Field Migration

Spectrum Y axis changes from `spectrumYMaxDb` + `spectrumYRangeDb` to `spectrumYMaxDb` + `spectrumYMinDb`. The min/max pair is more intuitive and simpler for gesture calculations. `normalizePanelControls()` handles migration from old format.

### State Flow

- Gesture → update panelControls → triggers re-render + persists to workspace store
- Panel settings slider → update same panelControls → same flow
- Double-click reset → write default values to panelControls

### Spectrum Panel Settings

The existing Y-axis sliders in panel settings are retained but changed from stepped (6 dB steps) to continuous (1 dB step). They read and write the same `spectrumYMaxDb`/`spectrumYMinDb` state as the gestures, providing bidirectional sync.

## Tick Label Density Adaptation

### Problem

Fixed tick counts cause label overlap at small panel sizes and sparse labels when zoomed in.

### Algorithm

1. Measure the axis pixel length via ResizeObserver (panels already have this)
2. Define minimum spacing per label: ~32px for Y axis, ~48px for X axis
3. `maxTicks = floor(axisPixelLength / minSpacing)`
4. Select the densest tick interval from predefined candidates that fits within maxTicks:
   - dB axes: candidates at every 3 / 6 / 12 / 24 dB
   - Frequency axes: filter from standard points (20, 50, 100, 200, 500, 1k, 2k, 5k, 10k, 20k)
5. When zoomed into a narrow range, ticks auto-densify to use available space (e.g., zoomed to 1k–4kHz shows ticks every 500 Hz)

### Edge Cases

- Axis too short for 2 labels: show only the two endpoint values
- Zoomed into very narrow range: use finer tick granularity appropriate for the visible span

### Implementation

Extend the existing `buildSpectrumYTicks` pattern. Each axis type gets a `buildTicks(range, availablePixels)` function in `scales.js`.

## Shared Axis Interaction Hook

### `useAxisInteraction` API

```js
useAxisInteraction({
  axis: "x" | "y",
  min, max,                    // current visible range
  absMin, absMax,              // absolute bounds
  defaultMin, defaultMax,      // double-click reset target
  minSpan,                     // minimum zoom span
  scale: "linear" | "log",    // affects zoom math
  onRangeChange(min, max),    // callback to update panelControls
})
```

### Returns

```js
{
  axisRef,          // ref to bind to the axis region DOM element
  axisHandlers,     // onWheel, onMouseDown, onDoubleClick, etc.
  cursorStyle,      // "ns-resize" | "ew-resize"
  isDragging,       // whether a drag is in progress (for optional visual feedback)
}
```

### Usage

Panel binds `ref={axisRef}` and `{...axisHandlers}` to the axis label container element. The hook handles all gesture logic internally.

### Responsibilities

- **Hook owns**: gesture recognition, range calculation, bounds clamping
- **Hook does NOT own**: tick label rendering, tick calculation, persistence (via onRangeChange callback)

### Relationship to `useHistoryInteraction`

Independent. History interaction handles in-plot-area time axis interactions (scrub, hover tooltip, etc.) with different semantics and hit zones. No merge.
