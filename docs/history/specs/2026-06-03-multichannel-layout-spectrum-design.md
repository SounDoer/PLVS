# Multichannel Layout Detection & Spectrum Channel Selection

**Date:** 2026-06-03  
**Status:** Approved

---

## Problem

1. **Auto mode never detects known layouts.** Any device with >2 channels returns `resolved: "unknown"` regardless of whether it is a standard 5.1 or 7.1 configuration.
2. **Manual layout mismatches are silent.** Selecting 7.1 on a 6-channel device produces no warning; the backend falls back to stereo loudness with no user-visible feedback.
3. **Spectrum uses all-channel power sum in multichannel.** Including LFE and surround channels distorts the spectral picture; professional tools use channel selection instead.
4. **7.1 loudness not implemented.** Selecting 7.1 with an 8-channel device silently measures in stereo only, not BS.1770 7.1.
5. **Auto mode always measures in stereo for >2ch.** Even after auto-detecting 5.1 (once fixed), the loudness measurement path stays on stereo L/R.

---

## Goals

- Auto mode correctly identifies standard channel counts and shows proper labels with no notification.
- Users see a clear notification whenever their manual layout selection doesn't match the device.
- Spectrum analyzer follows the same channel-selection pattern as Vectorscope: default L/R, user-selectable in multichannel.
- 7.1 loudness measurement uses correct BS.1770 channel weighting.
- Auto mode uses the correct 5.1 or 7.1 loudness measurement path when the device supports it.

---

## Behavior Rules

### Auto Mode

| Device channels | Detected layout | Peak Meter labels | Notification |
|---|---|---|---|
| 1 | mono | M | None |
| 2 | stereo | L R | None |
| 6 | 5.1 | L R C LFE Ls Rs | None |
| 8 | 7.1 | L R C LFE Ls Rs Lb Rb | None |
| 3 / 4 / 5 / 7 / 9+ | unknown | Ch 1 … Ch N | ⚠️ "N-channel detected · Select layout in Settings" |

### Manual Mode

- **Exact match** (selected layout matches auto-detected layout): no notification.
- **Mismatch** (any other case): show notification — `"Device is [auto] · selected [manual]"`.
- Peak Meter labels are always based on actual device channel count; the manual selection does not change the label display.

### Notification Logic (Frontend)

```
autoDetected = resolveChannelLayout("auto", { channelCount })
if channelLayout !== "auto" && channelLayout !== autoDetected.resolved:
    show mismatch notification
```

No backend signal (`loudnessLayoutKnown`) required.

---

## Architecture & Scope of Changes

### Frontend

#### `channelLayoutResolver.js`
Add `channelCount`-based detection to the auto path:

```
1ch  → { mode: "auto", resolved: "mono" }
2ch  → { mode: "auto", resolved: "stereo" }
6ch  → { mode: "auto", resolved: "5.1" }
8ch  → { mode: "auto", resolved: "7.1" }
else → { mode: "auto", resolved: "unknown" }
```

Manual presets continue to resolve directly (unchanged).

#### `App.jsx`
- Replace the existing `resolved === "unknown" && channelCount > 2` notification with the unified mismatch rule above.
- Add `spectrumChannel` state (analogous to `vectorscopePair`): persisted in localStorage, passed to engine on start and on change.
- Build `spectrumChannelOptions` from `channelCount` + `peakLabelContext` and pass to `SettingsPanel`.

#### `SettingsPanel.jsx`
Add a **Spectrum channel** selector below the Vectorscope selector.  
- Hidden when `channelCount <= 2` (L+R is the only option; no selector needed).
- Options for 5.1 (6ch): `L+R`, `Ls+Rs`, `C`, `LFE`.
- Options for 7.1 (8ch): `L+R`, `Ls+Rs`, `Lb+Rb`, `C`, `LFE`.
- Non-standard channel counts: pairs of adjacent channels + individual channels, derived from actual labels.

#### `spectrumChannelOptions.js` (new file)
Pure function: `buildSpectrumChannelOptions(channelCount, labelCtx) → OptionList`.  
- Stereo pairs: averaged (0.5 × chA + 0.5 × chB).
- Single channels (C, LFE, odd-count remainders): direct passthrough.
- Mirrors `buildVectorscopePairOptions` in structure for consistency.

### Backend

#### `meter_pipeline.rs` — `loudness_layout_meta`
Update the `Auto` arm:

```rust
ChannelLayoutSetting::Auto => match ch {
    1       => ("mono".to_string(),    true),
    2       => ("stereo".to_string(),  true),
    6       => ("5.1".to_string(),     true),
    8       => ("7.1".to_string(),     true),
    _       => ("unknown".to_string(), false),
}
```

#### `loudness.rs` — `push_interleaved_multichannel`

**7.1 path (new):** triggered when `channel_layout == Surround71 && ch >= 8`.  
Channel order: FL FR C LFE SL SR BL BR.  
BS.1770-4 weights: `[1, 1, 1, 0, 1, 1, 1, 1]` (LFE = 0).  
Reuses the same block accumulation and gating logic as the existing 5.1 path.

**Auto mode multichannel:** in `push_pcm`, resolve `Auto` to the effective layout before calling `push_interleaved_multichannel`:

```rust
let effective_layout = match channel_layout {
    ChannelLayoutSetting::Auto => match ch {
        6 => ChannelLayoutSetting::Surround51,
        8 => ChannelLayoutSetting::Surround71,
        _ => ChannelLayoutSetting::Stereo,
    },
    other => other,
};
```

#### `spectrum.rs`
Replace `push_interleaved` (all-channel power sum) with a `push_selected` method that takes a channel selection descriptor:

```rust
pub enum SpectrumChannelSel {
    Pair(u16, u16),   // average of two channels
    Single(u16),      // one channel
}
```

- Default (on start): `Pair(0, 1)` — L+R.
- `push_selected` extracts only the specified channel(s) and runs the existing stereo FFT path.

### IPC

#### `commands.rs` / `commands.js`
New command `set_spectrum_channel` mirroring `set_vectorscope_pair`:

```rust
#[tauri::command]
pub fn set_spectrum_channel(sel: SpectrumChannelSelPayload, state: ...) { ... }
```

Payload variants: `{ type: "pair", x: number, y: number }` or `{ type: "single", ch: number }`.

---

## Out of Scope

- True peak per-channel (only L/R reported; acceptable for now).
- Adding "Mono" as a manual layout option in Settings UI (auto-detection only).
- Notification dismissal UI (consistent with current auto-unknown notification behavior).
- Device mid-session channel count changes (requires session restart; existing behavior).
