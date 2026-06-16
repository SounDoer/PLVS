# Loudness Stats — Custom Metric Ordering

Date: 2026-06-16

## Problem

The Loudness Stats panel renders its metrics in a fixed order
(`LOUDNESS_STATS_ORDER` in `src/lib/panelControls.js`). Visibility is already
user-configurable via the header "Stats" multi-select popover, but display order
is not. Users want to arrange the visible metrics in whatever order suits their
monitoring workflow.

Note: today the displayed order comes from the fixed `allMetrics` order, **not**
from the `loudnessStatsVisibleIds` array order. Reordering therefore needs an
explicit source of truth.

## Decisions

- **Entry point:** reuse the existing header "Stats" multi-select popover
  (`MultiSelectChip` in `PanelHeaderControls.jsx`) — visibility and order live in
  one place.
- **Scope:** ordering applies to all 12 metrics, independent of visibility. Each
  metric keeps a stable rank; hiding then re-showing it returns it to its place.
- **Tech:** framer-motion `Reorder` (`Reorder.Group` / `Reorder.Item`).
  framer-motion is already a dependency (used in PeakPanel, LoudnessHistoryChart,
  SpectrumPanel, SettingsPanel), so this adds **zero new dependency** and matches
  existing animation conventions. dnd-kit was considered and rejected to avoid a
  new dependency for a single small list.
- **Reset:** a "Reset order" button in the popover restores
  `LOUDNESS_STATS_ORDER`.

## Data Model

In `src/lib/panelControls.js`:

- Add `loudnessStatsOrder`: a complete array of all 12 metric ids, the single
  source of truth for display order. Default = current `LOUDNESS_STATS_ORDER`.
- `loudnessStatsVisibleIds` is unchanged; it governs visibility only.
- Add normalization for `loudnessStatsOrder` in `normalizePanelControls`:
  dedupe, drop unknown ids, and **backfill any missing ids** at their default
  `LOUDNESS_STATS_ORDER` position (appended in default order). This guarantees
  the array is always the full set of 12 — important for older persisted data
  and for any future new metric.
- Add a default `loudnessStatsOrder` to `DEFAULT_PANEL_CONTROLS`.

## Rendering

In `src/components/panels/LoudnessStatsPanel.jsx`:

- Pull `loudnessStatsOrder` from `useAudioData()`.
- Build an `id → metric` map from `allMetrics`, sort by `loudnessStatsOrder`,
  then filter to visible ids.
- The panel rows stay read-only display — no drag inside the panel.

## Popover Interaction

In `MultiSelectChip` (`src/components/PanelHeaderControls.jsx`):

- Render all 12 items in `loudnessStatsOrder`.
- Wrap the list in `Reorder.Group axis="y"`; each row is a `Reorder.Item` with:
  - a drag handle (lucide `GripVertical`) on the left,
  - the existing visibility checkbox (keeps current `onToggle`),
  - the metric label.
- The handle drives reordering; `onReorder` writes the new order into
  `loudnessStatsOrder` via `onPanelControlsChange` + `normalizePanelControls`
  (the same persistence path as the existing visibility toggle).
- A "Reset order" button at the bottom sets `loudnessStatsOrder` back to
  `LOUDNESS_STATS_ORDER`.
- Under `useReducedMotion`, disable the drag animation (matches existing project
  convention).

## Testing

- `panelControls.test.js`: `normalizePanelControls` on `loudnessStatsOrder` —
  dedupe, backfill missing, drop unknown.
- `LoudnessStatsPanel.test.jsx`: renders in `loudnessStatsOrder`, including
  "hidden item does not affect the order of the rest".
- `PanelHeaderControls.test.jsx`: reorder callback writes the new order, Reset
  restores the default, visibility toggle still works.

## Out of Scope (YAGNI)

- Drag-to-reorder directly inside the panel.
- A reusable cross-panel ordering framework.
- Keyboard drag-to-reorder (checkbox toggling stays keyboard-accessible; only the
  pointer drag is mouse-oriented).
