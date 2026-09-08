# Agent Control Visual Capture — Implementation Plan

> Approved implementation plan.

**Goal:** Implement Windows-first, app-only screenshots and asynchronous H.264 MP4 recording for
the Agent Control `visual` family, with optional Live measured-source audio and bounded artifacts.

**Architecture:** Add semantic target discovery and paint settlement in the main React owner, a
small Rust visual-capture service behind Tauri IPC, Windows WebView2 still capture, and a Windows
Graphics Capture/Media Foundation recording worker. Keep media out of JSON and keep the optional PCM
tap downstream of the realtime callback.

**Tech stack:** React 19, JavaScript ESM, Vitest, Tauri 2, Rust, WebView2, Windows Graphics Capture,
Direct3D 11, Media Foundation, Windows WASAPI/cpal source PCM.

**Spec:**
`docs/superpowers/specs/2026-09-07-agent-control-visual-capture-design.md`

---

## Phase A — Screenshot foundation

### Task 1: Freeze protocol, capability, and target contracts

**Files:**

- Create: `src/agentControl/visualControl.js`
- Create: `src/agentControl/visualControl.test.js`
- Modify: `src/agentControl/protocol.js`
- Modify: `src/agentControl/protocol.test.js`
- Modify: `src/agentControl/appSnapshot.js`
- Modify: `src/agentControl/appSnapshot.test.js`

- [ ] Define public target/audio/state enums and pure `visual.describe` projection.
- [ ] Normalize `visual.describe` and `visual.screenshot` with exact parameter allowlists.
- [ ] Accept only semantic target objects; reject selectors, window handles, URLs, and paths.
- [ ] Make `panelId` legal and required only for `kind: "panel"`.
- [ ] Validate optional safe-integer `expectedRevision`.
- [ ] Advertise platform/runtime feature flags without hardcoding Windows availability into the CLI.
- [ ] Add method-to-normalizer/handler coverage so a newly advertised visual method cannot be
      orphaned.

Run:

```powershell
npx vitest run src/agentControl/visualControl.test.js src/agentControl/protocol.test.js src/agentControl/appSnapshot.test.js
```

Expected: request validation and capability output are deterministic and contain no DOM/native
objects.

Commit:

```text
feat(agent-control): define visual capture protocol
```

---

### Task 2: Add semantic capture surfaces and paint settlement

**Files:**

- Create: `src/agentControl/visualSurfaces.js`
- Create: `src/agentControl/visualSurfaces.test.js`
- Create: `src/agentControl/useVisualCaptureSurfaces.js`
- Create: `src/agentControl/useVisualCaptureSurfaces.test.jsx`
- Modify: `src/components/AppShell.jsx`
- Modify: `src/workspace/LeafView.jsx`
- Modify: `src/dock/accessories/*` only where a stable root marker/readiness signal is required
- Modify: `src/App.jsx`

- [ ] Mark the main shell, workspace root, active Panel leaf, Dock Header root, and Dock Editor root
      with stable semantic data attributes. Do not expose CSS selectors in the public contract.
- [ ] Resolve Panel IDs against Workspace state and separately determine whether the instance is the
      currently rendered tab.
- [ ] Return bounded CSS rect, viewport dimensions, DPR, window label, and surface readiness.
- [ ] Implement fonts-ready, non-zero/intersection, two-animation-frame geometry stability, and
      Canvas backing-size settlement with a three-second ceiling.
- [ ] Ensure settlement reads current revision immediately before returning geometry.
- [ ] Add a `ResizeObserver` subscription that is dormant unless a recording owns the surface.
- [ ] Test missing Panels, inactive tabs, focus view, overlays, Dock/normal availability, resize,
      cancellation, unmount, and settlement timeout.

Run:

```powershell
npx vitest run src/agentControl/visualSurfaces.test.js src/agentControl/useVisualCaptureSurfaces.test.jsx src/agentControl/useAgentControlBridge.test.jsx
```

Expected: the frontend can name and settle capture geometry without capturing pixels or mutating UI.

Commit:

```text
feat(agent-control): expose semantic capture surfaces
```

---

### Task 3: Build bounded artifact storage

**Files:**

- Create: `src-tauri/src/visual_capture/mod.rs`
- Create: `src-tauri/src/visual_capture/artifacts.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/state.rs` only if shared managed state belongs there

- [ ] Create identity-scoped `agent-artifacts` storage under the Tauri app-data directory.
- [ ] Generate opaque IDs and temporary sibling paths from OS randomness.
- [ ] Publish only complete PNG/MP4 paths and compute byte count/SHA-256 off the UI thread.
- [ ] Implement 24-hour expiry, 4-GiB completed-storage cap, oldest-first cleanup, and startup
      orphan-temporary cleanup.
- [ ] Protect active/temp artifacts from ordinary cleanup.
- [ ] Normalize all paths before deletion and verify they remain descendants of the exact artifact
      root.
- [ ] Unit-test expiry boundaries, capacity order, active-file protection, missing files, hash,
      rename failure, and path-containment checks.

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml visual_capture::artifacts --no-fail-fast
```

Expected: native capture backends can publish bounded artifacts without accepting caller paths.

Commit:

```text
feat(capture): add agent artifact storage
```

---

### Task 4: Implement Windows WebView2 screenshots

**Files:**

- Create: `src-tauri/src/visual_capture/platform.rs`
- Create: `src-tauri/src/visual_capture/windows.rs`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/ipc/commands.js`
- Modify: `src/ipc/commands.test.js`

- [ ] Introduce a platform trait that reports unsupported screenshot/recording capabilities
      explicitly on non-Windows builds.
- [ ] Access the selected PLVS WebView through Tauri's platform-WebView boundary and invoke
      WebView2 `CapturePreview` into a private temporary PNG.
- [ ] Decode only enough PNG metadata/pixels to crop the frontend rectangle losslessly and re-encode
      the final PNG.
- [ ] Derive independent X/Y CSS-to-image scale from actual preview dimensions and reject impossible
      or empty crops.
- [ ] Add Tauri commands for capability query and screenshot capture behind `src/ipc/commands.js`.
- [ ] Keep WebView/native handles, temporary paths, and OS errors out of successful public results.
- [ ] Test crop rounding, clamping, mismatched DPR/monitor scale, 1-pixel borders, transparent pixels,
      and unsupported-platform behavior with pure helpers/fakes.

Run:

```powershell
npx vitest run src/ipc/commands.test.js
cargo test --manifest-path src-tauri/Cargo.toml visual_capture --no-fail-fast
```

Expected: native tests cover geometry and lifecycle; real pixels remain a manual Windows gate.

Commit:

```text
feat(capture): capture WebView screenshots on Windows
```

---

### Task 5: Connect screenshot requests end to end

**Files:**

- Modify: `src/agentControl/useAgentControlBridge.js`
- Modify: `src/agentControl/useAgentControlBridge.test.jsx`
- Modify: `src/App.jsx`

- [ ] Implement `visual.describe` from frontend runtime plus native platform capabilities.
- [ ] Implement one-at-a-time screenshot request ownership and cancellation on unmount.
- [ ] Validate target, settle render, recheck optional revision, invoke native capture, and return
      revision/measurement/artifact metadata.
- [ ] Map missing/inactive targets, conflicts, settlement timeout, native failure, and artifact write
      failure to stable spec errors.
- [ ] Keep screenshot work outside the mutation serializer while respecting the capture concurrency
      guard.
- [ ] Verify no screenshot path changes Workspace, Preset, persistence, measurements, or revision.

Run:

```powershell
npx vitest run src/agentControl/visualControl.test.js src/agentControl/useAgentControlBridge.test.jsx
```

Expected: a fake native adapter proves the full semantic screenshot contract.

Commit:

```text
feat(agent-control): capture visual screenshots
```

---

### Task 6: Add screenshot CLI output handling

**Files:**

- Modify: `src-tauri/src/cli_control.rs`

- [ ] Add `visual describe` and `visual screenshot` parsers, family/root help, command inventory, and
      JSON-RPC builders.
- [ ] Require `--out` in the CLI but never send it to the running app.
- [ ] Copy the staged file to a caller-relative path after checking returned artifact kind/media
      type and rechecking byte count/SHA-256.
- [ ] Replace public `stagedPath` with `out` only after a successful copy.
- [ ] Preserve recoverable staged metadata and exit 1 on local write/copy verification failure.
- [ ] Cover every target shape, Panel ID requirement, optional revision, unknown flags, help,
      overwrite behavior, missing staged file, hash mismatch, and local output error.

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml cli_control --no-fail-fast
```

Expected: no media bytes enter the control envelope and output follows existing CLI conventions.

Commit:

```text
feat(cli): add visual screenshot commands
```

---

### Task 7: Verify the screenshot slice on real Windows displays

- [ ] Run all focused tests from Tasks 1–6 and `npm run check`.
- [ ] Start the real app and capture `main`, `workspace`, every Panel type, Dock Header, and Dock
      Editor.
- [ ] Verify normal, focus, File, and Dock forms plus open menu/overlay behavior.
- [ ] Repeat at 100%, 125%, 150%, and 200% display/text scaling; include a mixed-DPI monitor move.
- [ ] Compare output dimensions/corners against the settled semantic rectangles and inspect WebGL,
      Canvas, SVG, transparency, text, and theme rendering.
- [ ] Verify inactive-tab Panel, stale revision, hidden accessory, concurrent request, unwritable
      output, and staged-artifact cleanup failures.

Expected: the screenshot slice can ship independently before recording code is introduced.

Commit only fixes discovered by this verification; do not create an empty gate commit.

---

## Phase B — Silent recording

### Task 8: Spike and freeze the Windows recording backend

**Files:**

- Create: `docs/working/visual-capture-windows-spike.md`
- Create: `src-tauri/src/visual_capture/recording/windows_probe.rs` or a small ignored example,
  whichever keeps production code clean
- Modify: `src-tauri/Cargo.toml`

- [ ] Prove Windows Graphics Capture can acquire the PLVS main HWND without a system picker.
- [ ] Prove Direct3D crop/scale/letterbox into a fixed BGRA/NV12 encoder surface.
- [ ] Prove Media Foundation can stream H.264 MP4 at 15/30/60 fps and finalize a playable file.
- [ ] Measure start/finalize latency, GPU/CPU cost, resize, minimize/restore, occlusion, transparency,
      and abrupt window loss.
- [ ] Choose exact Windows crate features/APIs and record OS/runtime prerequisites and failure codes.
- [ ] Keep the probe out of release command surfaces; delete it if it no longer carries regression
      value after the backend exists.

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml visual_capture --no-fail-fast
```

Expected: replace design assumptions with measured native behavior before building lifecycle code.

Commit:

```text
docs(capture): record Windows recording spike
```

---

### Task 9: Implement the silent recording controller

**Files:**

- Create: `src-tauri/src/visual_capture/recording/mod.rs`
- Create: `src-tauri/src/visual_capture/recording/state.rs`
- Create: `src-tauri/src/visual_capture/recording/windows.rs`
- Modify: `src-tauri/src/visual_capture/mod.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/ipc/commands.js`
- Modify: `src/ipc/commands.test.js`

- [ ] Implement process-local opaque IDs and `starting/recording/stopping/completed/failed` state.
- [ ] Enforce one active recording, supported FPS, 1–1800-second duration, and 2-GiB byte limit.
- [ ] Capture the `main` HWND and apply the frontend's current target crop to a fixed initial output
      canvas.
- [ ] Exclude the Windows pointer by default, allow explicit `visible` pointer capture, and retain
      the selected mode in recording metadata.
- [ ] Accept bounded ResizeObserver geometry updates and aspect-fit/letterbox without changing
      encoder dimensions.
- [ ] Implement explicit stop, duration/size auto-stop, window-loss stop, finalization, hashing, and
      artifact publication.
- [ ] Keep a bounded event/error/interruption ledger and aggregate frame/drop/byte counters.
- [ ] Make stop idempotent and keep terminal records inspectable until artifact retention expiry.
- [ ] Attempt bounded shutdown finalization and leave only cleanup-safe temp files after interruption.
- [ ] Unit-test every state transition, limit, race, repeated stop, resize, native failure, and cleanup
      interaction with fake clocks/backends.

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml visual_capture::recording --no-fail-fast
npx vitest run src/ipc/commands.test.js
```

Expected: native silent recording is independently lifecycle-safe and never blocks the UI thread.

Commit:

```text
feat(capture): record PLVS surfaces on Windows
```

---

### Task 10: Add recording protocol, bridge, waits, and indicator

**Files:**

- Modify: `src/agentControl/visualControl.js`
- Modify: `src/agentControl/visualControl.test.js`
- Modify: `src/agentControl/protocol.js`
- Modify: `src/agentControl/protocol.test.js`
- Modify: `src/agentControl/useAgentControlBridge.js`
- Modify: `src/agentControl/useAgentControlBridge.test.jsx`
- Create or modify: `src/components/RecordingIndicator.jsx`
- Create or modify: `src/components/RecordingIndicator.test.jsx`
- Modify: `src/components/AppShell.jsx`
- Modify: `src/App.jsx`
- Modify: `src-tauri/src/agent_control/broker.rs`

- [ ] Normalize start/inspect/wait/stop requests and advertise them only when native recording is
      supported.
- [ ] Advertise `none` / `visible` cursor modes, default start requests to `none`, and forward the
      normalized mode to native capture.
- [ ] Start only `main`/`workspace`, with `audio: "none"` initially, after target settlement and
      optional revision recheck.
- [ ] Forward active ResizeObserver geometry to native recording state without using public RPC.
- [ ] Keep inspect immediate and wait outside the mutation serializer in the shared bounded wait
      pool.
- [ ] Add a dedicated bounded broker budget for stop finalization and make wait the timeout recovery
      path.
- [ ] Render a visible recording indicator; verify it appears in `main` pixels and not `workspace`.
- [ ] Return current/started/ended revisions only as correlation metadata.
- [ ] Map busy/not-found/native/finalization/artifact/wait errors and preserve partial state.
- [ ] Test unrelated Agent Control mutations throughout recording and verify they remain responsive.

Run:

```powershell
npx vitest run src/agentControl/visualControl.test.js src/agentControl/protocol.test.js src/agentControl/useAgentControlBridge.test.jsx src/components/RecordingIndicator.test.jsx
cargo test --manifest-path src-tauri/Cargo.toml agent_control::broker visual_capture::recording --no-fail-fast
```

Expected: silent recording is fully controllable without pinning the normal command queue.

Commit:

```text
feat(agent-control): control visual recordings
```

---

### Task 11: Add recording CLI lifecycle and output copy

**Files:**

- Modify: `src-tauri/src/cli_control.rs`

- [ ] Parse start target/cursor/FPS/duration/optional revision; reject Panel/Dock recording targets.
- [ ] Parse exact process-local recording IDs for inspect, wait, and stop.
- [ ] Support bounded `--timeout-ms` on wait and no timeout flag on inspect/start.
- [ ] Support `--out` only on terminal wait/stop; reject it on start/inspect.
- [ ] Reuse verified staged-artifact copy logic from screenshot.
- [ ] Add request, help, command inventory, timeout budget, output, exit mapping, and malformed-ID tests.

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml cli_control --no-fail-fast
```

Expected: a start CLI may exit, and a later CLI can inspect/wait/stop and materialize its artifact.

Commit:

```text
feat(cli): add visual recording commands
```

---

### Task 12: Verify silent recording on real Windows

- [ ] Run focused tests and `npm run check`.
- [ ] Record main/workspace at 15/30/60 fps, normal/focus/File/Dock forms, and each scaling factor.
- [ ] Resize, minimize/restore, move across mixed-DPI monitors, change Theme/Layout/Panels/Axes, and
      open/close overlays during recording.
- [ ] Verify fixed output dimensions, aspect ratio, letterboxing, frame/drop counters, and indicator
      inclusion rules.
- [ ] Verify default recordings exclude the Windows pointer and `--cursor visible` includes it only
      while it is over the captured PLVS window.
- [ ] Exercise explicit stop, automatic duration stop, simulated size stop, repeated stop, app
      shutdown, window loss, encoder failure, and full/unwritable disk behavior.
- [ ] Validate every MP4 with Media Foundation playback plus an independent probe/player.
- [ ] Confirm the bundled FFmpeg binaries and hashes did not change.

Expected: silent recording is shippable independently of audio.

---

## Phase C — Live measured-source audio

### Task 13: Design the worker-side PCM subscriber seam

**Files:**

- Modify: `src-tauri/src/audio/capture.rs`
- Modify: `src-tauri/src/audio/cpal_backend.rs`
- Modify: `src-tauri/src/audio/platform_backend.rs`
- Modify: `src-tauri/src/audio/macos/*` only to keep trait compilation/platform behavior coherent
- Modify: relevant neighboring Rust tests

- [ ] Add a runtime-attachable bounded PCM subscriber downstream of the realtime callback and before
      DSP mutation.
- [ ] Reuse the existing preallocated callback-to-worker handoff; do not introduce a second callback
      copy, lock, wake, allocation, or syscall.
- [ ] Define timestamps, buffer ownership/recycling, subscriber attach/detach, and drop accounting.
- [ ] Ensure a slow/failed recorder can only drop its own input and cannot delay metering delivery.
- [ ] Extend callback-reachable source guards and warmed allocation tests for the new seam.
- [ ] Verify Windows cpal and macOS trait builds even though visual recording remains Windows-only.

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml audio::cpal_backend --no-fail-fast
npm run smoke:capture
```

Expected: a fake subscriber receives source PCM on a normal worker without changing callback safety
or metering behavior.

Commit:

```text
refactor(audio): expose bounded measured PCM subscription
```

---

### Task 14: Encode, synchronize, and report measured-source audio

**Files:**

- Create: `src-tauri/src/visual_capture/recording/audio.rs`
- Modify: `src-tauri/src/visual_capture/recording/windows.rs`
- Modify: `src-tauri/src/visual_capture/recording/state.rs`
- Modify: `src/agentControl/visualControl.js`
- Modify: `src/agentControl/protocol.js`
- Modify: `src/agentControl/useAgentControlBridge.js`
- Modify: related frontend and Rust tests

- [ ] Add `measuredSource` validation while keeping explicit `none` support.
- [ ] Change the final default to `measuredSource` while Live is selected; keep `none` as the File
      default and as an explicit option in both source modes.
- [ ] Reject measured-source start whenever File is the selected source mode.
- [ ] Attach/detach the PCM subscriber as Live starts, stops, restarts, changes device, or yields to
      File without ever ingesting File decoder PCM.
- [ ] Use video as master clock; resample source PCM to 48-kHz AAC-LC stereo at 192 kbit/s.
- [ ] Duplicate mono and implement/test the documented multichannel stereo downmix from channel
      layout rather than assuming channel order.
- [ ] Insert silence for initial stopped Live state, lifecycle gaps, timestamp discontinuities, and
      bounded backpressure.
- [ ] Bound interruption history and report reason intervals plus aggregate silent duration.
- [ ] Test A/V timestamp drift, discontinuities, sample-rate/device changes, mono/stereo/
      multichannel, Live-to-File-to-Live, stop races, and dropped audio buffers.

Run:

```powershell
npx vitest run src/agentControl/visualControl.test.js src/agentControl/protocol.test.js src/agentControl/useAgentControlBridge.test.jsx
cargo test --manifest-path src-tauri/Cargo.toml visual_capture::recording audio::cpal_backend --no-fail-fast
npm run smoke:capture
```

Expected: recorded audio is exactly the Live source PLVS measures, remains synchronized, and cannot
disturb measurement capture.

Commit:

```text
feat(capture): record measured source audio
```

---

### Task 15: Run real capture audio verification and soak

- [ ] Record known stereo tones and pulses through WASAPI loopback and a physical/virtual input.
- [ ] Verify decoded MP4 duration, channel count, 48-kHz sample rate, AAC codec/bitrate, tone levels,
      channel mapping, and pulse A/V offset with an independent analyzer.
- [ ] Verify `none` contains no audio stream.
- [ ] Verify File-selected measured-source start fails and File playback never enters a running
      measured-source track.
- [ ] Exercise Live stopped-at-start, start/stop, device restart, Live/File switching, backpressure,
      and source disappearance; compare interruption metadata with the actual silent spans.
- [ ] Run `npm run smoke:capture` after the final audio changes.
- [ ] Run `npm run soak:capture` for the default four hours and treat drift failures as investigation
      leads, as required by `AGENTS.md`.
- [ ] Re-run `npm run check` after any finding-driven fix.

Expected: the audio addition passes both media correctness and PLVS capture stability gates.

---

## Phase D — Publication and final gate

### Task 16: Publish Visual Capture

**Files:**

- Create: `docs/agent-control/visual.md`
- Modify: `docs/agent-control/README.md`
- Modify: `docs/cli.md`
- Modify: relevant Agent Control roadmap/status document
- Modify: `scripts/cliDocumentationContract.test.js`
- Modify: `CHANGELOG.md`

- [ ] Publish all six commands, target meanings, actual-pixels rule, revision correlation, recording
      lifecycle, audio semantics, limits, retention, output files, and errors.
- [ ] Include copyable screenshot, silent recording, measured-source recording, wait, and stop
      workflows.
- [ ] State Windows support and File-audio exclusion plainly.
- [ ] Update current implementation status only after each delivered slice actually exists.
- [ ] Add documentation contract assertions for commands and safety/limit flags.

Run:

```powershell
npx vitest run scripts/cliDocumentationContract.test.js
```

Expected: agents can discover and safely use the feature without reading the design record.

Commit:

```text
docs(agent-control): publish visual capture
```

---

### Task 17: Final verification

- [ ] Run every focused frontend/Rust suite named above.
- [ ] Run `npm run check`.
- [ ] Repeat the real Windows screenshot, silent-video, and measured-source acceptance matrices.
- [ ] Confirm release and development identities use separate staging roots and endpoints.
- [ ] Confirm Agent Control disabled behavior, recording indicator, shutdown finalization, artifact
      retention, and startup cleanup.
- [ ] Confirm no generated documentation or `src/generated/` file was edited manually.
- [ ] Confirm the FFmpeg sidecar remains the existing trimmed audio decoder.
- [ ] Inspect repository diff for unrelated changes and leave the worktree clean after commits.

Final implementation commit is unnecessary if every task commit is already clean and complete.

## Implementation order and release slices

The mergeable order is intentional:

1. Tasks 1–7: screenshot-only release slice.
2. Tasks 8–12: silent-recording release slice.
3. Tasks 13–15: optional measured-source audio slice.
4. Tasks 16–17: publication and complete gate.

Do not start the audio capture-layer changes merely because screenshot or silent recording is ready.
Each slice should pass its own full gate and can be reviewed, reverted, or shipped independently.
