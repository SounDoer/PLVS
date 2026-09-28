# Level Meter Bar Colors

Date: 2026-09-28

Supersedes the visual model of `2026-09-26-level-meter-color-thresholds-design.md`. Everything
that record decided and this one does not revisit stays in force.

## Context

The 2026-09-26 design anchored every Level Meter colour to a level: a continuous gradient whose
stops were dB values, pure safe pinned to the bottom of the full scale, Peak/RMS stops from
per-panel **Warning / Critical** controls, Momentary/Short-term stops from the Loudness Profile's
ceilings or a neutral trace colour. It shipped to `main` (not to a release).

Using it showed that the old height-based gradient was not only a bug: a gradient spread over the
visible bar is a legitimate look that some users prefer, and it is what "a traditional meter" looks
like at a fixed scale. The level-anchored gradient, meanwhile, blends toward a colour before its
threshold, so the bar reads "almost red" while no rule has fired, which does not suit the mode
whose whole point is precision.

## Decision

### One setting, two ways to colour the bar

A new Level Meter control, **Bar Colors**, with two options:

| Option                 | What the colour means                                                    |
| ---------------------- | ------------------------------------------------------------------------ |
| **Gradient** (default) | Appearance only. Nothing is judged; the colour follows the bar's height. |
| **Level Zones**        | The colour is a level zone: thresholds, or the Loudness Profile's rules. |

Each measurement mode keeps its own value: `levelMeterPeakBarColors`, `levelMeterRmsBarColors`,
`levelMeterMomentaryBarColors` and `levelMeterShortTermBarColors`, all defaulting to Gradient, per
panel instance and saved with presets like every other panel control. A user can read headroom in
Level Zones under Peak and keep the Gradient under Momentary; switching Mode brings back that mode's
own choice. Settings show one **Bar Colors** row, for the current mode. The Dock level module carries
its own four values with the same defaults and the same behaviour; nothing about the Dock is
special-cased. (Revised 2026-09-28 during implementation: the first cut had one value shared by all
four modes.)

The UI label and tooltip use American spelling like every other UI string. Tooltip:
"Gradient is appearance only. Level Zones color the bar by level: Warning / Critical for Peak and
RMS, the Loudness Profile's rules for Momentary and Short-term."

### Gradient

- One continuous gradient over the visible bar, critical at the top, warning pure at **40 %** from
  the top, safe at the bottom — the same in every measurement mode, and in the Dock over the whole
  track.
- 40 % replaces the historical 46 %, which was tuned by eye (`b42c8c11`) and corresponds to no
  level. 40 % was the original value (`688161d5`), leaves the lower part of the bar green the way
  traditional meters do, and is a round number with nothing to explain. In the default ranges it
  falls near −22 dBFS (Peak/RMS) and −26 LUFS (M/ST); that is a consequence, not a meaning.
- Zooming the Y axis rescales the gradient with the bar. That is the definition of this option, not
  a defect.
- The Loudness Profile does not affect the bar. The Floating Value and TP Max markers keep following
  the Profile as before, so a breach is still visible.
- **Warning / Critical** is hidden, and inactive in Agent Control.

### Level Zones

Hard cuts at each threshold, no blending: a level has exactly the colour its zone has, so the bar
agrees with the readouts at every level.

- **Peak / RMS:** safe below Warning, warning from Warning up to Critical, critical from Critical up.
  Equal thresholds mean no warning zone. Thresholds, defaults (Peak −6 / −1 dBFS, RMS −18 / −9 dBFS),
  clamping and ordering are unchanged from 2026-09-26. **Warning / Critical** is shown for the
  current mode only.
- **Momentary / Short-term:** unchanged sources, hard-cut rendering.
  - Applicable rules are the `>` rules of the metric and of its Max (`momentary` + `momentaryMax`,
    `shortTerm` + `shortTermMax`); `<` rules never colour the bar.
  - Each kept threshold starts a zone in its severity's colour (`warn` → warning, `fail` →
    critical); below the lowest kept threshold the bar is safe. A threshold is kept only if its
    severity exceeds every lower kept one; at equal values the more severe rule wins. A single `fail`
    rule gives safe → critical with no warning zone.
  - With no applicable rule (no Profile, or a Profile without such rules) the bar is one solid
    colour: `--ui-loudness-momentary` or `--ui-loudness-shortterm`, the Loudness panel's trace
    colours.
- The "pure safe at the absolute scale minimum" anchor of 2026-09-26 is no longer needed: zones are
  defined by thresholds alone, and zooming only crops them.

### Unchanged

The Floating Value marker's status (own rules, worse of which and the Max metric's ceilings), the TP
Max marker, the clip-from-top fill, the removal of the Dock's whole-bar clip flash, and the theme's
three level colour roles.

### Theme

`.meter-gradient` (Theme Preview swatch) moves its warning stop to 40 % to match the Gradient option.
No stop position returns to the theme or to preferences.

### Agent Control

- Four public fields, one per mode, named like the threshold pairs: `peakBarColors`,
  `rmsBarColors`, `momentaryBarColors`, `shortTermBarColors`; enum `"gradient" | "levelZones"`,
  default `"gradient"`, in Panel Control and Dock Control. Each is effective in its own mode; otherwise
  its inactive reason is `nonPeakMode` / `nonRmsMode` / `nonMomentaryMode` / `nonShortTermMode`.
- `peakThresholdsDbfs` / `rmsThresholdsDbfs` stay. Their `effective` rule becomes "matching mode and
  that mode's bar colors is `levelZones`". The inactive reason is the mode one (`nonPeakMode` /
  `nonRmsMode`) when the mode does not match, otherwise `gradientBarColors`. Patch warnings follow
  the same rules against the final state of the patch.
- Regenerate `docs/agent-control/generated/`; follow the synchronisation checklist in
  `docs/agent-control/README.md`.

### Documentation

`docs/user/panels.md` (Level Meter) describes **Bar Colors**, both options, and states that under
Gradient the colours are appearance only and a Profile changes only the markers.
`docs/user/loudness-profiles.md` says M/ST bar colours follow rules under **Level Zones**. The
existing "reading aid for headroom" sentence applies to Level Zones for Peak/RMS.

## Testing

- Colour builder: Gradient output identical for all modes, independent of thresholds and Profile;
  Level Zones hard-cut output for Peak/RMS (normal, equal thresholds, zoomed view) and for M/ST
  (no rule → neutral, single fail, warn + fail, suppression, `<` ignored, Max ceilings included,
  threshold below the visible range).
- Control table: the four per-mode bar colors keys, their defaults and repair; each Bar Colors row
  visible only in its mode; thresholds row visible only under that mode's Level Zones.
- Per-mode independence: changing one mode's Bar Colors leaves the other three untouched, and the
  bar follows the current mode's value (panel and Dock).
- Panel and Dock: default renders the Gradient; switching to Level Zones renders zones; a Profile
  changes the M/ST bar only under Level Zones; marker status unchanged under both.
- Dock settings: the Bar Colors row, and thresholds hidden under Gradient.
- Agent Control contract tests for the four bar colors fields and the inactive reasons; preset round
  trip for per-mode bar colors.

## Out of scope

- A user-set warning position for Gradient.
- Blend width or colour interpolation options.
