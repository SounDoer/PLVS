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
- The verdicts in a [File Mode](file-mode.md) report

## Managing profiles

Select, create, rename, reorder, and delete profiles from the Loudness Profile menu. A new
installation starts with one example profile named after its parameters; edit or delete it freely.
In Dock mode, the Dock header can switch the active profile.

Profiles can be exported and imported from [System Settings](system-settings.md).
