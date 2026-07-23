# Loudness reference profiles

> **LEGACY — HISTORICAL SOURCES ONLY**
>
> This page records the historical parameter sources for the former built-in
> EBU, ATSC, and Streaming profiles. PLVS no longer provides or recommends
> these as product presets. The product now favors transparent parameters and
> user-defined rules, especially for contexts such as game audio where
> broadcast-delivery presets are usually not useful. This material is retained
> only for historical traceability.
>
> Current product behaviour is specified in
> [`2026-07-23-loudness-profile-flat-library-design.md`](superpowers/specs/2026-07-23-loudness-profile-flat-library-design.md).

Overlays and profile targets are **UI / QC guides**. They do **not** change the
measurement engine, and they are **not** platform or regulatory certification.

## Historical sources

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
  former merged Streaming −14 built-in.
