# Agent Control macOS Visual Capture — Implementation Plan

> **Goal:** Add app-only PNG screenshots and H.264/AAC MP4 recording to the existing Agent Control
> Visual Capture family on macOS without changing Windows behavior or bypassing React semantics.

**Architecture:** Reuse frontend semantic surfaces, Rust artifact/session/audio layers, and public
Tauri commands. Add a Rust macOS adapter over a narrow ARC Objective-C bridge: WKWebView snapshots
for permission-free stills, and ScreenCaptureKit + Core Image + AVAssetWriter for permission-gated
recordings. Generalize the recording controller from a Windows concrete session map to a small
platform-neutral session interface.

**Tech stack:** React 19, JavaScript ESM, Vitest, Tauri 2, Rust 2021, Objective-C with ARC, WebKit,
ScreenCaptureKit, Core Graphics, Core Image, Core Media, Core Video, and AVFoundation.

**Spec:**
[`../specs/2026-09-09-agent-control-macos-visual-capture-design.md`](../specs/2026-09-09-agent-control-macos-visual-capture-design.md)

---

## Background and constraints

Read before implementation:

- `AGENTS.md` — generated-document boundary, Agent Control synchronization checklist, macOS
  geometry pitfalls, and merge gate.
- `docs/engineering-pitfalls.md` — Windows/macOS scale rules and capture-layer testing limits.
- `docs/agent-control/visual.md` — implemented public Visual Capture contract.
- `docs/superpowers/specs/2026-09-07-agent-control-visual-capture-design.md` — platform-neutral
  product decisions that this phase preserves.
- `src/agentControl/useAgentControlBridge.js` — public error mapping and recording orchestration.
- `src/agentControl/visualSurfaces.js` and `useVisualCaptureSurfaces.js` — semantic geometry and
  resize ownership.
- `src-tauri/src/visual_capture/platform.rs` and `mod.rs` — native capability and Tauri boundary.
- `src-tauri/src/visual_capture/recording/{mod,state,audio,windows}.rs` — session lifecycle,
  audio timeline, and Windows behavior to preserve.
- `src-tauri/native/macos/tap_bridge.m` and `src-tauri/build.rs` — established Objective-C bridge
  and ARC build pattern.

Do not edit `docs/agent-control/generated/` by hand. If the command manifest changes, run its
generator and commit the generated result. Do not change the audio callback or ScreenCaptureKit
audio capture. Do not advertise a macOS family capability until its real acceptance step passes.

## Planned file structure

**Create**

- `src-tauri/native/macos/visual_capture_bridge.m`
- `src-tauri/src/visual_capture/macos.rs`
- `src-tauri/src/visual_capture/recording/session.rs`
- `src-tauri/src/visual_capture/recording/macos.rs`

**Modify**

- `src-tauri/build.rs`
- `src-tauri/Info.plist`
- `src-tauri/src/visual_capture/platform.rs`
- `src-tauri/src/visual_capture/mod.rs`
- `src-tauri/src/visual_capture/recording/mod.rs`
- `src-tauri/src/visual_capture/recording/windows.rs`
- `src/agentControl/visualControl.js`
- `src/agentControl/useAgentControlBridge.js`
- adjacent Rust and Vitest tests
- `docs/agent-control/visual.md`
- `docs/agent-control/README.md`
- `docs/architecture.md`
- `docs/cli.md`
- `docs/working/agent-control-cli-roadmap.md`

The exact native helper split may follow compiler and ownership constraints. Public Rust ownership,
semantic target behavior, and the narrow C ABI are required outcomes.

---

## Phase A — Freeze macOS capability and permission semantics

### Task 1: Extend the public description and stable errors

**Files:**

- Modify: `src/agentControl/visualControl.js`
- Modify: `src/agentControl/visualControl.test.js`
- Modify: `src/agentControl/useAgentControlBridge.js`
- Modify: `src/agentControl/useAgentControlBridge.test.jsx`
- Modify: `docs/agent-control/visual.md`

- [ ] Add `recording.permission` with values `granted`, `required`, and `unsupported`.
- [ ] Default Windows to `granted`, a supported macOS backend to its native preflight state, and an
      unsupported backend to `unsupported`.
- [ ] Keep `recording.available` as build/platform support rather than current TCC readiness.
- [ ] Add `screenCapturePermissionRequired` to the stable frontend error allowlist, message map,
      public docs, and handler tests.
- [ ] Preserve `app.capabilities` feature gates when permission is `required`.
- [ ] Test that `visual describe` performs no mutation, file write, or prompt-triggering command.

Run:

```bash
npx vitest run src/agentControl/visualControl.test.js src/agentControl/useAgentControlBridge.test.jsx
```

Expected: agents can distinguish “implemented but permission is required” from “unsupported,” and
no discovery call can trigger the macOS consent dialog.

### Task 2: Add native macOS capability and permission probes

**Files:**

- Modify: `src-tauri/src/visual_capture/platform.rs`
- Create: `src-tauri/src/visual_capture/macos.rs`
- Modify: `src-tauri/src/visual_capture/mod.rs`
- Modify: `src-tauri/Info.plist`
- Modify: `src-tauri/build.rs`

- [ ] Add a serialized recording permission field to `PlatformCapabilities`.
- [ ] Add a macOS platform implementation selected beside the existing Windows implementation.
- [ ] Wrap `CGPreflightScreenCaptureAccess()` in an injectable pure classification boundary.
- [ ] Wrap `CGRequestScreenCaptureAccess()` separately and call it only from recording start.
- [ ] Add `NSScreenCaptureUsageDescription` with PLVS-specific app-only recording wording.
- [ ] Add framework link declarations required by later native bridge work without changing
      non-macOS builds.
- [ ] Test platform selection and permission projection. Do not require changing the machine's real
      TCC state for unit tests.

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml visual_capture:: --no-fail-fast
```

Expected: macOS reports screenshot support after Phase B, keeps recording support false until Phase
C acceptance, and exposes a side-effect-free permission state.

---

## Phase B — Deliver permission-free macOS screenshots

### Task 3: Define the Objective-C bridge ABI and ownership rules

**Files:**

- Create: `src-tauri/native/macos/visual_capture_bridge.m`
- Modify: `src-tauri/build.rs`
- Create/Modify: adjacent Rust source-contract tests

- [ ] Define opaque callback context, completion callback, and sanitized error-code types for a
      one-shot WKWebView snapshot.
- [ ] Compile the bridge as Objective-C with ARC, modules, and the repository's macOS 14.2 minimum.
- [ ] Link WebKit, AppKit, CoreGraphics, and ImageIO through macOS-only build directives.
- [ ] Make callback delivery exactly once on success, native error, invalid geometry, or write
      failure.
- [ ] Document and test which side retains/releases the WebView, callback context, and native task.
- [ ] Ensure logs and errors never print opaque pointers or arbitrary artifact paths.
- [ ] Add a focused development probe for returned `NSImage` point size, bitmap pixel dimensions,
      alpha, and `snapshotWidth` behavior on 1x/2x displays before freezing the scale conversion.

Run:

```bash
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml visual_capture::macos --no-fail-fast
```

Expected: the bridge compiles and links on macOS before it is reachable from a public command.

### Task 4: Implement WKWebView snapshot capture

**Files:**

- Modify: `src-tauri/native/macos/visual_capture_bridge.m`
- Modify: `src-tauri/src/visual_capture/macos.rs`
- Modify: `src-tauri/src/visual_capture/platform.rs`
- Modify: `src-tauri/src/visual_capture/mod.rs`

- [ ] Use `WebviewWindow::with_webview` to obtain only the named PLVS `WKWebView`.
- [ ] Convert the settled CSS rectangle into a `WKSnapshotConfiguration.rect` inside current
      WebView bounds and enable capture after screen updates.
- [ ] Set `snapshotWidth` from the verified WebKit point/backing-pixel behavior; do not blindly
      multiply a point width by DPR. Treat returned bitmap dimensions as authoritative.
- [ ] Encode the returned `NSImage` to PNG at the pending artifact path.
- [ ] Adapt the native completion to a Rust one-shot future with cancellation-safe context
      ownership.
- [ ] Map invalid/moved targets to `targetUnavailable`, native snapshot failure to `captureFailed`,
      and file failure to `artifactWriteFailed`.
- [ ] Publish only after a complete native write and preserve existing screenshot concurrency.

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml visual_capture:: --no-fail-fast
npx vitest run src/ipc/commands.test.js src/agentControl/useAgentControlBridge.test.jsx
```

Expected: all mounted screenshot targets use the unchanged public result and artifact contract on
macOS, without requesting Screen Recording permission.

### Task 5: Verify and advertise screenshot support

**Files:**

- Modify: `docs/agent-control/visual.md`
- Modify: `docs/architecture.md`
- Modify: `docs/cli.md`
- Modify: `docs/working/agent-control-cli-roadmap.md`
- Modify: platform/source-contract tests

- [ ] Run real screenshots for main, workspace, active Panel, Dock Header, and Dock Editor.
- [ ] Verify PNG dimensions and semantic crop on Retina and a second display with a different scale.
- [ ] Verify hover/overlay state and confirm desktop/behind-window pixels are absent.
- [ ] Verify screenshots still work with Screen Recording permission absent.
- [ ] Enable macOS `screenshot.available` only after the matrix passes.
- [ ] Update public documentation and roadmap support tables.

Run:

```bash
npm run desktop
npm run desktop:control -- visual describe --json
npm run desktop:control -- visual screenshot --target main --out ./main.png --json
npm run check
```

Expected: Phase B is independently shippable; macOS screenshots are public while macOS recording
remains honestly unavailable.

---

## Phase C — Add permission-gated silent recording

### Task 6: Generalize recording session storage

**Files:**

- Create: `src-tauri/src/visual_capture/recording/session.rs`
- Modify: `src-tauri/src/visual_capture/recording/mod.rs`
- Modify: `src-tauri/src/visual_capture/recording/windows.rs`
- Modify: `src-tauri/src/visual_capture/mod.rs`

- [ ] Define a `RecordingSession` interface for ID, stop, geometry, audio-state, and finished state.
- [ ] Store platform sessions behind one thread-safe opaque type rather than a Windows-only map.
- [ ] Move platform-neutral insert/reap/stop/update/shutdown behavior out of Windows cfg blocks.
- [ ] Adapt the Windows session without changing capture, encoding, timing, or artifact behavior.
- [ ] Add fake-session tests for controller lifecycle, idempotent stop, update routing, reaping, and
      bounded shutdown.
- [ ] Prove Windows capability and recording contract tests remain unchanged.

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml visual_capture::recording --no-fail-fast
```

Expected: the controller is platform-neutral before the macOS session is introduced, and Windows
retains its current behavior.

### Task 7: Build ScreenCaptureKit source selection and lifecycle

**Files:**

- Modify: `src-tauri/native/macos/visual_capture_bridge.m`
- Create: `src-tauri/src/visual_capture/recording/macos.rs`
- Modify: `src-tauri/src/visual_capture/macos.rs`
- Modify: `src-tauri/src/visual_capture/mod.rs`

- [ ] On explicit start, preflight access, request it when absent, and return
      `screenCapturePermissionRequired` if it remains unavailable.
- [ ] Obtain the current main `NSWindow.windowNumber` inside Tauri's main-thread boundary.
- [ ] Resolve `SCShareableContent` and match the same window ID and current process only.
- [ ] Create a desktop-independent single-window `SCContentFilter`; never show a source picker.
- [ ] Configure requested FPS, bounded queue depth, cursor mode, shadow exclusion, and video-only
      stream output.
- [ ] Implement idempotent start/stop and delegate failure callbacks on a private serial queue.
- [ ] Test permission mapping, wrong/missing window refusal, callback ordering, and retained-context
      cleanup through native fakes/source contracts.

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml visual_capture::recording::macos --no-fail-fast
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: a PLVS-only stream starts and stops, but capability remains internal until MP4 output and
acceptance are complete.

### Task 8: Add geometry mapping and GPU composition

**Files:**

- Modify: `src-tauri/src/visual_capture/platform.rs`
- Modify: `src-tauri/src/visual_capture/recording/macos.rs`
- Modify: `src-tauri/native/macos/visual_capture_bridge.m`
- Add/Modify: adjacent geometry tests

- [ ] Represent semantic geometry as normalized WebView coordinates plus current viewport size.
- [ ] Map WKWebView bounds/offset, NSWindow coordinates, and ScreenCaptureKit frame metadata into a
      clamped pixel crop; handle AppKit's flipped Y axis explicitly.
- [ ] Keep output canvas dimensions fixed and even for the complete recording.
- [ ] Reuse the existing aspect-fit rule with an opaque black background.
- [ ] Use a reusable `CIContext` and `CVPixelBufferPool`; do not read full frames back to CPU.
- [ ] Make geometry replacement bounded and non-blocking; retain the last valid geometry.
- [ ] Fail closed when mapping would include pixels outside the semantic target.
- [ ] Test Retina/non-Retina scale, title/content offsets, fractional CSS pixels, one-pixel bounds,
      resize, scale transition, and letterbox calculations.

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml visual_capture::platform --no-fail-fast
cargo test --manifest-path src-tauri/Cargo.toml visual_capture::recording::macos --no-fail-fast
```

Expected: main/workspace geometry maps to the correct captured pixels without relying on
`SCStreamConfiguration.sourceRect`; its single-window behavior is ambiguous across the supported
OS and current SDK documentation.

### Task 9: Encode and publish silent H.264 MP4

**Files:**

- Modify: `src-tauri/native/macos/visual_capture_bridge.m`
- Modify: `src-tauri/src/visual_capture/recording/macos.rs`
- Modify: `src-tauri/src/visual_capture/mod.rs`
- Modify: `src-tauri/src/visual_capture/recording/state.rs` only for platform-neutral diagnostics

- [ ] Create `AVAssetWriter` MP4 output with an H.264 input and pixel-buffer adaptor.
- [ ] Start the writer/session from the first valid frame and append monotonic timestamps.
- [ ] Drop frames under writer backpressure without allocating an unbounded queue.
- [ ] Enforce maximum duration, artifact byte cap, explicit stop, window close, stream failure, and
      app shutdown through one finalization state machine.
- [ ] Stop SCStream, mark the video input finished, and await writer completion exactly once.
- [ ] Publish the pending artifact only after AVAssetWriter reports completed status.
- [ ] Surface sanitized failure details and preserve existing registry state/event semantics.

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml visual_capture::recording --no-fail-fast
npm run check
```

Expected: real silent recordings are playable H.264 MP4 files and every terminal path settles the
registry and temporary artifact.

### Task 10: Verify and advertise silent recording

**Files:**

- Modify: capability tests and public docs

- [ ] Verify absent permission describes `required` without prompting.
- [ ] Verify first start requests permission and returns the stable actionable error when needed.
- [ ] Restart after granting access and verify describe reports `granted`.
- [ ] Record main/workspace at 15, 30, and 60 FPS with cursor hidden and visible.
- [ ] Resize during recording and verify fixed dimensions, crop, aspect fit, and playable output.
- [ ] Exercise explicit stop, duration stop, window close, and application shutdown.
- [ ] Enable macOS `recording.available` only after these checks pass.

Run:

```bash
npm run desktop
npm run desktop:control -- visual describe --json
npm run desktop:control -- visual recording start --target main --audio none --json
npm run desktop:control -- visual recording wait <recording-id> --json
```

Expected: silent macOS recording becomes public only with a verified permission and lifecycle path.

---

## Phase D — Add measured-source AAC audio

### Task 11: Define bounded Rust-to-native audio packets

**Files:**

- Modify: `src-tauri/src/visual_capture/recording/audio.rs`
- Modify: `src-tauri/src/visual_capture/recording/session.rs`
- Modify: `src-tauri/src/visual_capture/recording/macos.rs`
- Modify: `src-tauri/native/macos/visual_capture_bridge.m`

- [ ] Reuse `AudioTimeline` to produce stereo 48-kHz signed-16-bit packets and presentation times.
- [ ] Define a C ABI call that copies one bounded PCM packet into native ownership; never pass a
      borrowed Rust buffer into an asynchronous Apple callback.
- [ ] Create `CMSampleBuffer` audio packets and append only while the writer audio input is ready.
- [ ] Treat native backpressure as an accounted drop/gap rather than queueing without bound.
- [ ] Preserve live-stopped, live-restart, source-mode-file, and input-drop silence semantics.
- [ ] Keep ScreenCaptureKit `capturesAudio` false and add a source-contract test for that invariant.
- [ ] Test timestamps, packet lifetime, downmix/resample results, backpressure, discontinuities, and
      completion flush.

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml visual_capture::recording::audio --no-fail-fast
cargo test --manifest-path src-tauri/Cargo.toml visual_capture::recording::macos --no-fail-fast
```

Expected: the native writer receives only the same measured PCM stream already used by Windows,
with bounded memory and no realtime-thread work.

### Task 12: Integrate AAC track and A/V finalization

**Files:**

- Modify: `src-tauri/native/macos/visual_capture_bridge.m`
- Modify: `src-tauri/src/visual_capture/recording/macos.rs`
- Modify: `src-tauri/src/visual_capture/mod.rs`
- Modify: frontend bridge tests where platform behavior is mocked

- [ ] Add an AAC AVAssetWriter input only for `measuredSource`.
- [ ] Use one native writer-session origin for video and audio timestamps.
- [ ] Attach the existing bounded `MeasuredPcmReceiver` after validation and before stream start.
- [ ] Route frontend audio-state changes to the shared timeline/session.
- [ ] Drain/finalize audio before completing the writer without blocking the React or audio callback
      thread.
- [ ] Return existing public audio stats and failure semantics unchanged.
- [ ] Verify File mode still defaults to `none` and rejects `measuredSource`.

Run:

```bash
npx vitest run src/agentControl/useAgentControlBridge.test.jsx
cargo test --manifest-path src-tauri/Cargo.toml visual_capture:: --no-fail-fast
```

Expected: completed macOS MP4 files contain synchronized AAC measured-source audio when requested
and no audio track when `none` is requested.

### Task 13: Run real audio and failure acceptance

**Files:**

- Modify: docs and roadmap only after acceptance

- [ ] Record a stable Live source and verify audible AAC plus expected duration with `ffprobe`.
- [ ] Stop/restart Live capture during recording and verify silence/event accounting.
- [ ] Force a slow writer or induced backpressure and verify bounded memory/drop reporting.
- [ ] Verify long-enough capture for drift and A/V synchronization.
- [ ] Verify permission revocation/native failure leaves a terminal failed session and no successful
      artifact.
- [ ] Confirm the normal audio meter remains responsive throughout recording.

Run:

```bash
npm run desktop
npm run desktop:control -- visual recording start --target main --audio measuredSource --json
npm run desktop:control -- visual recording wait <recording-id> --json
ffprobe -v error -show_streams -show_format <artifact-path>
```

Expected: audio behavior matches the Windows public contract and the recorder does not disturb
measurement or capture responsiveness.

---

## Phase E — Synchronize docs, packaging, and cross-platform gates

### Task 14: Complete Agent Control synchronization

**Files:**

- Modify: `docs/agent-control/visual.md`
- Modify: `docs/agent-control/README.md`
- Modify: `docs/architecture.md`
- Modify: `docs/cli.md`
- Modify: `docs/working/agent-control-cli-roadmap.md`
- Modify: schema/manifest source and generated output only if the error/description contract is
  represented there

- [ ] Document macOS permission timing, `recording.permission`, stable error/action details,
      restart expectations, and app-only screenshot semantics.
- [ ] Update the support matrix only for capabilities proven by the real acceptance matrix.
- [ ] Update architecture diagrams and native framework ownership.
- [ ] Run Agent Control manifest/schema generators rather than editing generated files.
- [ ] Verify examples work with both development identity and a packaged release identity.

Run:

```bash
npm run docs:agent-control
git diff --exit-code -- docs/agent-control/generated
```

Expected: code, capabilities, schema, public docs, and generated references describe the same
surface.

### Task 15: Final verification

**Files:** none unless a failure reveals a defect.

- [ ] Run focused frontend and Rust Visual Capture suites.
- [ ] Run `npm run check` on macOS.
- [ ] Run the repository's Windows merge gate/CI to prove the existing backend still compiles and
      behaves unchanged.
- [ ] Build the macOS application and verify `Info.plist` contains the packaged permission string.
- [ ] Repeat the real screenshot, silent recording, cursor, resize, measured audio, stop, duration,
      failure, and shutdown acceptance matrix in the packaged app.
- [ ] Confirm no capture code executes on the audio callback and no native pointer/path leaks into
      public output.

Run:

```bash
npm run check
npm run desktop:build
```

Expected: the full merge gate is green, Windows remains unchanged, and the packaged macOS app
passes the Visual Capture acceptance matrix.
