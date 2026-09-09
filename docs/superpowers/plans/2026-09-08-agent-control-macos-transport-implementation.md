# Agent Control macOS Transport — Implementation Plan

> **Goal:** Make the existing live Agent Control command surface available on macOS through a secure
> Unix-domain-socket transport without changing public command semantics or Windows behavior.

**Architecture:** Extract transport-independent framing and authentication from the Windows named
pipe, introduce one platform-neutral `agent_control::transport` facade, and implement its macOS side
with a private Unix socket, an identity ownership lock, peer-UID verification, and explicit response
delivery acknowledgement. Keep the existing Broker, Tauri/React bridge, business functions,
revision model, persistence barriers, and CLI output contract.

**Tech stack:** Rust 2021, Tauri 2, macOS Unix domain sockets and libc APIs, React 19, Vitest, Cargo
tests, Node source-contract tests.

**Spec:**
[`../specs/2026-09-08-agent-control-macos-transport-design.md`](../specs/2026-09-08-agent-control-macos-transport-design.md)

---

## Background and constraints

Read before implementation:

- `AGENTS.md` — Agent Control synchronization rules, generated-document boundary, merge gate, and
  platform testing expectations.
- `docs/agent-control/README.md` — implemented public contract and transport-level error behavior.
- `docs/agent-control/config.md` — response delivery must complete before configuration import
  relaunches PLVS.
- `docs/superpowers/specs/2026-09-02-agent-control-design.md` — original discovery, security, broker,
  and first-instance decisions.
- `src-tauri/src/agent_control/windows_pipe.rs` — current framing, authentication, worker, delivery,
  server ownership, and client behavior.
- `src-tauri/src/agent_control/broker.rs` — do not replace correlation, pending limits, timeout,
  cancellation, or delivery-confirmation ownership.
- `src-tauri/src/agent_control/discovery.rs` — descriptor identity and token ownership.
- `src-tauri/src/agent_control/toggle.rs` — permission ordering and runtime endpoint lifecycle.
- `src-tauri/src/cli_control.rs` — stable public failure and exit-code mapping.
- `src-tauri/src/cli_path.rs` — Windows PATH mutation and current non-Windows stub.
- `src-tauri/plvs-cli/src/main.rs` and `scripts/verify-macos-dmg.sh` — the macOS thin forwarder and
  bundle already exist; do not create another CLI executable.

Do not edit `docs/agent-control/generated/` by hand. Run its generator only if a source-derived
snapshot legitimately changes; this transport project is not expected to change the command
manifest.

No task may route around the React command bridge or mutate the store/native application directly.
No task touches the audio callback, DSP, or capture engine.

## Intended file structure

**Create**

- `src-tauri/src/agent_control/framing.rs`
- `src-tauri/src/agent_control/transport.rs`
- `src-tauri/src/agent_control/transport/macos_socket.rs`
- `src-tauri/src/agent_control/transport/windows_pipe.rs` by moving the existing implementation
  after callers use the facade; use a repository-aware move so history remains readable.

**Modify**

- `src-tauri/src/agent_control/mod.rs`
- `src-tauri/src/agent_control/broker.rs`
- `src-tauri/src/agent_control/discovery.rs`
- `src-tauri/src/agent_control/toggle.rs`
- `src-tauri/src/cli_control.rs`
- `src-tauri/src/cli_path.rs`
- `src-tauri/src/lib.rs`
- `src-tauri/Cargo.toml`
- Rust/frontend/source-contract tests adjacent to the changed code
- `AGENTS.md`, `README.md`, `CONTRIBUTING.md`, `docs/architecture.md`, `docs/cli.md`,
  `docs/agent-control/README.md`, and `docs/working/agent-control-cli-roadmap.md`

The exact split between `framing.rs` and small private helpers in each native module may follow the
code if Rust ownership makes a helper genuinely platform-specific. The facade and absence of native
transport names from callers are required outcomes.

---

## Phase A — Freeze and extract the common transport contract

### Task 1: Add platform-neutral transport errors

**Files:**

- Create: `src-tauri/src/agent_control/transport.rs`
- Modify: `src-tauri/src/agent_control/mod.rs`
- Modify: `src-tauri/src/cli_control.rs`

- [ ] Add `TransportErrorReason` with the current public-relevant classifications: empty frame,
      frame too large, truncated frame, trailing payload, I/O timeout, invalid UTF-8, invalid
      envelope, unauthorized, connection failed, delivery failed, and generic I/O.
- [ ] Add `TransportError` formatting and internal JSON-RPC conversion without the words
      `NamedPipe` or `Windows` in type names.
- [ ] Write tests that map unauthorized, connection, timeout, and generic transport failures to the
      existing public CLI codes and exit class 2.
- [ ] Make `LocalControlClient` call a temporary facade that delegates to the existing Windows
      implementation and preserves the non-macOS unsupported branch until the macOS module lands.
- [ ] Run focused Rust tests and prove all existing CLI golden envelopes remain unchanged.

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml cli_control:: --no-fail-fast
cargo test --manifest-path src-tauri/Cargo.toml agent_control::protocol --no-fail-fast
```

Expected: public output and exit codes are unchanged; `cli_control.rs` no longer matches a
Windows-specific error type.

### Task 2: Extract shared framing and authentication

**Files:**

- Create: `src-tauri/src/agent_control/framing.rs`
- Modify: `src-tauri/src/agent_control/transport.rs`
- Modify: `src-tauri/src/agent_control/windows_pipe.rs` initially, before the later move

- [ ] Move the four-byte length prefix, maximum authenticated request size, deadline-aware complete
      read/write helpers, frame validation, authentication envelope, constant-time token comparison,
      request parsing, response encoding adapter, and unattributed transport error response into
      the common module.
- [ ] Keep native `WouldBlock`, connection-state, buffer sizing, and flush behavior in the Windows
      module where required.
- [ ] Preserve tests for fragmented reads/writes, empty/oversized/truncated/trailing frames, invalid
      UTF-8/JSON/envelopes, wrong tokens, large requests, and large responses.
- [ ] Add test fakes that force partial reads and writes independently of Windows so the framing
      contract runs on macOS CI.
- [ ] Verify tokens remain redacted from `Debug`, `Display`, serialization of errors, and CLI JSON.

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml agent_control::framing --no-fail-fast
cargo test --manifest-path src-tauri/Cargo.toml agent_control::windows_pipe --no-fail-fast
```

Expected: framing tests pass on macOS without a Windows pipe; Windows-only native tests remain
compile-gated.

### Task 3: Finish the transport facade and move the Windows module

**Files:**

- Create: `src-tauri/src/agent_control/transport/windows_pipe.rs` from the existing file
- Modify: `src-tauri/src/agent_control/transport.rs`
- Modify: `src-tauri/src/agent_control/mod.rs`
- Modify: `src-tauri/src/agent_control/toggle.rs`
- Modify: `src-tauri/src/cli_control.rs`
- Modify: `src-tauri/src/lib.rs`
- Remove after move: `src-tauri/src/agent_control/windows_pipe.rs`

- [ ] Expose `ServerState`, `start`, `stop` through managed state, `is_running`, and
      `call_with_timeout` from `transport.rs`.
- [ ] Select `windows_pipe` only inside the facade.
- [ ] Replace all `agent_control::windows_pipe::*` references in application, toggle, broker cfgs,
      CLI client, shutdown, and tests with platform-neutral names.
- [ ] Generalize broker delivery fields currently compiled only for Windows so a macOS transport can
      request and confirm delivery without duplicating broker logic.
- [ ] Preserve Windows current-user ACL, first-instance binding, worker bound, descriptor ownership,
      listener wake-up, large-frame handling, and native delivery flush exactly.
- [ ] Use `rg` to prove production callers outside the transport directory do not mention
      `windows_pipe`, `PipeServerState`, or `PipeErrorReason`.

Run:

```bash
rg -n "windows_pipe|PipeServerState|PipeErrorReason" src-tauri/src \
  -g '!agent_control/transport/windows_pipe.rs'
cargo test --manifest-path src-tauri/Cargo.toml agent_control:: --no-fail-fast
```

Expected: only the native Windows module and intentionally historical test names mention named
pipes; the macOS build still compiles with an unsupported facade implementation.

---

## Phase B — Secure macOS discovery and ownership

### Task 4: Implement macOS process liveness

**Files:**

- Modify: `src-tauri/src/agent_control/discovery.rs`
- Modify: `src-tauri/Cargo.toml`

- [ ] Add a macOS-targeted `libc` dependency for `kill`, peer credentials, advisory locking, and any
      required socket metadata calls; do not add it to platforms that do not use it without reason.
- [ ] Replace the non-Windows always-alive placeholder on macOS with `kill(pid, 0)` classification.
- [ ] Treat success and `EPERM` as alive, `ESRCH` as stale, and unexpected errors conservatively as
      possibly alive.
- [ ] Keep a separate fallback for platforms other than Windows/macOS so this phase does not claim
      Linux support.
- [ ] Test current PID, a definitely invalid PID, and pure errno classification.

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml agent_control::discovery --no-fail-fast
```

Expected: stale macOS descriptors are classified as `appNotRunning` instead of remaining
permanently plausible.

### Task 5: Make descriptor writing private on macOS

**Files:**

- Modify: `src-tauri/src/agent_control/discovery.rs`

- [ ] Add Unix permission helpers that ensure the identity configuration directory used for Agent
      Control cannot be traversed by other users and the committed descriptor is mode `0600`.
- [ ] Preserve atomic descriptor replacement and ensure the temporary/committed file never has a
      broader exposure window.
- [ ] Do not change Windows ACL behavior or the shared store filename/location.
- [ ] Add permission tests using a private temporary directory and check the resulting Unix mode.
- [ ] Keep descriptor token redaction tests intact.

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml agent_control::discovery --no-fail-fast
```

Expected: descriptor round-trip and atomic replacement still pass, and macOS mode tests report
private ownership.

### Task 6: Add macOS endpoint address and ownership lock primitives

**Files:**

- Create: `src-tauri/src/agent_control/transport/macos_socket.rs`
- Modify: `src-tauri/src/agent_control/transport.rs`
- Modify: `src-tauri/src/agent_control/discovery.rs`

- [ ] Generate a short stable socket filename from the complete app identifier and join it to the
      application process's user temporary directory.
- [ ] Validate that the encoded absolute path fits macOS `sun_path`; return a clear startup failure
      instead of truncating.
- [ ] Store the selected absolute socket path in the descriptor and validate the macOS endpoint
      shape, filename identity hash, absoluteness, and non-empty parent without requiring the CLI to
      reproduce the GUI's environment.
- [ ] Add an identity-specific advisory lock file in the private configuration directory and hold
      its exclusive non-blocking lock for the server lifetime.
- [ ] Distinguish lock contention from stale socket cleanup. Only the lock owner may remove a stale
      expected socket.
- [ ] Before unlinking, reject symlinks, regular files, directories, and socket paths outside the
      selected address.
- [ ] Test deterministic dev/release separation, path-length refusal, lock contention, stale socket
      recovery, and refusal to unlink a non-socket.

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml agent_control::transport::macos_socket --no-fail-fast
```

Expected: one identity owner wins, a crashed owner can be replaced after its lock is released, and
unrelated filesystem entries are never removed.

---

## Phase C — macOS server, client, and delivery semantics

### Task 7: Implement Unix socket bind, accept, and authenticated request dispatch

**Files:**

- Modify: `src-tauri/src/agent_control/transport/macos_socket.rs`
- Modify: `src-tauri/src/agent_control/transport.rs`
- Modify: `src-tauri/src/agent_control/broker.rs`

- [ ] Bind a `UnixListener` only after the ownership lock is held and stale cleanup is complete.
- [ ] Set the socket mode to `0600` before publishing the descriptor.
- [ ] Verify the accepted peer effective UID equals the server effective UID before reading an
      authenticated request.
- [ ] Reuse the shared frame/envelope parser and existing Broker; do not add a macOS request router.
- [ ] Preserve the eight-worker bound and broker pending limit. Reject or close excess accepted
      clients without unbounded thread creation.
- [ ] Implement non-consuming peer-disconnect detection while a broker request is pending.
- [ ] Make shutdown wake a blocked accept, stop new work, settle/drain already accepted work within
      the existing bounded lifecycle, shut down the broker, and remove only owned native state.
- [ ] Test unauthenticated clients, peer-verification fakes, malformed frames, client disconnect,
      worker saturation, graceful shutdown, and owned cleanup.

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml agent_control::transport::macos_socket --no-fail-fast
cargo test --manifest-path src-tauri/Cargo.toml agent_control::broker --no-fail-fast
```

Expected: authenticated local requests reach the existing broker and no socket test requires a
Tauri WebView.

### Task 8: Implement the macOS client and common failure mapping

**Files:**

- Modify: `src-tauri/src/agent_control/transport/macos_socket.rs`
- Modify: `src-tauri/src/agent_control/transport.rs`
- Modify: `src-tauri/src/cli_control.rs`

- [ ] Connect to the absolute endpoint read from the validated descriptor with an explicit connect
      deadline.
- [ ] Verify the connected server effective UID equals the client effective UID.
- [ ] Send the shared authenticated request frame and read the complete response with the broker
      budget plus client grace.
- [ ] Parse the JSON-RPC response through the existing CLI path and preserve response ID checks.
- [ ] Map `ENOENT`, `ECONNREFUSED`, and stale/unreachable socket outcomes to `appNotRunning`; keep
      authentication, timeout, discovery, protocol mismatch, and other transport mappings stable.
- [ ] Test successful round trips, wrong token, missing socket, refused stale socket, malformed
      response, timeout, fragmented I/O, and payloads larger than socket buffers.

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml agent_control::transport --no-fail-fast
cargo test --manifest-path src-tauri/Cargo.toml cli_control:: --no-fail-fast
```

Expected: `LocalControlClient` can call a fake/real local macOS socket without any platform-specific
branch in CLI command execution.

### Task 9: Implement explicit macOS delivery acknowledgement

**Files:**

- Modify: `src-tauri/src/agent_control/framing.rs`
- Modify: `src-tauri/src/agent_control/transport/macos_socket.rs`
- Modify: `src-tauri/src/agent_control/broker.rs`

- [ ] Define a bounded internal acknowledgement frame carrying the request ID and no application
      result data.
- [ ] Send an acknowledgement only after the CLI has read, decoded, and matched the complete
      response.
- [ ] When `PendingResponse` contains a delivery sender, make the server wait for and validate that
      acknowledgement before calling `confirm_delivery(Ok(()))`.
- [ ] Map missing, malformed, mismatched, disconnected, and timed-out acknowledgements to
      `DeliveryFailed` and confirm failure exactly once.
- [ ] Ensure ordinary responses that do not request confirmation do not wait for an acknowledgement.
- [ ] Preserve the Windows `FlushFileBuffers` path and its existing test proving the client read the
      response.
- [ ] Add an end-to-end broker/socket test in which frontend delivery wait does not complete until
      the macOS client has consumed the response and acknowledged it.

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml agent_control::framing --no-fail-fast
cargo test --manifest-path src-tauri/Cargo.toml agent_control::transport --no-fail-fast
cargo test --manifest-path src-tauri/Cargo.toml agent_control::broker --no-fail-fast
```

Expected: relaunch-sensitive delivery has an explicit macOS proof and Windows behavior is unchanged.

### Task 10: Build the complete macOS server and descriptor lifecycle

**Files:**

- Modify: `src-tauri/src/agent_control/transport/macos_socket.rs`
- Modify: `src-tauri/src/agent_control/transport.rs`
- Modify: `src-tauri/src/agent_control/discovery.rs`

- [ ] Compose token generation, ownership lock, socket bind, broker creation, listener start,
      descriptor construction, private atomic descriptor write, managed broker installation, and
      managed server installation in that order.
- [ ] If any step after lock acquisition fails, clean up only resources created by this attempt and
      leave the GUI free to continue.
- [ ] Record the real PID, app name/version/identifier, protocol/schema versions, selected absolute
      endpoint, token, and RFC3339 start time.
- [ ] On stop/drop, compare current descriptor PID/token ownership before removing it and remove only
      the owned socket.
- [ ] Test failed bind, failed descriptor write, second owner, drop cleanup, descriptor replacement
      race, and start/stop idempotence.

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml agent_control::transport --no-fail-fast
cargo test --manifest-path src-tauri/Cargo.toml agent_control::discovery --no-fail-fast
```

Expected: the macOS native endpoint is publish-after-listen and cleanup cannot delete another
owner's descriptor.

---

## Phase D — Product lifecycle and installation status

### Task 11: Enable the transport in application startup and shutdown

**Files:**

- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/agent_control/toggle.rs`
- Modify: related Rust tests

- [ ] Manage the platform-neutral `ServerState` instead of a named-pipe state.
- [ ] Report `agentControl.available` on Windows and macOS and compute `enabled` from platform
      support plus persisted permission.
- [ ] Start the facade during setup on both supported desktop platforms when permission is enabled.
- [ ] Preserve the rule that bind failure logs a warning and does not abort the GUI.
- [ ] Stop the facade on window destruction/application shutdown on both platforms.
- [ ] Make `set_agent_control_enabled` call the facade on both platforms and retain the existing
      ordering that avoids persisting a permission the endpoint failed to honor.
- [ ] Replace the Windows-only status message with a generic unsupported-platform message while
      keeping stable human guidance for Windows/macOS missing CLI cases.
- [ ] Test supported/enabled status composition for Windows, macOS, and an unsupported platform.

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml agent_control::toggle --no-fail-fast
cargo test --manifest-path src-tauri/Cargo.toml agent_control::transport --no-fail-fast
```

Expected: development macOS starts enabled by default, release macOS starts disabled by default,
and the switch takes effect without restarting.

### Task 12: Detect the bundled macOS CLI without editing PATH

**Files:**

- Modify: `src-tauri/src/cli_path.rs`
- Modify: `src-tauri/src/agent_control/toggle.rs`
- Modify: adjacent Rust tests

- [ ] On macOS, derive the host executable directory from `current_exe` and check its sibling
      `plvs-cli` executable.
- [ ] Return `supported: true` for installation detection, the full CLI path, and an observed
      `onPath` value that is informational only.
- [ ] Make macOS `set_cli_path_enabled` a non-mutating status refresh; never edit shell files or
      create/remove symlinks.
- [ ] Ensure endpoint enablement requires the bundled CLI to exist but does not require `onPath`.
- [ ] Preserve the Windows registry PATH implementation and tests.
- [ ] Test `.app`-style directories, paths with spaces, missing/non-executable CLI, and PATH
      observation without mutation.

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml cli_path --no-fail-fast
cargo test --manifest-path src-tauri/Cargo.toml agent_control::toggle --no-fail-fast
```

Expected: a valid `.app` can enable Agent Control when invoked only by full CLI path.

### Task 13: Update Settings behavior and boot-state tests

**Files:**

- Modify: `src/components/SettingsPanel.test.jsx`
- Modify: `src/hooks/useAgentControlSettings.test.js`
- Modify: `src/App.smoke.test.jsx` or the closest boot-state contract test
- Modify: frontend code only if the new status shape reveals a platform assumption

- [ ] Replace the macOS Windows-only fixture with supported installed macOS status.
- [ ] Keep the switch disabled while status is loading, while an operation is busy, when the bundle
      CLI is missing, and on a genuinely unsupported platform.
- [ ] Verify an enable failure leaves the visible switch off and reports a useful generic failure.
- [ ] Verify the React Agent Control bridge is mounted only when injected runtime state says the
      endpoint is enabled.
- [ ] Keep `agentControlEnabled` outside public Settings Control and portable configuration/profile
      transfer.

Run:

```bash
npx vitest run src/components/SettingsPanel.test.jsx src/hooks/useAgentControlSettings.test.js src/App.smoke.test.jsx
```

Expected: the frontend needs no platform-specific transport logic; it responds only to the native
status contract.

---

## Phase E — Documentation, packaging contracts, and acceptance

### Task 14: Update living documentation and source contracts

**Files:**

- Modify: `AGENTS.md`
- Modify: `README.md`
- Modify: `CONTRIBUTING.md`
- Modify: `docs/architecture.md`
- Modify: `docs/cli.md`
- Modify: `docs/agent-control/README.md`
- Modify: `docs/working/agent-control-cli-roadmap.md`
- Modify: `scripts/cliDocumentationContract.test.js`
- Modify: other source-contract tests that pin Windows-only Agent Control wording
- Do not modify historical specs/plans merely to rewrite their original scope
- Do not hand-edit: `docs/agent-control/generated/`

- [ ] Describe Agent Control as Windows and macOS local control, with Named Pipe and Unix Socket as
      native transports behind one contract.
- [ ] Document that macOS full-path invocation works and PATH/symlink setup is optional and
      user-owned.
- [ ] Keep Visual Capture explicitly Windows-only and keep dynamic capability discovery as the
      authority.
- [ ] Update architecture diagrams and project-tree descriptions to use the facade/module names.
- [ ] Remove the delivered macOS transport item from the roadmap's outstanding constraints without
      implying Visual Capture was delivered.
- [ ] Update exact-string tests so they distinguish all-Agent-Control claims from intentionally
      Windows-only Visual Capture claims.
- [ ] Run the docs generator only as a check; investigate rather than accepting a command-catalog
      change caused solely by transport work.

Run:

```bash
npx vitest run scripts/cliDocumentationContract.test.js scripts/tauriSecurityConfig.test.js scripts/releaseWorkflowContract.test.js
npm run docs:agent-control
git diff --exit-code -- docs/agent-control/generated
```

Expected: living docs describe both transports, historical design records retain their context,
and generated public commands do not change.

### Task 15: Extend macOS bundle verification

**Files:**

- Modify: `scripts/verify-macos-dmg.sh`
- Modify: `scripts/releaseWorkflowContract.test.js` or the closest macOS release contract
- Modify: CI/release workflow only if the existing macOS job does not run the extended verifier

- [ ] Retain checks that `plvs`, `plvs-cli`, ffmpeg/ffprobe, and `plvs-agent.json` are bundled at the
      expected paths.
- [ ] Verify the CLI and host identities match and offline `doctor --json` plus `schema list --json`
      execute from the mounted bundle.
- [ ] Do not claim live control from a mounted DMG alone: live endpoint acceptance requires launching
      a writable installed/copy of the app with user consent.
- [ ] Add a source-contract check that macOS release commands stage the matching release-identity
      CLI sidecar.

Run:

```bash
npx vitest run scripts/releaseWorkflowContract.test.js scripts/tauriSecurityConfig.test.js
npm run desktop:verify-macos-dmg
```

Expected: packaging proves the correct CLI is present and executable; real GUI control remains a
separate manual acceptance step.

### Task 16: Run the complete automated gate

- [ ] Run formatting before the merge gate if focused Rust edits need it.
- [ ] Run the complete repository check.
- [ ] Review the diff for token/path leakage, accidental generated edits, public schema changes,
      Windows regressions, and unrelated worktree changes.

Run:

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
npm run check
git status --short
git diff --check
```

Expected: all checks pass. Capture smoke/soak is not required because this project does not touch
the audio, DSP, or engine directories.

### Task 17: Perform real macOS desktop acceptance

This task requires an interactive macOS desktop session and cannot be replaced by unit tests.

- [ ] Start `npm run desktop` and retain its development identity.
- [ ] Run `npm run --silent desktop:control -- capabilities --json` and confirm macOS runtime,
      protocol version, and development app identity.
- [ ] Run `inspect`, revision `wait`, measurement `inspect`/`wait`, and at least one dry-run plus one
      real revision-guarded semantic mutation.
- [ ] Exercise a large Theme/Preset/Configuration export and import.
- [ ] Perform a real `config import`, verify the CLI receives the complete success envelope, and
      then observe PLVS relaunching.
- [ ] Disable Agent Control and verify `agentControlDisabled`; enable it and reconnect without an app
      restart.
- [ ] Quit and verify `appNotRunning`, then relaunch and verify permission restoration.
- [ ] Start a second same-identity PLVS and verify the first endpoint remains authoritative.
- [ ] Force-terminate the owning app, relaunch, and verify stale socket recovery.
- [ ] Build/copy a release identity app and prove dev/release CLIs cannot cross-control identities.
- [ ] Invoke `/Applications/PLVS.app/Contents/MacOS/plvs-cli` or an equivalent copied app path with
      no PATH setup.
- [ ] Run `visual describe` and a visual command to verify the existing macOS unavailable contract
      remains honest and isolated.

Record the commands, app identities, and pass/fail results in the implementation handoff or pull
request. Do not record descriptor tokens or copy descriptor contents into logs.

---

## Completion criteria

- macOS development and release builds can expose Agent Control behind the existing permission.
- A matching `plvs-cli` reaches the existing Broker and React command surface through a private UDS.
- Development and release identities cannot discover or control each other.
- A second same-identity instance cannot replace the first endpoint.
- Crash leftovers recover without deleting unrelated files or a live owner's socket.
- Descriptor, socket, peer credentials, and token together enforce current-user local access.
- Bounded frames, workers, pending requests, timeouts, cancellation, and error mappings are covered.
- Configuration relaunch waits for explicit macOS response receipt.
- macOS enablement does not edit PATH or shell configuration.
- Windows Named Pipe behavior and public CLI output remain unchanged.
- macOS Visual Capture remains explicitly unavailable and outside this phase.
- Living docs, packaging checks, focused tests, and `npm run check` pass.
