# Panel Control

Panel Control reads and changes one live panel's public controls. Revision, dry run, the success
result and shared error codes follow the common contract in [`../user/cli.md`](../user/cli.md); this page
covers what is specific to panels. Fields, types, units, defaults and bounds for each module are
generated from the schema in `generated/panel-<module>.md`.

## Describe and inspect

`panel.describe` returns one live panel's complete public controls and its dynamic schema,
including constraints that depend on the current channel topology or Loudness Profile state. Schema
fields carry machine-readable constraints plus public `title`, `description`, and `unit` metadata.
They do not expose UI details such as widget type, CSS ordering, ARIA labels, React callbacks, or
commit-on-release behavior.

The schema is a deliberately small PLVS format inspired by JSON Schema, not a claim of full JSON
Schema compatibility. It describes:

- scalar and object types, defaults, numeric bounds, enum choices, titles, descriptions, and units;
- dynamic choices derived from current Loudness Profile and channel-topology state;
- current `effective` state and a stable `inactiveReason` for stored-but-dormant controls;
- `patchMode: "replace"` for atomic objects and arrays, or `patchMode: "merge"` for nested partial
  patches such as Spectrogram `threeD` and Stats `metrics`;
- relational constraints such as ordered ranges, minimum spans, or a required included value.

Dynamic choices list only currently valid values. Before a device topology is known, PLVS exposes
an assumed stereo L/R topology, and channel schemas report `channelTopology.status` as `assumed` or
`detected`.

`app.inspect` returns panels as an array in `panelOrder`. Each entry contains `id`, `moduleId`,
`title`, complete public `controls`, effective read-only `axes`, and module-specific `analysis` —
the same panel shape a successful update returns, without the schema.

## Update and reset

The input to `panel update` is a direct public-control patch, with no `controls` wrapper. The API
exposes a small module-specific control object, not the application's internal flat
`panelControlsById` record. Unknown fields, invalid types, invalid enum values, and out-of-range
values are errors; nothing is silently clamped, repaired, or substituted. Nested values such as
ranges are replaced atomically unless the module section below says the object supports merging.

An effective change marks the active Preset dirty. The success `state` contains `panel` (the
complete resulting panel) and `preset` (`activeId`, which may be null, and `dirty`). A no-op also
does not rebuild an analysis request.

`panel reset` matches the Reset button in the panel settings header: it restores the panel's public
controls, its axis-link flags, and its dormant local ranges. It never changes shared Workspace axis
values, removes the panel, changes the active Loudness Profile, or clears measured history and
maxima. Transient chart actions — clearing Max Hold, TP Max, or all measurements — are not Panel
Control at all.

## Errors and warnings

Panel-specific error codes are `panelNotFound` and `invalidControls`. The issues inside
`invalidControls` are `unknownControl`, `invalidType`, `invalidEnum`, `outOfRange`, and
`controlUnavailable`.

A stored control may be temporarily ineffective because of another control. Updating it is still
valid, so an agent can preconfigure a later mode. If a field the patch touches remains ineffective
in the final state, the result carries a `currentlyInactive` warning. Warnings are computed from the
final state and only for touched fields: changing a dormant field in the same patch that activates
it does not warn.

That differs from an option that is currently unavailable. Submitting such a value fails with
`controlUnavailable` rather than succeeding with a warning.

## Axes and analysis

Panels report effective axis state as `{ "linked": true, "source": "workspace", "writable": false }`,
where `source` is `workspace` or `panel`. Axes are read-only here and writable through
[`axes.md`](axes.md).

Where a module requests analysis, the panel reports it as `active`, `waitingForChannels`, or
`notRequested`/`inactive`. Request families have no count cap: identical request keys share one
request, every distinct valid key is sent to the backend, and Dock requests are deduplicated with
matching Workspace requests or appended, never evicting one. There is therefore no `overCap`,
request priority, or allocation warning. A dry run computes the expected request and status without
creating it or allocating history.

Two modules drive a shared global analysis instead of a keyed request. They report the panel's own
demand separately from the application-wide effect:

```json
{ "requestedByPanel": true, "runtime": "active" }
```

`requestedByPanel: false` with `runtime: "active"` is valid — another panel is the requester.
Starting or stopping the shared runtime by editing a panel produces no warning, and a dry run
previews both values without starting or stopping anything.

## Modules

### Level Meter

- Peak and RMS use `levelRangeDbfs`; Momentary and Short-term use `loudnessRangeLufs`. Both are
  always returned.
- `playbackMax` is effective for RMS, Momentary, and Short-term, not Peak. `floatingValue` is
  effective for Momentary and Short-term. `tpMaxMarker` is effective for Peak.
- No panel-specific analysis status.

### Loudness

- `layers` is a complete set replacement: may be empty, no duplicates, emitted in canonical order.
- Public `reference` maps to the internal `ref` identifier. When the active Profile provides no
  reference, `reference` is omitted from both the value and the schema's options, and submitting it
  fails with `controlUnavailable`. The hidden stored preference survives, so it reappears when a
  suitable Profile is enabled; updating layers while the Profile is off must not erase it.
- Time axis: read-only here.

### Stats

- `metrics` supports merge patches: a patch may supply only `visible` or only `order`.
- `visible` is a complete set replacement of unique known IDs, may be empty, and is output sorted by
  `order`. It defaults to the first eight IDs of the canonical order.
- `order` must be a full permutation of all 15 known IDs and defaults to the canonical order.
- Dialogue Detection engine selection is a global setting owned by Settings Control
  (`settings.dialogueVadEngine`), not a Stats control. Showing at least one dialogue metric requests
  the shared analysis, reported as `analysis.dialogueDetection`.

### Vectorscope

- `channelPair` takes in-range integer indices with `x < y`. Every distinct pair is valid, not only
  the UI's shortlist; reversed or invalid pairs are rejected, never swapped or clamped.
- `maxHold` is effective only in `polarLevel`.
- Request identity is the channel pair alone; mode and Max Hold do not affect it. Own request family.

### Spectrum

- `channel` is `{ "type": "single", "ch": n }` or `{ "type": "pair", "x": n, "y": n }`, limited to
  the choices the product UI offers for the current topology.
- `view` (`combined`, `lr`, `ms`) is effective only for a channel pair.
- Request identity: channel, view, speed, and octave smoothing. Tilt, level range, peak labels, and
  max mode are display-only. Shares the Spectrum-like request family with Spectrogram.
- Frequency axis: read-only here.

### Spectrogram

- Channel validation and topology reporting match Spectrum.
- `mode` is `heatmap` (2D), `lines`, or `surface` (3D). `threeD` supports merge patches, and its
  fields are effective only in a 3D mode.
- `azimuthDeg` must satisfy `0 <= value < 360`; unlike the UI's drag repair, the API rejects rather
  than wraps.
- Request identity: channel and octave smoothing, plus a hidden fixed speed. Mode, tilt, dB floor,
  3D controls, and axes do not affect it. Shares the Spectrum-like request family.
- Frequency and time axes: read-only here.

### Waveform

- The frequency split controls are effective only while `frequencyColor` is on; a touched
  `frequencyBandsHz` warns with reason `frequencyColorOff`. Turning Frequency Color off does not warn
  about untouched stored bands.
- Frequency Color and Centroid each request the shared `spectralWaveform` analysis, reported as
  `analysis.spectralWaveform`. It is one shared boolean request, not a keyed family, and a reset that
  removes the last requester leaves it unrequested.
- Time axis: read-only here.

### Stereo Map

- Channel-pair validation matches Vectorscope.
- `maxHold` is effective in every mode. Mode-specific ranges stay stored while another mode is active.
- `monoLossFloorDb` runs from -60 through -6 dB; its fixed 0 dB upper bound is not a control.
- Request identity: channel pair, speed, and octave smoothing. Modes share the same data.
- Frequency axis: read-only here.
