# Channel Label Override — Phase 1 (labels only)

**Date:** 2026-06-12
**Status:** Approved
**Phase:** 1 of 2 (this spec covers labels only; loudness-awareness is a separate follow-up spec)

## Overview

Let the user manually assign a **role** to each input channel, so channel counts that auto-detection cannot name (e.g. 7ch) — or any layout the user wants to relabel — get meaningful channel labels instead of generic `Ch 1 … Ch N`.

The override is **per channel count**: one user-defined "format" for N channels, stored and reused whenever an N-channel input appears. It is conceptually a user-supplied supplement to the built-in `PEAK_METER_CHANNEL_FORMATS` table.

**Phase 1 is labels only.** The override changes how channels are *named* in the peak meter header, vectorscope channel options, and spectrum channel options. It does **not** change loudness (BS.1770) math — loudness continues to auto-resolve by channel count (6→5.1, 8→7.1, otherwise first-two-channels stereo). Loudness-awareness (mapping roles → K-weight coefficients, the IPC, and the Rust dynamic-weight aggregation) is **Phase 2** and out of scope here.

## Motivation

This came out of removing the old Channel-layout preset picker: auto-detection by channel count handles standard layouts, but it deliberately leaves ambiguous counts as `unknown` → generic `Ch N` labels, and the user had **no way to correct them**. The trigger case was a 7-channel input (6.1 vs 7.0 has no single standard order, so the app cannot guess). Rather than hardcode a guess per ambiguous count, give the user a way to assign roles when they know the layout.

## Conceptual model

- A **role vocabulary** (fixed list) maps a per-channel role token to a display label.
- A **per-count override**: `channelLabelOverrides[count]` = an array of role tokens, length === `count`.
- When an override exists for the current input's channel count, it takes **highest priority** over auto-detection for label display.
- The override stores **role tokens** (not bare label strings), so Phase 2 can map the same tokens to loudness weights without a data-model change.

## Role vocabulary

A single ordered list, used to populate every per-channel dropdown. Each entry is `{ id, label }`; the `id` is what's persisted, the `label` is what's shown (and what becomes the channel header).

| id      | label | notes                                   |
| ------- | ----- | --------------------------------------- |
| `generic` | `—`   | renders as `Ch N` at that channel index |
| `M`     | `M`   | mono                                    |
| `L`     | `L`   | front left                              |
| `R`     | `R`   | front right                             |
| `C`     | `C`   | front center                            |
| `LFE`   | `LFE` | low-frequency effects                   |
| `Ls`    | `Ls`  | left surround (side)                    |
| `Rs`    | `Rs`  | right surround (side)                   |
| `Lb`    | `Lb`  | left back                               |
| `Rb`    | `Rb`  | right back                              |
| `Cs`    | `Cs`  | back center (6.1)                       |
| `Ltf`   | `Ltf` | top front left (Atmos)                  |
| `Rtf`   | `Rtf` | top front right (Atmos)                 |
| `Ltr`   | `Ltr` | top rear left (Atmos)                   |
| `Rtr`   | `Rtr` | top rear right (Atmos)                  |

Notes:
- `generic` is the only id whose displayed label is index-dependent (`Ch 1`, `Ch 2`, …); every other id renders its `label` verbatim.
- Duplicate roles are **allowed** and not validated (e.g. two channels both `L`). Phase 1 is cosmetic; no need to enforce uniqueness.
- Atmos height ids are display-only in Phase 1 (no loudness meaning yet).

## Data model & persistence

```
channelLabelOverrides: { [count: number]: string[] }   // tokens, tokens.length === count
```

- Lives in the existing prefs blob under `STORE_KEY` (alongside `appearance`, `referenceLufs`, …), persisted to `localStorage`.
- Load: restore `channelLabelOverrides` if it's a plain object; each entry is kept only if it's an array whose length equals its numeric key and whose tokens are all in the vocabulary (otherwise that entry is dropped — defensive against hand-edited/old blobs).
- Save: written alongside the other prefs in the existing save effect.
- No `stripLegacy…` involvement — this is a current key, not legacy.

## Label resolution (integration point)

`getPeakMeterChannelLabels(channelCount, ctx)` gains a new **highest-priority** branch:

1. **NEW** — if `ctx.overrideLabels` is an array with `length === channelCount`, return it as-is. (App computes this from `channelLabelOverrides[channelCount]` via the token→label helper; `generic` → `Ch ${i+1}`.)
2. `ctx.formatId` (existing)
3. `ctx.resolvedLayout === "unknown"` → numbered `Ch N` (existing)
4. exact-count format match (existing)
5. numbered fallback (existing)

A small pure helper does the token→label mapping:

```
roleTokensToLabels(tokens) -> string[]
  // maps each token to its vocabulary label; `generic` (or any unknown token) -> `Ch ${i+1}`
```

App wiring (in `App.jsx`):
- `channelLabelOverrides` is React state (seeded from persistence).
- For the current `channelCount`, compute `overrideLabels = override ? roleTokensToLabels(override) : null`.
- Thread `overrideLabels` into `peakLabelContext` and `vectorscopeLabelContext` (the two memos already carrying `channelLayout`/`resolvedLayout`). Spectrum channel options derive from `peakLabelContext`, so they inherit it.
- Changing the override updates state → contexts → re-render. No engine restart, no IPC.

The `resolveChannelLayout` resolver is **unchanged** — the override sits above it in the label path, not inside it.

## Settings UI — "Channel labels" section

A new section in `SettingsPanel`, below the existing controls.

**When an input is active (`channelCount > 0`):**
- A heading like `Channel labels · {N}-channel`.
- `N` rows, one per channel index `1…N`. Each row: a small index/label on the left (`1`, `2`, …) and a role `Select` on the right whose options are the full vocabulary.
- **Seed values:** each dropdown initializes to the channel's current auto-detected label mapped back to its token (auto labels are already role-shaped — `L`, `R`, `C`, `LFE`, `Ls`, `Rs`, `Lb`, `Rb`, `M`); when the auto label is numbered (`Ch N`, i.e. unknown/no match) the seed is `generic`. Seeding is for display of the editor's starting state; an override entry is only written to the store once the user changes something (or hits save-on-change — see below).
- **Write semantics:** changing any row writes the full current token array for this `count` into `channelLabelOverrides[count]` (so the store always holds a complete N-length array). Live meters update immediately.
- A **`Reset to Auto`** control: deletes `channelLabelOverrides[count]`, so labels fall back to auto-detection; the editor rows revert to their auto seeds.

**When idle (`channelCount === 0`):**
- The section is disabled with a hint: "Connect an input to label its channels."

The section follows existing `SettingsPanel` layout idioms (label + `Select`, `Separator` between sections), consistent with the Appearance / Loudness reference rows.

## Scope of effect

Affects (all label contexts):
- Peak meter column headers
- Vectorscope channel-pair option labels
- Spectrum channel-selection option labels

Does **not** affect:
- Loudness / BS.1770 aggregation (Phase 2)
- Channel order or routing of the audio itself
- The `resolveChannelLayout` resolver output

## Testing

- `roleTokensToLabels`: maps known tokens to labels; `generic` and unknown tokens → `Ch N` at their index; round-trips length.
- `getPeakMeterChannelLabels` override branch: returns `overrideLabels` when length matches; ignores it (falls through to existing logic) when length mismatches `channelCount`.
- Settings "Channel labels" section (component test): renders `N` rows for a given count; seeds each row from the auto label; changing a row writes the full token array; `Reset to Auto` clears the entry; disabled with hint when `channelCount === 0`.
- Persistence round-trip: an override survives save→load; malformed/over-length/unknown-token entries are dropped on load.
- `resolveChannelLayout` tests unchanged (resolver is not touched).

## Out of scope (Phase 2)

- Mapping role tokens → BS.1770 K-weight coefficients (LFE = 0, surround = +1.5 dB, front/center = 1.0; **height channels have no BS.1770 standard — Phase 2 will default them to unity (1.0) as a documented convention**).
- An IPC to send the per-channel weight vector for the current count to the Rust engine.
- Rust loudness aggregation accepting an arbitrary per-channel weight vector (replacing the hardcoded 5.1/7.1 vectors).
