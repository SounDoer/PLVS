# Loudness reference profiles

> **Product behaviour** for session-level Loudness Profiles (Off / built-ins /
> user profiles, Stats colouring, toolbar entry, persistence) is specified in
> [`docs/superpowers/specs/2026-07-19-loudness-profile-design.md`](superpowers/specs/2026-07-19-loudness-profile-design.md),
> and the rule editor that supersedes that spec's `unsaved-custom` slot is in
> [`docs/superpowers/specs/2026-07-20-loudness-profile-editor-design.md`](superpowers/specs/2026-07-20-loudness-profile-editor-design.md).
> This page remains a short **source bibliography** for reference targets.
>
> A user profile's numbers are the user's own. Only the built-ins below carry
> cited targets, which is what this bibliography is for.

Overlays and profile targets are **UI / QC guides**. They do **not** change the
measurement engine, and they are **not** platform or regulatory certification.

## Sources (v1 built-ins)

### EBU R128 / EBU R128 Live (−23 LUFS)

- EBU R 128 — Loudness normalisation and permitted maximum level of audio signals  
  `https://tech.ebu.ch/publications/r128`

### EBU R128 S1 (Short-form; ST Max −18 LUFS)

- EBU R 128 s1 — Loudness parameters for short-form content  
  `https://tech.ebu.ch/publications/r128s1`

### ATSC A/85 (−24 LKFS; dialogue anchor; TP −2)

- ATSC A/85 — Techniques for Establishing and Maintaining Audio Loudness for Digital Television  
  (recommended practice; PLVS dialogue path is on-device VAD, not Dolby DI)

### Streaming −14 LUFS

- Spotify for Artists – Loudness normalization  
  `https://support.spotify.com/artists/article/loudness-normalization/`
- YouTube does not consistently publish a single official LUFS target in help
  docs; **−14 LUFS** is the common observed / industry reference used for the
  merged Streaming −14 built-in.
