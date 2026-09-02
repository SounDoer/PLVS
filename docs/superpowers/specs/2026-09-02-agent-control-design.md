# PLVS Live Agent Control - Design

**Date:** 2026-09-02  
**Status:** Draft; product direction locked, implementation not started

## Summary

Add a semantic, local-only control surface for a running PLVS desktop instance. The first delivery
is a Windows development feature exposed through `plvs-cli app ...`; it lets an agent discover the
running app, inspect its current workspace, and atomically apply a declarative workspace layout.

The desktop app remains the single owner of live state. The CLI never edits `plvs-settings.json`
behind the app's back and never simulates UI clicks. A local Rust broker authenticates and forwards
requests to a frontend command bus, which invokes the same workspace-domain operations the UI uses
and responds only after React has committed the change and persistence has flushed.

This design establishes the transport and semantic boundary that later settings, panel-control,
preset, transport, user authorization, and MCP work will reuse. It deliberately does not ship a
production Agent Control setting or user-facing confirmation UI in the first slice.

## Problem

Development and debugging repeatedly require an agent to rearrange panels, change display controls,
apply presets, or inspect the state of the real Tauri application. Today the available choices are
all incomplete:

- OS-level mouse automation is slow, coordinate-dependent, and cannot prove which semantic value
  PLVS accepted.
- Browser-only Vite mode has no Tauri APIs or real audio capture.
- CDP can inspect a Windows WebView2 development surface, but requires an open debugging port, is not
  a cross-platform product contract, and bypasses the application's normal command boundaries.
- `plvs-cli profile import` writes the installed store on disk and requires a restart. It is a
  backup/deployment mechanism, not a live-control mechanism. Using it while the app is running would
  race the frontend's in-memory plugin-store cache and skip runtime side effects.

PLVS already ships an agent-discoverable CLI with stable JSON output, and its workspace reducer has
an atomic `SET_VIEW` action. The missing piece is a live, semantic bridge between those two existing
surfaces.

## Goals

### First functional slice

- Let a development build advertise one local control endpoint.
- Let the matching development `plvs-cli` discover that endpoint without relying on `PATH`.
- Add `npm run desktop:control -- ...`, a repository script that runs the `app` CLI family with the
  same `dev-identity` feature as `npm run desktop`, so the documented development workflow cannot
  select the release identity by accident.
- Add these commands:
  - `plvs-cli app capabilities --json`
  - `plvs-cli app inspect --json`
  - `plvs-cli app workspace apply <file|-> --json [--expected-revision <n>] [--dry-run]`
- Return structured success and error reports with the existing CLI exit-code conventions.
- Represent the workspace with a public declarative layout rather than the reducer's internal tree.
- Reuse existing panels by `panelId` so rearranging a workspace preserves their controls and titles.
- Create new panels by module ID and return the generated panel IDs.
- Validate a complete layout before changing any live state.
- Apply the complete workspace in one reducer commit.
- Mark the active preset dirty when the agent changes the workspace.
- Return success only after the frontend commit and plugin-store flush complete.
- Keep installed and development PLVS state separated through the existing `dev-identity` build.

### Architectural foundation

- Keep external transport, native brokering, frontend command routing, and workspace compilation as
  separate testable layers.
- Version the public control protocol independently of the app version.
- Make the protocol suitable for later typed CLI commands and an MCP adapter without changing the
  application command semantics.
- Leave a clear path to macOS local IPC and production user authorization.

## Non-goals

The first functional slice does not include:

- production-build Agent Control;
- a Settings toggle, connected-client UI, activity history, or confirmation dialog;
- MCP;
- automatic app launch;
- multiple simultaneously controllable instances of the same app identity;
- undo or an agent-operation history stack;
- screenshots;
- settings, panel-control, preset, Dock, file-source, or transport mutations;
- delete, reset, profile import, or arbitrary file-write operations;
- per-run disposable settings files;
- macOS or Linux transport delivery;
- pixel, accessibility-tree, or pointer automation;
- direct access to reducer action names, persistence keys, React setters, or raw audio history.

Existing standalone CLI commands (`doctor`, `probe`, `analyze`, `analyze-batch`, `devices`,
`capture`, `profile`, and `report`) keep their current behavior. They do not connect to the running
desktop app and are not governed by the future Agent Control authorization setting.

## Locked product decisions

| Topic | Decision |
| --- | --- |
| Initial audience | Development agents controlling `PLVS Dev` |
| Initial platform | Windows |
| App lifecycle | PLVS must already be running; no automatic launch |
| Configuration isolation | Reuse `com.soundoer.plvs.dev`; do not introduce a dynamic store filename |
| Control model | Semantic commands, not mouse automation or direct store edits |
| Layout model | Declarative complete target layout |
| Existing panels | Referenced by `panelId` and preserved with their controls/title/config |
| New panels | Declared by module ID; PLVS generates the persistent panel ID |
| Mutation shape | Validate completely, then apply with one `SET_VIEW` commit |
| Concurrency | Optional expected revision; stale writes are rejected |
| Completion | React commit plus persistence flush; paint stability is a later concern |
| Undo | Not in the first version |
| Controllable instances | One endpoint per app identity |
| PATH | Irrelevant to authorization and discovery; full-path discovery remains supported |
| Production authorization | Deferred; production builds expose no endpoint in the first slice |
| Release CLI surface | Unchanged; `app` is compiled and advertised only with `dev-identity` in the first slice |

## Runtime topology

```text
plvs-cli app ...
        |
        | JSON-RPC over a current-user local transport
        v
Rust agent-control broker in the running PLVS process
        |
        | targeted Tauri event to the main WebView
        v
Frontend command bus in App
        |
        | validate / compile / SET_VIEW
        v
Workspace reducer and persistence
        |
        | correlated response through a Tauri command
        v
Rust broker -> CLI JSON report
```

The broker is a transport and lifecycle boundary, not a second implementation of workspace logic.
The frontend is authoritative for workspace state and owns all semantic validation that depends on
the frontend model. Rust owns endpoint discovery, authentication, request correlation, timeouts,
and delivery to the main WebView.

## Development identity and discovery

`npm run desktop` and `npm run desktop:build` already combine:

```text
--config src-tauri/tauri.dev.conf.json --features dev-identity
```

That gives the development app the identifier `com.soundoer.plvs.dev`, while an installed build
uses `com.soundoer.plvs`. The different identifier separates the Tauri config directory, plugin
store, window state, Dock state, and WebView data directory without changing the shared store
filename.

Agent control must reuse the same compiled `PLVS_APP_ID` that `doctor` uses. The running app writes
its descriptor under that identity's config directory. The CLI binary built with the same feature
resolves the same directory. A development CLI therefore cannot silently discover the installed
app's endpoint, and a release CLI cannot silently discover the development endpoint.

The first slice uses one descriptor named `agent-control.json` per app identity. An illustrative
shape is:

```json
{
  "schemaVersion": 1,
  "protocolVersion": 1,
  "app": {
    "name": "PLVS Dev",
    "version": "0.14.5",
    "identifier": "com.soundoer.plvs.dev"
  },
  "pid": 12345,
  "endpoint": "plvs-control-com.soundoer.plvs.dev",
  "token": "opaque-per-launch-secret",
  "startedAt": "2026-09-02T08:00:00Z"
}
```

The descriptor is discovery metadata, not proof that the app is alive. A successful authenticated
connection to the endpoint is authoritative. The app writes the descriptor atomically after the
server is listening and removes it during a graceful shutdown. The CLI treats a missing, malformed,
stale, or unreachable descriptor as `appNotRunning` and never deletes it as part of an ordinary
read failure.

The endpoint uses a Windows named pipe restricted to the current OS user. The per-launch token is
an additional capability check and must be generated from the operating system's secure random
source. The token is never accepted as a command-line argument, logged, or included in CLI output.

The first broker to bind the identity's endpoint wins. If another development app with the same
identity starts, it continues as an ordinary PLVS window but logs that agent control is unavailable
and does not overwrite the descriptor. Multi-session discovery and `--session` selection are
follow-on work.

## Wire protocol

The local transport carries UTF-8 JSON-RPC 2.0 request and response objects. The first implementation
may use one request per connection; the semantic contract does not depend on a persistent socket.
Requests have a bounded payload size and a bounded response timeout.

Illustrative request:

```json
{
  "jsonrpc": "2.0",
  "id": "req-123",
  "method": "workspace.applyLayout",
  "params": {
    "expectedRevision": 42,
    "dryRun": false,
    "layout": {}
  }
}
```

Illustrative success:

```json
{
  "jsonrpc": "2.0",
  "id": "req-123",
  "result": {
    "revision": 43,
    "changed": ["workspace"]
  }
}
```

Illustrative error:

```json
{
  "jsonrpc": "2.0",
  "id": "req-123",
  "error": {
    "code": -32004,
    "message": "Workspace changed after revision 42.",
    "data": {
      "reason": "revisionConflict",
      "currentRevision": 44
    }
  }
}
```

JSON-RPC is an internal transport contract. The CLI renders its own stable report envelope rather
than exposing raw JSON-RPC error numbers as its public interface.

## Broker and frontend lifecycle

The Rust broker starts only when compiled with `dev-identity` in the first slice. It is not started
in a release build, even if a stale development descriptor exists.

The broker maintains:

- whether the main frontend has registered as ready;
- a bounded request queue;
- a pending map from request ID to response sender;
- a per-request timeout;
- the current endpoint descriptor and launch token.

The frontend registers readiness only after the main App has constructed the workspace store and
installed its request listener. Requests arriving before readiness receive `frontendNotReady`; they
are not held indefinitely during boot.

For each accepted request Rust:

1. authenticates the connection token;
2. validates the JSON-RPC envelope and request size;
3. rejects duplicate in-flight request IDs;
4. inserts a pending response entry;
5. emits `agent-control://request` only to the `main` WebView;
6. waits for the frontend to call the correlated response command;
7. removes the pending entry on response, timeout, frontend shutdown, or broker shutdown;
8. returns exactly one response to the client.

The frontend processes mutating commands serially. Read commands may be serialized too in the first
implementation; correctness is more important than read concurrency at this scale.

Accessory WebViews do not register as command handlers and never receive control requests.

## Public CLI

### Development invocation

`tauri dev` builds the main `plvs` binary but does not guarantee that the thin `plvs-cli` companion
has already been built beside it. The feature also has to match the running GUI. The implementation
therefore adds a cross-platform repository script whose effective behavior is:

```powershell
cargo run --manifest-path src-tauri/Cargo.toml --features dev-identity --bin plvs-cli -- app <args>
```

The user-facing form is:

```powershell
npm run desktop:control -- inspect --json
npm run desktop:control -- workspace apply layout.json --json
```

Documentation and manual acceptance use this script rather than an installed `plvs-cli`, a bare
`cargo run`, or a manually assembled target path. Installed builds continue to use the installed
companion and release identity exactly as they do today.

### Commands

```powershell
plvs-cli app capabilities --json
plvs-cli app inspect --json
plvs-cli app workspace apply <file|-> --json [--expected-revision <n>] [--dry-run]
```

`-` reads one JSON layout document from stdin. A file input is preferred for repeatability and to
avoid shell-specific JSON quoting. `workspace apply` requires `--json` in the first slice.

The thin `plvs-cli` forwarder keeps its current behavior: it launches the sibling `plvs` binary in
internal `--cli` mode. That new headless process connects to the already-running GUI process through
the descriptor; it does not attempt to initialize Tauri or create a second window.

In the first slice the `app` parser, help topic, and control client are available only when compiled
with `dev-identity`. Release CLI help and command behavior remain unchanged until production Agent
Control ships; a release user is not shown a permanently unavailable command family.

### Exit codes

The existing CLI contract remains:

| Code | Meaning |
| --- | --- |
| `0` | Command succeeded |
| `1` | The running app produced a valid error result, such as validation failure or revision conflict |
| `2` | Invalid usage or failure before a valid app result, such as app not running, malformed descriptor, authentication failure, or transport failure |

### Report envelopes

Every command includes:

```json
{
  "schemaVersion": 1,
  "command": "app-inspect",
  "status": "ok",
  "app": {
    "name": "PLVS Dev",
    "version": "0.14.5",
    "protocolVersion": 1
  }
}
```

Error reports include a stable string reason and human-readable message. Initial reasons are:

- `appNotRunning`
- `frontendNotReady`
- `authenticationFailed`
- `invalidRequest`
- `invalidParams`
- `unsupportedMethod`
- `revisionConflict`
- `commandTimeout`
- `commandFailed`

Transport implementation details and raw OS errors may appear in a diagnostic detail field but are
not the stable reason.

## Capabilities contract

`app.capabilities` is available after frontend readiness and returns the capabilities of the running
instance, not a hardcoded promise from the CLI binary. The first response includes:

- protocol version;
- app identifier and version;
- supported methods;
- supported workspace module IDs and display titles;
- whether mutation is enabled;
- platform and runtime mode.

The module list comes from the logic-only `workspace/moduleCatalog.js`, never
`workspace/registry.jsx`. This preserves the repository rule that logic-only consumers must not
evaluate every React panel and icon merely to ask which module IDs exist.

Full JSON Schema publication for every command is deferred until panel controls and MCP create a
real consumer for it. The first contract still validates every accepted request strictly.

## Inspect contract

`app.inspect` returns a compact semantic snapshot. The first slice contains:

```json
{
  "revision": 42,
  "workspace": {
    "layout": {},
    "panels": [
      {
        "panelId": "spectrum",
        "moduleId": "spectrum",
        "title": "Spectrum"
      }
    ]
  },
  "preset": {
    "activeId": null,
    "dirty": false
  }
}
```

The layout uses the same public shape accepted by `workspace.applyLayout`, with existing panel nodes
represented by `panelId`. Inspect does not return frame history, canvas buffers, analysis rows,
theme documents, persisted raw domains, or internal reducer paths.

The first revision is process-local and starts from a documented non-negative value at frontend
readiness. It increments whenever a controllable workspace snapshot changes, whether the change
came from the user, a preset, Dock-related coordination, or an agent. It is not persisted and must
not be compared across app launches.

## Declarative workspace layout

The public layout is recursive and has three node kinds.

### Existing panel

```json
{
  "type": "panel",
  "panelId": "spectrum"
}
```

This reuses the complete existing panel instance, including its module ID, custom title, config,
panel controls, and pinned metadata where that metadata remains meaningful in the target tree.

### New panel

```json
{
  "type": "panel",
  "key": "new-map",
  "moduleId": "stereo-map",
  "title": "Stereo Map B"
}
```

`key` is unique within this request and is only a correlation name. It is not persisted as the panel
ID. PLVS generates the panel ID using its existing instance rules and returns a `createdPanels` map
from request key to generated ID.

Panel controls on new nodes are deferred from the first functional slice. New panels receive the
same normalized defaults as panels created through the UI.

### Tabs

```json
{
  "type": "tabs",
  "active": "spectrum",
  "children": [
    { "type": "panel", "panelId": "spectrum" },
    { "type": "panel", "panelId": "waveform" }
  ]
}
```

`active` names an existing `panelId` or a new-panel request `key` within the same tabs node. It is
optional and defaults to the first child.

### Split

```json
{
  "type": "split",
  "direction": "horizontal",
  "weights": [2, 3],
  "children": [
    { "type": "panel", "panelId": "levelMeter" },
    {
      "type": "split",
      "direction": "vertical",
      "children": [
        { "type": "panel", "panelId": "loudness" },
        { "type": "panel", "key": "new-map", "moduleId": "stereo-map" }
      ]
    }
  ]
}
```

`direction` uses public words rather than the internal `h` / `v` representation. `weights` is
optional; omission means equal sizes. When present, it must have exactly one finite positive number
per child. PLVS normalizes the values to its internal size representation, so callers do not need to
make them sum to one.

### Validation rules

The compiler rejects the entire request before dispatch when:

- a node has an unknown type or unknown field;
- a split has fewer than two children;
- a tabs node has no children;
- `weights` length differs from `children` length;
- a weight is non-finite or not positive;
- a direction is not `horizontal` or `vertical`;
- an existing `panelId` is unknown or used more than once;
- a new-panel key is missing, empty, duplicated, or conflicts with an existing panel reference;
- a module ID is unknown;
- a tabs `active` reference is not one of that node's children;
- the document exceeds the configured depth, panel-count, or payload limits.

Unknown fields are rejected rather than ignored so an agent typo cannot appear to succeed.

### Apply semantics

After validation and compilation:

- referenced existing panels retain their instance data and controls;
- newly declared panels receive generated IDs and default controls;
- existing panels omitted from the target are removed;
- `panelOrder` is the deterministic depth-first order of the target layout;
- fullscreen state is cleared;
- pinned metadata is retained only for reused panels and normalized against the new panel set;
- current shared axis viewport values are preserved;
- panel-local axis controls stay with reused panels and use defaults for new panels;
- the active preset becomes dirty through the same semantic path as a user workspace change;
- the workspace lands through one `SET_VIEW` action.

`dryRun` performs all validation, ID planning, and canonicalization without dispatching or marking a
preset dirty. It returns the canonical public layout and planned `createdPanels` map. Generated IDs
from a dry run are advisory: another mutation before the real apply can consume them, so the caller
must use the mapping returned by the successful apply.

## Revision and completion semantics

`expectedRevision` is optional. When supplied, it must equal the current control revision at the
moment the mutating command reaches the head of the frontend queue. A mismatch returns
`revisionConflict` without changing state.

The successful response is delayed until:

1. the reducer has committed the compiled view;
2. a frontend snapshot confirms the target panel membership and tree;
3. the workspace persistence batch has been forced and settled;
4. the resulting control revision is available for the response.

The first slice does not promise that every Canvas has painted or that layout measurements have
stabilized. Those are later `app.wait` predicates. This distinction prevents the initial transport
from pretending that a React commit is a complete visual test.

If persistence fails, the current backend does not expose the error because its writes are
fire-and-forget and swallow failures. The implementation must first make the explicit flush path
report failure to the command bus without changing ordinary UI write behavior. An apply response
must not claim `persisted: true` when that explicit flush failed.

## Frontend organization

The command bus belongs at the App composition layer because that layer already owns the live
workspace, settings, preset, Dock, source, and transport controllers that future commands need. It
must not import React panel components to validate module identities.

Recommended pieces:

- a pure protocol/layout-schema module;
- a pure declarative-layout compiler that consumes a workspace snapshot;
- a Tauri event adapter isolated under `src/ipc/`;
- a React command-bus hook at the App layer;
- a small workspace semantic action that marks the preset dirty and performs `SET_VIEW`.

The layout compiler returns a complete internal view and metadata; it never dispatches, writes a
store, or invokes Tauri. This keeps its validation and round-trip behavior exhaustively unit-testable.

## Rust organization

Recommended pieces:

- descriptor and app-identity path handling;
- Windows named-pipe server lifecycle;
- token generation and authentication;
- bounded JSON-RPC framing;
- pending request correlation and timeout handling;
- Tauri ready/respond commands;
- a CLI-side control client used by the new parsers.

The audio callback thread is not involved. Agent-control code must not share locks with, emit from,
or otherwise add work to the capture callback. No capture smoke or soak is required for this feature
unless implementation later crosses into `src-tauri/src/audio`, `dsp`, or `engine`.

## Security boundary

The first slice is development-only, but it establishes the production-compatible boundary:

- local transport only; never bind a TCP or HTTP listener;
- current-user OS access restriction;
- per-launch secret in a current-user descriptor;
- no secret in argv, logs, errors, or CLI JSON;
- bounded request size, queue length, recursion depth, panel count, and timeout;
- strict method and parameter allowlists;
- no raw invoke forwarding;
- no arbitrary persistence key, reducer action, JavaScript expression, file path, or shell command;
- only the main WebView handles requests;
- release builds expose no endpoint in this slice.

The future production Agent Control toggle will start and stop this same broker dynamically. PATH
setup remains unrelated: removing PLVS from `PATH` never disables an executable that can be reached
by full path.

## Testing strategy

### Pure frontend tests

- public-layout validation for every node and error rule;
- existing-panel preservation;
- new-panel ID generation and returned key mapping;
- deterministic panel order;
- tabs active-reference resolution;
- weight normalization;
- omitted-panel removal;
- pinned and axis-viewport semantics;
- inspect/apply public-layout round trip;
- `dryRun` does not mutate inputs or live state;
- no import from `workspace/registry.jsx`.

### Frontend command-bus tests

- ready registration and teardown;
- request serialization;
- method and params rejection;
- expected-revision acceptance and conflict;
- one `SET_VIEW` commit per apply;
- preset dirty transition;
- response waits for committed state and explicit persistence flush;
- timeout/cancellation does not produce a late second response.

### Rust tests

- descriptor serialization and identity-specific path resolution;
- secure token verification without echoing the token;
- JSON-RPC parsing, framing limits, duplicate IDs, and error mapping;
- frontend-not-ready behavior;
- pending response correlation, timeout, and shutdown cleanup;
- second broker cannot replace the first endpoint descriptor;
- CLI connection errors map to exit `2` and stable reasons;
- valid app error results map to exit `1`;
- CLI parser coverage for file, stdin, expected revision, dry run, and required JSON.

### Integration and manual verification

Automated unit tests cover the protocol and both sides of the bridge, but the complete named-pipe →
Tauri event → React → Tauri response loop runs only in the real desktop app.

Manual acceptance on Windows:

1. Start installed PLVS and give it a recognizable workspace.
2. Start `npm run desktop`; confirm the development workspace remains separate.
3. Run `npm run desktop:control -- capabilities --json` and confirm the dev identity.
4. Run `npm run desktop:control -- inspect --json` and compare its panel/layout snapshot with the
   visible development app.
5. Rearrange existing panel IDs; confirm controls and custom titles survive.
6. Add a new Stereo Map through a declarative layout; confirm the returned ID exists in a new
   inspect response.
7. Submit an invalid and a stale-revision layout; confirm neither changes the workspace.
8. Apply from stdin and from a file.
9. Stop PLVS Dev and confirm the CLI reports `appNotRunning` even if a stale descriptor is present.
10. Confirm the installed PLVS workspace never changed.

`npm run check` is required before merge.

## Delivery sequence

1. Pure public layout schema, compiler, and tests.
2. Rust descriptor, Windows named-pipe broker, and protocol tests.
3. Tauri ready/request/respond bridge.
4. Frontend command bus, revision, and persistence completion barrier.
5. CLI parsers, client, output envelopes, and help/docs.
6. Real-app Windows acceptance pass.

The first useful checkpoint is narrower than the full sequence: `capabilities` and `inspect` can
prove the endpoint and round trip before workspace mutation is enabled.

## Follow-on work

In order of expected value:

1. `settings.inspect` / `settings.update` for the safe UI settings already discussed.
2. `panel.describe` / `panel.update` using a pure control schema and existing normalizers.
3. `preset.list` / `preset.apply`.
4. `transport.inspect` / `start` / `stop` / `clear`.
5. Explicit `app.wait` predicates for committed, persisted, painted, layout-stable, and transport
   states.
6. macOS Unix-domain-socket transport with the same semantic protocol.
7. Production Agent Control setting, connection status, activity summaries, and high-impact
   confirmation surfaces.
8. Multiple session discovery and explicit `--session` selection.
9. MCP adapter hosted by `plvs-cli mcp`, reusing the same app methods.
10. Optional screenshot support where the platform can provide a reliable whole-window capture.

## Acceptance criteria

- A running `PLVS Dev` instance is discoverable only by the matching development CLI identity.
- No release build exposes the live-control endpoint in the first slice.
- Release CLI help and command parsing remain unchanged in the first slice.
- `app capabilities` and `app inspect` return stable JSON for the running frontend state.
- A declarative layout can rearrange existing panels without losing their controls or titles.
- A declarative layout can create a new known module and returns its generated panel ID.
- Invalid, stale, unauthenticated, oversized, timed-out, or pre-ready requests do not mutate state.
- A successful apply is one reducer commit and reports only after the explicit persistence flush.
- The installed PLVS configuration, window state, Dock state, and WebView data are untouched.
- The CLI never depends on PATH, never edits the live store directly, and never launches the GUI.
- Logic-only control modules do not import `workspace/registry.jsx`.
- All focused tests and `npm run check` pass.
