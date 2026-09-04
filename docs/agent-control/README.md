# App Control Design

Date: 2026-09-03

Status: Living design record; Panel, Axis, Preset, Settings, Wait, Transport, and Dock Control
decisions are approved unless explicitly marked otherwise

This directory records the implemented developer-only App Control contract. It complements the
first-slice design in
[`../superpowers/specs/2026-09-02-agent-control-design.md`](../superpowers/specs/2026-09-02-agent-control-design.md).
That document explains the transport and initial Workspace implementation; this directory is the
source of truth for the complete public control surface.

## Current implementation

The development-identity build exposes all approved command families:

```text
app.capabilities
app.inspect
app.wait
workspace.applyLayout
panel.describe / panel.update / panel.reset
axis.describe / axis.inspect / axis shared / axis panel
preset.list / preset.describe / preset save / preset update / preset apply
preset.rename / preset.delete / preset.reorder
settings.describe / settings.inspect / settings.update
transport.inspect / transport source / transport live / transport file
dock.describe / dock.inspect / dock enter / dock exit / dock layout / dock panel
```

The repository entrypoint automatically supplies the `plvs-cli app` prefix:

```powershell
npm run desktop:control -- capabilities --json
npm run desktop:control -- inspect --json
npm run desktop:control -- wait --workspace-revision 0 --json
npm run desktop:control -- workspace apply layout.json --json
npm run desktop:control -- panel describe spectrum --json
npm run desktop:control -- settings inspect --json
npm run desktop:control -- transport inspect --json
npm run desktop:control -- dock inspect --json
```

Every example here writes its report to stdout, where npm also prints its script banner, so add
`--silent` (or call `node scripts/run-desktop-control.mjs` directly) whenever the JSON is
redirected or piped rather than read by a person.

These commands are development-only. The installed release CLI neither displays nor accepts the
`app` command family. Every mutation is delivered to the already-running React application and
uses the same state, native integrations, safety guards, and persistence paths as the GUI.

## Implementation status

The foundation, Panel Control, Axis Control, Presets, Settings, Revision Wait, Transport, and Dock
Control are implemented. Production exposure and MCP integration remain deferred product
decisions.

## Method responsibilities

### `app.capabilities`

This is the handshake and compatibility surface. It reports application identity, protocol version,
available methods, and supported module kinds. It does not report live panel instances, mutable
state, or a Workspace revision.

### `app.inspect`

This is a snapshot of the running application's mutable state. As command families are added, it
reports the Workspace, panel instances, each panel's complete public controls, compact Preset and
Settings state, Dock state, Transport state, and all domain revisions. It reports values, not
control schemas.

Panels are an array in `panelOrder`; each entry contains `id`, `moduleId`, `title`, complete public
`controls`, effective read-only `axes`, and module-specific `analysis`. The same panel shape is used
by successful Panel Control responses. The top-level `runtime` summarizes channel topology and
shared analysis such as Dialogue Detection and Spectral Waveform.

Inspection deliberately omits measurement frames and history, canvas data, hover/fullscreen/sheet
state, raw internal controls, React-only values, and field schemas. Preset state remains the compact
`activeId`/`dirty` relationship until the Preset command family is designed.

### `panel.describe`

This describes one live panel. It returns that panel's complete public controls and its dynamic
schema, including constraints that depend on the current channel topology or Profile state.
Schema fields carry machine-readable constraints plus public `title`, `description`, and `unit`
metadata where applicable. They do not expose UI implementation details such as widget type, CSS
ordering, ARIA labels, React callbacks, or commit-on-release behavior.

The schema is a deliberately small PLVS format inspired by JSON Schema, not a claim of full JSON
Schema compatibility. It describes:

- scalar and object types, defaults, numeric bounds, enum choices, titles, descriptions, and units;
- dynamic choices derived from current Profile and channel-topology state;
- current `effective` state and a stable `inactiveReason` for stored-but-dormant controls;
- `patchMode: "replace"` for atomic objects and arrays, or `patchMode: "merge"` for nested partial
  patches such as Spectrogram `threeD` and Stats `metrics`;
- relational constraints such as ordered ranges, minimum spans, or a required included value.

Dynamic choices list only currently valid values. For example, Loudness omits `reference` when the
Profile supplies no reference. Channel schemas include the currently valid object-valued choices
and report `channelTopology.status` as `assumed` or `detected`.

## Panel Control commands

```powershell
npm run desktop:control -- panel describe <panel-id> --json
npm run desktop:control -- panel update <panel-id> <file|-> --json
npm run desktop:control -- panel reset <panel-id> --json
```

`panel.update` and `panel.reset` also accept:

```text
--dry-run
--expected-revision <n>
```

The input file for `panel.update` is a direct public-control patch, without an extra `controls`
wrapper. Internally the RPC params wrap it with the target `panelId` and command options.

## Mutation contract

### Public controls

The API exposes a small module-specific control object, not the application's internal flat
`panelControlsById` record. Unknown fields, invalid types, invalid enum values, and out-of-range
values are errors. Agent mutations must not silently clamp, repair, or fall back.

Nested logical values such as ranges are atomic unless a panel document explicitly says a nested
partial patch is supported. The entire patch is validated before one state commit.

### Successful update

A normal successful update means all of the following have completed before the command returns:

1. Validation and revision checking.
2. React/Workspace state commit.
3. Workspace persistence flush.

Persistence failure therefore fails the command. There is no `persisted` boolean in successful
responses.

An effective controls change increments the Workspace revision and marks the active Preset dirty.
A no-op leaves the revision and Preset dirty state unchanged.

`panel.update` and `panel.reset` share one result shape:

```json
{
  "dryRun": false,
  "revision": 13,
  "changed": ["controls.frequencyColor"],
  "warnings": [],
  "panel": {
    "id": "waveform-1",
    "moduleId": "waveform",
    "controls": {},
    "axes": {},
    "analysis": {}
  },
  "preset": {
    "activeId": "preset-1",
    "dirty": true
  }
}
```

- `panel` is the complete resulting public panel state, in the same shape used by `app.inspect`.
  Unlike `panel.describe`, it does not include the schema.
- `changed` contains only public leaf paths whose values actually changed, in public schema order.
  It never exposes internal `panelControlsById` names. Reset may report an axis-link path such as
  `axes.frequency.linked`.
- `warnings` describes valid but noteworthy results; it does not represent failure.
- `preset` describes the resulting active-Preset relationship. `activeId` may be null.
- There is no `persisted` field. Successful non-dry-run completion implies durable persistence.

A no-op is successful, returns an empty `changed` array and the complete unchanged panel, does not
increment revision, does not write persistence, does not dirty the Preset, and does not rebuild an
analysis request.

### Revision domains

Revision is optimistic concurrency protection for one running PLVS process, not a durable document
version. It resets when the application restarts, so callers inspect again after connecting to a new
process.

Inspection groups independently evolving persisted domains:

```json
{
  "revisions": {
    "workspace": 13
  }
}
```

Preset, Settings, and Transport Control add `presets`, `settings`, and `transport` counters. The
first three describe durable domains; Transport revision is process-local runtime state. Dock is
part of the Workspace scene and does not add a fifth counter. A specific single-domain command
result can continue returning the unqualified `revision` because its command family identifies the
domain. Cross-domain results return a `revisions` object.

Workspace layout, panels, public panel controls, panel axis state, pin/title state, and a Preset
application that changes the Workspace increment `revisions.workspace`. Equivalent user and agent
mutations follow the same rule. One atomic operation increments once regardless of the number of
changed fields.

Dry runs, no-ops, validation failures, revision conflicts, live measurements, capture state, and
transient UI state do not increment it. Settings and Preset-collection edits do not increment the
Workspace counter. Preset dirty follows a Workspace mutation but does not add a second Workspace
increment; it is a change in the separate Presets domain.

If persistence fails after UI commit, the committed revision remains current and is returned with
`stateCommitted: true`; it is not rolled back merely to make the counter look unchanged.

### Dry run

A dry run performs the same validation, revision check, final-state calculation, warning analysis,
and diff calculation as a real update, but it does not:

- mutate React or Workspace state;
- increment the revision;
- mark the active Preset dirty;
- persist anything;
- create an analysis request or history slab.

Dry run uses the same result shape. `revision` remains the current real revision, while `changed`,
`panel`, and `preset` describe the result that a real execution would produce. No separate
`wouldChange` or projected-revision vocabulary is used; `dryRun: true` establishes the preview
semantics.

### Reset

`panel.reset` exposes the same product behavior as the Reset button in the panel settings header. It
resets the panel's public controls and its axis-link flags/default dormant local ranges. It does not
change shared Workspace axis values, remove the panel, change the active Profile, or clear measured
history and maxima.

### Failure contract

Validation is atomic: if any submitted field is invalid, none of the patch is committed. Validation
returns every independently discoverable input issue in one response so a caller can correct them
together:

```json
{
  "reason": "invalidControls",
  "message": "The panel controls are invalid.",
  "details": {
    "issues": [
      {
        "code": "outOfRange",
        "path": "$.speedPercent",
        "message": "speedPercent must be between 0 and 100."
      }
    ]
  }
}
```

Each issue has a stable machine code, a path into the caller's submitted JSON, and a human-readable
message. The initial stable reasons and issue codes are:

- `panelNotFound` for an unknown target panel;
- `revisionConflict`, with both `expectedRevision` and `currentRevision` in details;
- `invalidControls`, containing `issues` such as `unknownControl`, `invalidType`, `invalidEnum`,
  `outOfRange`, and `controlUnavailable`;
- `commandFailed` for an unexpected commit failure;
- `persistenceFailed` when UI state committed but durable saving failed.

A persistence failure must state the partial outcome explicitly:

```json
{
  "reason": "persistenceFailed",
  "details": {
    "stateCommitted": true,
    "revision": 13
  }
}
```

After a revision conflict or persistence failure, the caller should inspect current state rather
than retry blindly.

### Failures below the application

A request can also fail before it reaches the application at all: the frontend is not ready yet, the
broker's pending limit is full, the frontend did not answer in time, or the envelope was unreadable.
These carry `"layer": "transport"` alongside their `reason`, because they are not a valid app result
and must not be read as one — the same `busy` reason means the broker's request limit with the tag
and a refused concurrent `app.wait` without it. The CLI maps a tagged failure to exit code `2`
while keeping the reported reason; untagged errors are app results and exit `1`.

### Conditional controls and warnings

A stored control may be temporarily hidden or ineffective because of another control. Updating it
is valid and allows an agent to preconfigure a later mode. If a field touched by the patch is still
ineffective in the patch's final state, the result includes a `currentlyInactive` warning.

Warnings are calculated from the final state and only for fields touched by that patch. For example,
changing `frequencyBandsHz` while Waveform Frequency Color remains off warns; changing the bands in
the same patch that enables Frequency Color does not.

This differs from a dynamically unavailable option. Loudness `reference` is not a valid option when
the active Profile does not provide a reference, so submitting it fails with `controlUnavailable`
instead of succeeding with a warning.

### Axes

Panel descriptions and inspection return effective axis information:

```json
{
  "linked": true,
  "source": "workspace",
  "writable": false
}
```

The source is `workspace` or `panel`. Axis mutation is deliberately kept out of the public control
patch and belongs to the separate Axis Control contract.

### Analysis status and request deduplication

Where applicable, panel results describe analysis as `active`, `waitingForChannels`, or
`notRequested`/`inactive`.

Analysis request families have no artificial count cap. Identical request keys are deduplicated and
shared; every distinct valid request is sent to the backend. Spectrum and Spectrogram share the
Spectrum-like request family, while Vectorscope and Stereo Map use their own families. Dock requests
are deduplicated with matching Workspace requests or appended as distinct requests; they never evict
a Workspace request. Consequently Panel Control has no `overCap`, request-slot priority, or
allocation-change warning.

A dry run calculates the expected request and status without creating it or allocating history.

Stats reports Dialogue Detection with two read-only values: whether that individual panel requests
it and whether the shared global runtime is active. This keeps the per-panel cause separate from the
application-wide effect.

Waveform uses the same two-value pattern for shared Spectral Waveform analysis: a panel reports
`requestedByPanel` separately from global `runtime`, while the application runtime also provides a
single global summary.

Transient chart actions such as clearing Max Hold, TP Max, or all measurements are not Panel
Control settings.

## Panel specifications

| Module      | Detailed contract                                |
| ----------- | ------------------------------------------------ |
| Level Meter | [`panels/level-meter.md`](panels/level-meter.md) |
| Loudness    | [`panels/loudness.md`](panels/loudness.md)       |
| Stats       | [`panels/stats.md`](panels/stats.md)             |
| Vectorscope | [`panels/vectorscope.md`](panels/vectorscope.md) |
| Spectrum    | [`panels/spectrum.md`](panels/spectrum.md)       |
| Spectrogram | [`panels/spectrogram.md`](panels/spectrogram.md) |
| Waveform    | [`panels/waveform.md`](panels/waveform.md)       |
| Stereo Map  | [`panels/stereo-map.md`](panels/stereo-map.md)   |

## Follow-on module specifications

- [`presets.md`](presets.md) — approved Preset Control contract
- [`axes.md`](axes.md) — approved Axis Control contract
- [`settings.md`](settings.md) — approved Settings Control contract
- [`wait.md`](wait.md) — approved Revision Wait contract
- [`transport.md`](transport.md) — approved Transport Control contract
- [`dock.md`](dock.md) — approved Dock Control contract

## Resolved cross-module ownership

- Dialogue Detection engine selection is a global system setting, not a Stats panel control. The
  Settings contract owns `dialogueVadEngine`; Panel Control does not expose it.
- App Control sends live mutations through the running React application; Rust does not edit
  persisted Workspace or Preset records behind the frontend's state.
- Loudness Profile and Theme editors register with the shared blocking-editor guard. Preset
  save/apply/update and Dock entry are refused while either editor is open; no App Control flag may
  discard a draft.
- FILE mode refuses direct Dock entry and any Preset Apply that requires Dock before mutation, using
  the shared `fileModeActive` scene-operation contract. Lack of platform Dock support instead
  degrades by applying the non-Dock portion.

## Deferred decisions

- Production exposure and MCP integration remain future product decisions.
