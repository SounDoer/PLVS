# Stereo Map — Design

**Date:** 2026-07-25  
**Status:** Draft for owner review  
**Depends on:** `2026-07-25-shared-spectral-engine-design.md`

## Summary

Add a frequency-domain stereo-analysis panel named **Stereo Map**. It answers where
each frequency region is positioned, how correlated the selected channel pair is,
how much phase cancellation mono fold-down introduces, and whether Mid or Side
energy dominates.

Stereo Map is an independent Workspace panel and Dock module. It supports live
capture, file analysis, visual history, and snapshot. It remains read-only and never
filters, solos, routes, or modifies audio.

## Product goals

- Locate stereo-position and mono-compatibility issues by frequency.
- Present four related measurements as one single-select Mode control.
- Use terms and interactions consistent with Spectrum and Vectorscope.
- Keep low-energy bands from displaying confident but meaningless ratios.
- Make short-lived extremes discoverable through a shared Hold toggle.
- Reuse one analysis result across matching Workspace and Dock instances.
- Preserve PLVS's full-resolution history and explicit no-backfill semantics when
  an Analysis Key is inactive.
- Reconstruct every Mode from one retained set of spectral primitives.

## Non-goals

- Reproducing SPL HawkEye numerically or visually.
- Claiming an industry-standard certified stereo measurement.
- Adding band-pass audition, solo, correction, or any audio processing.
- Showing multiple modes at once.
- Treating M/S Ratio as a universal stereo-width score.
- Linking frequency ranges across panels in this phase.
- Adding Coherence, phase angle, group delay, or inter-channel delay.
- Supporting a fabricated stereo pair for mono input.

## Naming and placement

- Product and module name: `Stereo Map`.
- Description/help text: `A frequency-domain stereo analyzer.`
- The title does not append the selected pair label.
- It is absent from the default and reset Workspace.
- Add Panel lists it after Waveform.
- Dock Modules also lists it after Waveform and leaves it disabled by default.

## Measurement model

For each log-grid frequency point, temporal averaging and fractional-octave smoothing
first operate in linear power on the retained primitives:

```text
PL = power of the first selected channel
PR = power of the second selected channel
C  = real part of the averaged L/R cross-power
```

Ratios and dB conversion happen only after averaging `PL`, `PR`, and `C`. Final
ratios must not be averaged directly. The same pure frontend derivation consumes
live and historical primitives, so live, snapshot, and file views cannot drift
between separate formula implementations.

Before deriving metrics, finite power values clamp to zero or above and cross-power
clamps to the Cauchy bound `[-sqrt(PL * PR), +sqrt(PL * PR)]`. Any non-finite input
invalidates that frequency point. The backend canonicalizes an invalid primitive
point to the finite triplet `(0, 0, 0)`; the energy gate then reconstructs it as
invalid for display.

### Position

```text
Position = (PL - PR) / (PL + PR)
```

- `+1`: entirely at the first/top channel.
- `0`: equal channel energy.
- `-1`: entirely at the second/bottom channel.
- UI values use `42% L`, `0%`, or `68% R` with the actual selected channel labels.
- Equal energy does not imply mono compatibility.

### Correlation

```text
Correlation = C / sqrt(PL * PR)
```

Clamp finite results to `[-1, +1]`:

- `+1`: fully in phase.
- `0`: uncorrelated or approximately 90 degrees apart.
- `-1`: fully anti-phase.

If either channel lacks enough energy for a stable denominator, the value is invalid
and the curve breaks. It must not be replaced by zero.

### Mono Loss

Mono Loss measures only the additional loss caused by phase relationship, not the
level change caused by pan law:

```text
actualSum = PL + PR + 2C
idealSum  = PL + PR + 2sqrt(PL * PR)

MonoLossDb = 10log10(actualSum / idealSum)
```

Reference cases:

- any fully in-phase balance: `0 dB`;
- equal-energy uncorrelated signals: approximately `-3.01 dB`;
- equal-energy correlation `-0.5`: approximately `-6.02 dB`;
- equal-energy anti-phase signals: negative infinity;
- one-sided signal: `0 dB`.

The plot clips values to its visible Y range. Hover reports values below the range as
`<= lower bound` rather than presenting the clipped point as an exact measurement.

### M/S Ratio

Use the orthogonal measurement definition:

```text
M = (L + R) / sqrt(2)
S = (L - R) / sqrt(2)

PM = (PL + PR + 2C) / 2
PS = (PL + PR - 2C) / 2

MSRatioDb = 10log10(PS / PM)
```

Positive values are Side-dominant and negative values are Mid-dominant. A hard-left
or hard-right mono signal reads approximately `0 dB`, so the UI and help text must
not call this a pure width measurement.

### Numerical boundary contract

- A zero or gate-invalid Position denominator produces an invalid point.
- A gate-invalid Correlation denominator produces an invalid point, not zero.
- `actualSum`, `idealSum`, `PM`, and `PS` clamp to zero after floating-point
  roundoff; a materially negative value invalidates the point.
- Mono Loss clamps its finite power ratio to `[0, 1]`. A zero numerator with a
  positive denominator is valid negative infinity.
- M/S Ratio is negative infinity for `PS = 0, PM > 0`, positive infinity for
  `PM = 0, PS > 0`, and invalid when both are zero.
- Valid infinities remain valid derived measurement values in the frontend:
  plotting clips them to the current Y bound, Hover uses `<= lower bound` or
  `>= upper bound`, and Hold may retain them.
- IPC and history carry only finite `PL`, `PR`, and `C` primitives. They never
  serialize a separate validity array or derived `NaN`/`Infinity` through Tauri's
  JSON channel.
- The derivation returns an explicit `invalid`, `finite`, `belowRange`, or
  `aboveRange` state for plotting and Hover. It never relies on a JSON
  representation of non-finite numbers.

## Energy gate

The gate is automatic and has no user control. `energyDb` is an internal,
unweighted analysis-PSD scale derived from `PL + PR`; it is not presented as a
certified dBFS measurement:

```text
energyDb = 10log10(max(PL + PR, 1e-20)) + CAL_OFFSET_DB
gateDb = max(-96 analysis dB, current full-grid peak - 60 dB)
```

`CAL_OFFSET_DB` is the existing Spectrum analysis calibration. Reusing it fixes one
deterministic internal scale across FFT resolutions; it does not turn the result into
a certified absolute level.

- Below `gateDb`: invalid for display; break the curve and do not update Hold.
- From `gateDb` to `gateDb + 12 dB`: smoothly fade opacity from zero to full.
- Above that range: fully valid.

The gate uses unweighted, untilted L+R total power over the complete grid. Frequency
zoom does not change it. Gate threshold, validity, and opacity are reconstructed
from each retained `PL + PR` row and are not stored as separate history arrays. A
previously recorded Hold may remain visible in a band that has since fallen below
the gate.

## Speed and frequency smoothing

- `Speed` reuses Spectrum's real behavior: higher values mean more temporal averaging
  and slower response.
- `Smoothing` options: Off, 1/12 oct, 1/6 oct, and 1/3 oct.
- Stereo Map defaults to 1/12-octave smoothing.
- Smoothing is applied to linear `PL`, `PR`, and `C` before metric derivation.

Both controls affect measurement and therefore belong to the analysis request key.

## Hold

One `Hold` toggle applies to the selected Mode. It controls visibility only: turning
it off hides the outlines but does not reset or pause accumulation. Every Mode
accumulates while its Analysis Key exists, whether or not that Mode is selected.
Global Clear resets all Stereo Map holds.

Per frequency:

- Position keeps the most positive and most negative positions.
- Correlation keeps the minimum value.
- Mono Loss keeps the most negative dB value.
- M/S Ratio keeps the maximum dB value.

Only fully valid values derived from already-smoothed primitives update Hold. Hold
persists until Clear; it does not decay.

Hold renders as a thin, low-opacity solid outline with no fill. Current data renders
above it.

## Workspace panel

### Per-instance controls

In order:

1. Mode
2. Channel pair
3. Hold
4. Speed
5. Smoothing
6. X range
7. Y range, only for Mono Loss and M/S Ratio

Defaults:

```text
Mode             Position
Pair             Front L/R when available, otherwise the existing pair fallback
Hold             Off
Speed            same default semantic value as Spectrum
Smoothing        1/12 oct
X range          20 Hz to 20 kHz
Mono Loss Y      0 to -24 dB
M/S Ratio Y      +24 to -48 dB
```

Pair options reuse Vectorscope's `Common` / `All pairs` grouping, ordering, channel
labels, and invalid-selection fallback. Every instance persists independently and is
captured by Workspace presets.

### Axes and interaction

The X axis reuses Spectrum's logarithmic frequency-axis style and behavior:

- 20 Hz to 20 kHz limits;
- adaptive ticks;
- wheel zoom;
- drag pan;
- settings range input;
- double-click/reset to the default range.

Position and Correlation always show their complete normalized Y range. Zooming them
could hide endpoint or risk semantics and is intentionally disabled.

Mono Loss:

- top remains fixed at `0 dB`;
- lower bound is adjustable from `-6` through `-60 dB`;
- default is `-24 dB`;
- zero cannot be panned out of view.

M/S Ratio:

- default is `+24` to `-48 dB`;
- absolute limits are `+48` and `-96 dB`;
- custom asymmetric ranges are allowed;
- the range must include `0 dB`.

Y range uses the existing Panel Settings range-input component, validation, spacing,
and commit behavior. The two dB modes retain separate ranges. Axis reset restores
the current Mode's defaults.

### Visual design

Position:

- one continuous curve filled lightly to the unlabeled center baseline;
- top and bottom dynamically show the two selected channel labels;
- curve color interpolates between the two channel colors;
- center is labeled `0%`, never `C` or `Center`;
- Hold uses upper and lower outlines.

Correlation:

- one `+1` to `-1` curve filled to zero;
- continuous Good -> Warn -> Bad color mapping derived from existing signal tokens
  and the Vectorscope correlation marker semantics;
- Hold is the minimum-value outline.

Mono Loss:

- one downward-only curve filled from the `0 dB` top line;
- continuous Good -> Warn -> Bad mapping;
- `-3` and `-6 dB` may be visual reference ticks but are not normative thresholds;
- Hold is the most-negative outline.

M/S Ratio:

- one curve filled to the `0 dB` baseline;
- positive is Side-dominant and negative is Mid-dominant;
- reuse Spectrum's Mid/Side color semantics without declaring Side dangerous;
- Hold is the highest S/M outline.

Axis-label typography and spacing reuse Waveform/Spectrum tokens rather than adding a
panel-specific type scale.

### Hover

Reuse Spectrum's hover-marker style and frequency snapping. Show:

- frequency;
- current Mode value;
- energy;
- Hold value when enabled and available.

Position hover uses the percentage plus selected channel label and never says
`Center`.

### Empty and transition states

- Mono input: `Mono input — Stereo Map requires a channel pair.`
- Pair/request change: show pending until the new key's first frame; never flash data
  from the old key.
- Low energy: fade and then break the curve; do not draw a false zero.
- Pending, over-cap, stopped, and engine-error presentation reuse existing analysis
  panel patterns.
- Mode changes are frontend-only and do not change requests, rewarm analysis, or
  create history gaps.

## Dock module

- Module name: Stereo Map.
- Size policy: Spectrum-like `min 180 / default 360 / flexible`.
- Compact output contains only the current curve, baseline, fill, and Hold.
- No full axes, hover marker, wheel zoom, pan, or snapshot interaction.
- Position retains compact top/bottom pair labels; other modes retain only required
  zero baselines.
- X and applicable Y ranges are edited in Dock Editor.
- Dock controls are independent from Workspace panel controls.
- Matching `Pair + Speed + Smoothing` reuses the same backend analysis result.
- Mono and pending states use compact placeholders.
- Frequency-range linking is unavailable in Dock.

Dock Editor uses the same control order and shared settings primitives as the
Workspace panel.

## Analysis requests and IPC

### Keys

The request and retained-history identity is:

```text
Analysis Key = Pair + Speed + Smoothing
```

The Analysis Key excludes Mode, Hold visibility, X/Y ranges, and Workspace/Dock
origin.
Mode is a pure frontend projection of the same primitives and never appears in a
request or history key.

Use an independent Stereo Map request family with an initial cap of four unique
Analysis Keys, matching the existing Spectrum/Vectorscope policy. Over-cap status is
visible per panel. This cap is independent from Spectrum's four-request cap so one
panel family cannot starve the other. A mixed four-Spectrum plus four-Stereo-Map
benchmark must validate the policy before release.

### Live result

Each active Analysis Key publishes one shared frequency grid and finite, smoothed
`PL`, `PR`, and real `C` arrays. Frequency centers are constant for a request
lifecycle.

The frontend derives Energy, gate validity/opacity, all four Mode arrays, and live
Hold extrema from that result. Mode switching selects another derivation without
restarting analysis.

### Visual-history payload

At each emitted visual tick:

- `PL`, `PR`, and real `C` are stored once per active Analysis Key.
- Mode, Energy, validity, opacity, and derived metric rows are not stored.
- History uses the complete live frequency grid and Float32 primitive precision.
- Timestamps remain Float64/number precision.

Live emits at the existing 40 ms semantic cadence. File analysis currently feeds the
pipeline in 100 ms media-time chunks, so its effective visual cadence remains about
10 Hz, matching existing Spectrum/Spectrogram behavior. Raising all file visual
history to 40 ms is a separate pipeline change and is not silently folded into this
feature. Stereo Map preserves every row emitted by either source without additional
downsampling.

This stores three full-grid curves per Analysis Key at every retained tick. At the
240-minute live cadence, one full key is approximately 3.9 GiB before small chunk
metadata and summaries. The cost is deliberate: any Mode can be reconstructed over
the complete retained interval without reanalysis.

## History, snapshot, and file mode

Introduce chunked typed-array Stereo Map primitive history with the same read-only
contract as existing visual histories:

```text
length
timestampAt(index)
rowAt(index)
freeze()
```

Requirements:

- Live preserves the 40 ms semantic cadence; File preserves its current emitted
  media-time cadence.
- Every emitted `PL`, `PR`, and real `C` frequency point is preserved as Float32.
- Sealed chunks are immutable and shared with snapshots.
- Freeze copies only the active tail.
- Live uses wall-clock timestamps; File uses media timestamps.
- Inactive request keys remain retained until Clear/retention reset.
- An interior Analysis Key gap resolves to Missing, not nearest unrelated data.
- A grid/sample-rate change starts compatible storage rather than mixing rows.

### Historical Hold contract

Live Hold accumulates continuously for all modes while an Analysis Key exists.
Snapshot Hold is reconstructed from exact primitive rows available for that
Analysis Key within the current Clear epoch:

- sealed chunks store exact per-band derived extrema summaries for all Modes;
- complete chunks before the selected row merge their summaries;
- if retention starts inside the oldest sealed chunk, the query scans only retained
  rows from its logical start and never merges the evicted prefix's summary;
- the selected partial chunk scans only its rows up to the target;
- Clear starts a new epoch and queries never cross it.

The summaries are derived indexes, not source history. At 240 minutes they remain
small relative to the three primitive arrays, and they prevent a Hold query from
scanning every retained row. Historical Hold may differ from live Hold only across
an Analysis Key gap or retention boundary, never merely because the selected Mode
changed.

## Clear and lifecycle

- Global Clear resets all live Stereo Map accumulators and starts a history Hold epoch.
- Hold toggle changes visibility only.
- Changing Pair/Speed/Smoothing creates a different Analysis Key and does not inherit
  state from the previous key.
- Changing Mode is frontend-only and immediately reconstructs the complete retained
  history for the current Analysis Key.
- Stop follows existing session-history retention semantics.
- A retention change clears/rebuilds Stereo Map history with the other histories.
- Inactive Analysis Keys remain retained until Clear or a retention change, matching
  Spectrum and Vectorscope; no silent key eviction is introduced.

## Performance and memory

Stereo Map history is spectrum-shaped and must be treated as a primary memory cost:

- no per-tick JS arrays or row objects as primary storage;
- no monolithic snapshot copy;
- no source-history scan in a roughly 60 Hz render path;
- no stored Energy, validity, opacity, or Mode rows;
- no reduction from either source's existing cadence, grid, or Float32 precision.

Extend the deterministic full-history benchmark with:

- one and four Stereo Map Analysis Keys;
- 30/60/120/240-minute retention;
- Mode switches across retained live and file history;
- snapshot freeze and lookup;
- historical Hold query;
- mixed four-Spectrum plus four-Stereo-Map workloads.

The benchmark records retained bytes, snapshot cost, lookup cost, and frame-intake
work. Automated tests enforce structural/call-count bounds rather than fragile
wall-clock thresholds.

## Testing

### DSP reference vectors

- equal-energy in-phase;
- equal-energy anti-phase;
- 90-degree phase difference;
- deterministic independent L/R noise;
- in-phase unequal amplitudes;
- single-sided signal;
- below, within, and above the Energy fade range.

Tests cover every formula, clamp, invalid denominator, smoothing order, Speed
behavior, gate, Hold update rule, finite/infinite boundaries, primitive validity,
and NaN rejection. Rust tests cover primitive production; frontend differential
fixtures cover the single live/history derivation.

### Frontend and state

- all four axes, curves, fills, colors, and Hold outlines;
- pair groups, labels, and fallback clamping;
- hover formatting;
- X range and per-dB-Mode Y ranges;
- mono/pending/over-cap/error states;
- multiple independent panel instances;
- Add Panel and Dock ordering/defaults;
- Workspace/Dock control independence and preset round trips.

### History

- live 40 ms cadence, current file media-time cadence, complete grid, and Float32
  `PL`/`PR`/`C` values;
- Analysis Key no-backfill and interior gaps;
- complete Mode reconstruction without Mode-specific gaps or file reanalysis;
- immutable chunk freeze while live intake continues;
- live/file timestamp alignment;
- Clear epochs;
- historical Hold never includes rows after the selected timestamp;
- historical Hold excludes extrema from an evicted prefix of the oldest partial
  chunk;
- full-history benchmark has no structural regression.

### Desktop

- Windows and macOS rendering;
- mixed high-load Workspace and Dock layouts;
- live/file switching and long capture;
- `npm run check`;
- release capture smoke;
- `npm run soak:capture` after `dsp`/`engine` work.

## Acceptance criteria

- Stereo Map exposes the approved four single-select Modes and controls.
- Formulas match the reference cases above.
- Low-energy bands never display fabricated zero ratios.
- Matching Workspace/Dock requests share one Analysis Key.
- Mode, Hold, and ranges do not restart DSP.
- History preserves every emitted Float32 `PL`/`PR`/`C` grid row for active Analysis
  Keys without reducing the source's existing cadence.
- Any Mode can reconstruct the complete retained interval for its Analysis Key in
  Live and File without reanalysis.
- Snapshot and file mode obey explicit Missing/no-backfill semantics.
- Historical Hold cannot read future rows or cross Clear.
- Dock provides the compact display and editor controls without chart interaction.
- Existing Spectrum/Vectorscope behavior is unchanged.
- The four-request cap passes CPU, IPC, and retained-memory benchmarks.
- Full verification and required real-capture follow-up complete before integration.
