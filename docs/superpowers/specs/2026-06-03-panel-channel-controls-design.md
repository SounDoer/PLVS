# Panel Channel Controls - Design Spec

**Date:** 2026-06-03  
**Status:** Awaiting written spec review

---

## Problem

PLVS already supports multichannel metering, but the channel-selection controls are inconsistent and too far from the panels they affect.

- Vectorscope channel-pair selection is always visible in Settings.
- Spectrum channel selection appears in Settings only when multichannel options exist.
- Spectrum still shows the legacy `All channels (summed)` caption even though multichannel spectrum now follows the selected channel.
- Spectrogram reuses Spectrum history data, so any Spectrum channel control also affects Spectrogram.

These controls behave like per-panel analysis controls, not global application preferences. Moving them into the relevant panel headers makes multichannel inspection faster and reduces Settings clutter.

---

## Goals

- Move Vectorscope and frequency-channel selection out of Settings.
- Show lightweight channel controls in panel headers only when actual multichannel data is active.
- Use one shared frequency-channel selector for Spectrum and Spectrogram.
- Preserve Loudness/Spectrogram timeline linkage when the frequency channel changes.
- Make Spectrogram channel changes visible in history instead of silently mixing old and new channel contexts.
- Keep snapshot mode honest: header labels must reflect the selected historical point, not only the current live selection.

---

## Non-Goals

- Do not redesign the entire dock/header system.
- Do not add independent Spectrum and Spectrogram DSP streams.
- Do not add a generic registry accessory framework yet.
- Do not add Vectorscope change markers to history; Vectorscope has no long-running heatmap comparable to Spectrogram.
- Do not change `Channel layout`; it remains a global setting in Settings.

---

## Interaction Design

### Header Placement

Channel controls appear in the active panel header, on the right side before the fullscreen and hide buttons.

The control is a low-emphasis clickable chip, for example:

- `L/R v`
- `Ls/Rs v`
- `C v`
- `L/Rb v`

Clicking the chip opens the available channel menu.

### Visibility Rules

- `Vectorscope`: show a channel-pair chip when `channelCount > 2`.
- `Spectrum`: show the shared frequency-channel chip when `channelCount > 2`.
- `Spectrogram`: show the same shared frequency-channel chip when `channelCount > 2`.
- Stereo, mono, idle, or unknown-no-data states do not show these chips.

### Settings Cleanup

Settings removes:

- `Vectorscope channels`
- `Spectrum channel`

Settings keeps global options such as Appearance, Loudness reference, and Channel layout.

### Legacy Caption

Spectrum removes the `All channels (summed)` overlay. It is now inaccurate because multichannel Spectrum uses the selected frequency channel rather than an all-channel sum.

---

## State Ownership

`App.jsx` remains the owner of the selection state:

- `vectorscopePairUi`: selected Vectorscope X/Y pair.
- `spectrumChannelUi`: selected frequency channel shared by Spectrum and Spectrogram.

`LeafView` renders a small `PanelChannelSelector` in the header based on the current active tab:

- `vectorscope` uses Vectorscope pair options and `onVectorscopePairChange`.
- `spectrum` uses Spectrum channel options and `onSpectrumChannelChange`.
- `spectrogram` uses the same Spectrum channel options and `onSpectrumChannelChange`.

Panel bodies continue to focus on rendering charts. They do not own the selector UI.

---

## Spectrum And Spectrogram Semantics

Spectrum and Spectrogram share frequency data:

1. The backend `SpectrumMeter` computes `spectrum_smooth_db`.
2. `FrameIntake` stores each history tick in `spectrumDataSnap`.
3. `SpectrogramPanel` paints `spectrumDataSnap` as a time-frequency canvas.

Therefore, Spectrum and Spectrogram should expose the same frequency-channel selector. Changing it from either panel updates the shared `spectrumChannelUi`.

---

## Frequency Channel Changes

Changing the frequency channel must not break Loudness/Spectrogram timeline linkage.

### Chosen Behavior

Keep existing Spectrum/Spectrogram history, but add visible channel-change markers.

When the user changes the frequency channel:

1. The live `spectrumChannelUi` updates.
2. Snapshot mode exits to live if currently active.
3. The backend resets `SpectrumMeter` so FFT ring, smoothing, and peak hold do not carry over from the old channel.
4. Frontend history remains aligned with Loudness history.
5. A pending marker is recorded and written at the next history tick.

This avoids two bad outcomes:

- Directly clearing Spectrum/Spectrogram history would desynchronise it from Loudness history.
- Keeping history without markers would make old-channel history look like it belongs to the current channel.

### Marker Series

`FrameIntake` adds a frequency-channel marker ring aligned with existing history rings.

Each history tick stores either:

```js
null
```

or:

```js
{
  type: "frequencyChannelChange",
  from: "L/R",
  to: "C"
}
```

The marker is written on the first history tick after the selection change, then the pending marker is cleared.

`SpectrogramPanel` renders markers in the visible time window as subtle vertical lines. Hover or tooltip text should identify the change, for example:

`Frequency channel changed: L/R -> C`

Markers are for visual history boundaries only. They are not used to infer per-tick labels.

---

## Snapshot-Aware Labels

Header chip labels must reflect the current display mode.

### Live Mode

The chip shows the current live selection and controls future incoming data.

### Snapshot Mode

The chart body shows a historical point. The header chip should show the channel or pair associated with that historical point.

To support this, `FrameIntake` stores lightweight per-tick metadata:

- frequency channel label for Spectrum/Spectrogram ticks
- Vectorscope pair label for Vectorscope ticks

`useSnapshot` freezes this metadata together with the existing history snapshot arrays. When a user selects a historical point, header labels come from the selected tick metadata.

If the user changes a chip while in snapshot mode, PLVS exits snapshot mode and returns to live before applying the new selection. This avoids a confusing state where the control changes but the displayed historical chart does not.

---

## Backend Reset Requirement

Changing `spectrumChannel` must reset only frequency analysis state.

Required:

- Reset `SpectrumMeter` ring buffers.
- Reset smoothing.
- Reset peak hold.

Not required:

- Clear Loudness history.
- Clear Peak state.
- Clear Vectorscope state.
- Clear global meter history.

This should be implemented as a narrow frequency reset rather than reusing `clear_peak_and_history`.

---

## Error Handling And Edge Cases

- If channel count drops back to stereo, hide header chips and clamp selections back to the default L/R-compatible state.
- If a persisted selection is invalid for the current channel count, reuse existing clamp behavior and fall back to the first available option.
- If a channel change occurs while idle, update persisted UI state but do not create a Spectrogram marker until history is actually running.
- If multiple channel changes happen before the next history tick, record the last effective transition for that tick.
- If snapshot metadata is missing for older seeded or legacy history, fall back to the current display label rather than blocking rendering.

---

## Implementation Boundaries

### Frontend

- Add `PanelChannelSelector`.
- Update `LeafView` to render the selector for supported active tabs.
- Pass selector state and callbacks through `AudioDataContext`.
- Remove Vectorscope/Spectrum channel selector props and UI from `SettingsPanel`.
- Remove Spectrum's `All channels (summed)` overlay.
- Extend `FrameIntake` with:
  - frequency marker snap ring
  - pending frequency marker
  - per-tick frequency channel metadata
  - per-tick Vectorscope pair metadata
- Extend `useSnapshot` so snapshot mode returns selected tick metadata.
- Extend `SpectrogramPanel` to render frequency channel markers.

### Backend

- Ensure `set_spectrum_channel` resets only `SpectrumMeter` state after updating the selected channel.
- Do not clear global meter history as part of frequency-channel changes.

---

## Test Plan

### Unit / Component Tests

- `SettingsPanel` no longer renders `Vectorscope channels` or `Spectrum channel`.
- Header selector appears for `vectorscope`, `spectrum`, and `spectrogram` when `channelCount > 2`.
- Header selector does not appear for stereo or idle states.
- Spectrum and Spectrogram selectors read and update the same `spectrumChannelUi`.
- Vectorscope selector reads and updates `vectorscopePairUi`.
- Changing a selector in snapshot mode calls `setSelectedOffset(-1)` before applying the new live selection.
- `FrameIntake` writes pending frequency markers on the next history tick.
- `FrameIntake` keeps marker and metadata rings aligned with loudness history length.
- `useSnapshot` returns the selected tick's frequency label and Vectorscope pair label.
- `SpectrogramPanel` renders marker lines only when visible markers exist.

### Backend Tests

- Changing spectrum channel resets `SpectrumMeter` state without clearing meter history.
- `SpectrumMeter` does not carry old-channel smoothing or peak hold into the new selection.

### Manual Checks

- In 5.1 or 7.1, Settings contains no Vectorscope/Spectrum channel selectors.
- Vectorscope header shows pair chip only in multichannel.
- Spectrum and Spectrogram headers show the same frequency chip.
- Changing the chip in Spectrum updates Spectrogram, and vice versa.
- Spectrogram keeps its Loudness-linked timeline after channel changes.
- Spectrogram shows a visible marker where channel changes occur.
- Snapshot mode displays historical channel labels correctly.
- Clicking a channel chip in snapshot mode returns to live mode.
