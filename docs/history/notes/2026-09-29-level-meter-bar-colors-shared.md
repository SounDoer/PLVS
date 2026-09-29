# Level Meter Bar Colors: back to one shared value

Supersedes the per-mode storage in `docs/history/specs/2026-09-28-level-meter-bar-colors-design.md`
("Each measurement mode keeps its own value") and
`docs/history/plans/2026-09-28-level-meter-bar-colors-per-mode.md`. The rest of that design stands.

## Decision

Bar Colors is one panel control, `levelMeterBarColors` (`"gradient" | "levelZones"`, default
Gradient), shared by all four measurement modes, in the panel, the Dock level module and Agent
Control (`barColors`, always effective). The four per-mode keys only reached a preview build, so they
are removed without a migration.

## Why

Across the panel controls, a setting is stored per mode only when its value means something different
in each mode: Peak and RMS Warning / Critical are different levels, Mono Loss and M/S Ratio Level
Range have different units and constraints. A setting whose value means the same thing in every mode
it applies to is one shared key: Stereo Map Hold, Speed and Smoothing, the Spectrogram 3D settings
across Lines and Surface, and, in the Level Meter itself, Playback Max and Floating Value.

Bar Colors' value means the same thing in every mode, so per-mode storage was the one exception, and
it made the setting appear not to stick when switching Mode.

The case that motivated per-mode storage, Level Zones under Peak while Momentary has no Profile rule,
now shows Momentary in its neutral trace colour. That is the intended reading: no rule judges the
metric, so the bar says nothing about it.
