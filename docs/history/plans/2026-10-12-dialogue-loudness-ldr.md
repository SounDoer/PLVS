# Dialogue Loudness and LDR Implementation Plan

**Design:** `docs/history/specs/2026-10-12-dialogue-loudness-ldr-design.md`

## 1. Record the changed engine decision

- [x] Add an ADR that supersedes ADR 0004: FireRed and Silero remain user-selectable; TEN is removed
      because its current upstream licensing cannot support the earlier maintenance assumption.
- [x] Remove `ten-vad-rs`, the embedded TEN model, adapter code, engine catalogue entry, capability
      declaration, tests, and third-party notice.
- [x] Normalize persisted `ten` selections to FireRed at the persistence boundary and cover the
      migration.
- [x] Keep command-line and Agent Control enum declarations synchronized with the reduced engine set.

## 2. Build the programme-dialogue evaluation harness

- [x] Define a versioned annotation format for valid measurement spans, dialogue spans, channel
      roles, singing/background-speech tags, and expected programme cases.
- [x] Add deterministic adapters that run FireRed, current Silero V5, candidate Silero V6.2, and the
      multichannel fusion candidates over the same decoded samples.
- [ ] Report precision/recall, false-positive and false-negative duration, boundary error, downstream
      DL/LDR/Coverage error, runtime factor, latency, CPU, and peak memory.
- [x] Assemble redistributable synthetic fixtures in the repository.
- [x] Add a reproducible local-manifest path for non-redistributable programme material kept
      outside the repository.
- [x] Record the model hashes, runtime versions, thresholds, and corpus revision in every result.
- [x] Select the Silero generation and fusion policy from the results; do not change the default from
      FireRed without a reviewed result showing a better programme-monitoring trade-off.

## 3. Separate VAD evidence, fusion, and block alignment

- [x] Replace the unconditional all-channel arithmetic average with a detector-input layer that
      receives configured channel roles and excludes LFE.
- [x] Preserve per-channel evidence through a dedicated fusion policy instead of hiding fusion in an
      engine adapter.
- [x] Normalize engine-native frames, probabilities, readiness, and errors into time-aligned evidence
      without treating scores from different engines as interchangeable.
- [x] Align fused decisions to the exact 100 ms loudness-block timeline and test boundary conditions,
      resampler delay, partial frames, resets, and gaps.
- [x] Keep inference and any allocations, locks, model calls, or syscalls off the realtime audio
      callback.

## 4. Implement the metric core

- [x] Add a Dialogue Loudness accumulator using selected BS.1770 block energies, the −70 LUFS
      absolute gate, and no programme-relative gate.
- [x] Replace Dialogue Offset with `LDR = PL − DL`, including unavailable-value propagation.
- [x] Change Dialogue Coverage to dialogue duration over valid measurement duration, retaining
      silence and excluding explicitly invalid gaps.
- [x] Implement the three-second masked Dialogue Range observations and exact duration-weighted
      P10/P95 calculation without an LRA relative gate.
- [x] Version the dialogue algorithm and cover empty, one-observation, long-session, reset, and
      numerical-boundary cases with independent reference fixtures.
- [x] Ensure exact whole-session accumulation follows the approved measurement-lifetime design and
      does not reintroduce a hidden retention cutoff.

## 5. Decouple collection from presentation

- [x] Request Dialogue Detection by default from the Live analysis owner rather than deriving the
      request from visible Stats rows.
- [x] Keep an explicit future-compatible enable/disable setting boundary, but ship detection enabled
      by default.
- [x] Route current VAD engine and relevant channel-role changes through the coherent full Live
      Clear; keep model, threshold, and fusion changes on the same operation when those controls
      are introduced.
- [x] Lock File analysis inputs at start and prevent settings changes from mutating an in-progress
      run.
- [x] Surface initialization and runtime detector failures explicitly; never fall back silently to
      another engine.

## 6. Update Stats, Dock, Profiles, and reports

- [x] Replace the four existing catalogue entries with Dialogue Loudness/DL, LDR, Dialogue
      Coverage/Dlg Cov, and Dialogue Range/Dlg Rng while preserving the current responsive label
      rules and Dock short-label behaviour.
- [x] Add whole-row hover explanations identifying the standardized and PLVS auxiliary metrics.
- [x] Display `—`, neutral, `warn`, and `fail` according to the design without adding Collecting,
      Insufficient, or Pass visual states.
- [x] Keep shipped Profile rules free of auxiliary Dialogue Coverage/Range rules (no built-in
      standards Profiles currently ship); retain both metrics for deliberate Custom Profile rules.
- [x] Update File summaries, Markdown/JSON reports, Live history rows, Snapshot resolution, Agent
      Control inspection, and CLI output to carry the renamed metrics and method identity.
- [x] Treat report/schema compatibility deliberately; do not leave `dialogueLra` or opposite-sign
      offset fields with silently changed meanings.

## 7. Reconcile living documentation

- [x] Update `docs/architecture.md` with the implemented detector-evidence/fusion/loudness boundary.
- [x] Rewrite `docs/user/dialogue-gated-loudness.md` for the four definitions, automatic-detection
      limits, default-on collection, engine choices, and reset behaviour.
- [x] Update System Settings, File analysis, Profile, and CLI documentation where their visible
      behaviour or field names change.
- [x] Correct every remaining claim that Silero is the default.
- [x] Update third-party notices with exact shipped model versions and hashes.

## 8. Verify in layers

- [x] Run focused Rust DSP/engine tests and frontend catalogue, Stats, Dock, Profile, persistence,
      report, Agent Control, and File analysis tests during each phase.
- [x] Run `npm test`, frontend format/lint/typecheck for frontend changes, and `npm run rust:check`
      before each commit.
- [x] Compare Agent Control screenshots before and after the Stats and Dock label changes at narrow
      and wide widths.
- [x] Run `npm run smoke:capture` because the capture/DSP path changes; do not bypass a red result.
- [ ] Run `npm run soak:capture` for four hours and compare drift and resource behaviour with the
      spread of retained completed baselines under `artifacts/soak/`.
- [ ] Analyse the same multichannel files through Live capture and File mode and compare final DL,
      LDR, Coverage, and Range within the reviewed tolerances.
- [x] Run the full `npm run check` before any push or merge.
