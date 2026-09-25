# ADR 0010: Render Community previews in an isolated browser harness

## Status

Accepted (2026-09-25)

## Context

Community Catalogue Releases need trustworthy previews that show the imported content in PLVS.
Those images become immutable Release assets, so a maintainer and CI must be able to regenerate
them from the canonical artifact without depending on personal application state.

Capturing a running desktop application would reuse the complete product but would also require a
GUI session, native Tauri services and mutable persisted state. In some environments it would also
couple publication to the audio capture rig. Independently drawn promotional cards would be easier
to automate, but could drift from the components and semantics users actually receive.

The existing Theme semantic overview is useful as a contract surface, while Loudness Profiles and
Workspace Presets need representative product scenes. All families need one renderer identity,
fixed inputs and an explicit readiness signal before capture.

## Decision

- Add a dedicated browser entry for Community preview rendering. It must not enter the normal
  desktop boot path.
- Render the production React components that own the Theme, Loudness Profile, Stats, Workspace and
  Dock surfaces. Preview-only adapters may supply their contexts and data, but may not redraw
  approximations of those components.
- Supply all measurements, histories, settings and time through versioned fixtures. The harness
  does not start Tauri, audio capture, persistence, networking, animation or a live clock.
- Capture with a pinned Chromium toolchain, fixed locale, appearance, interface size, viewport and
  device scale. Wait for fonts, two animation frames and an explicit canvas/render settlement
  signal before capture.
- Let the versioned preview contract own the exact asset IDs and dimensions. The renderer emits a
  report containing renderer, content and fixture identities plus each PNG's dimensions, byte
  length and SHA-256 hash.
- Treat the generated pixel hashes as immutable Release seals, not as cross-operating-system
  golden assertions. Structural tests verify the asset set, dimensions, identities and readiness.

## Consequences

- Catalogue previews remain visually owned by the product instead of becoming a second UI design.
- Preview generation can run without a desktop session, sound device or mutable PLVS installation.
- Changes to production components can intentionally change future Release images; published
  Releases remain immutable and retain their original sealed assets.
- The preview adapters and fixture become maintained test infrastructure. They must evolve when the
  production component contracts change.
- Pixel output is reproducible in the supported pinned publication environment, but is not promised
  to match byte-for-byte across arbitrary browsers, operating systems or font stacks.

## Verification

Contract tests cover exact asset ownership, filenames, dimensions, hashes, renderer identity,
content identity and fixture identity. Harness tests cover separation from desktop boot, fixed
providers, disabled external state and explicit render settlement. Capture tests cover the pinned
browser, safe output paths, complete PNG generation and deterministic reports for all three
portable artifact families.
