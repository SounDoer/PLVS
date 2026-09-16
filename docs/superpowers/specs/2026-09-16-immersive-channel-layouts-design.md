# Immersive Channel Layouts (B1)

Status: Designed (2026-09-16). Implementation plan to follow.

## Context

Multichannel support is being completed in three sub-projects (see
`docs/superpowers/specs/2026-09-15-multichannel-measurement-correctness-design.md`). A — measurement
correctness — merged on 2026-09-15. B — immersive channel layouts — is split into four:

- **B1 — layout model and manual selection (this spec).** One shared layout table, BS.2051 role
  vocabulary for immersive layouts, a layout picker in Settings, layout read/write over Agent
  Control and a `--layout` flag on the standalone CLI.
- **B2 — source-declared layouts.** ffprobe `channel_layout` for files (B2a); WAVE channel mask and
  CoreAudio layout tag for live capture (B2b), which also settles the unverified macOS 7.x channel
  order from A.
- **B3 — layout-derived measurement and export.** Per-channel True Peak, `visual` recording downmix
  beyond 6 / 8 channels, the Dock Stats `Ch 1–2` marker and recording layout dependence in
  `statsCatalog.js`.
- **B4 — many-channel UI.** Layout-aware channel pair ordering and grouping, Waveform label overlap
  at 12 channels.

Order: B1 → B2a → B4 → B3 → B2b. Everything depends on B1's table.

The reference is [ITU-R BS.1770-5 (11/2023)](https://www.itu.int/dms_pubrec/itu-r/rec/bs/R-REC-BS.1770-5-202311-I!!PDF-E.pdf)
Annex 3, Table 4 and Table 5. Channel order follows ffmpeg's native layout order, which is the WAVE
(`KSAUDIO_SPEAKER_*`) bit order, as decided in A.

## Problems

1. **Immersive layouts are unrecognised.** Anything above 8 channels measures Ch 1–2 as stereo. A
   7.1.4 deliverable (12 channels) cannot be measured correctly at all.
2. **Channel count alone cannot identify a layout.** 8 channels is 7.1 or 5.1.2; 10 channels is
   5.1.4 or 7.1.2. Guessing produces silently wrong weights.
3. **There is no layout entry point.** The PRD promises manual Stereo / 5.1 / 7.1 presets. The
   engine enum `ChannelLayoutSetting` exists but no UI ever sets it — the frontend hardcodes
   `"auto"` (`src/App.jsx`, `src/runtime/appRuntimeDerivations.js`). The per-channel role editor in
   Settings is the only working manual path, and it needs one choice per channel: twelve for 7.1.4.
4. **Two manual mechanisms.** `ChannelLayoutSetting` and the per-channel role override both claim to
   decide the layout.
5. **The weight data exists twice.** `src/math/channelRoles.js` (role → weight) and
   `src-tauri/src/dsp/channel_weights.rs` (channel count → weights) are kept in step by a comment.
6. **A selected layout is reported as `custom`.** The frontend sends a bare weight array, so the
   engine reports `loudnessLayout: "custom"` for anything the user set. Automation cannot tell a
   standard 7.1.4 from an arbitrary per-channel override.
7. **An unknown layout has no repair path.** The `Ch 1–2` marker says the reading is degraded but
   not what to do about it.

## Out of scope

Reading source-declared layouts (B2), per-channel True Peak, `visual` downmix and `statsCatalog`
(B3), channel pair and Waveform UI (B4), object- and scene-based audio (C). Channel orders other
than WAVE / ffmpeg (film order `L C R Ls Rs LFE`, Pro Tools orders) get no presets; the per-channel
role editor remains the way to express them.

## Decision 1: no layout guessing above 8 channels

Auto detection by channel count is unchanged: mono, stereo, LCR, quad, 5.0, 5.1, 7.0, 7.1. 8
channels stays 7.1. 9 and above stay `unknown`, keep `loudnessLayoutKnown: false` and keep the
`Ch 1–2` marker.

Immersive layouts are reached by manual selection (this spec) or by a source declaration (B2), never
by counting channels. Many-channel live inputs — 12- and 16-input interfaces, Dante, ADAT — carry
microphones, not speaker feeds; weighting them as 9.1.6 would be wrong and invisible. This follows
A's rule that degradation must be visible.

## Decision 2: one shared layout table

A single JSON file, `shared/channel-layouts.json`, holds both tables. The frontend imports it; Rust
embeds it with `include_str!` and parses it once, the way `src-tauri/src/cli_manifest.rs` already
embeds `src/agentControl/commandManifest.json`. `shared/` is the repository's existing home for
cross-language sources — `shared/analysis-request-key-fixtures.json` and
`shared/cli-v1-envelope-fixtures.json` are read by Vitest and by cargo tests alike, so changing one
side without the other fails a test. Loudness weights appear nowhere else.

**Roles.** The existing vocabulary (`generic`, `M`, `L`, `R`, `C`, `LFE`, `Ls`, `Rs`, `Lb`, `Rb`,
`Cs`, `Ltf`, `Rtf`, `Ltr`, `Rtr`) gains `Lw`, `Rw`, `Ltm`, `Rtm`. Weights follow BS.1770-5 Table 4:
1.41 (+1.5 dB) for |elevation| < 30° with 60° ≤ |azimuth| ≤ 120°, 1.00 everywhere else, 0 for LFE.
So `Ls`, `Rs` (M±090 / M±110) and `Lw`, `Rw` (M±060) are 1.41; `Lb`, `Rb` (M±135), `Cs` (M+180) and
every upper-layer role (`Ltf`, `Rtf`, `Ltm`, `Rtm`, `Ltr`, `Rtr`) are 1.00.

**Layouts,** in ffmpeg / WAVE order:

| id | Roles |
| --- | --- |
| `mono` | M |
| `stereo` | L R |
| `lcr` | L R C |
| `quad` | L R Ls Rs |
| `5.0` | L R C Ls Rs |
| `5.1` | L R C LFE Ls Rs |
| `7.0` | L R C Lb Rb Ls Rs |
| `7.1` | L R C LFE Lb Rb Ls Rs |
| `5.1.2` | L R C LFE Ls Rs Ltf Rtf |
| `5.1.4` | L R C LFE Ls Rs Ltf Rtf Ltr Rtr |
| `7.1.2` | L R C LFE Lb Rb Ls Rs Ltf Rtf |
| `7.1.4` | L R C LFE Lb Rb Ls Rs Ltf Rtf Ltr Rtr |
| `9.1.6` | L R C LFE Lb Rb Lw Rw Ls Rs Ltf Rtf Ltr Rtr Ltm Rtm |

As in A, a role names the weighting position, not the WAVE speaker bit: ffmpeg writes 5.1.2 and
5.1.4 with `BL/BR`, which sit at the same interleaved slots and the same ≈110° position as `Ls/Rs`.
`Lw/Rw` occupy ffmpeg's `FLC/FRC` slots in 9.1.x. ffmpeg orders `TSL/TSR` (`Ltm/Rtm`) last, after
`TBL/TBR`; Dolby's own 9.1.6 ordering differs and is not used here.

The following are removed: the hand-maintained role weight map in `src/math/channelRoles.js`, the
count table in `src/math/peakMeterChannelLabels.js`, the count table in
`src-tauri/src/dsp/channel_weights.rs`, and the `ChannelLayoutSetting` enum with its plumbing
through `meter_pipeline.rs`, the capture backends and the frontend's hardcoded `"auto"`.

## Decision 3: roles are the interchange, the layout name is derived

The IPC command that carries `weights` becomes a command that carries the role list. Rust looks up
the weights itself and derives the reported layout:

- role list length ≠ channel count → ignored; auto detection applies (today's behaviour for a
  mismatched weight array),
- role list equals a layout's roles → `loudnessLayout` is that layout id, `loudnessLayoutKnown` true,
- otherwise → `"custom"`, known true,
- no role list → auto detection by count; 9+ channels is `"unknown"`, known false.

`loudnessLayout` gains `5.1.2`, `5.1.4`, `7.1.2`, `7.1.4` and `9.1.6`. A documented that the value
set is open and that B would extend it, so this is not a breaking change.

Readings change only where the user selects a layout. Auto detection is untouched, so existing
setups do not move.

**Persistence is unchanged.** `channelLabelOverrides` already stores `{ channelCount: roles[] }`
(`src/hooks/useMeterSettings.js`, `src/persistence/profileShape.js`). Selecting a layout writes that
channel count's role array; the current layout is derived by matching the stored roles against the
table. No new field, no migration.

## Decision 4: a Layout row above the per-channel roles

The Settings "Channels · Nch" section gains a **Layout** select above the per-channel selects.

- Options are the layouts whose channel count equals the current count, plus `Custom`. 12 channels
  offers `7.1.4`; 8 channels offers `7.1` and `5.1.2`.
- The current value is derived from the role list: an exact match shows that layout, anything else
  shows `Custom`.
- Choosing a layout fills every per-channel select. Editing one afterwards leaves the roles in place
  and flips Layout to `Custom`.
- With no input connected (channel count 0) the section keeps today's
  "Connect an input to label its channels." message.
- The existing reset button is unchanged: it clears the override for that channel count and returns
  to auto detection.

## Decision 5: a footer prompt when the layout is unknown

When the displayed source reports `loudnessLayoutKnown === false` and the channel count is above 0,
the footer shows a clickable **`Channel layout unknown · Set in Settings`**, next to and styled like
the existing update prompt in `src/components/AppShell.jsx`, sharing `onOpenSettings`. It disappears
once a layout is known.

It applies to live and file analysis alike, is hidden with the footer in focus mode, and does not
replace the `Ch 1–2` marker: the marker says the reading is degraded, the footer says how to fix it.
The Dock has no footer and keeps the marker alone.

This also covers A's unverified item — the degradation prompt for a live 9+ channel input.

## Decision 6: layout on the CLI and over Agent Control

**Agent Control.** `settings.channelLabels` gains `layout` beside `roles`. Reading returns the
derived layout id or `custom`; writing it fills the roles for that channel count. A patch that sets
both `layout` and `roles` is refused as a conflict. Per `docs/agent-control/README.md`, the schema,
read/patch mapping, capability declaration, contract tests and documentation change together, and
`docs/agent-control/generated/` is never hand-edited.

**Standalone CLI.** `plvs-cli analyze` and `plvs-cli capture` gain `--layout <id>`, accepting layout
ids only. A channel count mismatch is an error exit, never a silent fallback. `docs/cli.md` and the
CLI contract tests are updated. Per-channel role arguments are deliberately not added.

**Documentation.** `docs/prd.md` A.3 marks the manual layout preset gap delivered;
`docs/agent-control/measurements.md` lists the new `loudnessLayout` values; `docs/architecture.md`
§5 matches.

## Testing

Rust:

- The shared JSON parses; every layout's role count equals its channel count; every role exists in
  the role table.
- Weights match BS.1770-5: in 9.1.6 only `Ls Rs Lw Rw` are 1.41, every upper-layer role is 1.00, LFE
  is 0; 7.1.4's `Lb Rb` are 1.00.
- A role list matching a layout reports that id; changing one role reports `custom`; a wrong-length
  list falls back to auto detection.
- Auto detection is unchanged: 8 channels is 7.1, 12 channels is `unknown` with known false.
- `--layout` with a mismatched channel count exits with an error.

Vitest:

- The frontend and Rust read the same shared file (contract test, as for `cli_manifest`).
- Selecting a layout fills the roles; editing one role returns the Layout select to `Custom`.
- The Layout select offers only layouts matching the channel count.
- The footer prompt renders when `loudnessLayoutKnown === false` with channels present, and not
  otherwise.

Capture layer: this changes `src-tauri/src/dsp`, which CI does not exercise with real devices. Run
`npm run smoke:capture` before merge — the stereo VB-Cable baseline is expected to be unchanged —
and `npm run soak:capture` afterwards.

Manual:

- A 12-channel WAV set to 7.1.4: the `Ch 1–2` marker and the footer prompt disappear and the
  loudness reading changes plausibly.
- A multichannel live input: the footer prompt appears and opens Settings.

## Risks

- **SMPTE bed order shifts the +1.5 dB pair, and does so invisibly.** Dolby's bed order for 5.1
  through 7.1.2 is `L R C LFE Ls Rs Lrs Rrs Ltm Rtm` — side surrounds at slots 5–6, rear surrounds
  at 7–8. WAVE / ffmpeg order is the opposite: `BL BR` at 5–6, `SL SR` at 7–8. Sides weigh 1.41,
  rears 1.00, so material authored in bed order and measured as WAVE order puts the +1.5 dB on the
  wrong pair whenever those pairs differ. 9.1.6 diverges further: ffmpeg is
  `… Lb Rb Lw Rw Ls Rs …`, Dolby is `… Ls Rs Lrs Rrs Lw Rw …`.

  WAVE / ffmpeg order is kept anyway, and no SMPTE-order presets are added. It is the order the
  pipeline actually delivers — WASAPI hands over the device mask's bit order, ffmpeg decode its
  native order — it is A's decision for 7.1 already, and it is the only vocabulary a source
  declaration can use in B2: the Windows channel mask has 18 bits and none for wide or top-side, so
  9.1.6 cannot be expressed as a mask at all. Two presets per layout would put two near-identical
  entries in the picker, where choosing wrong fails just as silently.

  The escape hatch is the per-channel role editor: select the layout, then swap the two surround
  pairs. The mismatch is at least visible in the Peak meter headers, which will not match the DAW's
  track names.
- **The bundled ffmpeg 7.1 has no 9.1.6 layout** (it stops at 9.1.4). This does not affect B1, which
  never asks ffmpeg for a layout name, but B2a must handle it.
- **The IPC signature change touches the capture path.** The role list reaches the engine through
  the same plumbing as the weight array, so a mistake there shows up only under real capture, which
  CI does not run. The smoke run before merge is the guard.
