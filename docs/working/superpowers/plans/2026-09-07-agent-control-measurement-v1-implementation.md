# Agent Control Measurement V1 — Implementation Plan

> Implemented on `main`. The unchecked boxes below preserve the original pre-implementation plan;
> verification results are recorded in the implementation handoff rather than rewritten post hoc.

**Goal:** Implement read-only `measurement describe/inspect` for one coherent latest LIVE semantic
sample, with freshness, null reasons, canonical Stats values, and effective Loudness Profile
evaluation.

**Architecture:** Capture a source-specific immutable measurement record in the existing LIVE
frame path, format it through a pure bounded public model, and serve it through the current React
Agent Control bridge. Keep numeric ownership in the existing frame reducer, `buildStatsValues`, and
`loudnessProfileEvaluate`; do not read panel rendering state or create analysis demand.

**Tech stack:** React 19, JavaScript ESM, Vitest, Rust CLI parser, Tauri Agent Control.

**Spec:**
`docs/working/superpowers/specs/2026-09-07-agent-control-measurement-v1-design.md`

---

### Task 1: Freeze the public catalogue and pure result model

**Files:**

- Create: `src/agentControl/measurementControl.js`
- Create: `src/agentControl/measurementControl.test.js`
- Reuse: `src/lib/statsCatalog.js`
- Reuse: `src/lib/loudnessProfileEvaluate.js`

- [ ] Define the ordered V1 descriptor catalogue, schema version, 2000 ms freshness threshold,
      metric basis values, and closed unavailability-reason enum.
- [ ] Add JSON-safe finite-number/null helpers and exact path recording for unavailable values.
- [ ] Build topology and channel rows from one frozen LIVE record and the captured label context.
- [ ] Map canonical Stats values through `buildStatsValues`; expose raw precision rather than panel
      strings.
- [ ] Model current/session True Peak without inventing multichannel True Peak fields the engine
      does not emit.
- [ ] Model optional stereo values only for an already-active first Vectorscope request, including
      insufficient-channel and below-signal-floor behavior.
- [ ] Model Dialogue inactive, active/no-dialogue, warm-up, and ready states without treating an
      inactive detector's zero coverage as a real measurement.
- [ ] Evaluate the effective saved/preview profile through `loudnessProfileEvaluate` and derive the
      documented overall status.
- [ ] Build no-sample, fresh-running, old-running, stopped-retained, and failed-retained results.
- [ ] Assert that `JSON.stringify` never emits or silently loses a non-finite value.

Run:

```powershell
npx vitest run src/agentControl/measurementControl.test.js
```

### Task 2: Add a LIVE-specific coherent sample owner

**Files:**

- Modify: `src/lib/tauriFrameApply.js`
- Modify: `src/lib/tauriFrameApply.test.js`
- Modify: `src/hooks/useAudioEngine.js`
- Modify: `src/hooks/useAudioEngine.test.js`
- Modify: `src/hooks/useMeterDisplay.js` only if the process/session owner belongs there
- Modify: `src/runtime/MeterRuntimeEngines.jsx`
- Modify: adjacent runtime tests as required

- [ ] Add an explicit callback/ref seam to `buildTauriFrameApply` that receives the raw frame and
      the complete reduced audio object in the same synchronous handler turn.
- [ ] Keep that seam opt-in so File analysis and existing tests retain current behavior.
- [ ] Own the latest LIVE record separately from shared `displayAudio`, File analysis, and history
      scrub state.
- [ ] Freeze/copy only V1 scalar arrays and metadata; never retain request-keyed band/point arrays
      through the Measurement owner.
- [ ] Record native `seq`, native elapsed `timestampMs`, loudness layout metadata, frame receipt
      wall time, and current reduced values atomically.
- [ ] Advance a process-local LIVE session generation on successful session start and explicit
      measurement clear; define and test restart behavior through the existing lifecycle.
- [ ] Preserve the last record after stop/failure and remove it after clear.
- [ ] Verify that File frames cannot replace the latest LIVE record, including when File is the
      displayed source.
- [ ] Avoid any added allocation, lock, or syscall on the native audio callback thread; this work
      remains in the frontend frame handler.

Run:

```powershell
npx vitest run src/lib/tauriFrameApply.test.js src/hooks/useAudioEngine.test.js
```

### Task 3: Expose captured LIVE/profile/channel context to Agent Control

**Files:**

- Modify: `src/App.jsx`
- Modify: `src/agentControl/useAgentControlBridge.js`
- Modify: `src/agentControl/useAgentControlBridge.test.jsx`
- Modify: context/runtime seams only where required by ownership

- [ ] Pass a stable getter for the latest LIVE record and session generation into the bridge.
- [ ] Capture once per request: global revision, `observedAt`, LIVE lifecycle, latest record,
      current channel-label resolution, active analysis requests, dialogue-demand state, and the
      effective Loudness Profile document/mode.
- [ ] Do not pass or read `displayAudio`, selected history offset, current File session, visual
      history slabs, or panel canvas state.
- [ ] Register `measurement.describe` and `measurement.inspect` as query methods that bypass
      mutation serialization, revision checks, editor guards, settlement, persistence, and GUI
      notices.
- [ ] Ensure describe remains available before the first frame and inspect returns a successful
      explicit no-sample result.
- [ ] Cover LIVE running/stopped/cleared, File displayed, history scrubbed, profile preview, absent
      analysis requests, dialogue inactive, and repeated read-only query cases.
- [ ] Prove queries do not call analysis setters, transport actions, store writers, revision bump,
      or notification paths.

Run:

```powershell
npx vitest run src/agentControl/useAgentControlBridge.test.jsx
```

### Task 4: Add protocol schema and capability synchronization

**Files:**

- Modify: `src/agentControl/schema.js`
- Modify: `src/agentControl/schema.test.js`
- Modify: `src/agentControl/capabilities.js`
- Modify: `src/agentControl/capabilities.test.js`
- Modify: `src/agentControl/protocol.test.js`
- Generate as required by: `docs/agent-control/README.md`

- [ ] Add strict empty-parameter request schemas for both wire methods.
- [ ] Add bounded response schemas for the descriptor catalogue and inspect result, including
      nullable numeric fields and exact enum values.
- [ ] Keep channel count, strings, arrays, object properties, and unavailability entries within
      explicit protocol bounds.
- [ ] Declare both commands and their read-only/query semantics in capabilities.
- [ ] Keep measurement session generation out of global revision inputs and `app.wait`.
- [ ] Run the repository's documented generation command; never hand-edit
      `docs/agent-control/generated/`.
- [ ] Add protocol fixtures for full, partial, stale, and no-sample envelopes.

Run the focused schema, capability, and protocol suites named by the existing package scripts and
the Agent Control synchronization checklist.

### Task 5: Implement the Rust CLI command family

**Files:**

- Modify: `src-tauri/src/cli_control.rs`
- Modify: adjacent Rust CLI tests in the same module

- [ ] Parse exactly `measurement describe --json` and `measurement inspect --json`.
- [ ] Require `--json` under the existing running-app command policy.
- [ ] Reject expected revision, dry-run, confirmation, source, input, output, and unknown options
      before transport.
- [ ] Map commands to `measurement.describe` and `measurement.inspect` with empty params.
- [ ] Add root help and family help using the exact public spelling.
- [ ] Reuse existing discovery, authentication, timeout, request envelope, response envelope, and
      exit-code handling.
- [ ] Cover successful parsing, option rejection, help, method mapping, and valid no-sample result.

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml cli_control
```

### Task 6: Document the public workflow

**Files:**

- Create: `docs/agent-control/measurements.md`
- Modify: `docs/agent-control/README.md`
- Modify: `docs/cli.md`
- Modify: `docs/working/agent-control-cli-roadmap.md`

- [ ] Document commands, LIVE-only scope, JSON examples, metric units/basis, sample identity,
      freshness, null reasons, stopped-retained behavior, and profile evaluation.
- [ ] State prominently that inspect never starts LIVE or activates optional analysis.
- [ ] Explain why `app.inspect` still omits measurements and why global revision/app wait remain
      unchanged.
- [ ] Explain that File reports, visual arrays, history export, and runtime predicates are later
      independent slices.
- [ ] Add copyable PowerShell examples that start/inspect LIVE through the documented commands
      without parsing display strings.
- [ ] Mark Measurement V1 complete in the roadmap only after implementation and checks pass.

### Task 7: Verification and desktop smoke

- [ ] Run all focused JS and Rust tests from the preceding tasks.
- [ ] Run the Agent Control generated-doc check and confirm no generated file was hand-edited.
- [ ] Run the merge gate:

```powershell
npm run check
```

- [ ] Start the real development app with `npm run desktop` and verify from a second terminal:
      describe before capture, no-sample inspect, fresh running inspect, loudness warm-up, stereo
      inactive/active, Dialogue inactive/active, profile off/saved/preview, stopped stale retention,
      clear, File displayed, and history scrubbed.
- [ ] Compare representative numbers with the corresponding GUI readouts while accounting for GUI
      display rounding.
- [ ] Confirm repeated inspect calls do not change revision, session generation, analysis requests,
      capture lifecycle, persistence files, or visible notices.
- [ ] This plan does not change native capture/DSP code, so capture smoke/soak are not required. If
      implementation expands into `src-tauri/src/audio`, `dsp`, or `engine`, follow the capture-layer
      smoke requirement and remind the user to run the four-hour soak.

## Completion gate

Measurement V1 is complete only when the implementation matches the approved design, generated
contracts are synchronized, all focused tests and `npm run check` pass, and the real desktop smoke
proves the CLI reads latest LIVE state rather than File/scrub presentation state.
