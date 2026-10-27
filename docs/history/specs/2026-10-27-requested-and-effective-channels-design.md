# Requested and Effective Channel Selections

**Date:** 2026-10-27
**Status:** Approved

## Summary

A panel's channel selection is stored as the user's request and is never rewritten because the
current source has fewer channels. What the panel analyses and draws is the effective selection,
derived from the request and the current channel topology wherever a reader needs it. When the
wider source returns, the panel returns to the request on its own.

This supersedes the "Channel clamp" section of
`2026-10-27-preset-dirty-by-comparison-design.md`, which kept a clamped Preset modified because the
clamp was destructive.

## Problem

Four effects in `AnalysisSessionContext.jsx` clamp channel selections to the available channels and
write the result back:

- one over Workspace panels through `deriveClampedPanelControls` (`workspace/clampPanelControls.js`):
  Spectrum and Spectrogram `spectrumChannel`, Vectorscope `vectorscopePair`, Stereo Map
  `stereoMapPair`;
- three over Dock panels: Vectorscope, Stereo Map, and Spectrum/Spectrogram.

Reproduced in the dev app on 2026-10-27: a Preset with Spectrum on pair 5/6, applied on a 10-channel
input, then capture started on a 2-channel device. Spectrum was rewritten to 1/2 and persisted.

- Returning to the 10-channel device leaves the panel on 1/2.
- The active Preset reads modified, and Update overwrites the Preset's 5/6 with 1/2.
- The same applies to analysing a file with fewer channels than the live source.

Stopping capture, or switching devices while stopped, does not clamp; starting capture on the
narrower device does.

## Goals

- Stored channel selections change only when the user, a Preset or Agent Control sets them.
- The effective selection matches what the clamp produces today, so what a panel shows on a narrower
  source does not change.
- Returning to a source that has the requested channels restores them without user action.
- A clamped panel no longer makes the active Preset modified.

## Non-goals

- Recovering selections already rewritten before this change.
- Changing which fallback the clamp picks.
- Letting the UI or Agent Control select a channel the current source does not have.

## Design

### Resolution

```text
effective = resolveEffectiveChannelControls(moduleId, requestedControls, topology)
```

A pure module, `src/analysis/effectiveChannels.js`, resolves the channel fields of one panel's
controls: `spectrumChannel` for Spectrum and Spectrogram, `vectorscopePair` for Vectorscope and
`stereoMapPair` for Stereo Map. It reuses `clampSpectrumChannelToAvailable` and
`clampVectorscopePairToAvailable` with the inputs the clamp effects use today
(`spectrumChannelOptions`, `channelCount`, `peakLabelContext`), so the fallback is identical. It
also reports whether the requested selection is unavailable.

The topology comes from `AnalysisSessionContext`, which already derives all three. When the channel
count is unknown (no frame shape reported yet), the effective selection is the requested one. That
follows the existing Stereo Map rule in `deriveAnalysisRequests`: the file analysis worker snapshots
the request list once at start, so a request must not be suppressed before the shape is known.

The four clamp effects and `workspace/clampPanelControls.js` are removed.

### Which value each reader uses

| Reader                                                                                                                                                     | Value     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| Stored Workspace and Dock controls, Preset snapshots, the Preset modified comparison                                                                       | requested |
| Settings controls and every write they make                                                                                                                | requested |
| Backend analysis requests: `deriveAnalysisRequests` and `mergeDockAnalysisRequests`                                                                        | effective |
| Panel result lookup: `SpectrumPanel`, `SpectrogramPanel`, `useVectorscopeDisplay`, `StereoMapPanel` and the Dock key functions in `dockAnalysisRequest.js` | effective |
| Retained history keys: `deriveRetainedAnalysisKeys` and `mergeDockRetainedKeys`                                                                            | both      |

Hosts (`LeafView`, `SplitLayout`, the Dock module hosts) keep passing the requested controls.
Settings write by spreading the whole controls object
(`onPanelControlsChange({ ...normalizedPanelControls, ...changes })`), so a settings control that saw
the effective selection would store it as the request as soon as the user changed an unrelated
option. Panels therefore resolve the effective selection themselves, through one hook over the
analysis session, at the point where they derive their request key; the write path is unchanged.

Retained keys keep both: the requested key, so its history survives while the source is narrower
and is shown again when the wider source returns within the retention window, and the effective key,
so the history being recorded during the fallback is not swept as unretained.

Stereo Map's request-side rule in `deriveAnalysisRequests` (omit the request while the pair is
out of range) stays, but only a mono source still reaches it: on two or more channels the resolved
fallback pair is always in range, which is what users saw before, because the clamp rewrote the pair
first.

Agent Control's Preset apply plan (`planPresetApplyResources` in `presetScene.js`) also used the
clamp, and the apply installed the clamped copy. It now applies the saved selections and keeps the
`channelSelectionAdapted` warning, reporting the effective selection.

### Settings display

Decision: while the requested selection is unavailable, the channel control shows the request,
marked unavailable, for example `Ch 5+Ch 6 (Unavailable)`, and the panel draws the fallback. Choosing
any listed option replaces the request; the unavailable entry is not offered as a choice in the list.
The Spectrum channel row, otherwise shown only above two channels, is also shown while its request is
unavailable, so the kept request is visible on a stereo source. While the channel count is not known
yet, nothing is marked unavailable.

### Agent Control

Decision: `inspect` and panel reads report `controls.channel` (and the Vectorscope and Stereo Map
pairs) as the request, and add the effective selection, read-only, to the panel's existing
`analysis` block (`readPublicPanelAnalysis` in `appSnapshot.js`, `panelAnalysis` in
`dockControl.js`), with a flag when it differs from the request. `panel update` keeps refusing a
channel the current topology does not offer (`controlUnavailable`).

The synchronisation checklist in `docs/agent-control/README.md` applies: schema, read mapping,
documentation, capability declaration and contract tests. Generated files are regenerated, never
hand-edited. Preset snapshots already drop the `analysis` block (`presetSnapshot.js`), so the
effective value cannot leak into a Preset.

### Preset modified state

No change to `presetDivergence.js` is needed: the stored selection no longer changes on a narrower
source, so the comparison stays clean. ADR 0040 listed the destructive clamp as a consequence; this
removes it.

## Risks

- A reader left on the requested selection would ask for a key Rust does not compute, and the panel
  would draw nothing. Every caller of `spectrumRequestKeyFromControls`,
  `vectorscopeRequestKeyFromControls`, `stereoMapRequestKeyFromControls` and the Dock key functions
  goes through the resolution, and a contract test pins the files allowed to call them.
- A changed effective key opens a new history slab, as the clamp does today. Retention and eviction
  are checked against the analysis-history section of `docs/pitfalls.md`.
- Vectorscope pair validity depends on channel labels (`peakLabelContext`), not only on the count.
  The resolution passes the same context the clamp uses.

## Testing

- `effectiveChannels.test.js`: each of the four modules, an available request (unchanged), an
  unavailable one (same fallback as the clamp functions), unknown topology (request unchanged), and
  a label-dependent Vectorscope pair.
- Request derivation: a Workspace and a Dock panel requesting 5/6 on a 2-channel topology produce the
  1/2 request; retained keys contain both keys.
- Regression, replacing the clamp tests: a narrower topology never calls `setPanelControlsForPanel`
  or the Dock `setPanelControls`, and the stored controls are unchanged.
- Settings: the unavailable request is labelled, and changing an unrelated option keeps the stored
  request.
- Agent Control contract tests for the effective selection in Workspace and Dock panel reads.
- Real app: 10-channel input with Spectrum on 5/6, then 2 channels, then 10 again. Spectrum shows 1/2
  and then 5/6, the stored selection stays 5/6 throughout, the active Preset stays clean, and a Dock
  Spectrum behaves the same.

## Documentation

- `docs/user/multichannel.md`, Per-panel behaviour: a selected channel or pair that the current
  source lacks is kept and shown as unavailable while the panel falls back, and comes back with a
  source that has those channels.
- Agent Control documentation for the new read-only effective selection.
