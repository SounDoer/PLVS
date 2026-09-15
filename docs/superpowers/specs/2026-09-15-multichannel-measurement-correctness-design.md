# Multichannel Measurement Correctness

Status: Implemented (2026-09-15) per
`docs/superpowers/plans/2026-09-15-multichannel-measurement-correctness.md`; see Verification at the end.

## Context

Multichannel support is being completed in three sub-projects, each with its own spec, plan and
merge:

- **A — measurement correctness (this spec).** Readings that are silently wrong today.
- **B — immersive channel layouts.** BS.2051 role vocabulary, 5.1.2 / 5.1.4 / 7.1.2 / 7.1.4 /
  9.1.6, manual layout presets, source-declared channel layouts, many-channel meter UI.
- **C — object- and scene-based audio.** Not in this round; recorded in the PRD roadmap.

The reference is [ITU-R BS.1770-5 (11/2023)](https://www.itu.int/dms_pubrec/itu-r/rec/bs/R-REC-BS.1770-5-202311-I!!PDF-E.pdf):
Annex 1 (3/2 algorithm, LFE excluded), Annex 3 Table 4 (weights by position: 1.41 for
60° ≤ |azimuth| ≤ 120° with |elevation| < 30°, 1.00 everywhere else) and Table 5 (per-label weights
for BS.2051 systems, including M±090 = 1.41 and M±135 / M+180 = 1.00 in 0+7+0).

## Problems

1. **7.x weights are wrong.** Every non-front, non-LFE channel gets 1.41. BS.1770-5 gives back
   surrounds (M±135) and centre surround (M+180) 1.00, so 7.0 / 7.1 read high by up to 1.5 LU.
2. **7.x channel order is inconsistent.** The Rust 7.1 comment says `FL FR C LFE BL BR SL SR`; the
   Rust 7.0 comment says `… SL SR BL BR`; frontend labels name slots 5–6 `Ls/Rs` and 7–8 `Lb/Rb`.
   Equal weights hid this. Correct weights make order matter.
3. **The same weight table exists three times:** `LoudnessMeter` auto 5.0 / 7.0 branches,
   `LoudnessMeter` hand-written 5.1 / 7.1 loops, and `SummaryMeter::auto_weights` (CLI analyze and
   CLI capture).
4. **Unknown layouts degrade silently.** Any channel count without a table (3, 4, 9+) measures
   Ch1/Ch2 as stereo with no visible indication. The PRD requires degradation to be explicit.
   The Rust layout metadata also disagrees with the frontend resolver for 3 and 4 channels.
5. **True Peak reads only Ch1/Ch2.** BS.1770 True Peak is the maximum over all channels.

## Out of scope

Immersive layouts, role vocabulary changes beyond weights, manual layout preset UI, reading
WAVEFORMATEXTENSIBLE masks / CoreAudio layout tags / ffprobe `channel_layout`, per-channel True Peak
arrays, object and scene-based audio. All belong to B or C.

Also B: the `visual` recording stereo downmix
(`src-tauri/src/visual_capture/recording/audio.rs`) handles only 6 and 8 channels and silently
takes Ch1/Ch2 for every other count. Its 7.1 matrix sums slots 5+7 left and 6+8 right, so the A
channel-order decision does not change its output. Agent Control layout read/write, per-channel
True Peak and layout-aware pair suggestions are also B.

## Decision 1: one weight table, WAVE / ffmpeg channel order

A single function in `src-tauri/src/dsp/` returns the loudness weights for a channel count, or
`None` when the count has no standard layout. `LoudnessMeter` (auto and the `Surround51` /
`Surround71` settings) and `SummaryMeter` all call it and feed `push_interleaved_weighted`-style
summation. The hand-written 5.1 / 7.1 loops are removed.

Channel order is the native WAVE (`KSAUDIO_SPEAKER_*`) order, which is also ffmpeg's native layout
order, so WASAPI capture and file decode agree:

| Channels | Layout | Order | Weights |
| --- | --- | --- | --- |
| 1 | mono | M | existing mono path |
| 2 | stereo | L R | existing stereo path |
| 3 | lcr | L R C | 1, 1, 1 |
| 4 | quad | L R Ls Rs | 1, 1, 1.41, 1.41 |
| 5 | 5.0 | L R C Ls Rs | 1, 1, 1, 1.41, 1.41 |
| 6 | 5.1 | L R C LFE Ls Rs | 1, 1, 1, 0, 1.41, 1.41 |
| 7 | 7.0 | L R C Lb Rb Ls Rs | 1, 1, 1, 1.00, 1.00, 1.41, 1.41 |
| 8 | 7.1 | L R C LFE Lb Rb Ls Rs | 1, 1, 1, 0, 1.00, 1.00, 1.41, 1.41 |

`Ls/Rs` means the 1.41 surround pair (≈110° in 5.x, ±90° side in 7.x); `Lb/Rb` means the ±135°
back pair. 1.41 is the existing `SURROUND_LOUDNESS_WEIGHT` (+1.5 dB).

Frontend changes in the same commit series:

- `PEAK_METER_CHANNEL_FORMATS`: `surround70` labels become `L R C Lb Rb Ls Rs`; `surround71`
  becomes `L R C LFE Lb Rb Ls Rs`.
- `LOUDNESS_WEIGHT_BY_ROLE_ID`: `Lb`, `Rb`, `Cs` become 1.00. `Ls`, `Rs` stay 1.41.
- The `channelRoles.js` header comment stops claiming height roles have no loudness meaning; they
  already drive weights (1.00).

**User-visible consequence:** 7.0 / 7.1 Integrated, M, S and LRA drop by 0 to 1.5 LU depending on
back-surround energy (≈ −0.4 LU with equal energy in every channel). Commit type `fix(dsp)`; the
release notes must state the change and its reason.

**Saved 8-channel overrides are not migrated.** Weights follow the saved role tokens, so a saved
override keeps measuring exactly what its roles say. Users who saved the old default labels have
`Ls/Rs` on slots 5–6; the release note tells them to re-check 7.x channel labels.

## Decision 2: unknown layouts stay Ch1/Ch2 and say so

- Rust `loudness_layout_meta` adds `3 → "lcr"` and `4 → "quad"` (known), matching
  `channelLayoutResolver.js`.
- Channel counts without a table (9 and above) keep the existing Ch1/Ch2
  stereo loudness and report `loudnessLayout = "unknown"`, `loudnessLayoutKnown = false`. A user
  channel-label override still switches to `custom` weighted loudness, as today.
- **Live UI:** when `loudnessLayoutKnown` is false, the Loudness panel, the Stats panel and the Dock
  Loudness module show a compact `Ch 1–2` marker next to the loudness readout. Its tooltip:
  "Layout not recognized. Loudness uses channels 1–2 only." Exact placement and styling follow the
  existing panel chrome and are settled in the implementation plan.
- **File and CLI summaries:** `SummaryMetrics`, `FileAnalysisSummaryMetrics`, `CliAnalyzeSummary`
  and the CLI capture run gain `loudnessLayout` and `loudnessLayoutKnown` (additive fields). The
  GUI file summary shows the same `Ch 1–2` marker when unknown.
- Agent Control already exposes `loudnessLayout` / `loudnessLayoutKnown` in `measurement` results;
  see Decision 4 for the documented semantics.

Rejected: summing every channel at 1.00 for unknown counts. Channel 4 is not necessarily LFE, and a
surround-looking number on an unrecognized layout is exactly what the PRD forbids.

## Decision 3: True Peak covers every channel

- `LoudnessMeter` and `SummaryMeter` hold oversampling history per actual channel instead of a
  fixed pair. Buffers are sized on construction and on channel-count change, never in the per-sample
  path.
- `truePeakMaxDbtp` (live frame, file summary, CLI analyze, CLI capture) is the maximum across all
  channels. The Level Meter TP Max marker, Stats, Loudness Profile evaluation and the file summary
  already read this value.
- `truePeakL` / `truePeakR` keep their Ch1 / Ch2 meaning; see Decision 4 for the Agent Control
  consequences.
- Cost: 3 interpolated phases × 32 taps per sample per channel (≈37 M multiply-adds per second at
  8 ch / 48 kHz), on the DSP consumer thread, not the audio callback.

## Decision 4: Agent Control contract

The Agent Control schema, field names, capability declaration and generated reference do not
change. Values do change for inputs with more than two channels; stereo and mono are unchanged.

| Field | Change |
| --- | --- |
| `levels.truePeak.maxDbtp` | Maximum over all channels instead of Ch1/Ch2 |
| `loudness.psrDb`, `loudness.plrDb` | Follow `maxDbtp` (both derive from `tpMax` in `statsCatalog.js`) |
| `loudness.*` for 7.0 / 7.1 | Lower readings from the weight fix |
| `profile` verdicts | May change because they evaluate the same values |
| `loudnessLayout` | Gains `lcr` and `quad` for 3 / 4 channels, previously `unknown` |
| `levels.truePeak.leftDbtp` / `rightDbtp` | Unchanged: still Ch1 / Ch2 only |

`docs/agent-control/measurements.md` gains:

- `maxDbtp` is the maximum True Peak across every channel.
- `leftDbtp` / `rightDbtp` are Ch1 / Ch2 only, whatever the channel count.
- The full `loudnessLayout` value set: `mono`, `stereo`, `lcr`, `quad`, `5.0`, `5.1`, `7.0`, `7.1`,
  `custom` (user channel-label override) and `unknown`. `unknown` means loudness is Ch1/Ch2 stereo
  loudness and `loudnessLayoutKnown` is false. Clients must not treat the set as closed; B adds
  values.

Release notes mention the `maxDbtp` / PSR / PLR and 7.x value changes for automation users.

## Decision 5: documentation

- `docs/prd.md` multichannel section: weights cite BS.1770-5 Table 5; known layouts list mono,
  stereo, LCR, quad, 5.0, 5.1, 7.0, 7.1; True Peak is all channels; unknown layouts degrade to
  Ch1/Ch2 with a visible marker.
- `docs/prd.md` implementation table: record the gap that manual Stereo / 5.1 / 7.1 presets are
  promised but have no UI entry (owned by B). Add object / scene-based audio to the roadmap (C).
- `docs/architecture.md` §5 and `docs/agent-control/measurements.md` updated to match.

## Testing

Rust:

- The weight table matches the Decision 1 table for every count, and returns `None` for 9+.
- A 7.1 signal present only in `Lb/Rb` reads 1.5 LU lower than the same signal only in `Ls/Rs`.
- `LoudnessMeter` and `SummaryMeter` agree (Integrated, M max, S max, True Peak max) for 3–8
  channels.
- An inter-sample peak placed only on channel 8 is reported by `truePeakMaxDbtp` in both meters,
  while `truePeakL/R` do not see it.
- 10 channels: layout `unknown`, known `false`, loudness equal to a stereo measurement of Ch1/Ch2.
- `loudness_layout_meta` returns `lcr` / `quad` for 3 / 4 channels.
- Existing 5.1 / 7.1 expectations are updated deliberately, never loosened.

Vitest:

- 7.0 / 7.1 default labels.
- Role weights for `Lb`, `Rb`, `Cs`.
- The `Ch 1–2` marker renders only when the layout is not known, in live and file-summary views.

Capture layer: this changes `src-tauri/src/dsp`, which CI does not exercise with real devices. Run
`npm run smoke:capture` before merge (its stereo VB-Cable baselines are expected to be unchanged) and
`npm run soak:capture` afterwards.

## Risks

- **macOS 7.x channel order is unverified.** CoreAudio devices may deliver side-first order. A adds
  a manual macOS check; reading the layout tag is B.
- **Windows 8-channel "7.1 wide"** (`FLC/FRC`) is indistinguishable from 7.1 surround through cpal.
  A treats all 8-channel input as 7.1 surround; source-declared layouts are B.

## Verification

Recorded 2026-09-15 on `feat/multichannel` rebased onto main `8bd4ba69`.

- `npm run check`: exit 0 (357 Vitest files / 4249 tests; 640 Rust library tests; fmt, clippy,
  lint, build).
- `npm run smoke:capture` with a freshly built capture harness, before and after the rebase: live
  capture agrees with the file path on the stereo VB-Cable rig (Integrated −22.0306 file /
  −22.0339 live LUFS; sample peaks identical), so the stereo baseline did not move.
- Development app, File mode, synthetic 12-channel WAV: the summary reports
  `loudnessLayout: "unknown"`, `loudnessLayoutKnown: false`, 12 channels; Agent Control screenshots
  show the `Ch 1–2` marker in the Loudness chart (top-right), the Stats panel and the file summary.
  With the loudness trace near the top of the chart the marker covers a short stretch of it; accepted.

Not verified:

- Dock Loudness marker with a live input of 9+ channels. The only such input on the test machine was
  held by another application, so capture never started. Check manually.
- macOS 7.x channel order (Risk 1) and 8-channel "7.1 wide" sources (Risk 2).

Found along the way and handled outside this spec: Agent Control artifact storage failed under Windows
app-package filesystem redirection (fixed on main in `b80fd389`, `8bd4ba69`); a frontend hang after a
failed live capture followed by entering and leaving Dock was filed as a separate task.
