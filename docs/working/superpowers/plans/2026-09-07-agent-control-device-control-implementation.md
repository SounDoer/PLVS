# Agent Control Device Control — Implementation Plan

> Draft plan. Do not implement until the paired design is approved.

**Goal:** Implement live-app `device list/inspect/select` with exact dynamic inventory, Automatic
selection, optimistic generation checks, shared GUI semantics, confirmed Live restart, and durable
selection settlement.

**Architecture:** Add a pure Device Control model over the existing audio-device hook snapshot,
then promote `useAudioDevices` into the shared asynchronous selection owner used by the header,
tray, and Agent Control. Keep capture access behind `src/ipc/`; the bridge owns protocol,
concurrency, confirmation, and response envelopes.

**Tech stack:** React 19, JavaScript ESM, Vitest, Rust CLI parser, Tauri Agent Control.

**Spec:**
`docs/working/superpowers/specs/2026-09-07-agent-control-device-control-design.md`

---

### Task 1: Freeze the public device model and pure planner

**Files:**

- Create: `src/agentControl/deviceControl.js`
- Create: `src/agentControl/deviceControl.test.js`
- Modify: `src/lib/audioDeviceLabels.js` only if a pure existing label primitive is reusable

- [ ] Normalize native `DeviceInfo` rows into the bounded public ID, label, kind, direction,
      loopback, sample-rate, and channel-count model.
- [ ] Model Automatic separately from concrete rows and never infer a concrete ID from its label.
- [ ] Implement the 256-row and 512-scalar label bounds plus explicit truncation reporting.
- [ ] Reject duplicate normalized IDs as an internal inventory error.
- [ ] Build stable inventory signatures and a process-local generation transition helper.
- [ ] Build inspection from requested selection, Automatic preview, inventory, migration state, and
      Live lifecycle.
- [ ] Implement pure exact-ID/default selection planning, no-op, availability, restart effect,
      confirmation, warning, and File-isolation behavior.
- [ ] Cover output/input ordering, Unicode label truncation, no devices, unavailable Automatic,
      duplicate IDs, stale generation, no-op, Live running/stopped, and File-selected cases.

Run:

```powershell
npx vitest run src/agentControl/deviceControl.test.js src/lib/audioDeviceLabels.test.js
```

Expected: public snapshots and every selection decision are deterministic and side-effect free.

Commit:

```text
feat(agent-control): add device control planner
```

---

### Task 2: Make `useAudioDevices` the shared selection owner

**Files:**

- Modify: `src/hooks/useAudioDevices.js`
- Create or modify: `src/hooks/useAudioDevices.test.jsx`
- Modify: `src/ipc/capturePrefs.js`
- Modify: `src/ipc/capturePrefs.test.js`
- Modify: `src/App.jsx`
- Modify: `src/hooks/useTray.js` and its tests only to route the existing callback through the owner
- Modify: `src/components/AppHeader.jsx` and its tests only if callback/result handling changes

- [ ] Expose one coherent snapshot containing inventory, observed timestamp, generation,
      Automatic preview, requested selection, and migration state.
- [ ] Replace fire-and-forget selection persistence with an awaitable controller operation.
- [ ] Fix capture preference validation so current stable `lb-<32 hex>` / `cap-<32 hex>` IDs
      round-trip instead of being rewritten to `default`, while retaining legacy IDs long enough for
      the existing migration path.
- [ ] Keep initial load, hotplug events, legacy-ID migration, header selection, and tray selection on
      that same owner.
- [ ] Increment generation only for normalized inventory/Automatic changes and prevent stale async
      preview results from overwriting a newer generation.
- [ ] Make GUI selection surface persistence failures instead of claiming a durable choice.
- [ ] Keep `default` as a policy and preserve current GUI ordering and display labels.
- [ ] Test same-context state update, awaited persistence, hotplug, preview races, migration,
      unmount, and GUI/tray parity.

Run:

```powershell
npx vitest run src/hooks/useAudioDevices.test.jsx src/ipc/capturePrefs.test.js src/hooks/useTray.test.js src/components/AppHeader.test.jsx
```

Use the repository's actual neighboring test filenames if the component suites have a more
specific name; do not invent duplicate broad suites.

Expected: every caller uses one observable and awaitable device-selection owner.

Commit:

```text
refactor(audio): centralize device selection ownership
```

---

### Task 3: Expose observable Live device-restart settlement

**Files:**

- Modify: `src/hooks/useAudioEngine.js`
- Modify: `src/hooks/useAudioEngine.test.js`
- Modify: `src/hooks/useCaptureTransport.js`
- Modify: `src/hooks/useCaptureTransport.test.jsx`
- Modify: `src/App.jsx`

- [ ] Reuse the normal Live lifecycle to preflight, stop, clear, and start after an effective device
      change; do not create a second engine path.
- [ ] Expose transition and readiness settlement so a caller can distinguish React selection from
      native capture readiness.
- [ ] Ensure preflight/device disappearance before commit leaves the current Live session untouched.
- [ ] Preserve the new requested selection and expose stopped/failed state when restart fails after
      commit; do not auto-fallback or retry.
- [ ] Prevent overlapping Transport and Device lifecycle actions with `transitionInProgress`.
- [ ] Verify a stopped or File-only selection never starts/stops capture or mutates File sessions.
- [ ] Verify a running selection clears Live measurement state exactly once and produces one
      externally observed control mutation.

Run:

```powershell
npx vitest run src/hooks/useAudioEngine.test.js src/hooks/useCaptureTransport.test.jsx src/agentControl/transportControl.test.js src/agentControl/useAgentControlBridge.test.jsx
```

Expected: restart completion and partial failure are observable without bypassing `src/ipc/`.

Commit:

```text
refactor(audio): expose device restart settlement
```

---

### Task 4: Add Device Control protocol and capabilities

**Files:**

- Modify: `src/agentControl/protocol.js`
- Modify: `src/agentControl/protocol.test.js`
- Modify: `src/agentControl/appSnapshot.js`
- Modify: `src/agentControl/appSnapshot.test.js`

- [ ] Advertise `device.list`, `device.inspect`, and `device.select`.
- [ ] Define query/mutation classification and exact parameter allowlists.
- [ ] Require safe-integer `expectedRevision` and `expectedGeneration` for select.
- [ ] Accept exactly one bounded non-empty `deviceId`, `allowMeasurementRestart`, and `dryRun`.
- [ ] Reject labels, indexes, migration flags, and Transport flags at their own JSON paths.
- [ ] Add a coverage guard tying every advertised Device command to validation and a bridge handler.

Run:

```powershell
npx vitest run src/agentControl/protocol.test.js src/agentControl/appSnapshot.test.js
```

Expected: malformed requests never reach device or engine owners.

Commit:

```text
feat(agent-control): define device control protocol
```

---

### Task 5: Implement bridge queries, concurrency, and selection

**Files:**

- Modify: `src/App.jsx`
- Modify: `src/agentControl/useAgentControlBridge.js`
- Modify: `src/agentControl/useAgentControlBridge.test.jsx`

- [ ] Pass the complete Device controller and Live lifecycle settlement into Agent Control.
- [ ] Implement bounded list and current inspection from one coherent controller snapshot.
- [ ] Track requested selection in global revision identity and inventory in a separate generation.
- [ ] Ensure GUI/tray selection and committed legacy-ID migration bump global revision once.
- [ ] For select: validate revision, generation, transition, exact target and preview; compute effects
      and confirmation; return early for dry-run/no-op; register settlement; commit and await once.
- [ ] Repeat target presence and preview immediately before real commit.
- [ ] Map pre-commit availability, confirmation, transition, persistence, and post-commit restart
      failures to the spec's stable errors and `stateCommitted` details.
- [ ] Return resulting inspection state without forcing an immediate follow-up query.
- [ ] Test every state matrix row, hotplug race, Automatic availability, stale revision/generation,
      no-op, dry-run, GUI mutation, persistence failure, and restart failure.

Run:

```powershell
npx vitest run src/agentControl/useAgentControlBridge.test.jsx src/agentControl/deviceControl.test.js
```

Expected: global configuration concurrency and dynamic inventory concurrency remain independent.

Commit:

```text
feat(agent-control): control capture device selection
```

---

### Task 6: Add Rust CLI parsing

**Files:**

- Modify: `src-tauri/src/cli_control.rs`

- [ ] Add the `device` family without reviving the removed standalone `devices` command.
- [ ] Parse list and inspect as JSON-only queries.
- [ ] Parse select with exact ID/default, required expected revision/generation, optional restart
      confirmation, and optional dry-run.
- [ ] Reject `--out`, stdin/file inputs, label matching, and unrelated family flags.
- [ ] Update root/family help and command inventory from the same parser-owned manifest pattern.
- [ ] Add request-building, safe-integer, missing-flag, unknown-flag, help, and exit-code tests.

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml cli_control --no-fail-fast
```

Expected: all Device commands produce exact platform-independent JSON-RPC requests.

Commit:

```text
feat(cli): add device control commands
```

---

### Task 7: Publish Device Control

**Files:**

- Create: `docs/agent-control/devices.md`
- Modify: `docs/agent-control/README.md`
- Modify: `docs/agent-control/transport.md`
- Modify: `docs/cli.md`
- Modify: `docs/working/agent-control-cli-roadmap.md`
- Modify: `scripts/cliDocumentationContract.test.js`
- Modify: `CHANGELOG.md`

- [ ] Publish inventory fields, Automatic semantics, exact selection, generations, revision,
      restart confirmation, dry-run, failure, and settlement contracts.
- [ ] Clearly separate Device selection from Transport start/stop and from Doctor enumeration.
- [ ] Add copyable PowerShell workflows for listing, selecting a USB input, switching to Automatic,
      dry-running a Live switch, and re-inspecting after hotplug.
- [ ] Mark Device Control complete and make the next roadmap choice explicit.
- [ ] Add documentation contract coverage for every command and required safety flag.

Run:

```powershell
npx vitest run scripts/cliDocumentationContract.test.js
```

Expected: users can discover the family without learning removed CLI or internal harness history.

Commit:

```text
docs(agent-control): document device control
```

---

### Task 8: Final verification

- [ ] Run every focused frontend and Rust test from Tasks 1–7.
- [ ] Run `npm run check`.
- [ ] Start the real desktop app with at least one system output and one physical/virtual input.
- [ ] Verify list ordering, exact metadata, Automatic preview, and inspect while Live is stopped.
- [ ] Select each concrete device while stopped, restart PLVS, and verify persisted selection.
- [ ] Start Live, dry-run a switch without confirmation, then verify the real command refuses
      without the flag and succeeds with it only after capture readiness.
- [ ] Confirm the restart clears Live measurement/history once and leaves Presets/File sessions
      untouched.
- [ ] Unplug a listed device between list and select and verify stale generation or not-found fails
      before the current Live session stops.
- [ ] Verify Automatic-unavailable behavior while stopped and running.
- [ ] Force or simulate persistence and native-start failures and inspect committed-state reporting.
- [ ] Return the machine to its original requested device through the normal command.

This plan does not require changes under `src-tauri/src/audio`, `dsp`, or `engine`; do not widen the
implementation into those directories merely to expose existing behavior. Capture smoke and soak
are therefore not mandatory. If implementation does touch the capture layer, run the real capture
smoke and remind the user to run `npm run soak:capture` as required by `AGENTS.md`.

Final implementation commit is unnecessary if every task commit is already clean and complete.

## Review checklist before implementation

- [ ] Confirm all six proposed decisions in the paired spec.
- [ ] Confirm dedicated inventory generation rather than global-revision hotplug churn.
- [ ] Confirm both expected revision and expected generation are required for select.
- [ ] Confirm unavailable Automatic may be persisted only while Live is stopped.
- [ ] Confirm post-commit restart failure preserves selection instead of rollback/fallback.
- [ ] Confirm no `device describe`, label matching, or separate headless command in the first slice.
