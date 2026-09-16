# Spectrum channel overlay (M/S + L/R) — design

Date: 2026-06-15
Status: Approved, ready for plan

## Background

The spectrum analyzer emits **one** curve (`smooth_db` + `peak_db`) over a fixed log
grid. Multichannel input is handled by `push_selected` (`src-tauri/src/dsp/spectrum.rs`):
the user picks **one** `SpectrumChannelSel` — a `Pair(x,y)` (the two channels **averaged**
into one curve) or a `Single(c)`. So today you can only ever view one curve at a time, and
a `Pair` only gives you the *average*; there is no way to see the two channels split, and no
way to see Mid/Side at all (M/S needs the `(L+R)`/`(L−R)` matrix, which neither `Pair`-average
nor `Single` can produce).

This is the "Item 6 — multichannel overlay" deferred item from the spectrum-multires-FFT work
(`memory/project-spectrum-multires-fft.md`), re-scoped after review.

## Scope decision (re-scoped from "per-channel overlay")

Overlaying every channel of a surround layout (6 curves for 5.1) was rejected: nobody reads
6 stacked curves, and viewing a single surround channel is already covered by channel-select.
The real value is **comparison of two things at once**, and specifically **M/S**, which is a
capability the current selector cannot produce at all.

**Item 6 = two-curve overlay, max 2 curves, ever.**

Two orthogonal axes:

- **Source group** — unchanged: `panelControls.spectrumChannel` (a `Pair` or a `Single`),
  built by `buildSpectrumChannelOptions` per layout (stereo / 5.1 / 7.1 / unknown).
- **View** — new: how to render the selected group.

### View modes (only meaningful for `Pair`)

| View       | Meaning                              | Curves | Banks |
|------------|--------------------------------------|--------|-------|
| `combined` | two channels averaged (= current)    | 1      | 1     |
| `lr`       | the two raw channels, overlaid       | 2      | 2     |
| `ms`       | M = (x+y)/2, S = (x−y)/2, overlaid   | 2      | 2     |

- `Single` selections (C, LFE) are always one curve; the view control is hidden/disabled.
- M/S and L/R apply to **any** `Pair`, including surround pairs (e.g. `Ls+Rs`). No special-case
  for the front L/R pair — it is just matrix math on the selected pair, which keeps the code
  uniform. The "surround mid/side" capability is niche but free.

### M/S scaling: `/2`

M = `(x+y)/2`, S = `(x−y)/2`.

Chosen so **M is bit-for-bit identical to the current `combined` curve** (which already averages
the pair). Toggling `combined` ↔ `ms` leaves the M curve perfectly still — best continuity — and
S sits on the same scale. A centered full-scale mono signal reads M ≈ 0 dBFS, S ≈ −∞ (silent),
matching M/S-meter expectations.

## Data model

- `panelControls.spectrumView: "combined" | "lr" | "ms"`, default `"combined"`, persisted
  alongside `spectrumChannel` (same uiStore / `normalizePanelControls` path).
- New IPC command `setSpectrumView(view)`, mirroring `setSpectrumChannel` (independent axis —
  not folded into the channel command).
- When the selection is a `Single`, view is treated as `combined` (one curve) regardless of the
  stored value; switching to a `Single` does not need to mutate the stored view.

## Engine (Rust)

- `SpectrumMeter` holds **up to 2 banks**. `combined`/`Single` → 1 bank (today's path);
  `lr` → bank_a fed raw x, bank_b fed raw y; `ms` → bank_a fed `(x+y)/2`, bank_b fed `(x−y)/2`.
- The view mode reaches the engine via `PcmContext` (alongside the existing `spectrum_channel`).
- `last_output` returns the primary curve plus an **optional** secondary curve; centers are shared
  (both banks use the same `LogGrid`).
- CPU is at most ×2, and only when the user actively selects `lr` or `ms`. Default `combined`
  carries zero extra cost.

## Payload shape — primary + optional secondary (chosen over a general array)

Since curves are hard-capped at 2 and carry clear primary/secondary semantics (M vs S, L vs R),
add **one optional secondary set** rather than a general N-curve array:

- Keep the existing single-curve fields as the **primary** curve.
- Add `spectrum_path_b: String` and `spectrum_smooth_db_b: Vec<f64>` (both empty in single-curve
  modes). `spectrum_band_centers_hz` is shared. Peak fields stay as-is (unused — see out of scope).

This is backward-compatible and grows the payload by zero in the common (`combined`) case.

## UI

- A three-segment view control (`Combined` / `L-R` / `M-S`) next to the existing channel dropdown,
  shown only when the selection is a `Pair`.
- A compact legend (panel top-right): `ms` → "Mid ● / Side ●"; `lr` → the pair's two channel
  labels (e.g. "L ● / R ●", or "Ls ● / Rs ●" for a surround pair).

## Hover / snapshot

- **Hover:** when a secondary curve is present, the HUD shows **two dB rows** (color-coded to the
  curves) at the hovered frequency; freq + note rows are shared. `computeSpectrumHoverIndex` is
  unchanged (shared centers); read one extra `dbListB[idx]`.
- **Snapshot / freeze:** snapshot captures both primary and secondary paths (`useSnapshot`
  extended). The selected/snap palette swaps the secondary curve to its `-snap-b` token.

## Colors

- Primary curve (M or L): existing `--ui-chart-spectrum-live` / selected `--ui-chart-spectrum-snap`.
- Secondary curve (S or R): **new theme tokens** `--ui-chart-spectrum-live-b` /
  `--ui-chart-spectrum-snap-b`, defined in both plvs-dark and plvs-light with a distinguishable hue.
  This token is required, not optional — two overlaid curves must be visually separable.

## Considered but out of scope

- **Per-channel (N>2) overlay** — rejected; comparison value is low and the screen becomes a mess.
- **Peak-hold display / wiring** — peak-hold is currently never rendered: `meter_pipeline.rs:290`
  passes `show_peak_hold = false` hard-coded, so `spectrum_peak_path` is always empty and
  `scales.js` `showPeakHold` is a dead config. (This means QW1's peak-hold defaults are invisible.)
  Fixing this wiring + adding a toggle belongs to the future UI-controls batch, not here. Overlay
  therefore shows **live curves only**, consistent with current behavior.
- **Configurable A4, freeze toggle, user slope/smoothing/resolution controls** — future UI-controls
  batch.
