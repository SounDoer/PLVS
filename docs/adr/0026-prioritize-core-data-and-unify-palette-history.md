# ADR 0026: Prioritize Core Data and unify Palette History

## Status

Accepted

## Context

ADR 0025 made Snapshot appearance a History data state. Early semantics 5 experiments gave Status,
Frequency, Intensity, and the Level Meter Gradient separate hue treatments so every panel would
change visibly. The result overemphasized the state transition, weakened authored palette identity,
and required several unrelated tuning constants. A meter-specific History ramp derived from Core
Data also made Gradient diverge from the Level Meter's own Status palette.

Core Data and Palettes have different jobs. Primary and Secondary Data identify the Theme's main
signals and can carry a clear temporal-state change. Status, Frequency, and Intensity encode
judgment, position, and magnitude; their authored hues should remain stable across Live and
Snapshot.

Theme Semantics 5 and its Sharesets documents have not been released. They are local development
artifacts and have no compatibility population to migrate.

## Decision

- Core Primary and Secondary Data derive clearly distinct History Primary and History Secondary
  colours. Trace modules and the Snapshot transport indicator follow those roles as already defined
  by ADR 0025.
- Status, Frequency, and Intensity share one automatic Palette History treatment. It preserves hue
  and chroma and moves only OKLCH lightness slightly toward the panel surface, with a smaller step
  for Light Themes.
- The Level Meter has no meter-specific History roles. Gradient and Level Zones both use the
  module's Safe, Warning, and Critical colours and therefore receive the same Palette History
  treatment in Snapshot.
- Colours derived from neither Core Data nor Palettes do not acquire a History treatment merely to
  make Snapshot more visible. Spectrogram monochrome ink, Selection, and interface colours remain
  unchanged.
- No transform strength, opacity, or additional palette controls are added to the Theme Editor.
- Because semantics 5 is unreleased, its automatic derivation is corrected in place. There is no
  semantics 6 migration solely for discarded local output.

This refines ADR 0025. Its History data-state model remains accepted; its requirement to version
changes to automatic History meaning applies after semantics 5 is published.

## Consequences

- Snapshot identity is clearest in Core Data traces without forcing every measurement palette to
  become a second Theme.
- Palette meaning and Theme character remain stable, while the small lightness change still lets a
  side-by-side review distinguish Live and Snapshot rendering.
- Gradient and Level Zones remain visually related and require no special meter compiler roles.
- Built-in Themes remain free of Advanced overrides, and custom Themes inherit the same rules.
- Existing local semantics 5 artefacts and deterministic previews must be regenerated in place.
