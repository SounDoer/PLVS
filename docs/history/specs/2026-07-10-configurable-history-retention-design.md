# Configurable History Retention

**Date:** 2026-07-10
**Status:** Draft

## Summary

Replace the hardcoded 2-hour history cap with a user-configurable setting in
System Settings. The setting offers four presets — 30min / 1h (default) / 2h /
4h — and controls both frontend history ring buffers used for panel history
and visualization.

This is a frontend-only change. No Rust engine or IPC changes are required.

## Motivation

`HIST_MAX_SAMPLES` and `VISUAL_MAX_SAMPLES` in `src/App.jsx` are currently
fixed constants sized for a 2-hour retention window. Users running longer
unattended sessions may want more history; users concerned about memory
footprint may want less. Making this a setting lets users pick a tradeoff that
fits their session length and machine.

## Current Model

Two independent ring buffers, both currently fixed at 2h:

- `HIST_MAX_SAMPLES = 72000` (`src/App.jsx:59`) — scalar loudness history
  (M/ST curves, correlation, etc.) sampled at `HIST_SAMPLE_SEC = 0.1s`
  (`src/hooks/useLoudnessHistory.js:14`). Backed by plain JS arrays with
  `ringPush` (`src/lib/FrameIntake.js:136`), which shifts one element per push
  once the array exceeds capacity — a slow drain, not an immediate resize.
- `VISUAL_MAX_SAMPLES = 180_000` (`src/App.jsx:60`) — waveform/spectrum/
  vectorscope visual history sampled at `VISUAL_HIST_SAMPLE_SEC = 0.04s`
  (25 Hz). Backed by `RingBuffer` / `SpectrumHistorySlab` /
  `VectorscopeHistorySlab` (`src/lib/FrameIntake.js:264-324`), which already
  detects a capacity mismatch and reallocates a fresh, empty buffer
  (`slab.capacity !== visualMaxSamples`) — this path exists but is currently
  dead code since the capacity constant never changes at runtime.

Both values flow from `App.jsx` through `runtimeEnginesProps` →
`useAudioEngine` → `FrameIntake.pushFrame(frame, histMaxSamples, ...,
visualMaxSamples)`, and are also reused by `useFileAnalysisEngine.js` for
file-mode analysis (including `detectHistoryTruncation`, which warns when a
file's length exceeds the ring capacity).

The Rust engine side (`src-tauri/src/engine/meter_pipeline.rs`) keeps
per-analysis-request-key computation state with no time-based cap of its own;
retention of the 2-hour history window is purely a frontend concept. This
change does not touch the Rust engine.

## Design

### Setting

Add `historyRetentionSec` to the settings persistence domain
(`src/persistence/index.js` `settingsStore`), alongside `referenceLufs` /
`closeAction`.

`src/settings/defaults.js`:

```js
export const DEFAULT_HISTORY_RETENTION_SEC = 3600; // 1h
export const HISTORY_RETENTION_OPTIONS_SEC = [1800, 3600, 7200, 14400]; // 30min/1h/2h/4h

export function normalizeHistoryRetentionSec(raw) {
  const n = Number(raw);
  return HISTORY_RETENTION_OPTIONS_SEC.includes(n) ? n : DEFAULT_HISTORY_RETENTION_SEC;
}
```

New hook `src/hooks/useHistoryRetentionSetting.js`, mirroring
`useCloseActionSetting.js` (local `useState` + `settingsStore.patch`, no
cross-window `subscribe` — PLVS is single-window, and configuration
import/reset already trigger a full reload via `reloadAfterProfileChange()`,
so there's no live-sync gap to cover):

```js
export function useHistoryRetentionSetting() {
  const [historyRetentionSec, setHistoryRetentionSecState] = useState(() =>
    normalizeHistoryRetentionSec(settingsStore.read().historyRetentionSec)
  );

  function setHistoryRetentionSec(value) {
    const next = normalizeHistoryRetentionSec(value);
    if (next === DEFAULT_HISTORY_RETENTION_SEC) {
      const { historyRetentionSec: _drop, ...rest } = settingsStore.read();
      settingsStore.reset();
      settingsStore.patch(rest);
    } else {
      settingsStore.patch({ historyRetentionSec: next });
    }
    setHistoryRetentionSecState(next);
  }

  return { historyRetentionSec, setHistoryRetentionSec };
}
```

Wired into `useSettings.js` alongside the other setting hooks.

### App.jsx wiring

Replace the two hardcoded constants with values derived from the setting:

```js
const histMaxSamples = Math.round(historyRetentionSec / HIST_SAMPLE_SEC);
const visualMaxSamples = Math.round(historyRetentionSec / VISUAL_HIST_SAMPLE_SEC);
```

used in place of `HIST_MAX_SAMPLES` / `VISUAL_MAX_SAMPLES` at
`runtimeEnginesProps` (`src/App.jsx:752-753`). `HIST_SAMPLE_SEC` and
`VISUAL_HIST_SAMPLE_SEC` are already exported from
`src/hooks/useLoudnessHistory.js`.

### Immediate rebuild on capacity change

Changing the setting mid-session clears history and starts accumulating fresh
from that point — for both ring types, so behavior is consistent. This
matches the rebuild-on-mismatch behavior the visual slabs already have.

- Visual buffers (`pushVisualHistRow`): no change needed, the existing
  capacity-mismatch check already rebuilds them.
- Scalar buffers (`pushHistRow`): currently have no capacity-change detection.
  Add the same pattern — track the capacity the scalar arrays were built for,
  and when `histMaxSamples` changes, reset `_loudnessHist`, `_audioSnap`,
  `_corrSnap`, `_frequencyChannelMarkers`, and `_channelMetadataSnap` to empty
  arrays before continuing to push, instead of relying on the one-shift-per-
  push drain.

### Settings UI

`src/components/SettingsPanel.jsx`: new `SettingsSection` + `SettingsRow`
inserted between the Theme section's closing `SettingsDivider`
(`SettingsPanel.jsx:421`) and the Channels section, using the same `Select`
pattern as `closeAction`:

```jsx
<SettingsSection>
  <SettingsRow label="History Length">
    <Select value={String(historyRetentionSec)} onValueChange={(v) => setHistoryRetentionSec(Number(v))}>
      <SelectTrigger className={SELECT_TRIGGER_CLASS} aria-label="History length">
        <SelectValue />
      </SelectTrigger>
      <SelectContent className={SELECT_CONTENT_CLASS}>
        <SelectItem value="1800">30 min</SelectItem>
        <SelectItem value="3600">1 h</SelectItem>
        <SelectItem value="7200">2 h</SelectItem>
        <SelectItem value="14400">4 h</SelectItem>
      </SelectContent>
    </Select>
  </SettingsRow>
</SettingsSection>
<SettingsDivider />
```

New props (`historyRetentionSec`, `setHistoryRetentionSec`) threaded through
`SettingsPanel` the same way `closeAction` / `setCloseAction` are, sourced
from `useSettings()` in `AppSettingsOverlays.jsx` (or wherever `SettingsPanel`
is currently instantiated with `closeAction`).

## Testing

- `settings/defaults.test.js` (or existing defaults test file):
  `normalizeHistoryRetentionSec` — valid presets pass through, invalid/
  missing values fall back to the 1h default.
- `src/lib/FrameIntake.test.js`: capacity-change test for scalar rings
  mirroring the existing visual-ring capacity-change test — push past a
  capacity, change `histMaxSamples`, assert the scalar history arrays reset
  rather than draining gradually.
- `src/components/SettingsPanel.test.jsx`: renders the new History Length row
  and calls `setHistoryRetentionSec` with the selected value on change.

## Out of Scope

- Rust engine / IPC changes (none required).
- Cross-window sync (PLVS is single-window; not applicable).
- Preserving history across a capacity change (explicitly out of scope per
  user decision — rebuild/clear is the agreed behavior).
