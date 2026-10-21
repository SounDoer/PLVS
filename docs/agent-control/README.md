# Agent Control

This directory is the source of truth for what each Agent Control command family does, and for how
to extend the surface without letting it drift from the app. Every family documented here is
implemented; a family that is not implemented does not belong on these pages.

Three places divide the work, and nothing is said in two of them:

- [`../user/cli.md`](../user/cli.md) owns the public contract every family shares: the JSON envelope, global
  revision, dry run, the success result, shared error codes, exit codes, and the development
  wrapper.
- [`generated/`](generated/commands.md) is the reference for command IDs, CLI paths, arguments,
  fields, types, defaults and bounds. It is rendered from the schema builders and never edited by
  hand.
- The pages below carry what neither can state: each family's semantics, atomicity, warnings,
  availability rules, and concurrency.

## Families

| Family                   | Page                                           |
| ------------------------ | ---------------------------------------------- |
| Module discovery         | [`modules.md`](modules.md)                     |
| Panel Control            | [`panels.md`](panels.md)                       |
| Axis Control             | [`axes.md`](axes.md)                           |
| Presets                  | [`presets.md`](presets.md)                     |
| Theme Control            | [`themes.md`](themes.md)                       |
| Loudness Profile Control | [`loudness-profiles.md`](loudness-profiles.md) |
| Settings Control         | [`settings.md`](settings.md)                   |
| View Control             | [`view.md`](view.md)                           |
| Dock Control             | [`dock.md`](dock.md)                           |
| Device Control           | [`devices.md`](devices.md)                     |
| Transport Control        | [`transport.md`](transport.md)                 |
| Measurement Control      | [`measurements.md`](measurements.md)           |
| Measurement Wait         | [`measurement-wait.md`](measurement-wait.md)   |
| Revision Wait            | [`wait.md`](wait.md)                           |
| Visual Capture           | [`visual.md`](visual.md)                       |
| UI Navigation            | [`ui.md`](ui.md)                               |
| Editor Draft Control     | [`editor-drafts.md`](editor-drafts.md)         |
| Library Transfer         | [`libraries.md`](libraries.md)                 |
| Configuration Transfer   | [`config.md`](config.md)                       |

## Keeping this contract in step with the app

Panel Control is three hand-written lists of the same fields -- the schema, the read mapping and the
patch planner -- layered on one flat control record. Nothing in the app makes them agree, and a
control added to `src/lib/panelControls.js` and rendered in Panel Settings needs no Agent Control
change to look finished. Seven guards make that omission fail instead:

| Guard                                              | Fails when                                                                                                                                                              |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/agentControl/panelControlCoverage.test.js`    | A panel control is neither exposed by Panel or Axis Control nor listed as deliberately internal.                                                                        |
| `src/agentControl/panelControlContract.test.js`    | A module in `MODULE_CATALOG` has no branch in describe / read / patch / reset, or the three field lists disagree.                                                       |
| `src/agentControl/settingsControlContract.test.js` | Settings read / describe / patch disagree, or an option list stops matching the app's own.                                                                              |
| `src/agentControl/viewControl.test.js`             | View schema, strict planning, platform availability, reset, or Dock warning behavior changes.                                                                           |
| `src/agentControl/libraryTransferContract.test.js` | A library has a pack format but no command family, or the reverse.                                                                                                      |
| `src/agentControl/publicSurfaceDocs.test.js`       | `generated/` no longer matches the schema builders.                                                                                                                     |
| `src/agentControl/handlers/coverage.test.js`       | A wire method in the command manifest has no handler, a handler serves a method the manifest does not list, or a handler waits on a settlement slot no domain provides. |

`publicSurfaceDocs` fails as a snapshot mismatch; `npm run docs:agent-control` rewrites the pages.

A new wire method is registered in the family's file under `src/agentControl/handlers/`, with
`lane: "direct"` if it must answer outside the serialized queue. A newly observed area of app state
is a new entry in `src/agentControl/bridge/domains.js`: the entry is what gives the area its
revision watcher, its settlement slot and its place in the unmount cleanup, so none of the three can
be added without the others.

`src/agentControl/settingsSurfaceCatalog.js` is the authority inventory for every user-operable
Settings control. Each entry is owned by Settings Control, another Agent Control family, an external
destination, or an explicit user-only boundary. `PUBLIC_FIELDS` is derived from that catalogue, so
adding a Settings-owned control without exposing it cannot silently create a second field list.
Settings Control also imports option lists and defaults from `src/settings/defaults.js` and
`src/lib/dialogueVadEngines.js`; a value the GUI offers cannot drift from `settings describe`.

`generated/` holds the reference half of this directory: every field's type, unit, default and
bounds, rendered from the schema builders. It is not editable by hand. The pages beside it carry
what a schema cannot state -- atomicity, warning semantics, availability rules, analysis identity --
and no longer restate numbers the generated tables own.

Deciding that a control stays out of Agent Control is a normal outcome; record it by adding the key to
`INTERNAL_ONLY_CONTROLS` in the coverage test, with the reason. What the guards forbid is leaving
the question unanswered.

## Application-wide methods

### Private development controls

Dev-identity builds have a private `dev.fixture.establish` / `dev.fixture.reset` wire path
for deterministic review of event-only interfaces. Rust accepts the corresponding hidden CLI
grammar only when built with `dev-identity`; the methods are intentionally absent from the public
manifest, capability list, generated reference, help, completion, and packaged CLI parser.

The frontend protocol accepts a closed fixture name plus exact global revision and UI generation.
Each adapter delegates establishment and reset to the production state owner, carries an opaque
fixture ID separately from component props, and waits for the ordinary UI Navigation surface to
settle. Existing blocking editors, real event surfaces, non-matching resets, stale tokens, or unsafe
busy states are refusals. A failed post-establishment wait reports the committed fixture ID and
leaves the scene intact. Result actions such as Save, Send, Confirm, Update, Reload, Copy, and Delete
remain ordinary user actions and are never fixture operations. The one exception is the follow-up
action on a fixture Import Complete (Use Theme, Apply Preset, Use Profile): the fixture never wrote
its sample item, so that action is refused without effect.

Every `useUiSurface` registration with `origin: "event"` or `origin: "nested"` declares
`developmentFixture`: the fixture name that shows it, `{ none: "<reason>" }`, or `TABLE[key]` for a
module-level `const TABLE = { ... }` holding those forms when one registration serves several kinds.
`scripts/developmentFixtureCoverage.test.js` fails when such a surface omits the declaration, names
an unknown fixture or one without an adapter, or when the fixture names in the frontend protocol,
the dev CLI parser, and the walkthrough validator differ. A new event or nested surface therefore
cannot ship without a screenshot path or a stated reason.

Packaged updater acceptance has a separate hidden `dev.update.*` wire path. It is admitted only
when the running identifier is the SHA-derived `com.soundoer.plvs.updatetest.h*` identity and the
debug CLI exposes its private `dev` grammar. Its fixed actions save update preferences, open the
real details surface, confirm the exact visible update surface, or request a normal full-app quit.
Every action requires current revision and UI-generation tokens; surface actions also require the
exact opaque surface ID. Stable, dev and Preview identities cannot use these controls, and the
methods stay absent from capabilities, generated reference, help and completion.

The same private boundary has fixed `dev.performance.inspect` and `dev.performance.stall` methods
for desktop-performance acceptance. Inspect combines the production native UI-frame diagnostics
with a continuously maintained renderer animation-frame snapshot; it never waits for a new frame.
Stall accepts only an integer from 100 through 10,000 milliseconds and blocks the renderer main
thread for that bounded interval. Neither method accepts source text or arbitrary evaluation, and
both remain unavailable outside the dev identity.

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

Inspection deliberately omits measurement frames and history, canvas data, hover and temporary
surface state, raw internal controls, React-only values, and field schemas. Transient window form,
visibility, dialogs, editors, and sheets belong to [`ui inspect`](ui.md). Preset state is only the
compact `activeId`/`dirty` relationship; the library itself belongs to
[`presets.md`](presets.md).

## Transport

Windows carries requests over a current-user named pipe. macOS and Linux carry the same
authenticated, bounded protocol over a mode-`0600` Unix-domain socket. Linux places the endpoint
under the current user's private `$XDG_RUNTIME_DIR` and verifies both client and server ownership
with `SO_PEERCRED`; macOS verifies ownership with `getpeereid`. All native transports use the
shared framing and authentication implementation; only endpoint creation, peer validation, and
delivery acknowledgement remain platform-specific. The public CLI contract is transport-neutral;
callers use runtime capabilities to discover native features. Linux Visual Capture uses the
app-owned WebKitGTK snapshot path rather than desktop capture and records with the distribution
FFmpeg, whose encoder availability it reports. Silent recording is H.264-only;
measured-source recording adds the same fixed-shape AAC timeline and gap accounting used on Windows
and macOS. Linux does not advertise system-pointer capture.

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
