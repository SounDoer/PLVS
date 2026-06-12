# Channel Label Override — Phase 2 (loudness-aware roles)

**Date:** 2026-06-12
**Status:** Draft
**Phase:** 2 of 2

## Overview

Phase 1 lets the user assign role tokens to each input channel and uses those tokens for display labels. Phase 2 makes the same role tokens affect loudness measurement: when the current channel count has a user-defined override, the frontend maps its role tokens to a per-channel BS.1770-style weight vector and sends that vector to the Rust engine.

This phase is still labels/roles driven. It does **not** add a channel router, matrix mixer, arbitrary user gain editor, or new layout preset picker.

## Current state

Already implemented before this phase:

- `channelLabelOverrides[count]` persists role tokens per channel count.
- `roleTokensToLabels`, `seedTokensFromLabels`, and `sanitizeChannelLabelOverrides` exist in `src/math/channelRoles.js`.
- `App.jsx` computes the active override for `channelCount` and threads override labels into peak/vectorscope/spectrum display contexts.
- Rust already supports hardcoded 5.1 and 7.1 loudness paths and auto-routes 6ch/8ch inputs to those paths.
- Spectrum channel selection IPC/state already exists and is unrelated to this phase.

The missing link is dynamic loudness weighting for user-overridden layouts. Seven-channel inputs are labelled as `7.0` by default (`L R C Ls Rs Lb Rb`), but Phase 2 still matters because user edits must be able to change loudness semantics live.

## Goals

- A user-defined channel label override changes loudness aggregation for that channel count.
- The loudness engine accepts a dynamic per-channel weight vector and uses it ahead of hardcoded layout detection when the vector length matches the current stream channel count.
- Removing the override clears the dynamic vector, so loudness falls back to existing auto behavior.
- Changing roles while capture is running takes effect without restarting the engine.
- Dynamic weight changes reset loudness accumulation so momentary/short-term/integrated values do not mix old and new semantics.

## Non-goals

- No custom per-channel gain sliders.
- No user-editable dB values.
- No channel reordering or audio routing.
- No Phase 1 UI redesign.
- No change to peak meter, vectorscope, spectrum, waveform, or true-peak channel routing.
- No attempt to define official BS.1770 height-channel semantics; height roles use a documented unity convention.

## Weight vocabulary

Weights are **linear energy multipliers** used in the BS.1770 K-weighted mean-square sum:

```
sum_ms += weight[channel] * k_weighted_sample[channel]^2
```

| role token | meaning | weight |
| --- | --- | --- |
| `L`, `R`, `C`, `M` | front / mono full-band channel | `1.0` |
| `LFE` | low-frequency effects | `0.0` |
| `Ls`, `Rs`, `Lb`, `Rb`, `Cs` | surround/back channels | `10 ** (1.5 / 10)` ≈ `1.4125375446` |
| `Ltf`, `Rtf`, `Ltr`, `Rtr` | height channels | `1.0` |
| `generic` | user left the role unspecified | `1.0` |
| unknown token | defensive fallback; should not survive sanitization | `1.0` |

`generic` uses unity because it is safer to include an unlabeled full-band channel than to silently ignore it. Users who need LFE exclusion or surround gain must choose a semantic role.

## Frontend behavior

Add a pure helper in `src/math/channelRoles.js`:

```
roleTokensToLoudnessWeights(tokens) -> number[]
```

It returns one finite linear weight per token, preserving length. It does not validate channel count; `App.jsx` already selects the current count's override.

`App.jsx` computes:

```
const loudnessWeights =
  channelLabelOverride ? roleTokensToLoudnessWeights(channelLabelOverride) : null;
```

When `loudnessWeights` changes:

- If it is an array and the app is running in Tauri, call `setLoudnessWeights(loudnessWeights)`.
- If it is `null`, call `setLoudnessWeights(null)` to clear the engine override.
- On engine start, send the current value before `audio_start`, just like vectorscope/spectrum selections.

This makes role edits live. No restart or IPC to mutate labels is needed.

## IPC contract

Add one frontend wrapper:

```
setLoudnessWeights(weights)
  // weights: number[] | null
  // invokes "set_loudness_weights" with { weights }
```

Add one Rust command:

```
#[tauri::command]
pub fn set_loudness_weights(weights: Option<Vec<f64>>, state: State<'_, AppState>) -> Result<(), String>
```

Validation:

- `None` clears the dynamic override.
- `Some(weights)` must have length `1..=64`.
- Every value must be finite and `>= 0.0`.
- Invalid payloads return `Err(...)` and leave the previous state unchanged.

The state stores `Arc<Mutex<Option<Vec<f64>>>>`. The capture worker reads a cloned snapshot for each PCM chunk and passes it to `MeterPipeline::push_pcm_f32`.

## Rust DSP behavior

`PcmContext` gains:

```
pub loudness_weights: Option<Vec<f64>>
```

`LoudnessMeter` uses dynamic weights when:

- `ctx.loudness_weights` is `Some(weights)`, and
- `weights.len() == ctx.channels as usize`.

Dynamic weights have highest priority over `ChannelLayoutSetting`. Existing hardcoded paths remain as fallback:

1. dynamic weights if length matches
2. hardcoded 5.1 path
3. hardcoded 7.1 path
4. stereo fallback using first two channels

If a non-matching vector reaches DSP, it is ignored. The IPC and frontend should normally prevent this.

## Runtime updates

`MeterPipeline` tracks the last applied loudness weight vector. If the vector changes:

- reset `LoudnessMeter`
- clear `last_loudness`
- clear `pending_loudness_hist`
- reset `m_max` and `st_max`

Do not reset sample peak maxima, spectrum, vectorscope, waveform, or capture session state. True peak remains reported from physical channels 1/2, matching existing UI semantics.

## History and snapshot semantics

Existing frame payload fields `loudness_layout` and `loudness_layout_known` remain. When a dynamic vector is active, payloads should report:

```
loudness_layout: "custom"
loudness_layout_known: true
```

This makes history entries explicit: they were measured with a user-defined role override, not with the auto 5.1/7.1 resolver.

## Error handling

- Frontend helper output is deterministic and finite.
- IPC rejects malformed vectors.
- The capture thread treats poisoned locks or invalid snapshots as `None` and falls back to auto loudness.
- Dynamic vector length mismatch is ignored in DSP rather than panicking.

## Testing

Frontend:

- `roleTokensToLoudnessWeights` maps all role groups correctly.
- `generic` and unknown tokens map to `1.0`.
- `setLoudnessWeights` invokes Tauri with either an array or `null`.
- `App.jsx` wiring sends weights on engine start and when channel label overrides change.

Rust:

- IPC accepts valid vectors, clears on `None`, rejects negative/NaN/empty/overlong vectors.
- `LoudnessMeter` ignores an LFE-only channel when dynamic weights set that channel to `0`.
- Dynamic surround weight produces a higher loudness value than unity for the same signal.
- A mismatched dynamic vector falls back to the existing layout path.
- `MeterPipeline` reports `"custom"` / `known=true` when dynamic weights are active.
- Changing the vector resets loudness accumulation without resetting unrelated meters.

## Manual verification

With a 7-channel input:

1. Start with no override: labels resolve as 7.0 (`L R C Ls Rs Lb Rb`) and loudness uses existing auto fallback until a user override exists.
2. In Settings, change roles as needed, for example mark one channel as `LFE` or `Cs`.
3. Confirm labels update immediately.
4. Confirm loudness changes after role edits without restarting capture.
5. Change the LFE row to a full-band role and confirm loudness changes again.
6. Click `Reset to Auto` and confirm the engine returns to auto loudness behavior.
