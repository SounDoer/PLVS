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
- **Every metric carries a hover tip** (a short plain-language explanation),
  rendered with a **shadcn/Radix `Tooltip`** so it follows the app theme, supports
  keyboard focus, and has a controllable delay. Adds a new `ui/tooltip.jsx`
  component and the `@radix-ui/react-tooltip` dependency (consistent with the
  existing Popover/Select primitives already in use).
- **Single source of truth** for label/unit/hint, so panel and picker can never
  drift again.

### New labels + hints (panel + picker)

| id | Label | unit | hint (`title`) |
|----|-------|------|----------------|
| `momentary` | Momentary | LUFS | Loudness over a 400ms window |
| `shortTerm` | Short-term | LUFS | Loudness over a 3s window |
| `integrated` | Integrated | LUFS | Loudness over the whole program, gated below −70 LUFS |
| `momentaryMax` | Momentary Max | LUFS | Highest Momentary (400ms) loudness reached so far |
| `shortTermMax` | Short-term Max | LUFS | Highest Short-term (3s) loudness reached so far |
| `lra` | Loudness Range | LU | LRA, loudness range over the whole program |
| `psr` | Short-term Dynamics | dB | PSR, Peak to Short-term loudness Ratio |
| `plr` | Integrated Dynamics | dB | PLR, Peak to Loudness Ratio |
| `dialogueCoverage` | Dialogue Coverage | % | Share of time dialogue is detected |
| `dialogueIntegrated` | Dialogue Integrated | LUFS | Loudness over dialogue only |
| `dialogueRange` | Dialogue Range | LU | Loudness range over dialogue only |
| `dialogueOffset` | Dialogue Offset | LU | Dialogue loudness relative to the overall mix |

Naming notes:

- `Short-term Dynamics` / `Integrated Dynamics` mirror the existing
  `Short-term` / `Integrated` LUFS rows, and are technically accurate (PSR uses
  short-term loudness; PLR uses integrated loudness).
- `lra` / `psr` / `plr` hints lead with the abbreviation (`LRA,` / `PSR,` / `PLR,`)
  since the label no longer shows it.
- Dialogue hints say "dialogue" (product framing) for consistency with the labels,
  though the detector is a generic speech/voice VAD.

## Design

### Registry (single source of truth) — `src/lib/panelControls.js`

```js
export const LOUDNESS_STATS_META = {
  momentary:    { label: "Momentary",           unit: "LUFS", hint: "Loudness over a 400ms window" },
  shortTerm:    { label: "Short-term",          unit: "LUFS", hint: "Loudness over a 3s window" },
  integrated:   { label: "Integrated",          unit: "LUFS", hint: "Loudness over the whole program, gated below −70 LUFS" },
  momentaryMax: { label: "Momentary Max",       unit: "LUFS", hint: "Highest Momentary (400ms) loudness reached so far" },
  shortTermMax: { label: "Short-term Max",      unit: "LUFS", hint: "Highest Short-term (3s) loudness reached so far" },
  lra:          { label: "Loudness Range",      unit: "LU",   hint: "LRA, loudness range over the whole program" },
  psr:          { label: "Short-term Dynamics", unit: "dB",   hint: "PSR, Peak to Short-term loudness Ratio" },
  plr:          { label: "Integrated Dynamics", unit: "dB",   hint: "PLR, Peak to Loudness Ratio" },
  dialogueCoverage:   { label: "Dialogue Coverage",   unit: "%",    hint: "Share of time dialogue is detected" },
  dialogueIntegrated: { label: "Dialogue Integrated", unit: "LUFS", hint: "Loudness over dialogue only" },
  dialogueRange:      { label: "Dialogue Range",      unit: "LU",   hint: "Loudness range over dialogue only" },
  dialogueOffset:     { label: "Dialogue Offset",     unit: "LU",   hint: "Dialogue loudness relative to the overall mix" },
};
```

- A canonical order array drives both the picker order and the existing id set.
- `LOUDNESS_STATS_OPTIONS` (picker source) is derived from the registry and now
  carries `{ id, label, hint }`.
- `DEFAULT_PANEL_CONTROLS` and `LOUDNESS_STATS_IDS` continue to work off the same
  id list.

### Tooltip component

- Add via `npx shadcn@latest add tooltip` → generates `src/components/ui/tooltip.jsx`
  (`Tooltip`, `TooltipTrigger`, `TooltipContent`, `TooltipProvider`) and installs
  `@radix-ui/react-tooltip`.
- Mount a single `TooltipProvider` at the app root with a shared `delayDuration`
  (~300ms) so every tip behaves consistently.
- `TooltipContent` already themes via the shadcn CSS variables, so plvs-dark /
  plvs-light are picked up automatically.

### Consumers

- **Panel** — `useLoudnessHistory`: each metric object spreads
  `...LOUDNESS_STATS_META[id]` (label + unit + hint) and supplies only the live
  `value`. The hook keeps its per-id value logic (each value has a distinct source).
- **Panel row** — `LoudnessStatsPanel` `MetricRow`: wrap the row in
  `<Tooltip><TooltipTrigger asChild>…row…</TooltipTrigger><TooltipContent>{hint}</TooltipContent></Tooltip>`.
- **Picker** — `PanelHeaderControls` `MultiSelectChip`: wrap each option button the
  same way. The picker lives inside a Radix `Popover`; `TooltipContent` portals out,
  and is placed `side="left"` to avoid overlapping the open popover.

## Testing

Radix tooltips only mount their content on hover/focus and are unreliable to assert
in jsdom, so coverage targets the wiring rather than the rendered bubble:

- `panelControls.test.js` — assert registry shape and derived `LOUDNESS_STATS_OPTIONS`
  (order, labels, every entry carries a non-empty `hint`). This is the real
  single-source-of-truth guard.
- `LoudnessStatsPanel.test.jsx` — update the three changed labels; assert all visible
  rows still render their label (tooltip trigger wrapping doesn't break rendering).
- `PanelHeaderControls.test.jsx` — update the three changed picker labels; assert the
  picker still lists every option.

## Out of scope

- Replacing the existing native-`title` tooltips elsewhere (`MeterHealthBadge`,
  metering footnotes) — leave as-is.
- Any change to value computation, units math, or the loudness DSP.
