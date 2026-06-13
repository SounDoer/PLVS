# Loudness Stats — unified labels + hover hints

**Date:** 2026-06-13
**Status:** Approved design, pending implementation

## Problem

Three derived loudness metrics are labeled inconsistently between the stats panel
and the picker, and their meaning is opaque:

| id | Panel label (now) | Picker label (now) |
|----|-------------------|--------------------|
| `lra` | Loudness Range (LRA) | LRA |
| `psr` | Dynamics (PSR) | PSR |
| `plr` | Avg. Dynamics (PLR) | PLR |

Issues raised:

1. Panel and picker labels diverge (a recurring drift — `dialogueRange` was just
   hand-synced across both files).
2. Bare three-letter abbreviations (`LRA`/`PSR`/`PLR`) are unclear to non-experts.
3. `Dynamics` / `Avg. Dynamics` don't convey the time scale and don't expand the
   abbreviation.
4. Pure abbreviations also clash with every other metric, which uses plain words
   (Momentary, Short-term, Integrated…).

## Decisions

- **Inline label = plain-language words**, consistent with the other metrics.
  Same label in panel and picker.
- **Hover tip carries the abbreviation + a one-line explanation**, via the native
  `title` attribute (the established tooltip pattern in this codebase —
  `MeterHealthBadge`, `meteringFootnoteHints`). No new component or dependency.
- **Single source of truth** for label/unit/hint, so panel and picker can never
  drift again.

### New labels (panel + picker)

| id | Label | unit | hint (`title`) |
|----|-------|------|----------------|
| `lra` | Loudness Range | LU | `LRA · Loudness Range — spread between the quietest and loudest sustained passages (EBU R128). Unit: LU.` |
| `psr` | Short-term Dynamics | dB | `PSR · Peak to Short-term loudness Ratio — headroom between true peak and short-term loudness; higher = more dynamic. Unit: dB.` |
| `plr` | Integrated Dynamics | dB | `PLR · Peak to Loudness Ratio — headroom between true peak and integrated (whole-program) loudness. Unit: dB.` |

`Short-term Dynamics` / `Integrated Dynamics` mirror the existing
`Short-term` / `Integrated` LUFS rows, and are technically accurate (PSR uses
short-term loudness; PLR uses integrated loudness).

Only these three carry a hint. The other nine metrics have no `hint` and render no
tooltip (dialogue hints can be added later by filling the same field).

## Design

### Registry (single source of truth) — `src/lib/panelControls.js`

```js
export const LOUDNESS_STATS_META = {
  momentary:    { label: "Momentary",           unit: "LUFS" },
  shortTerm:    { label: "Short-term",          unit: "LUFS" },
  integrated:   { label: "Integrated",          unit: "LUFS" },
  momentaryMax: { label: "Momentary Max",       unit: "LUFS" },
  shortTermMax: { label: "Short-term Max",      unit: "LUFS" },
  lra:          { label: "Loudness Range",      unit: "LU",   hint: "LRA · …" },
  psr:          { label: "Short-term Dynamics", unit: "dB",   hint: "PSR · …" },
  plr:          { label: "Integrated Dynamics", unit: "dB",   hint: "PLR · …" },
  dialogueCoverage:   { label: "Dialogue Coverage",   unit: "%"    },
  dialogueIntegrated: { label: "Dialogue Integrated", unit: "LUFS" },
  dialogueRange:      { label: "Dialogue Range",      unit: "LU"   },
  dialogueOffset:     { label: "Dialogue Offset",     unit: "LU"   },
};
```

- A canonical order array drives both the picker order and the existing id set.
- `LOUDNESS_STATS_OPTIONS` (picker source) is derived from the registry and now
  carries `{ id, label, hint }`.
- `DEFAULT_PANEL_CONTROLS` and `LOUDNESS_STATS_IDS` continue to work off the same
  id list.

### Consumers

- **Picker** — `PanelHeaderControls` `MultiSelectChip`: each option button gets
  `title={option.hint}`.
- **Panel** — `useLoudnessHistory`: each metric object spreads
  `...LOUDNESS_STATS_META[id]` (label + unit + hint) and supplies only the live
  `value`. The hook keeps its per-id value logic (each value has a distinct source).
- **Panel row** — `LoudnessStatsPanel` `MetricRow`: render `title={hint}` on the
  row container. `title={undefined}` for metrics without a hint is a no-op.

## Testing

- `panelControls.test.js` — assert registry shape and derived `LOUDNESS_STATS_OPTIONS`
  (order, labels, presence of hints on `lra`/`psr`/`plr` only).
- `LoudnessStatsPanel.test.jsx` — update the three changed labels; assert the row
  exposes the `title` for a hinted metric.
- `PanelHeaderControls.test.jsx` — update the three changed picker labels; assert a
  picker item exposes the `title`.

## Out of scope

- Hints for the dialogue metrics (field is ready; fill later if wanted).
- Any change to value computation, units math, or the loudness DSP.
