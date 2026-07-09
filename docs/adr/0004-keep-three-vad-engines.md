# ADR 0004: Keep all three dialogue VAD engines

## Status

Accepted (product decision by the owner, 2026-07-09)

## Context

Dialogue-gated loudness supports three runtime-selectable VAD engines behind
`VadEngineKind` (`src-tauri/src/dsp/speech.rs`): Silero (vendored
`voice_activity_detector`), FireRed (`firered-vad`, the default), and TEN
(`ten-vad-rs`). All three are exposed as user-facing options
(`src/lib/dialogueVadEngines.js`), all three link `ort` (ONNX Runtime), and
their models are embedded in the binary (Silero ~2.3 MB, FireRed ~2.2 MB,
TEN ~0.3 MB).

A bundle-size review (2026-07-08) noted that cutting an engine saves ~2.2 MB
of installed size per model plus a maintenance surface, and asked whether the
alternates should be feature-gated or removed. Note the shared `ort` runtime —
the dominant size cost — cannot be removed while any ONNX engine remains, so
per-engine savings are models-only.

## Decision

**Keep all three engines shipped and user-selectable.** Different program
material favors different detectors, and offering the comparison is part of
the product's value for dialogue metering. The ~4.8 MB of embedded models is
an accepted cost.

## Consequences

- Bundle reviews should not re-propose cutting or feature-gating VAD engines
  for size; the remaining size levers live elsewhere.
- All three engines stay on the maintenance surface (dependency updates,
  `speech.rs` adapter tests).
- If a fourth engine is ever proposed, the bar is product value of the added
  comparison, not binary size alone.
