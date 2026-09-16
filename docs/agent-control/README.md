# Agent Control

This directory is the source of truth for what each Agent Control command family does, and for how
to extend the surface without letting it drift from the app. Every family documented here is
implemented; a family that is not implemented does not belong on these pages.

Three places divide the work, and nothing is said in two of them:

- [`../cli.md`](../cli.md) owns the public contract every family shares: the JSON envelope, global
  revision, dry run, the success result, shared error codes, exit codes, and the development
  wrapper.
- [`generated/`](generated/commands.md) is the reference for command IDs, CLI paths, arguments,
  fields, types, defaults and bounds. It is rendered from the schema builders and never edited by
  hand.
- The pages below carry what neither can state: each family's semantics, atomicity, warnings,
  availability rules, and concurrency.

## Families

| Family                         | Page                                           |
| ------------------------------ | ---------------------------------------------- |
| Module discovery               | [`modules.md`](modules.md)                     |
| Panel Control                  | [`panels.md`](panels.md)                       |
| Axis Control                   | [`axes.md`](axes.md)                           |
| Presets                        | [`presets.md`](presets.md)                     |
| Theme Control                  | [`themes.md`](themes.md)                       |
| Loudness Profile Control       | [`loudness-profiles.md`](loudness-profiles.md) |
| Settings Control               | [`settings.md`](settings.md)                   |
| View Control                   | [`view.md`](view.md)                           |
| Dock Control                   | [`dock.md`](dock.md)                           |
| Device Control                 | [`devices.md`](devices.md)                     |
| Transport Control              | [`transport.md`](transport.md)                 |
| Measurement Control            | [`measurements.md`](measurements.md)           |
| Measurement Wait               | [`measurement-wait.md`](measurement-wait.md)   |
| Revision Wait                  | [`wait.md`](wait.md)                           |
| Visual Capture                 | [`visual.md`](visual.md)                       |
| Library Transfer               | [`libraries.md`](libraries.md)                 |
| Configuration Transfer         | [`config.md`](config.md)                       |

## Keeping this contract in step with the app

Panel Control is three hand-written lists of the same fields -- the schema, the read mapping and the
patch planner -- layered on one flat control record. Nothing in the app makes them agree, and a
control added to `src/lib/panelControls.js` and rendered in Panel Settings needs no Agent Control
change to look finished. Six guards make that omission fail instead:

| Guard                                              | Fails when                                                                                                        |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `src/agentControl/panelControlCoverage.test.js`    | A panel control is neither exposed by Panel or Axis Control nor listed as deliberately internal.                  |
| `src/agentControl/panelControlContract.test.js`    | A module in `MODULE_CATALOG` has no branch in describe / read / patch / reset, or the three field lists disagree. |
| `src/agentControl/settingsControlContract.test.js` | Settings read / describe / patch disagree, or an option list stops matching the app's own.                        |
| `src/agentControl/viewControl.test.js`             | View schema, strict planning, platform availability, reset, or Dock warning behavior changes.                     |
| `src/agentControl/libraryTransferContract.test.js` | A library has a pack format but no command family, or the reverse.                                                |
| `src/agentControl/publicSurfaceDocs.test.js`       | `generated/` no longer matches the schema builders.                                                               |

The last fails as a snapshot mismatch; `npm run docs:agent-control` rewrites the pages.

Settings has no coverage guard of its own. There is no single definition of "every setting" to check
`PUBLIC_FIELDS` against -- the settings persistence domain also holds Preset-captured scene state,
the Theme and Loudness Profile libraries and window state, all of which `settings.md` places outside
this contract -- so such a list would be a judgement call maintained by hand, which is the failure
mode these guards exist to remove. What is checked instead is that Settings Control never restates an
option list or default: it imports the app's own from `src/settings/defaults.js` and
`src/lib/dialogueVadEngines.js`. A value the GUI offers that Agent Control rejects would otherwise be
invisible, because `settings describe` would tell the agent the value does not exist.

`generated/` holds the reference half of this directory: every field's type, unit, default and
bounds, rendered from the schema builders. It is not editable by hand. The pages beside it carry
what a schema cannot state -- atomicity, warning semantics, availability rules, analysis identity --
and no longer restate numbers the generated tables own.

Deciding that a control stays out of Agent Control is a normal outcome; record it by adding the key to
`INTERNAL_ONLY_CONTROLS` in the coverage test, with the reason. What the guards forbid is leaving
the question unanswered.

## Application-wide methods

### `app.capabilities`

The frontend JSON-RPC method and the public CLI result deliberately differ. The frontend returns
`revision`, `appVersion`, `protocolVersion`, `features`, `runtime`, `methods`, and `modules`, but no
`cliVersion`; Rust adapts that payload for `plvs-cli capabilities --json` and injects the installed
CLI version itself. `runtime` and `modules` may remain as compatible extra fields, but consumers
discover wire methods and features only from `methods` and `features`. Capabilities reports no live
panel instances and no mutable state beyond the current revision.

### `app.inspect`

This is a snapshot of the running application's mutable state. It reports the Workspace, panel
instances, each panel's complete public controls, compact Preset,
Settings, and View state, Dock state, Transport state, Device selection state, and the current top-level
`revision`. It reports values, not control schemas.

The snapshot also includes compact Appearance and Loudness Profile selection state as
`appearance { mode, selectedThemeId, resolvedThemeId }` and `loudnessProfile { activeId }`. Theme
documents and Loudness Profile rules remain in their dedicated command families.

Panels use the shape described in [`panels.md`](panels.md). The top-level `runtime` summarizes
channel topology and shared analysis such as Dialogue Detection and Spectral Waveform.

Inspection deliberately omits measurement frames and history, canvas data, hover/fullscreen/sheet
state, raw internal controls, React-only values, and field schemas. Preset state is only the compact
`activeId`/`dirty` relationship; the library itself belongs to [`presets.md`](presets.md).

## Transport

Windows carries requests over a current-user named pipe. macOS carries the same authenticated,
bounded protocol over a private Unix-domain socket. Both native transports use the shared framing
and authentication implementation; only endpoint creation, peer validation, and delivery
acknowledgement remain platform-specific. The public CLI contract is transport-neutral; callers use
runtime capabilities to discover native features such as cross-platform screenshots and recording.

## Failures below the application

A request can also fail before it reaches the application at all: Agent Control is disabled
(`agentControlDisabled`), the on-disk descriptor exists but could not be read (`discoveryFailed`),
its protocol version is incompatible (`protocolMismatch`), the frontend is not ready yet, the
broker's pending limit is full, the frontend did not answer in time, or the envelope was
unreadable.
The thin CLI companion also refuses to invoke an adjacent application binary built for another app
identity (`cliHostIdentityMismatch`), before that host can discover or contact a running app.
Inside the internal JSON-RPC error data, failures from this layer carry `"layer": "transport"`
alongside an internal `reason`, because they are not valid app results and must not be read as one.
The public CLI maps that internal distinction to its documented exit class and always emits the
common `{ schemaVersion, ok: false, error: { code, message, details? } }` envelope. A long wait
refused by the shared concurrency limit is instead an application error with public code
`waitLimitReached`.
