# First-Run Defaults: Window, Workspace Layout, Dock

Status: Design decided (2026-09-14) — window size and fit, workspace layout, Dock defaults. Not
implemented yet.

## Scope

What a new user sees on first launch with an empty profile, in both window forms:

- **Normal window** — initial window size and the default workspace layout (`DEFAULT_TREE`, default
  panel controls).
- **Dock** — the default strip (`DEFAULT_DOCK_MODULES`, height, reserve space).

Out of scope: onboarding copy / Ready empty-state guidance (not chosen for this round).

## Decision 1: Default window size — 1280×800 logical (16:10)

Replaces the current `inner_size(1280.0, 960.0)` in `src-tauri/src/lib.rs`.

Why: 960 logical height plus a title bar does not fit the most common laptop work areas.

| Display | Logical work area | 1280×960 + title bar |
| --- | --- | --- |
| Windows 2560×1440 @125% | 2048×1104 | fits |
| Windows 1920×1080 @100% | 1920×1032 | fits |
| Windows 1920×1080 @125% | 1536×826 | ~170 over |
| MacBook Air 13″ | ~1470×920 | ~70 over |
| MacBook Pro 14″ | ~1512×950 | just over |

16:10 keeps today's width (the four stacked time-series panels want width more than height) and
matches Mac displays and most monitors. Alternatives rejected: 1440×900 (compressed on laptops, so
tuned proportions would not survive), keeping 1280×960 with clamping only.

**First-launch fit (decided).** Today first launch
calls `inner_size(1280.0, 960.0)` (logical) and leaves placement to the OS: no centering, no
work-area check. Separately, `clamp_to_visible` re-homes saved bounds that are off every monitor via
`centered_on_monitor`, which uses a hard-coded 1280×860 **physical** size (1024×688 logical at 125%)
against the full monitor rect, not the work area.

Today's first-launch position differs by platform, because PLVS sets no position and tao 0.35.3
decides: on Windows it passes `CW_USEDEFAULT` on the primary monitor, so the system cascades the
window from the top-left and it is not centered; on macOS it calls `NSWindow.center()`, which is
horizontally centered and sits somewhat above vertical center. Centering explicitly makes both
platforms behave the same.

Decisions:

- With no saved bounds, the window is 1280×800 logical when it fits the monitor work area;
  otherwise it shrinks **proportionally** (keeps 16:10, so tuned panel proportions survive) until it
  fits, and is **centered** in the work area.
- **Fit budget (decided): at most 90% of the work area** in each dimension, measured on the outer
  window (content plus title bar, ~32 logical px on Windows, ~28 on macOS), so a shrunk window keeps
  a visible margin and reads as a normal window rather than a near-maximized one. Examples (content
  size, logical): 2048×1104 work area → 1280×800 unchanged; MacBook Air 13″ ~1470×923 → unchanged;
  1920×1080 @125% (1536×826) → ~1138×711; 1366×768 @100% (1366×728) → ~997×623.
- **Monitor (decided): the primary monitor.** It matches today's Windows placement and keeps the
  result predictable on multi-monitor setups; the monitor under the cursor was considered and not
  chosen.
- The off-screen fallback for saved bounds uses the **same rule** (1280×800 logical converted with
  that monitor's scale, 90% budget, proportional shrink, centered in its work area) instead of its
  own numbers, and targets the primary monitor too. Today it falls back to `monitors[0]`, which is
  not guaranteed to be the primary.
- Work area comes from Tauri 2.11's cross-platform `Monitor::work_area()` (physical px, taskbar and
  menu bar excluded), so Windows and macOS share one implementation.

Discussion uses the user's 125% display, where 1280×800 logical is 1600×1000 physical; the default
itself stays in logical px because a physical default would be 1600×1000 logical on a 100% display
and overflow a 150% laptop.

The workspace layout below is tuned at exactly 1280×800 logical.

## Decision 2: Default workspace layout — decided

The user tuned the layout by hand in a fresh-profile development app at 1280×800 (2026-09-14); the
result was read back with `inspect --json` (revision 359). The saved Preset `main16001000` is a
tuning artifact only: first launch still has no Preset.

### Tree

| Column | Weight | Content |
| --- | --- | --- |
| Left | 0.132 | Level Meter |
| Middle | 0.688 | Vertical split, four equal rows: (1) Loudness \| Waveform, horizontal, equal; (2) Spectrogram; (3) Spectrum; (4) Stereo Map |
| Right | 0.180 | Vertical split: Stats 0.623, Vectorscope 0.377 |

Stereo Map (`stereo-map`) joins the default layout; today `ALL_MODULE_IDS` does not include it.

### Panel controls that differ from today's defaults

| Panel | Control | Tuned |
| --- | --- | --- |
| Level Meter | `levelMeterTpMaxMarker` | `true` |
| Loudness | `loudnessHistoryVisibleLayerIds` | momentary, shortTerm, **reference** |
| Stats | `statsVisibleIds` | all 15 metrics, including the four dialogue metrics, TP Max, Corr, S/M |
| Spectrum | `spectrumView` / `spectrumMaxMode` | `lr` / `decay` |
| Waveform | `waveformFrequencyColor` / `waveformCentroid` | `true` / `true` |

Vectorscope, Spectrogram, Stereo Map, theme and view settings stay at today's defaults.

**Scope (decided):** these controls apply only to the panels of the first-run layout (per-panel
entries in the default `panelControlsById`). `DEFAULT_PANEL_CONTROLS` row defaults do not change, so
a panel the user adds later keeps today's conservative defaults. **Resetting a single panel's
settings returns it to those row defaults, not to the first-run values (decided)**; Reset Layout
restores the whole first-run layout, tuned controls included. The Dock follows the same rule. A
consequence, not a bug: on a fresh install Level Meter, Stats, Spectrum and Waveform already read as
"not at defaults", so their panel Reset is enabled and their changed rows show reset markers.

### Loudness Profile (decided)

A fresh profile's library is already seeded with one starter profile (`createStarterProfile`,
`I −23 ±0.5 · TP ≤ −1`, random UUID, editable and deletable), but the active selection is Off
(`normalizeLoudnessProfiles`). **Decision: on first run the seeded starter profile is active.** Only
the initial active selection changes; the starter document itself keeps its rules. This makes the
Loudness `reference` layer draw, and typical music reads red against −23 on purpose: PLVS presents
itself as a delivery-loudness check. Existing users whose stored `loudnessProfiles` is valid are
unaffected, including those who chose Off. A missing or malformed key counts as first run: an upgrade
straight from a build before v0.11.0 (when the key first shipped), a Configuration Profile exported
before v0.11.0, or corrupt storage also lands on the selected starter.

### Analysis cost (decided)

**Decision: both stay on by default, as tuned** — all 15 Stats metrics visible (dialogue detection
runs) and Waveform Frequency Color + Centroid on (spectral waveform runs). The measured host cost is
about 2.5 points of one core; the WebView cost is inside run-to-run noise.

- **Analysis cost.** Visible dialogue metrics start dialogue detection (VAD, FireRed engine by
  default) and Frequency Color / Centroid start the spectral waveform analysis for every new user.
  Frequency Color drawing measured ~8.6% of the frame budget at 1200 px / 60 s before a −27%
  optimization (`docs/working/perf/waveform.md`).

  **Measured 2026-09-14** (dev-identity release build, tuned layout at 1280×800, LIVE with music,
  i7-13700K / 24 logical CPUs; CPU in % of one logical core; host = `plvs.exe`, WebView = renderer +
  GPU process). Two runs, configurations interleaved with baselines:

  | Run | Config | Host | WebView | Total |
  | --- | --- | --- | --- | --- |
  | 1 | baselines 1–3 (both off) | 0.55–0.72 | 4.1–5.9 | 4.8–6.4 |
  | 1 | VAD only | 2.67 | 9.2 | 11.9 |
  | 1 | Spectral only | 1.75 | 8.2 | 9.9 |
  | 1 | Both | 3.12 | 11.5 | 14.6 |
  | 1 | baseline-4 | 4.78 | 24.6 | 29.3 (outlier) |
  | 2 (restarted) | baselines a–d | 0.76–2.71 | 8.3–16.9 | 10.4–19.6 |
  | 2 | Both / VAD / Spectral | 4.76 / 2.20 / 1.23 | 12.3 / 5.5 / 7.9 | 17.1 / 7.7 / 9.1 |

  Reading: the host-side increments are consistent in run 1 — VAD ≈ +2 points of one core, spectral
  waveform ≈ +1, both ≈ +2.5 — i.e. roughly 0.1% of this machine's total CPU. WebView increments are
  inside the noise: run 2's baselines alone swing 10–20 points, with the installed PLVS (another
  WebView2 renderer + GPU process) and other WebView apps busy on the same machine. A suspected
  "analysis keeps running after it is turned off" leak (run 1 baseline-4) did **not** reproduce in
  run 2, where the baseline right after "both" fell back; code reading agrees (VAD is fed only while
  `dialogue_gating` is on, spectral waveform is computed only while requested).

Observations from the previous default (fresh profile, 1280×960), for reference:

- Stats takes 54% of the right column for eight rows; the lower half is empty and Vectorscope is
  squeezed.
- Loudness shows Momentary and Short-Term by default in two very close oranges (`#fb923c` /
  `#c66a2a`); the traces are hard to tell apart.
- The seven toolbar icons at top right are unlabeled.
- The footer device label renders as `4- Apogee Symphony Desktop` (OS label `扬声器 (4- …)`
  partially stripped).

The normal-window Waveform panel that rendered nothing during LIVE while the Dock Waveform worked
was a development-build bug, fixed in `77dbd92f` (a StrictMode remount left a stale animation-frame
id, so the lane never painted); it does not affect these defaults.

## Decision 3: Dock defaults — decided

**Scope (decided):** like the workspace, tuned Dock values apply only to the first-run Dock layout.
A Dock panel the user adds later keeps today's default controls and width. The user hand-tuned the
Dock in the running dev-identity release build; the result was read back with `dock inspect --json`
and the rounded widths were applied and confirmed on screen (2026-09-14, Dock revision 4).

### Form (decided)

**Top** edge, **56 px** (compact height mode), reserve space **on**. The monitor is not part of the
default: first entry keeps today's saved → current/primary monitor resolution.

### Panels and widths (decided)

Widths are the flex bases in CSS px. They record what the user saw while tuning on a 2048 px logical
strip (2560×1440 @125%), rounded to tens, with the last four panels equal. The dragged bases summed
to 2300 and were silently shrunk by flex, so storing them would not match what was on screen.

| Order | Panel id | Module | Width | Min / max preferred | Growth |
| --- | --- | --- | ---: | --- | --- |
| 1 | `transport` | Transport | 90 | 90 / 180 | fixed |
| 2 | `level` | Level Meter | 150 | 140 / 420 | fixed |
| 3 | `loudness` | Loudness | 210 | 154 / 480 | fixed |
| 4 | `stats` | Stats | 370 | 160 / 420 | fixed |
| 5 | `correlation` | Vectorscope | 190 | 160 / 360 | fixed |
| 6 | `waveform` | Waveform | 260 | 160 / 960 | flexible |
| 7 | `spectrogram` | Spectrogram | 260 | 180 / 960 | flexible |
| 8 | `spectrum` | Spectrum | 260 | 180 / 960 | flexible |
| 9 | `stereoMap` | Stereo Map | 260 | 180 / 960 | flexible |
| | | | **2050** | mins sum to 1404 | |

First-run panel ids come from the legacy Dock module ids (`level`, `correlation`, `stereoMap`); the
tuned strip's `stereo-map` id was only the id the Add Module flow generated.

Against today's first-run Dock: Stereo Map is added, Waveform moves ahead of Spectrogram and
Spectrum, and every width is pinned instead of left to responsive sizing.

How it behaves on other strips (`DockStrip` is a flex row with `overflow-hidden`; handles are
absolutely positioned and take no width):

- **2048 px** (tuning display): 2 px over, every panel shrinks by under 1 px.
- **1536 px** (1920×1080 @125%): Transport, Level Meter, Loudness and Vectorscope sit at their
  minimums, Stats ≈ 260, the last four ≈ 183 each and still equal.
- **Wider than 2050 px:** only the four flexible panels grow, equally, so they stay equal.
- **Narrower than 1404 px:** the rightmost panels are clipped; there is no scrolling.

### Panel settings (decided)

Full Dock controls, public Agent Control names. Bold marks a difference from today's Dock defaults.

| Panel | Controls |
| --- | --- |
| Transport | none |
| Level Meter | `mode: peak`, `readout: live`, `showLabels: true` |
| Loudness | `layers: [momentary, shortTerm, reference]`, `loudnessRangeLufs: −64…0`, **`showReadouts: false`** |
| Stats | **`metrics.visible`: all 15**; `metrics.order`: canonical (momentary, shortTerm, integrated, momentaryMax, shortTermMax, lra, psr, plr, dialogueCoverage, dialogueIntegrated, dialogueRange, dialogueOffset, truePeak, correlation, sideToMid) |
| Vectorscope | `mode: lissajous`, `channelPair: 0/1`, `maxHold: false` |
| Waveform | **`frequencyColor: true`**, `centroid: false`, `frequencyBandsHz: 200 / 2000` |
| Spectrogram | `channel: pair 0/1`, `dbFloor: −84`, `frequencyRangeHz: 20…20000`, `tiltDbPerOctave: 3` |
| Spectrum | `channel: pair 0/1`, `view: combined`, **`maxMode: decay`**, `octaveSmoothing: off`, `speedPercent: 25`, `tiltDbPerOctave: 3`, `levelRangeDb: −96…−12`, `frequencyRangeHz: 20…20000` |
| Stereo Map | `mode: position`, `channelPair: 0/1`, `maxHold: false`, `octaveSmoothing: 1/12`, `speedPercent: 50`, `monoLossFloorDb: −24`, `msRatioRangeDb: −48…24`, `frequencyRangeHz: 20…20000` |

### Stats at 370 px (measured)

Compact Dock padding is 5 px per side plus the 1 px divider, so the grid gets 359 px. The column
count is `floor((W + 12) / 72)`; five columns (all 15 metrics at three rows) need W ≥ 348, i.e. a
panel width ≥ 359. At 370 all 15 show; `Dlg Cov` and `Dlg Offset` truncate because metric cells cap
at 72 px regardless of panel width. Below 359 px the last metrics are **silently dropped**
(`visibleDockStats`), which happens on a 1536 px strip (Stats ≈ 260: three columns, nine metrics).
Tracked as a separate Dock Stats layout issue, not part of this decision.

### Loudness reference line (resolved)

The tuned Dock Loudness already shows the `reference` layer: the stored ids are
`[momentary, shortTerm, ref]`, all three layers are checked in its settings, and the line is drawn.
It matches the first-run workspace, so there is nothing to decide.

An earlier read-back reported only momentary + shortTerm. That was an Agent Control bug, not the
tuned state: every Dock handler in `useAgentControlBridge` passed the bare `dockContext`, which never
carried `hasLoudnessReference`, so the shared panel mapping dropped `ref` from `dock.inspect`,
omitted `reference` from `dock.panel.describe`, and would have refused or stripped it on write. Fixed
by merging `hasLoudnessReference` into the Dock request context, with a bridge test covering inspect,
describe and a layout apply that preserves the layer.

Previous first-run Dock, for reference: bottom edge of the current/primary monitor, 72 px, reserve
space on (Windows), modules Transport → Level → Loudness → Stats → Vectorscope → Spectrum →
Spectrogram → Waveform. Observations:

- Reserve space pushes other windows on first entry.
- The Transport cell is timer-only by design; START/STOP and Restore Window live in the hover
  header, which is invisible until the pointer enters the strip.
- M / ST / I appear twice (Loudness readouts and Stats).
- Stats labels truncate to `M …` / `ST …`.
- Vectorscope is a small blob at 72 px.

## Appendix: full workspace panel settings (as tuned)

Read back with `inspect --json` at revision 359, public Agent Control names. Decision 2 lists only
the differences from today's defaults; this is the complete set the first-run layout should carry.

| Panel id | Module | Controls |
| --- | --- | --- |
| `levelMeter` | Level Meter | `mode: peak`, `levelRangeDbfs: −60…3`, `loudnessRangeLufs: −64…0`, `floatingValue: false`, `playbackMax: false`, **`tpMaxMarker: true`** |
| `loudness` | Loudness | **`layers: [momentary, shortTerm, reference]`**, `loudnessRangeLufs: −64…0` |
| `stats` | Stats | **`metrics.visible`: all 15**; `metrics.order`: canonical |
| `vectorscope` | Vectorscope | `mode: lissajous`, `channelPair: 0/1`, `maxHold: false` |
| `spectrum` | Spectrum | `channel: pair 0/1`, **`view: lr`**, **`maxMode: decay`**, `octaveSmoothing: off`, `peakLabels: false`, `speedPercent: 25`, `tiltDbPerOctave: 3`, `levelRangeDb: −96…−12` |
| `spectrogram` | Spectrogram | `channel: pair 0/1`, `mode: heatmap`, `dbFloor: −84`, `octaveSmoothing: off`, `tiltDbPerOctave: 3`, `threeD: { azimuthDeg 135, elevationDeg 60, heightScale 1, colorize true, grid true }` |
| `waveform` | Waveform | **`frequencyColor: true`**, **`centroid: true`**, `frequencyBandsHz: 200 / 2000` |
| `stereo-map` | Stereo Map | `mode: position`, `channelPair: 0/1`, `maxHold: false`, `octaveSmoothing: 1/12`, `speedPercent: 50`, `monoLossFloorDb: −24`, `msRatioRangeDb: −48…24` |

Axes: the time axis (Loudness, Spectrogram, Waveform) is linked at a 60 s window, offset 0; the
frequency axis (Spectrum, Spectrogram, Stereo Map) is linked at 20…20000 Hz.
