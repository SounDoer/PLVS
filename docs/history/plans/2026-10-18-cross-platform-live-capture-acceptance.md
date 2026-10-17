# Cross-platform live-capture acceptance implementation plan

**Date:** 2026-10-18

**Design:** `docs/history/specs/2026-10-18-cross-platform-live-capture-acceptance-design.md`

## 1. Normalize the shared rig API

- Replace Windows-named constants at call sites with a route resolver returning a capture selector
  and player target.
- Make the harness executable path and VLC locations platform-aware.
- Keep the existing Windows endpoint lookup and argument contract unchanged.
- Unit-test route validation and player arguments with an injected platform so CI covers both
  adapters on either host.

## 2. Add deterministic macOS discovery

- Add a small Swift/Core Audio probe for the numeric output-device id and format.
- Add a feature-gated harness device-list command exposing the same rows capture resolves.
- Select exactly one BlackHole system-output-monitor row and validate stable id, channels and
  sample rate before playback.
- Classify missing, duplicate, malformed and wrong-format results as rig errors.

## 3. Unify smoke and soak execution

- Update smoke, soak and multi-instance capture to consume the normalized route.
- Route VLC through `mmdevice` on Windows and `auhal` on macOS.
- Add targeted macOS player cleanup without disturbing user-owned VLC processes.
- Make soak RSS sampling platform-aware while preserving artifact fields and drift semantics.

## 4. Protect adjacent tooling

- Keep Windows-only performance and process-loopback tools explicitly Windows-only where their
  product purpose has no macOS equivalent.
- Migrate shared callers such as marketing capture only when they use the same live-capture rig;
  otherwise fail with a precise unsupported-platform message rather than silently changing their
  route.
- Update setup and contributor documentation with BlackHole as a macOS rig prerequisite, clearly
  separated from product dependencies.

## 5. Verification and commits

1. Run focused JavaScript tests for rig discovery, arguments, cleanup and verdict classification.
2. Run focused Rust tests for device listing and selector behavior.
3. Build the feature-gated harness from current sources.
4. Run `npm run smoke:capture` on this macOS BlackHole rig and retain the console evidence.
5. Run the repository-required pre-commit checks: `npm test`, `npm run format:check`,
   `npm run lint`, `npm run typecheck`, and `npm run rust:check` for the mixed JS/Rust change.
6. Commit implementation with a scoped Conventional Commit.
7. When a Windows rig becomes available, run the same smoke command there. Treat missing Windows
   evidence as an explicitly reported gap, not a reason to weaken or bypass the contract.

The four-hour soak is valuable follow-up evidence but is not required to finish the implementation
commit. Start it deliberately when the host can remain dedicated for the full run, then compare its
spread with the existing files in `artifacts/soak/`.
