# ADR 0011: Theme-owned bounded visual tuning

## Status

Accepted

## Context

ADR 0005 deliberately limited Theme V2 to colours and left panel opacity and other product tuning
outside themes. That boundary remains correct for structural surface transparency, layout,
typography, geometry, measurement thresholds, and analysis settings.

Some renderer values are nevertheless part of a theme's visual composition rather than product
behaviour. Spectrum's area-fill gradient is the first such case: its opacity determines how the
theme's data colour combines with its plot surface. Keeping it in global preferences means a saved
theme cannot preserve that composition, while encoding alpha in the data colour would weaken the
line trace and every other consumer of the same role.

## Supersession

This ADR supersedes ADR 0005 only where it says that all opacity and all non-colour values remain
outside themes. ADR 0005 continues to govern the rest of the Theme V2 authoring, compiler, runtime,
and migration contract.

## Decision

The Theme Role Registry may define a bounded numeric role when all of the following are true:

- the value controls visual composition whose appropriate result depends on the theme;
- it does not change layout, measurement meaning, analysis, or interaction behaviour;
- the role has a stable ID, explicit default, finite bounds, step, unit, and consumer binding;
- it is compiled, previewed, persisted, and transferred through the ordinary Theme pipeline; and
- it is exposed as a curated Advanced control rather than an arbitrary settings bag.

Numeric overrides use the sparse authoring shape `{ kind: "number", value }`. The compiler owns
range and cross-role validation, and the editor presents the role in its owning module section.
Reset to Auto removes the override and restores the registry default.

Spectrum introduces the first two roles:

| Role                         | Default | Range  | Step | Binding                             |
| ---------------------------- | ------- | ------ | ---- | ----------------------------------- |
| `spectrum.fillOpacityTop`    | 20%     | 0–100% | 1%   | `--ui-spectrum-fill-top-opacity`    |
| `spectrum.fillOpacityBottom` | 2%      | 0–100% | 1%   | `--ui-spectrum-fill-bottom-opacity` |

The lower value must not exceed the upper value. Primary, Secondary, and Snapshot Spectrum fills
share this gradient. Stereo Map and Waveform fill opacity remain independent product-tuning values
until each is separately judged to be theme-owned.

Structural `surfaceOpacity`, Glass strength, modal scrims, layout geometry, stroke widths,
measurement thresholds, and frequency split settings remain outside themes.

## Consequences

- A custom Theme can preserve the intended balance between Spectrum trace, fill, and background.
- Draft preview, cross-window publication, portable Theme transfer, and generated first-paint CSS
  use one registry/compiler path for the values.
- The Theme compiler and registry now support an explicit `number` value kind in addition to colour
  value kinds.
- Future numeric roles require the same ownership test and explicit registry metadata; this is not
  permission to move general preferences into Theme documents.
