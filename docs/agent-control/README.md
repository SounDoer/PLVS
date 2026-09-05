# App Control Design

Date: 2026-09-03

Status: Living design record; Panel, Axis, Preset, Settings, Wait, Transport, and Dock Control
decisions are approved unless explicitly marked otherwise

This directory records the implemented App Control contract. It complements the
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
npm run desktop:control -- wait --after-revision 0 --timeout-ms 30000 --json
npm run desktop:control -- workspace apply layout.json --expected-revision 0 --json
npm run desktop:control -- panel describe spectrum --json
npm run desktop:control -- settings inspect --json
npm run desktop:control -- transport inspect --json
npm run desktop:control -- dock inspect --json
```

Every example here writes its report to stdout, where npm also prints its script banner, so add
`--silent` (or call `node scripts/run-desktop-control.mjs` directly) whenever the JSON is
redirected or piped rather than read by a person.

These commands require Agent Control to be enabled in PLVS Settings, which is off by default in
release builds and on in development builds. Every mutation is delivered to the already-running
React application and uses the same state, native integrations, safety guards, and persistence
paths as the GUI.

## Implementation status

The foundation, Panel Control, Axis Control, Presets, Settings, Revision Wait, Transport, and Dock
Control are implemented. MCP integration remains a deferred product decision.

## Keeping this contract in step with the app

Panel Control is three hand-written lists of the same fields -- the schema, the read mapping and the
patch planner -- layered on one flat control record. Nothing in the app makes them agree, and a
control added to `src/lib/panelControls.js` and rendered in Panel Settings needs no App Control
change to look finished. Four guards make that omission fail instead:

| Guard                                              | Fails when                                                                                                        |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `src/agentControl/panelControlCoverage.test.js`    | A panel control is neither exposed by Panel or Axis Control nor listed as deliberately internal.                  |
| `src/agentControl/panelControlContract.test.js`    | A module in `MODULE_CATALOG` has no branch in describe / read / patch / reset, or the three field lists disagree. |
| `src/agentControl/settingsControlContract.test.js` | Settings read / describe / patch disagree, or an option list stops matching the app's own.                        |
| `src/agentControl/publicSurfaceDocs.test.js`       | `generated/` no longer matches the schema builders.                                                               |

The last fails as a snapshot mismatch; `npm run docs:agent-control` rewrites the pages.

Settings has no coverage guard of its own. There is no single definition of "every setting" to check
`PUBLIC_FIELDS` against -- the settings persistence domain also holds Preset-captured scene state,
the Theme and Loudness Profile libraries and window state, all of which `settings.md` places outside
this contract -- so such a list would be a judgement call maintained by hand, which is the failure
mode these guards exist to remove. What is checked instead is that Settings Control never restates an
option list or default: it imports the app's own from `src/settings/defaults.js` and
`src/lib/dialogueVadEngines.js`. A value the GUI offers that App Control rejects would otherwise be
invisible, because `settings describe` would tell the agent the value does not exist.

`generated/` holds the reference half of this directory: every field's type, unit, default and
bounds, rendered from the schema builders. It is not editable by hand. The pages beside it carry
what a schema cannot state -- atomicity, warning semantics, availability rules, analysis identity --
and no longer restate numbers the generated tables own.

Deciding that a control stays out of App Control is a normal outcome; record it by adding the key to
`INTERNAL_ONLY_CONTROLS` in the coverage test, with the reason. What the guards forbid is leaving
the question unanswered.

## Method responsibilities

### `app.capabilities`

This is the handshake and compatibility surface, with a deliberate distinction between the
frontend wire payload and the public CLI result. The frontend JSON-RPC method returns the current
`revision`, `appVersion`, `protocolVersion`, `commands`, `features`, `runtime`, `methods`, and
`modules`. It does not contain `cliVersion`; Rust adapts that payload for
`plvs-cli app capabilities --json` and independently injects the installed CLI version.

The stable public result contains `revision`, `appVersion`, `cliVersion`, `protocolVersion`,
`commands`, and `features`:

```json
{
  "schemaVersion": 1,
  "ok": true,
  "result": {
    "revision": 13,
    "appVersion": "0.14.6",
    "cliVersion": "0.14.6",
    "protocolVersion": 1,
    "commands": [],
    "features": {}
  }
}
```

`runtime`, `methods`, and `modules` may remain as compatible extra fields, but public CLI consumers
discover supported commands and features from `commands` and `features`. `appVersion` and
`cliVersion` are independent build identities and must not be assumed equal. Capabilities does not
report live panel instances or mutable state beyond the current revision.

### `app.inspect`

This is a snapshot of the running application's mutable state. As command families are added, it
reports the Workspace, panel instances, each panel's complete public controls, compact Preset and
Settings state, Dock state, Transport state, and the current top-level `revision`. It reports
values, not control schemas.

Panels are an array in `panelOrder`; each entry contains `id`, `moduleId`, `title`, complete public
`controls`, effective read-only `axes`, and module-specific `analysis`. The same panel shape is used
by successful Panel Control responses. The top-level `runtime` summarizes channel topology and
shared analysis such as Dialogue Detection and Spectral Waveform.

Inspection deliberately omits measurement frames and history, canvas data, hover/fullscreen/sheet
state, raw internal controls, React-only values, and field schemas. Preset state remains the compact
`activeId`/`dirty` relationship; the implemented Preset commands provide library listing,
description, save, update, apply, rename, delete, and reorder operations.

### `panel.describe`

This describes one live panel. It returns that panel's complete public controls and its dynamic
schema, including constraints that depend on the current channel topology or Loudness Profile state.
Schema fields carry machine-readable constraints plus public `title`, `description`, and `unit`
metadata where applicable. They do not expose UI implementation details such as widget type, CSS
ordering, ARIA labels, React callbacks, or commit-on-release behavior.

The schema is a deliberately small PLVS format inspired by JSON Schema, not a claim of full JSON
Schema compatibility. It describes:

- scalar and object types, defaults, numeric bounds, enum choices, titles, descriptions, and units;
- dynamic choices derived from current Loudness Profile and channel-topology state;
- current `effective` state and a stable `inactiveReason` for stored-but-dormant controls;
- `patchMode: "replace"` for atomic objects and arrays, or `patchMode: "merge"` for nested partial
  patches such as Spectrogram `threeD` and Stats `metrics`;
- relational constraints such as ordered ranges, minimum spans, or a required included value.

Dynamic choices list only currently valid values. For example, Loudness omits `reference` when the
Loudness Profile supplies no reference. Channel schemas include the currently valid object-valued
choices and report `channelTopology.status` as `assumed` or `detected`.

## Panel Control commands

```powershell
npm run desktop:control -- panel describe <panel-id> --json
npm run desktop:control -- panel update <panel-id> <file|-> --expected-revision 12 --json
npm run desktop:control -- panel reset <panel-id> --expected-revision 12 --json
```

`panel.update` and `panel.reset` require `--expected-revision` and support `--dry-run`:

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

An effective controls change increments the global revision and marks the active Preset dirty.
A no-op leaves the revision and Preset dirty state unchanged.

Inside the public CLI success envelope, `panel.update` and `panel.reset` use this `result` object:

```json
{
  "dryRun": false,
  "revision": 13,
  "changed": true,
  "warnings": [],
  "state": {
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
}
```

- `state.panel` is the complete resulting public panel state, in the same shape used by
  `app.inspect`.
  Unlike `panel.describe`, it does not include the schema.
- `changed` is a boolean: `true` means at least one public value changed.
- `warnings` describes valid but noteworthy results; it does not represent failure.
- `state.preset` describes the resulting active-Preset relationship. `activeId` may be null.
- There is no `persisted` field. Successful non-dry-run completion implies durable persistence.

A no-op is successful, returns `changed: false` and the complete unchanged panel, does not
increment revision, does not write persistence, does not dirty the Preset, and does not rebuild an
analysis request.

### Revision

Revision is optimistic concurrency protection for one running PLVS process, not a durable document
version. It resets when the application restarts, so callers inspect again after connecting to a new
process.

Every public query and successful mutation reports one top-level revision. As a minimal fragment,
the public CLI envelope's `result` contains:

```json
{
  "revision": 13
}
```

Workspace layout, panels, public panel controls, panel axis state, pin/title state, and a Preset
application that changes the Workspace increment the revision. Preset collection, Settings, Dock,
and Transport lifecycle changes use the same counter. Equivalent user and agent mutations follow
the same rule. One atomic operation increments once regardless of the number of changed fields.

Dry runs, no-ops, validation failures, revision conflicts, live measurements, capture state, and
transient UI state do not increment it. Changes that settle together as one observable operation
produce one revision increment.

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

Dry run uses the same result shape. `revision` remains the current real revision, while `changed`
and `state` describe the result that a real execution would produce. No separate `wouldChange` or
projected-revision vocabulary is used; `dryRun: true` establishes the preview semantics.

### Reset

`panel.reset` exposes the same product behavior as the Reset button in the panel settings header. It
resets the panel's public controls and its axis-link flags/default dormant local ranges. It does not
change shared Workspace axis values, remove the panel, change the active Loudness Profile, or clear
measured history and maxima.

### Failure contract

Validation is atomic: if any submitted field is invalid, none of the patch is committed. Validation
returns every independently discoverable input issue in one response so a caller can correct them
together:

```json
{
  "schemaVersion": 1,
  "ok": false,
  "error": {
    "code": "invalidControls",
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
}
```

Each issue has a stable machine code, a path into the caller's submitted JSON, and a human-readable
message. The initial stable error and issue codes are:

- `panelNotFound` for an unknown target panel;
- `revisionConflict`, with both `expectedRevision` and `currentRevision` in details;
- `invalidControls`, containing `issues` such as `unknownControl`, `invalidType`, `invalidEnum`,
  `outOfRange`, and `controlUnavailable`;
- `commandFailed` for an unexpected commit failure;
- `persistenceFailed` when UI state committed but durable saving failed.

A persistence failure must state the partial outcome explicitly:

```json
{
  "schemaVersion": 1,
  "ok": false,
  "error": {
    "code": "persistenceFailed",
    "message": "Panel controls committed but persistence failed.",
    "details": {
      "stateCommitted": true,
      "revision": 13
    }
  }
}
```

After a revision conflict or persistence failure, the caller should inspect current state rather
than retry blindly.

Successful mutation `changed` and failure detail `changed` deliberately have different types.
`result.changed` is always a boolean. When an execution or persistence error must identify a
partial outcome, `error.details.changed` is an array of public path strings. The success envelope
and error envelope make the two unambiguous.

### Internal failures below the application

A request can also fail before it reaches the application at all: Agent Control is disabled
(`agentControlDisabled`), the on-disk descriptor exists but could not be read (`discoveryFailed`),
its protocol version is incompatible (`protocolMismatch`), the frontend is not ready yet, the
broker's pending limit is full, the frontend did not answer in time, or the envelope was
unreadable.
Inside the internal JSON-RPC error data, failures from this layer carry `"layer": "transport"`
alongside an internal `reason`, because they are not valid app results and must not be read as one.
The public CLI maps that internal distinction to its documented exit class and always emits the
common `{ schemaVersion, ok: false, error: { code, message, details? } }` envelope. A refused
concurrent `app.wait` is instead an application error with public code `waitLimitReached`.

### Conditional controls and warnings

A stored control may be temporarily hidden or ineffective because of another control. Updating it
is valid and allows an agent to preconfigure a later mode. If a field touched by the patch is still
ineffective in the patch's final state, the result includes a `currentlyInactive` warning.

Warnings are calculated from the final state and only for fields touched by that patch. For example,
changing `frequencyBandsHz` while Waveform Frequency Color remains off warns; changing the bands in
the same patch that enables Frequency Color does not.

This differs from a dynamically unavailable option. Loudness `reference` is not a valid option when
the active Loudness Profile does not provide a reference, so submitting it fails with
`controlUnavailable` instead of succeeding with a warning.

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

- MCP integration remains a future product decision.
