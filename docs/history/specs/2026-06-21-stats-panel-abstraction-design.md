# Stats Panel Abstraction — From Loudness Stats to Cross-Domain Readouts

**Date:** 2026-06-21
**Status:** Draft

## Summary

Evolve the existing "Loudness Stats" panel into a general **Stats** panel that
holds scalar readouts from any analysis domain — not just loudness. In v1 the
panel keeps its scrollable, user-orderable, user-toggleable list of
`label + value + unit` rows, but the data source is abstracted behind a single
metric catalog, and two readouts from other domains are added:

- **True Peak** (Level domain) — `dBTP`
- **Correlation** (Spatial domain) — unitless

This mirrors the earlier Peak → Level Meter move: the user-facing surface gains
broader meaning while module id, file names, and persistence keys stay put to
avoid a storage/preset migration.

## Motivation

The Loudness Stats panel is already a generic "list of scalar readings" surface;
only its data happened to be loudness-only. Once it shows True Peak or
Correlation, the name "Loudness Stats" is misleading. Renaming the surface to
**Stats** and abstracting the data assembly into a catalog lets future domains
(e.g. spectrum-derived scalars) plug in by touching one module, not the panel.

## Decisions (from brainstorming)

| Dimension       | Decision |
|-----------------|----------|
| Data shape      | Scalar readouts only (`label + value + unit`) — fits the existing `MetricRow`. |
| Organization    | Flat list. **No explicit grouping UI. No per-row source label or icon.** |
| Default order   | A canonical, domain-clustered order constant. Reset follows it. |
| Naming          | User-facing title `Loudness Stats` → **`Stats`**. Module id stays `loudnessStats`. |
| v1 data         | True Peak + Correlation. **No new DSP.** |
| Default visibility | New readouts **hidden by default**; reset keeps the existing loudness default set. |
| Assembly        | Single metric-catalog module; hook exposes one merged `statsMetrics` array. |

## Product Behavior

### Title

The module registry title for `loudnessStats` becomes:

```txt
Stats
```

The panel header follows the registry title.

### Rows

Rows stay exactly as today: `label` (muted), `value` (mono, emphasized),
`unit` (muted). No source tag, no icon, no grouping headers. The implicit
domain grouping is expressed solely through the default order.

### New readouts

Two rows are added to the catalog:

- `truePeak` — `{ label: "True Peak", unit: "dBTP" }`, value from
  `displayAudio.tpMax`.
- `correlation` — `{ label: "Correlation", unit: "" }`, value from the live
  frame `correlation`.

Both are **available in the visibility picker but hidden after a reset**.

## Data Architecture

Introduce a single source of truth for stat readouts.

### New module: `src/lib/statsCatalog.js`

Pure functions + constants. No React.

- `STATS_META` — extends the current 12 loudness entries with `truePeak` and
  `correlation`. Each entry stays `{ label, unit, hint }`. **No `source` field
  is added** — grouping lives only in the order constant below.
- `STATS_CANONICAL_ORDER` — the domain-clustered default order:
  `[...existing 12 loudness ids, "truePeak", "correlation"]`.
  (Loudness cluster → Level cluster → Spatial cluster.)
- `STATS_OPTIONS` — derived `{ id, label, hint }[]` for the visibility/reorder
  picker (replaces `LOUDNESS_STATS_OPTIONS`).
- `buildStatsMetrics(displayAudio, frame)` — returns a single
  `{ id, label, value, unit, hint }[]` in catalog order. This absorbs the metric
  assembly currently split across the `primaryMetrics` and `secondaryMetrics`
  memos in `useLoudnessHistory`, and adds the True Peak and Correlation rows.

### `panelControls.js`

Re-point the existing loudness-stats constants at the catalog to remove the
duplicate source of truth:

- `LOUDNESS_STATS_META` / `LOUDNESS_STATS_ORDER` / `LOUDNESS_STATS_OPTIONS`
  become re-exports of (or thin wrappers over) the `statsCatalog` equivalents.
- Persistence key names (`loudnessStatsVisibleIds`, `loudnessStatsOrder`) are
  **unchanged**.

### `useLoudnessHistory.js`

- Replace the `primaryMetrics` + `secondaryMetrics` memos with one
  `statsMetrics` memo backed by `buildStatsMetrics(...)`.
- Return `statsMetrics` instead of the two arrays.

### Consumers

`primaryMetrics`/`secondaryMetrics` are only ever consumed by concatenation in
`LoudnessStatsPanel` (`[...primaryMetrics, ...secondaryMetrics]`); `App.jsx` just
forwards them into `AudioDataContext`. Merge is lossless:

- `App.jsx` — forward `statsMetrics` into the context value.
- `LoudnessStatsPanel.jsx` — read `statsMetrics` directly; drop the concat.
- Test fixtures that set `primaryMetrics: []` / `secondaryMetrics: []`
  (`PanelHeaderControls.test.jsx`, `LoudnessStatsPanel.test.jsx`) move to
  `statsMetrics: [...]`.

## Default Order & Visibility

- `DEFAULT_PANEL_CONTROLS.loudnessStatsOrder` = `[...STATS_CANONICAL_ORDER]`.
- `DEFAULT_PANEL_CONTROLS.loudnessStatsVisibleIds` — **unchanged** (the existing
  8 loudness ids). `truePeak` and `correlation` are therefore hidden after a
  reset.
- Migration: persisted orders from older versions won't contain `truePeak` /
  `correlation`. `normalizeOrder` must append any canonical id missing from the
  stored order to the tail (verify current behavior; adjust if it drops or
  reorders unknown-but-canonical ids).

## Scope Boundary

In scope:

- Registry title `Loudness Stats` → `Stats`.
- New `statsCatalog.js`; merge to single `statsMetrics`.
- Add True Peak + Correlation rows (default hidden).
- Canonical domain-clustered default order.

Out of scope:

- Explicit grouping UI or group headers.
- Per-row source label / icon.
- Any new DSP, including spectrum-derived scalars (centroid, peak frequency).
- Renaming module id, file names (`LoudnessStatsPanel.jsx`), or persistence keys.
- Multi-instance workspace behavior.

## Testing Notes

- `buildStatsMetrics` returns rows including `truePeak` (dBTP, from `tpMax`) and
  `correlation` (unitless, from frame), in canonical order.
- `correlation`'s empty unit renders cleanly in the unit column.
- Module registry title for `loudnessStats` is `Stats`.
- After reset, `loudnessStatsVisibleIds` is still the existing 8 loudness ids;
  `truePeak`/`correlation` are present in `STATS_OPTIONS` but not visible.
- A persisted order lacking `truePeak`/`correlation` normalizes to append them
  at the tail.
- `LoudnessStatsPanel` renders from a single `statsMetrics` array.
