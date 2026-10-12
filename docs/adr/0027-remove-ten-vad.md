# ADR 0027: Remove TEN VAD

## Status

Accepted (product decision by the owner, 2026-10-12)

Supersedes [ADR 0004](0004-keep-three-vad-engines.md).

## Context

ADR 0004 kept FireRed, Silero, and TEN as bundled user-selectable dialogue detectors. Its decision
assumed that all three models could remain on the same ordinary open-source maintenance surface.

PLVS's embedded TEN model and third-party notice came through `ten-vad-rs` 0.1.7 and described the
model as Apache-2.0. The current upstream TEN VAD repository instead publishes an Apache-2.0 text
with additional deployment restrictions, including a restriction on competing offerings. PLVS does
not have sufficient provenance evidence to establish that its embedded model carries an earlier,
unrestricted grant suitable for continued redistribution.

The product does not need three engines to provide trustworthy dialogue metering. Maintaining a
model with unclear redistribution terms is not justified by detector variety alone.

## Decision

Remove TEN VAD, its model, dependency, user option, capability declaration, and third-party notice.
Keep FireRed and Silero bundled and user-selectable. FireRed remains the default.

A persisted `ten` selection is treated as an unsupported value and normalizes to FireRed. PLVS does
not silently substitute another engine after a selected, supported engine fails at runtime; this
normalization applies only to obsolete stored configuration at the persistence boundary.

## Consequences

- Dialogue Detection offers two engines rather than three.
- Existing settings that selected TEN safely start with FireRed after upgrade.
- A future detector requires its own product value, programme-material evaluation, integration
  maintenance, and model-license review. Binary size alone is neither an acceptance nor rejection
  criterion.
- Reintroducing TEN would require verified model provenance and a new superseding decision.
