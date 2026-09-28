# Loudness Profiles

A Loudness Profile is your own rule set for judging a measurement. PLVS ships no platform or
broadcast certification presets; every value in a profile is one you chose.

## What a profile contains

- **Reference** — a LUFS value drawn as the reference line on the Loudness panel. It judges nothing
  by itself.
- **Rules** — each rule picks a Stats metric, a side (`>` or `<`), a threshold, and a severity,
  **Warn** or **Fail**. One metric can carry several rules, so a target range is two rules.

Integrated loudness is not judged until the measurement has settled.

## Where profiles apply

- The Loudness panel's reference line
- The colouring of Stats readouts that breach a rule
- The True Peak Max marker on the Level Meter
- The Level Meter's Floating Value, and its Momentary and Short-term bar colours under Level Zones
- The verdicts in a [File Mode](file-mode.md) report

The Level Meter colours its Momentary and Short-term bars from rules on that metric and on its Max
(Momentary Max, Short-term Max) that set an upper limit ("above"). This applies when the Level
Meter's **Bar Colors** is **Level Zones**; the default Gradient does not follow the Profile. A lower
limit ("below") is not drawn on the bar — live loudness falls between phrases, so the bar would sit
red — but Stats still judges it.

## Managing profiles

Select, create, rename, reorder, and delete profiles from the Loudness Profile menu. A new
installation starts with one example profile named after its parameters; edit or delete it freely.
In Dock mode, the Dock header can switch the active profile.

Profiles can be exported and imported from [System Settings](system-settings.md).
