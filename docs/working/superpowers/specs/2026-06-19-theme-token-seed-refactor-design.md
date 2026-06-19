# Theme Token Seed Refactor — Design

Date: 2026-06-19
Status: Approved design (pending implementation plan)

## 1. Background & Goals

PLVS currently ships **five** builtin themes (`plvs-dark`, `plvs-light`, `plvs-phosphor`,
`plvs-tungsten`, `plvs-abyss`). Each theme hand-fills a full color table, and the same hue is
copied across four chart tokens. dark/light meter colors live in `meterColorBridge.js` while the
three colored themes use `meterColorOverrides` — two storage mechanisms for the same kind of value.
`docs/design-tokens.md` has drifted from what the runtime actually writes, and several tokens
(`--ui-signal-corr-*`) are set but never consumed.

This refactor has three intentions, of which only the first two are in scope here:

1. **Delete the three preset themes** (`plvs-phosphor`, `plvs-tungsten`, `plvs-abyss`); keep
   `plvs-dark` and `plvs-light`.
2. **Regularize the design-token system**, then polish dark/light. *Structure first, visual polish
   second.*
3. *(Deferred — separate spec.)* Open the tokens up so users can design their own themes. Not built
   here, but the structure produced by step 2 must be able to support it.

**Order within step 2:** first regularize the token structure, then tune the dark/light visuals.

## 2. Scope

**In scope**
- Remove the three colored themes and everything that exists only to serve them.
- Introduce a **seed → derive** color model for the instrument world (`--ui-*`).
- Move non-color chart geometry out of per-theme data into global layout data.
- Delete dead tokens; unify token naming; rewrite `docs/design-tokens.md`.
- Make dark/light theme objects symmetric under the new model.
- Migrate persisted theme ids that point at a deleted theme.

**Out of scope (deferred to the phase-3 spec)**
- User-facing custom-theme editor, importing community shadcn presets, the accent/primary
  collision rule, user-swappable colormap presets.
- Reusing the colormap on vectorscope/spectrum (registered as a future idea only).
- Whether Short-term (ST) switches from a same-family sibling to the secondary accent — this is a
  **visual-polish** taste call made in the polish sub-phase against real renders, not a structural
  decision. Structurally ST stays an accent-derived sibling for now.

## 3. The Two-Color-World Model (approach 甲)

PLVS UI color splits into two worlds with different ownership:

- **Shell world** — shadcn semantic tokens (`--background`, `--card`, `--foreground`, `--muted`,
  `--border`, `--primary`, `--ring`, …). These are consumed by off-the-shelf shadcn components and
  follow shadcn convention. **Kept explicit per theme** (not seed-derived), so PLVS stays compatible
  with the shadcn ecosystem (community themes can be pasted in during phase 3, online editors,
  component upgrades).
- **Instrument world** — PLVS-only `--ui-*` tokens (meters, vectorscope, spectrum, loudness,
  correlation, peak). **Fully derived from seeds.**

**`accent` is the only bridge:** one seed value feeds both the shell `--primary`/`--ring` and every
live instrument trace, keeping brand button and chart traces in lockstep.

**No `overrides` escape hatch.** The data model does not carry per-token overrides. If derivation
can't produce a needed color, we fix the derivation or add a seed — we do not patch. (Goal: zero
overrides. With only dark/light remaining, the derivation surface is small and this is achievable.)

**Each theme stores its own seed values.** We do **not** derive light from dark. dark and light each
carry a hand-tuned seed set; derivation only operates *within* a theme (seed → its children).

## 4. Color Model

A theme's color definition is:

```
theme = {
  // chromatic seeds (instrument world)
  accent,                       // brand hue; e.g. dark #fb923c
  accentSecondary,              // second distinguishing hue (renamed from spectrumB); e.g. dark #38bdf8
  signal: { good, warn, bad },  // green / amber / red

  // intensity colormap (its own color object, not seed-derived)
  colormap,                     // ordered list of stops for area/magnitude visuals (spectrogram)

  // shell world (explicit shadcn semantic block)
  shell: { background, foreground, card, ..., primary, ring, ... },

  colorScheme,                  // "dark" | "light"
}
```

### 4.1 Seeds and what they derive

| Seed | Derives (instrument world) |
|------|----------------------------|
| `accent` | shell `--primary`/`--ring`; all live traces (momentary, vectorscope, spectrum primary, waveform); **snap family** (momentary-snap, vectorscope-snap, spectrum-snap, selection); **over family** (momentary-over, shortterm-over); **ST sibling** (shortterm, shortterm-snap); peak-sample; metric-toggle label/border/bg/glow |
| `accentSecondary` | spectrum secondary trace live + snap (`--ui-chart-spectrum-live-b` / `-snap-b`); derived with the **same transforms as `accent`** (symmetric) |
| `signal.good/warn/bad` | meter gradient bottom/mid/top; peak-true; TP-max-exceeded; correlation red/green (reused, not separate) |

Neutrals that are **not** seeds: correlation's neutral, grid lines, and metric-row tints derive from
the shell / scheme:
- correlation mid (if ever rendered) and other neutral text → `--muted-foreground`.
- grid / diagonal / history grid lines → `color-mix` from `--border`.
- metric-row bg/hover → scheme-derived neutral overlay (white-alpha on dark, black-alpha on light).

### 4.2 Derivation transforms (approach 甲 — real functions)

Derivation is implemented as **OKLCH transforms**, not hand-stored child values, so changing one seed
cascades. Transforms are **scheme-aware** because the same intent flips direction by mode:

- **snap** — the "selected/frozen" family. Intent: *raise contrast against the background and shift
  toward gold.* dark → lighter, light → darker. (Anchors: dark accent `#fb923c` → snap `#fcd34d`;
  light accent `#e07020` → snap `#b76b00`.)
- **over** — the over-reference "hotter" family. Intent: *push toward hot red, raise chroma.*
  (Anchor: dark `#fb923c` → over `#ff5a1f`.)
- **sibling (ST)** — Short-term relative to Momentary. Intent: *same family, reduced lightness/chroma*
  so it reads as a sibling, distinguished further by stroke width. (Anchor: dark `#fb923c` →
  `#c66a2a`.)

The transforms are a small set of **named OKLCH delta constants** shared across themes and applied to
each theme's own seeds. **Exact magnitudes are tuned in the visual-polish sub-phase** so that both
dark and light land on good-looking results; the anchors above are the current values to match as a
starting point. If a transform can't satisfy both themes, the fix is to adjust the seed or the
transform — never to add a per-token override.

### 4.3 Colormap (approach 乙 — per-theme)

The spectrogram is a time–frequency **heatmap**: a magnitude→color object that a single accent cannot
express. It is therefore its own per-theme field, an explicit ordered list of stops (like the shell
block, **not** seed-derived). It does not add to derivation complexity.

- This round: the colormap drives the **spectrogram only**.
- Each theme's colormap should **harmonize with that theme's accent** (e.g. dark runs through a warm
  black→deep-red→orange→bright-yellow ramp that sits naturally with the orange accent; light uses a
  lighter ramp). The current Inferno ramp is the dark starting point.
- **Discipline:** the colormap is only for *area/density* visuals. It must never be applied to 1D
  brand lines/bars/vector traces — those stay in the accent/signal language to preserve brand
  coherence.
- Deferred: user-swappable colormap presets (viridis/magma/…) and reuse on vectorscope-density or
  spectrum-fill. The field shape leaves room for these later.

### 4.4 Full instrument-color coverage (audit)

Every consumed `--ui-*` color maps cleanly:

- accent + its transforms → spectrum live/snap, vectorscope live/snap, momentary/snap/over,
  shortterm/over, selection, waveform, peak-sample, metric toggle.
- accentSecondary → spectrum live-b/snap-b.
- signal → meter gradient, peak-true, tp-max.
- shell/scheme-derived neutrals → grid lines, vector diagonal, history grid, metric-row tints.
- colormap → spectrogram.

Color model = **3 chromatic seeds + 1 per-theme colormap + scheme/shell-derived neutrals.**

## 5. Structure Cleanups

- **Delete dead tokens** `--ui-signal-corr-bad` / `-mid` / `-good` (set but never consumed). There is
  no correlation neutral-gray concept after this.
- **Move dark/light meter colors** out of `meterColorBridge.js` into the theme model; delete the
  `meterColorOverrides` mechanism along with the three colored themes. `meterColorBridge.js` is
  removed (its dark/light values become derived from `signal` + scheme).
- **Move non-color chart geometry to global** layout data (`data.js` / `applyLayoutToDocument`):
  `strokeWidth`, `fillOpacity`, `axisOpacity`, `plotRadius`, `gridDiagDash`, `gridDiagInsetPct`,
  `shortTermOpacity`, etc. After this, **a theme owns color only** (seeds + colormap + shell +
  scheme). These geometry values are currently near-identical across themes, confirming they are not
  theme concerns.
- **Unify token naming.** Collapse the abbreviated `--ui-lh-*` / `--ui-vs-*` / `--ui-sp-*` namespaces
  and the full `--ui-chart-*` namespace into a single consistent convention. (Exact final convention
  decided in the plan; the principle is one namespace for chart-domain tokens.)
- **Rewrite `docs/design-tokens.md`** to match the runtime exactly: document the seed model, the
  derivation transforms, the colormap, the explicit shell block, and the complete token inventory.

## 6. Theme Deletion & Migration (step 1)

Remove `plvs-phosphor`, `plvs-tungsten`, `plvs-abyss` and everything that exists only for them:

- `BUILTIN_THEMES`, `THEME_IDS`, `THEME_SELECT_OPTIONS`, the `ThemeId` typedef.
- The `PLVS_SEMANTIC_PHOSPHOR/TUNGSTEN/ABYSS` presets and their `CHARTS_*`, `METER_GRADIENT_*`,
  `METER_COLOR_OVERRIDES_*` blocks.
- `meterColorOverrides` field and `meterColorBridge.js` (per §5).
- ADRs / docs that enumerate the five themes (update, don't silently drop history).
- Tests referencing removed ids.

**Migration:** a persisted theme id pointing at a deleted theme must fall back to `DEFAULT_THEME_ID`
(`plvs-dark`) on load. `getBuiltinTheme` already falls back for unknown ids; confirm the persistence
read path resolves through it (or normalizes the stored id) so a user previously on Phosphor lands on
Dark without an error. Add a test for this.

## 7. Testing

- `buildThemeTokens(theme)` (the derivation): unit tests asserting each seed produces the expected
  token set, snap/over/sibling direction is correct per scheme, and **no token is left unset**.
- Snapshot/equivalence guard: for the polish phase, a test that dark's derived values match the
  intended anchor set (so a refactor doesn't silently shift colors).
- Deleted-theme migration test (§6).
- Existing theme tests updated for the two-theme world and the renamed `accentSecondary`.
- `npm run check` must pass (format + lint + test + build + version + Rust fmt/clippy/test).
- `npm run theme:generate` regenerates `src/generated/theme-fallbacks.css` from the new dark semantic
  (prebuild runs it; verify first-paint output).

## 8. Deferred / Future (not this round)

- Phase 3: custom-theme editor, community shadcn preset import + accent/primary collision rule,
  user-swappable colormap presets.
- ST sibling vs secondary-accent (polish-phase taste call).
- Colormap reuse on vectorscope-density / spectrum-fill.

## 9. Open Items Folded Into the Plan

- Exact final token naming convention for the unified chart namespace.
- Exact OKLCH delta magnitudes for snap/over/sibling (tuned in the visual-polish sub-phase to the
  §4.2 anchors).
- Exact dark/light colormap stop lists (visual-polish sub-phase).
