# Panel Labels: Structural Alignment & Responsive Compact Behavior

**Date:** 2026-05-19  
**Scope:** `PeakPanel`, `VectorscopePanel` — channel labels, TP MAX footer, CORRELATION footer

---

## Problem

Two independent issues with label implementation under the bento workspace layout:

1. **Magic number spacers** — `--ui-tp-info-left-blank` (5.4rem) and `--ui-corr-info-left-blank` (4rem) are hardcoded values not derived from the actual layout structure. They break silently if tick column width or panel padding change.

2. **No compact behavior** — panels can be resized to any width in the bento layout (PeakPanel minimum: 140px). At narrow widths, channel labels, TP MAX, and CORRELATION text overflow or become unreadable. The `compact` prop exists on both components but is never used.

---

## Design

### Part 1: Structural Alignment (remove magic numbers)

**PeakPanel — TP MAX footer spacer**

Replace the hardcoded `--ui-tp-info-left-blank` spacer with an inline `calc()` that derives the offset from actual layout variables:

```jsx
<div
  className="shrink-0"
  style={{ width: "calc(var(--ui-w-peak-ticks) + var(--ui-peak-axis-chart-gap))" }}
/>
```

This keeps the "TP MAX" label aligned to the left edge of the chart column regardless of tick column width changes.

**VectorscopePanel — CORRELATION footer spacer**

Vectorscope has no tick column, so the spacer has no structural basis. Remove it entirely. The footer becomes flush-left, consistent with the panel padding.

**Cleanup**

Remove `tpInfoLeftBlank` and `corrInfoLeftBlank` from `UI_PREFERENCES` (`src/preferences/data.js`) and the corresponding `setCssVar` calls in `applyDocumentTheme.js`. Remove the `--ui-tp-info-left-blank` and `--ui-corr-info-left-blank` CSS vars from the document.

---

### Part 2: Responsive Compact Behavior (container queries)

Tailwind v4 is in use — container queries are supported natively.

**Mechanism:** Add `@container` to the root div of each panel component. Use `@max-[220px]:hidden` (or similar threshold) on label elements to hide them when the panel is too narrow.

**PeakPanel**

- Root div: add `@container`
- Channel bar labels (`c.label` + `fmt(c.valueDb)` div): add `@max-[220px]:hidden`
- TP MAX footer row: add `@max-[220px]:hidden`

Threshold of 220px chosen because below this width, individual channel bars with multiple channels have too little horizontal space to render readable text. The meter fill animation and hold line remain visible at all widths.

**VectorscopePanel**

- Root div: add `@container`
- CORRELATION footer row: add `@max-[220px]:hidden`
- Corner labels (`axisXLabel`, `axisYLabel`): no change for now — they sit in opposite corners of the chart and only collide at extreme narrowness. Revisit if the issue surfaces.

**Threshold values**

Both panels use 220px as the initial threshold. This is a starting point to be tuned visually. The value is not derived from a formula — it reflects the practical minimum width where footer text is still readable alongside the chart.

---

### Part 3: Remove unused `compact` prop

The `compact` prop on both `PeakPanel` and `VectorscopePanel` was placeholder API, never wired to any behavior. With container queries handling responsive display, the prop is no longer needed.

- Remove `compact` parameter from both component signatures
- Remove `compact={false}` from `LeafView` (where `<ActiveComponent compact={false} />` is rendered)
- Update the `MODULE_REGISTRY` type annotation in `registry.jsx` to drop `compact` from the component type

---

## Files Changed

| File | Change |
|------|--------|
| `src/preferences/data.js` | Delete `tpInfoLeftBlank`, `corrInfoLeftBlank` |
| `src/preferences/applyDocumentTheme.js` | Delete two `setCssVar` calls for the removed vars |
| `src/components/panels/PeakPanel.jsx` | Add `@container`; replace spacer with calc; add `@max-[220px]:hidden` to label div and footer; remove `compact` prop |
| `src/components/panels/VectorscopePanel.jsx` | Add `@container`; remove footer spacer div; add `@max-[220px]:hidden` to CORRELATION footer; remove `compact` prop |
| `src/workspace/LeafView.jsx` | Remove `compact={false}` from `<ActiveComponent />` render |
| `src/workspace/registry.jsx` | Update `Component` type annotation to remove `compact` param |

---

## Out of Scope

- SpectrumPanel, SpectrogramPanel, LoudnessPanel — not affected; they have no similar spacer pattern
- Vectorscope corner label collision at extreme narrowness — deferred
- Dynamic threshold computation based on channel count — not needed; 220px covers the practical range
