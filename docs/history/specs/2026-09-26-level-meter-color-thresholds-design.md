# Level Meter Colour Thresholds

Date: 2026-09-26

## Context

The Level Meter bar is painted with one continuous gradient: critical at the top, warning at a
fixed `midStopPercent` of 46 % of the bar height, safe at the bottom
(`src/index.css` `.meter-gradient`, `src/preferences/data.js`). Commit `646be22d` fixed the gradient
being scaled together with the fill, so the gradient now spans the whole bar and the fill only
reveals part of it.

What remains is that every colour stop is a percentage of the visible Y range, not a level:

- In the default Peak range (−60..+3 dBFS) pure warning sits at about −26 dBFS; in the M/ST range
  (−64..0 LUFS) at about −29 LUFS. Neither was chosen as a level; both fall out of 46 %.
- The Y axis is zoomable. Zooming moves every stop, so the colour at a given level changes with the
  view and carries no information.
- The M/ST bar is coloured like a judgement (safe → critical) although nothing judges it: with no
  Loudness Profile, or with a Profile that has no M/ST rules, Stats renders the same metric as
  unwatched.
- The Dock level strip has its own logic: a safe → warning gradient stretched over the fill, and the
  whole bar turning critical at −0.1 dBFS in the peak family.

Hardware and DAW meters look like the current gradient, but their scale is fixed, so their
percentage stops are level stops in practice. PLVS keeps that look and makes the anchoring explicit.

## Decision

### Visual model: a continuous gradient anchored in dB

- The bar keeps one continuous gradient, but every stop is a **level**, not a percentage.
- A threshold marks where its colour becomes **pure**. Between two stops the colour blends; above the
  highest stop it stays pure. Precise judgement stays with the numeric readout and the markers.
- Pure safe is anchored at the **absolute minimum of the mode's scale**: `PEAK_DB_MIN` (−60) for
  Peak/RMS, `LOUDNESS_DB_MIN` (−64) for M/ST. It is the axis's zoom limit, not the visible minimum.
  The gradient is therefore defined over the full scale and the visible window only crops it: every
  level has one colour at every zoom.
- Rendering keeps the clip-from-top fill from `646be22d`. Stops are converted from dB to percentages
  of the current visible range at render time; stops outside 0–100 % are valid and intended.
- Hard segments were considered and rejected as visually too harsh; short fixed blends around each
  threshold were considered and set aside in favour of the traditional long blend.

### Peak and RMS: user thresholds

- Four new Level Meter panel controls, per panel instance and saved with presets:

  | Key                        | Default |
  | -------------------------- | ------- |
  | `levelMeterPeakWarningDb`  | −6      |
  | `levelMeterPeakCriticalDb` | −1      |
  | `levelMeterRmsWarningDb`   | −18     |
  | `levelMeterRmsCriticalDb`  | −9      |

- Peak and RMS are separate because RMS reads far below Peak; a shared pair would leave RMS green.
- Rationale for the defaults, recorded as conventions, not standards: −1 is a common delivery peak
  ceiling (those specifications address true peak; the bar shows sample peak, which is why this is a
  default and nothing more); −6..−1 then reads as "approaching clip". RMS −18 is roughly the usual
  0 VU alignment; loud modern masters reach about −9 RMS.
- Values are clamped to the mode's absolute scale. `warning <= critical` is enforced by normalisation;
  equal values are allowed and mean "no warning band".
- The settings appear in the Level Meter tab only for the matching mode (`showWhen`), labelled in
  Title Case (`Warning`, `Critical`).
- The Peak-mode bar does **not** read the Profile's `truePeak` rules: the bar is sample peak. The TP
  Max marker already follows the Profile.

### Momentary and Short-term: the Loudness Profile or nothing

PLVS does not invent LUFS thresholds (`src/lib/loudnessProfileCatalog.js`), so M/ST has no panel
thresholds and no defaults.

- **Unwatched → neutral.** With no Profile, or a Profile with no applicable rule (below), the bar is
  one solid colour: `--ui-loudness-momentary` in Momentary mode, `--ui-loudness-shortterm` in
  Short-term mode, matching the Loudness panel's traces. Safe green would itself be a judgement.
- **Applicable rules.** The Momentary bar reads the `>` rules of `momentary` **and** `momentaryMax`;
  Short-term reads `shortTerm` and `shortTermMax`. A ceiling on the Max is the level the live value
  must not cross; the moment the bar crosses it, the Max breaches.
- **`<` rules never colour the bar.** Live loudness falls to silence between phrases, so a floor on a
  live bar would sit red for much of any programme, and placing pure safe between a floor and a
  ceiling would need an invented midpoint. Floors keep being judged in Stats.
- **Stops from rules.** Pure safe at −64 LUFS; each applicable threshold becomes a pure stop in its
  severity's colour (`warn` → warning, `fail` → critical). Sorted ascending, a stop is kept only if
  its severity exceeds every lower kept stop's; at equal values the more severe rule wins. A single
  `fail` rule gives safe → critical with no warning band; no warning stop is synthesised.
- Profile changes apply immediately; no Profile state is copied into panel controls.

### M/ST readout marker (existing inconsistency, fixed here)

`LevelMeterPanel` evaluates the Floating Value marker only against `momentary` / `shortTerm` rules,
even while Playback Max makes it show a maximum. The marker's status becomes the worse of:

- the metric's own rules evaluated at the readout value (as today, matching the Stats row), and
- the Max metric's `>` rules evaluated at the readout value (matching the bar colour at the marker's
  position).

### Dock level strip

- Uses the same model and sources: Peak/RMS thresholds and M/ST Profile stops, and a neutral colour
  for unwatched M/ST.
- The Dock stores panel controls under the panel's own keys (`DOCK_MODULE_CONTROL_KEYS`); the four
  threshold keys are added to the `level` module so the Dock has its own values with the same
  defaults and normalisation.
- The whole-bar critical flash at −0.1 dBFS is removed. Its role is taken over by the critical stop,
  and it contradicted a user who moves Critical.

### Theme

- The `level.safe` / `level.warning` / `level.critical` colour roles stay.
- The stop position leaves the theme: `prefs.modules.peak.meterGradient.midStopPercent` and
  `--ui-meter-gradient-mid-stop` are removed. The Theme Preview swatch keeps a representative
  gradient.

### Agent Control and documentation

- The four panel controls go through the Agent Control synchronisation checklist in
  `docs/agent-control/README.md` (schema, read/patch mapping, capability declaration, contract
  tests, `docs/user/cli.md`); generated files are regenerated, never hand-edited.
- `docs/user/panels.md` (Level Meter) documents the thresholds and the M/ST colouring;
  `docs/user/loudness-profiles.md` states that `>` rules on M/ST and their Max colour the Level Meter
  and that `<` rules do not.

## Testing

- Pure stop builder: Peak/RMS thresholds → dB stops; Profile rules → stops, covering `<` rules
  ignored, Max `>` rules included, severity ordering and suppression, single-rule, no-rule, equal
  thresholds, thresholds outside the scale.
- dB → percent conversion under a zoomed range: a stop keeps its level when the range changes.
- Panel: Peak/RMS gradients follow the controls; M/ST is neutral without a Profile and with the
  starter Profile; M/ST follows `momentaryMax` ceilings.
- Marker: status with Playback Max on/off against `momentaryMax` rules.
- Normalisation: defaults, clamping, `warning <= critical`, preset round-trip.
- Dock: same stops, no clip flash, own control values.
- Agent Control contract tests for the new keys.

## Out of scope

- Drawing the Profile's `referenceLufs` on the Level Meter axis.
- A setting for blend width or colour interpolation space.
- Per-channel thresholds.
