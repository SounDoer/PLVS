# PLVS Live Agent Control Implementation Plan

> Implement task-by-task with focused tests at every boundary. Keep the design document authoritative
> for behavior. Do not commit, push, or merge unless the user explicitly authorizes it.

**Goal:** Let a matching development `plvs-cli` inspect and atomically replace the workspace of an
already-running `PLVS Dev` instance through a secure, semantic, local-only control channel.

**Design:** `docs/superpowers/specs/2026-09-02-agent-control-design.md`

**Architecture:** A Windows named-pipe broker in the running Rust process authenticates and forwards
JSON-RPC requests to one frontend command bus in the main WebView. Pure frontend helpers serialize
and compile the public declarative layout. The command bus owns revisions, reducer dispatch, preset
dirty state, and the persistence completion barrier. The CLI is a typed client, never a live-store
editor.

**Initial platform:** Windows development builds (`dev-identity`) only. Release CLI help and desktop
behavior remain unchanged.

**Merge gate:** Focused frontend and Rust tests, `npm run check`, dev-identity Rust checks, then the
real Windows desktop matrix in Task 12. This work must not touch the capture callback; no capture
smoke or soak is required unless scope crosses into `src-tauri/src/audio`, `dsp`, or `engine`.

## Locked invariants

- Reuse the existing `com.soundoer.plvs.dev` identity; do not introduce dynamic store filenames.
- `npm run desktop:control -- ...` is the only documented repository control entrypoint.
- The repository script fixes the CLI family to `app`; callers pass only `capabilities`, `inspect`,
  or `workspace apply ...`.
- A release build does not start a broker and does not advertise or accept the `app` CLI family.
- The running frontend is authoritative for workspace state.
- The CLI never edits `plvs-settings.json` and never launches the GUI.
- The broker never forwards arbitrary Tauri invokes, reducer actions, persistence keys, JavaScript,
  file writes, or shell commands.
- Layout validation is complete before dispatch; a successful apply is one `SET_VIEW` commit.
- Existing `panelId` references preserve panel instance data and controls. New modules receive the
  same defaults and ID rules as UI-created panels.
- Successful mutation responses wait for React commit and an explicit persistence flush.
- Logic-only modules import `workspace/moduleCatalog.js`, never `workspace/registry.jsx`.
- Undo, screenshots, Settings UI, production authorization, MCP, macOS transport, and multiple
  controllable sessions stay out of this plan.

## Phase map

| Phase | Tasks | Checkpoint |
| --- | --- | --- |
| 1 — Workspace semantics | 1–3 | Public layout round-trips and applies atomically without Tauri |
| 2 — Native protocol | 4–6 | Authenticated local requests reach a correlated Rust pending request |
| 3 — Frontend bridge | 7–9 | `capabilities` and `inspect` round-trip through the real App; layout apply settles correctly |
| 4 — CLI and delivery | 10–12 | `desktop:control` works end to end against `npm run desktop` |

---

## Phase 1 — Workspace semantics

### Task 1: Public declarative layout serializer and compiler

**Files:**

- Create: `src/agentControl/workspaceLayout.js`
- Create: `src/agentControl/workspaceLayout.test.js`

**Step 1: Write failing serializer tests**

Cover:

- a single-tab leaf serializes as `{ type: "panel", panelId }`;
- a multi-tab leaf serializes as `tabs`, preserving order and active panel;
- `h` / `v` split directions serialize as `horizontal` / `vertical`;
- internal sizes serialize as public weights without exposing reducer paths;
- a mixed production-like tree round-trips through serialize → compile without losing topology;
- serialization emits no panel controls, config blobs, pinned metadata, or transient fullscreen
  state inside the layout tree.

**Step 2: Verify RED**

```powershell
npm test -- src/agentControl/workspaceLayout.test.js
```

Expected: module missing.

**Step 3: Write failing compiler validation tests**

Cover every spec rule:

- unknown node types and unknown fields;
- split child count, direction, weights length, non-finite/non-positive weights;
- empty tabs and invalid `active` references;
- unknown, repeated, or missing existing panel IDs;
- missing/duplicate/empty new-panel keys;
- unknown module IDs;
- depth, panel-count, and input-size ceilings;
- no mutation of the input document or current workspace.

Use explicit small ceiling constants exported for tests. Keep validation errors structured with a
stable reason, JSON path, and concise message.

**Step 4: Implement the pure compiler**

Export narrow functions such as:

```js
serializeWorkspaceLayout(workspace)
compileWorkspaceLayout(layout, workspace, options)
```

The compiler:

- uses `MODULE_CATALOG` for module identity;
- seeds new ID allocation with every current panel, including panels omitted from the target;
- creates multiple new panels sequentially against the growing map;
- preserves complete existing panel instances and normalized controls;
- gives new panels `createDefaultPanelControls()`;
- emits deterministic depth-first `panelOrder`;
- returns the complete `SET_VIEW` payload, canonical public layout, and `createdPanels` key map;
- preserves shared axis viewport values;
- retains and normalizes pinned metadata only for reused panels;
- clears fullscreen state through the normal `SET_VIEW` behavior.

Do not dispatch, write persistence, or import React/Tauri.

**Step 5: Verify GREEN and structural boundary**

```powershell
npm test -- src/agentControl/workspaceLayout.test.js
rg -n "workspace/registry" src/agentControl
```

Expected: tests pass; search has no matches.

**Checkpoint:** An inspect-layout fixture can be edited and compiled back to a complete internal
view with existing controls intact.

---

### Task 2: Workspace semantic replace action and preset dirty behavior

**Files:**

- Modify: `src/workspace/WorkspaceContext.jsx`
- Modify: `src/workspace/WorkspaceContext.test.jsx`
- Modify if needed: `src/workspace/reducer.js`
- Modify if needed: `src/workspace/reducer.test.js`

**Step 1: Write failing provider tests**

Add a semantic `replaceWorkspace(view)` action for external whole-workspace changes. Prove that it:

- dispatches exactly one `SET_VIEW`;
- marks an active clean preset dirty once;
- does not repeatedly rewrite an already-dirty preset;
- keeps the existing `setView` path used by preset apply free to restore `dirty: false`;
- persists through the existing `ownedWorkspaceState` effect rather than writing directly.

The semantic action must be product-neutral enough for later import/control callers; do not expose a
raw reducer dispatcher to the agent bridge.

**Step 2: Verify RED**

```powershell
npm test -- src/workspace/WorkspaceContext.test.jsx
```

**Step 3: Implement and verify**

```powershell
npm test -- src/workspace/WorkspaceContext.test.jsx src/workspace/reducer.test.js
```

---

### Task 3: Observable persistence completion barrier

**Files:**

- Modify: `src/persistence/pluginStoreBackend.js`
- Modify: `src/persistence/pluginStoreBackend.test.js`
- Modify: `src/persistence/localStorageBackend.js`
- Modify: `src/persistence/localStorageBackend.test.js`
- Modify: `src/persistence/index.js`
- Modify: `src/persistence/index.test.js`

**Step 1: Write failing backend tests**

Preserve ordinary UI behavior while making explicit flush reliable:

- scheduled background writes remain coalesced and do not surface unhandled rejections;
- an explicit `backend.flush()` forces a scheduled batch immediately;
- explicit flush resolves only after `set` operations and `save()` settle;
- explicit flush rejects with the original persistence failure;
- a failed explicit flush does not permanently poison a later successful flush;
- localStorage exposes the same async flush contract as an immediate no-op.

**Step 2: Verify RED**

```powershell
npm test -- src/persistence/pluginStoreBackend.test.js src/persistence/localStorageBackend.test.js
```

**Step 3: Implement one manager-level flush**

Export `flushPersistence()` from `src/persistence/index.js`. It delegates to the selected shared
backend; command-bus code must not import plugin-store internals.

Keep profile import/export using the same completion primitive instead of maintaining a parallel
flush path.

**Step 4: Verify**

```powershell
npm test -- src/persistence/pluginStoreBackend.test.js src/persistence/localStorageBackend.test.js src/persistence/index.test.js src/persistence/profile.test.js
```

**Checkpoint:** A caller can distinguish “React/store cache updated” from “the selected persistence
backend durably settled.”

---

## Phase 2 — Native protocol

### Task 4: Rust JSON-RPC, descriptor, and CLI report primitives

**Files:**

- Create: `src-tauri/src/agent_control/mod.rs`
- Create: `src-tauri/src/agent_control/protocol.rs`
- Create: `src-tauri/src/agent_control/discovery.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`

**Step 1: Write failing Rust tests for the wire envelope**

Cover:

- string request IDs, method, object params, and protocol version;
- malformed JSON, wrong JSON-RPC version, missing fields, non-object params, and duplicate fields;
- stable error reasons and JSON-RPC error mapping;
- maximum request/response byte lengths;
- the launch token is never rendered by `Debug`, user-facing errors, or report serialization.

The semantic method allowlist remains frontend-owned, but the Rust envelope rejects malformed
requests before emitting them.

**Step 2: Write failing discovery tests**

Cover:

- descriptor paths derive from the compiled `PLVS_APP_ID` config directory already used by
  `doctor`;
- development and release identities produce different paths/endpoints;
- descriptor serialization and parse validation;
- atomic replacement through a sibling temporary file;
- stale/missing/malformed descriptor classification;
- a secure per-launch token has sufficient entropy and survives round-trip only through the
  descriptor.

Use an OS secure-random dependency rather than timestamps or process IDs. Do not pin a version in
this plan; select the current compatible crate during implementation and commit its lockfile result.

**Step 3: Implement pure protocol/discovery modules**

Keep filesystem and random-source injection seams narrow enough for deterministic tests. Reuse
`doctor::resolve_config_dir()`; do not duplicate platform directory logic.

**Step 4: Verify**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml agent_control::protocol
cargo test --manifest-path src-tauri/Cargo.toml agent_control::discovery
```

---

### Task 5: Broker pending-request lifecycle and Tauri correlation commands

**Files:**

- Create: `src-tauri/src/agent_control/broker.rs`
- Modify: `src-tauri/src/agent_control/mod.rs`
- Modify: `src-tauri/src/lib.rs`
- Create or modify: `src-tauri/capabilities/default.test.js`
- Modify if required: `src-tauri/capabilities/default.json`

**Step 1: Write failing broker-state tests**

With transport and Tauri emission injected/faked, cover:

- frontend starts not ready;
- readiness is accepted only for the main handler lifecycle;
- pre-ready requests return `frontendNotReady` without entering pending state;
- duplicate in-flight request IDs are rejected;
- accepted requests enter a bounded pending map;
- exactly the matching frontend response resolves a request;
- unknown/late/duplicate responses are ignored or rejected without resolving another request;
- timeout, frontend teardown, and broker shutdown remove pending entries;
- no request can receive two responses;
- queue and in-flight limits reject excess work predictably.

**Step 2: Implement managed broker state**

Add narrow Tauri commands:

```text
agent_control_frontend_ready
agent_control_frontend_not_ready
agent_control_respond
```

The frontend response carries the request ID plus either a result or a structured semantic error.
Rust emits requests only to the `main` WebView label. Accessory windows are never targets.

Register the commands in all builds if that keeps Tauri macro assembly simple, but return disabled
and start no external endpoint outside `dev-identity`. The external release surface remains absent.

**Step 3: Verify capability boundaries**

Only the main window should be able to use the readiness/response commands if Tauri capabilities
need explicit entries. Extend the existing config guard tests rather than broadening a wildcard.

```powershell
cargo test --manifest-path src-tauri/Cargo.toml agent_control::broker
npm test -- src-tauri/capabilities/default.test.js
```

---

### Task 6: Windows current-user named-pipe server

**Files:**

- Create: `src-tauri/src/agent_control/windows_pipe.rs`
- Modify: `src-tauri/src/agent_control/mod.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`

**Step 1: Lock framing and resource limits in tests**

Use one request per connection with a four-byte little-endian length prefix followed by UTF-8 JSON.
Cover:

- fragmented reads and writes;
- zero, oversized, truncated, invalid UTF-8, and trailing payloads;
- authentication before broker dispatch;
- response length enforcement;
- client disconnect while pending;
- a stalled client cannot block new clients indefinitely.

**Step 2: Implement current-user pipe security**

- Derive the pipe name from the app identity, not the process ID.
- Create an explicit security descriptor that grants the current user (plus required OS service
  principals) access; do not rely on a permissive default DACL.
- Authenticate the per-launch descriptor token with a constant-time comparison before parsing or
  dispatching the semantic request.
- Keep blocking pipe work on named worker threads, not Tauri's UI thread and never an audio thread.
- Bound concurrent client workers and every wait.

Add only the specific `windows-sys` features required for named pipes, security descriptors, token
identity, and cancellation. Keep non-Windows modules compilable with a disabled stub.

**Step 3: Start and stop with the app**

During Tauri setup in a `dev-identity` build:

1. bind the pipe;
2. create broker state;
3. write the descriptor only after listening succeeds;
4. leave the second same-identity instance running without control if bind fails because another
   broker owns the endpoint;
5. remove only this process's matching descriptor during graceful shutdown.

A stale descriptor never lets a second process overwrite a live broker.

**Step 4: Verify**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml agent_control::windows_pipe
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

**Checkpoint:** A Rust test client can authenticate, submit a request to a fake frontend broker, and
receive exactly one correlated response through the real named pipe.

---

## Phase 3 — Frontend bridge

### Task 7: Frontend IPC adapter and strict request normalization

**Files:**

- Create: `src/ipc/agentControlEvents.js`
- Create: `src/ipc/agentControlEvents.test.js`
- Modify: `src/ipc/commands.js`
- Modify: `src/ipc/commands.test.js`
- Create: `src/agentControl/protocol.js`
- Create: `src/agentControl/protocol.test.js`

**Step 1: Write failing protocol tests**

Normalize only:

- `app.capabilities` with empty params;
- `app.inspect` with empty params;
- `workspace.applyLayout` with layout, optional non-negative safe-integer expected revision, and
  optional boolean dry run.

Reject unknown methods, unknown params, arrays where objects are required, unsafe revisions, and
prototype-bearing/untrusted shapes. Return structured semantic errors; never throw raw values into
the broker response path.

**Step 2: Add Tauri wrappers**

Components and agent-control hooks import only this adapter. It owns:

- listen for the targeted request event;
- ready/not-ready invokes;
- correlated response invoke.

Test exact event and command names plus listener cleanup.

```powershell
npm test -- src/agentControl/protocol.test.js src/ipc/agentControlEvents.test.js src/ipc/commands.test.js
```

---

### Task 8: Read-only App command bus and revisioned snapshot

**Files:**

- Create: `src/agentControl/appSnapshot.js`
- Create: `src/agentControl/appSnapshot.test.js`
- Create: `src/agentControl/useAgentControlBridge.js`
- Create: `src/agentControl/useAgentControlBridge.test.jsx`
- Modify: `src/App.jsx`
- Modify: `src/App.smoke.test.jsx`

**Step 1: Write failing snapshot tests**

Build a compact snapshot from explicit inputs. Cover:

- app/protocol/runtime identity;
- module capabilities from `MODULE_CATALOG`;
- serialized public layout and panel summaries;
- active preset ID and dirty flag;
- absence of history buffers, analysis frames, raw stores, and React-only objects;
- deterministic JSON-safe output.

**Step 2: Write failing bridge-hook tests**

Cover:

- listener installed before ready is announced;
- ready is withdrawn and listener removed on unmount;
- requests are serialized;
- capabilities and inspect use the latest refs rather than listener-creation closures;
- workspace changes from user and preset paths advance the process-local revision;
- reads return the current revision and never mutate state;
- unsupported/invalid requests return one structured error;
- accessory surfaces never mount the bridge.

**Step 3: Mount once at the App composition layer**

Mount after workspace and preset controllers exist. Keep the hook disabled unless the injected
runtime/build capability says development Agent Control is available. Do not infer enablement from
`import.meta.env.DEV` alone; it must agree with Rust's compiled `dev-identity` state.

```powershell
npm test -- src/agentControl/appSnapshot.test.js src/agentControl/useAgentControlBridge.test.jsx src/App.smoke.test.jsx
```

**Read-only checkpoint:** With a temporary test client or broker harness, the real App can answer
`app.capabilities` and `app.inspect` before any mutation method is enabled.

---

### Task 9: Workspace apply, dry run, revision conflict, and settlement

**Files:**

- Modify: `src/agentControl/useAgentControlBridge.js`
- Modify: `src/agentControl/useAgentControlBridge.test.jsx`
- Modify: `src/agentControl/workspaceLayout.js`
- Modify: `src/agentControl/workspaceLayout.test.js`
- Modify: `src/App.jsx`

**Step 1: Write failing command-bus tests**

Cover:

- expected revision checked when the mutation reaches the head of the queue;
- stale revisions never compile IDs, dispatch, dirty presets, or flush;
- dry run validates and returns canonical layout/planned IDs without mutation or flush;
- valid apply dispatches one semantic workspace replace;
- response waits until the committed workspace matches the compiler result;
- response then waits for `flushPersistence()`;
- a flush failure returns `commandFailed` and never claims persistence success;
- returned revision is the committed revision, not the request revision;
- `createdPanels` comes from the real apply result;
- timeout/unmount prevents a late second response;
- a user workspace change queued before the agent mutation produces a revision conflict rather than
  being overwritten.

**Step 2: Implement a state-based settlement barrier**

Do not use an arbitrary sleep or a fixed number of animation frames. Resolve the pending mutation
from an effect that observes the committed workspace snapshot and matches the command's expected
result. Force persistence only after that match.

The first slice promises committed + persisted, not painted/layout-stable. Keep those future wait
states out of the response.

**Step 3: Verify**

```powershell
npm test -- src/agentControl/useAgentControlBridge.test.jsx src/agentControl/workspaceLayout.test.js src/workspace/WorkspaceContext.test.jsx src/App.smoke.test.jsx
```

**Checkpoint:** A mocked Rust request can inspect, dry-run, reject a stale layout, and apply a valid
layout through the real React workspace provider.

---

## Phase 4 — CLI and delivery

### Task 10: Typed CLI app parser, reports, and control client

**Files:**

- Create: `src-tauri/src/cli_app.rs`
- Modify: `src-tauri/src/cli_main.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/bin/plvs-cli.rs` only if forwarding tests expose a real need

**Step 1: Write failing parser tests**

Cover:

- capabilities and inspect require `--json`;
- workspace apply accepts one file or `-`, required `--json`, optional expected revision, and
  optional dry run;
- missing/multiple input, unsafe revision, unknown flag, and missing JSON are usage errors;
- release-mode parsing leaves root help and unknown-command behavior unchanged;
- development-mode parsing advertises the `app` help topic.

Make the parser's live-control availability an explicit test input derived from
`cfg!(feature = "dev-identity")` in production code. This lets default Rust tests cover both the
enabled and disabled command surface without requiring two complete builds.

**Step 2: Write failing client/report tests**

Cover:

- descriptor discovery under the matching app identity;
- stdin and UTF-8/BOM file loading;
- one authenticated framed request and one response;
- app not running, malformed descriptor, authentication, transport, timeout, and app semantic
  errors map to the spec's stable reasons;
- transport failures exit `2`; valid app errors exit `1`; success exits `0`;
- JSON report envelopes include schema, command, status, app, protocol, and result/error;
- token and raw security descriptor details never appear in stdout/stderr.

Use an injected control client in parser/run tests; do not require a live named pipe for every CLI
unit test.

**Step 3: Implement and verify**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml cli_app
cargo test --manifest-path src-tauri/Cargo.toml cli_main
```

---

### Task 11: `desktop:control`, help, and developer documentation

**Files:**

- Modify: `package.json`
- Modify: `docs/cli.md`
- Modify: `CONTRIBUTING.md`
- Modify: `docs/architecture.md`
- Modify if needed: `scripts/verify-versions.mjs` or related script tests only when the new script
  exposes an existing assumption

**Step 1: Add the repository entrypoint**

```json
"desktop:control": "cargo run --manifest-path src-tauri/Cargo.toml --features dev-identity --bin plvs-cli -- app"
```

Verify npm argument forwarding:

```powershell
npm run desktop:control -- --help
npm run desktop:control -- capabilities --json
```

The first command must show app-family help, not Cargo or root CLI help.

**Step 2: Document the two-terminal workflow**

```powershell
# Terminal A
npm run desktop

# Terminal B
npm run desktop:control -- inspect --json
```

Document clearly:

- this is development-only;
- the GUI must already be running;
- the script selects `dev-identity` and does not touch installed PLVS;
- PATH is unrelated;
- installed standalone CLI commands retain their current behavior;
- release `plvs-cli` does not expose `app` yet.

Update the architecture IPC boundary and ownership description without documenting implementation
details as product guarantees.

**Step 3: Verify static/help contracts**

Add or update focused tests where CLI help snapshots/contracts exist. Run:

```powershell
npm run version:check
cargo test --manifest-path src-tauri/Cargo.toml cli_main
```

---

### Task 12: Full gate and real Windows acceptance

**Precondition:** A fresh worktree has no FFmpeg sidecars. Before `npm run check`, run the repository's
verified fetch command; do not copy binaries from another checkout.

```powershell
npm run ffmpeg:fetch
```

**Automated gate:**

```powershell
npm run check
cargo test --manifest-path src-tauri/Cargo.toml --features dev-identity
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --features dev-identity -- -D warnings
```

If feature toggling causes a second Rust build, accept that cost; it verifies the actual broker
startup and CLI availability configuration used by `npm run desktop`.

**Real Windows matrix:**

1. Start installed PLVS with a recognizable workspace and leave it running.
2. Start `npm run desktop`; verify the title/identity is PLVS Dev and its workspace is independent.
3. Run `npm run desktop:control -- capabilities --json`; verify dev identity, protocol version,
   method list, and all current module IDs.
4. Run `npm run desktop:control -- inspect --json`; compare the layout and panel summaries with the
   visible development window.
5. Save the returned revision and layout document.
6. Rearrange existing panel IDs only; apply it and confirm custom titles and panel controls survive.
7. Add a new `stereo-map` panel; confirm `createdPanels` returns its real ID and a second inspect
   contains it.
8. Run the same request with `--dry-run`; confirm no visual, dirty, revision, or persisted change.
9. Change the workspace manually, then apply with the stale saved revision; confirm
   `revisionConflict` and no overwrite.
10. Submit every representative invalid layout category; confirm none partially changes the UI.
11. Apply from a UTF-8 file and stdin.
12. Restart PLVS Dev and confirm the successful layout persisted.
13. Stop PLVS Dev and confirm `desktop:control` returns `appNotRunning`, including with a deliberately
    retained stale descriptor.
14. Start two PLVS Dev instances; confirm only the first is controllable and the descriptor is not
    replaced.
15. Confirm the installed PLVS workspace, window bounds, Dock state, and settings never changed.
16. Run installed `plvs-cli --help`; confirm the `app` family is absent and existing commands still
    work.

Record any platform-specific manual observations in the implementation handoff. Do not mark the
design implemented until every acceptance item that can run on the current machine has passed or is
explicitly reported as unavailable.

## Completion criteria

- Tasks 1–12 are complete and their focused tests pass.
- `npm run check` and dev-identity Rust checks pass.
- The real Windows named-pipe → Rust → main WebView → React → Rust → CLI path passes the matrix.
- Release help and runtime behavior remain unchanged.
- Installed configuration remains untouched.
- The design document status is updated from Draft only after the real acceptance pass.
- No capture-layer files changed; otherwise the user is reminded to rebuild the release CLI and run
  the required capture smoke plus four-hour soak guidance from `AGENTS.md`.

