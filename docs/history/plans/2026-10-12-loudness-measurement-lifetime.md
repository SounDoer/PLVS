# Loudness Measurement Lifetime Implementation Plan

**Design:** `docs/history/specs/2026-10-12-loudness-measurement-lifetime-design.md`

## 1. Lock the lifetime contracts with tests

- [x] Add Rust fixtures longer than the former 60-minute boundary whose early and late programme
      material produce distinguishable whole-session and rolling-window results.
- [x] Cover Integrated and LRA in both the Live meter path and File summary path.
- [ ] Cover the lifetime of Dialogue Integrated, Dialogue Range, Dialogue Coverage, and session Max
      values across the same boundary.
- [ ] Add frontend tests showing that a Snapshot reads the cumulative values stored at its selected
      instant rather than recalculating from retained display rows.

## 2. Replace the rolling loudness accumulators

- [x] Remove the 36,000-block eviction from Live and File Integrated calculation.
- [x] Remove the 36,000-value eviction from Live and File LRA calculation.
- [x] Replace front-removing vectors with efficient append/chunked storage appropriate to exact
      full-session gating and percentile calculation.
- [x] Bring dialogue accumulation under the same reviewed storage and reset model without changing
      its VAD semantics.
- [x] Verify that processing remains off the realtime audio callback and that no new callback
      allocation, lock, or syscall is introduced.

## 3. Make History Length a Live Clear operation

- [x] Move the setting change behind one business operation shared by UI and Agent Control.
- [x] Persist the normalized setting and, when a Live measurement exists, invoke the existing full
      Clear path exactly once.
- [x] Keep capture running while resetting native accumulators, frontend intake, Snapshot selection,
      holds, and the measurement clock.
- [x] Remove history-capacity changes as a reason for `useAudioEngine` to tear down and recreate the
      native capture session.
- [x] Update Settings help and tests to state that changing History Length clears Live measurement.

## 4. Separate File history from Live retention

- [x] Remove `histMaxSamples` and `visualMaxSamples` as File analysis lifetime inputs.
- [x] Define and implement bounded multiresolution File timeline stores that preserve complete time
      coverage while reducing display checkpoint density for long files.
- [x] Keep authoritative File summary calculations in the decoding worker and independent of the
      display timeline.
- [x] Preserve beginning-to-end navigation and Snapshot resolution at the retained display
      checkpoint resolution.
- [x] Remove the current File `historyTruncated` outcome once complete time coverage is guaranteed,
      including its report and UI treatment.
- [x] Verify that changing History Length during or after a File run neither cancels nor re-runs it.

## 5. Reconcile metric descriptions and documentation

- [x] Correct the Integrated hint to describe the absolute and relative gates and the complete
      Measurement Session/File lifetime.
- [x] Review LRA, dialogue, Max, PLR, PSR, and Dialogue Offset hints for the same lifetime language.
- [x] Update the relevant `docs/user/` chapters for Live History, Snapshot, File analysis, Clear, and
      History Length.
- [x] Keep standards/Profile source material separate from the measurement-lifetime documentation.

## 6. Verify in layers

- [x] Run focused frontend and Rust tests during each phase.
- [x] Run `npm test`, frontend format/lint/typecheck, and `npm run rust:check` before any commit.
- [x] Run the real capture smoke because the DSP/capture layer changed.
- [ ] Run and retain a four-hour `npm run soak:capture` result, then compare drift with the existing
      completed baselines under `artifacts/soak/` rather than only the script threshold.
- [ ] Exercise a file longer than 60 minutes and a file longer than 240 minutes, confirming exact
      whole-file summaries and beginning-to-end timeline navigation.
- [ ] Run the full `npm run check` before any push or merge.

## 7. Resume the first standards Profiles

- [ ] Revalidate the EBU R 128 Programme, ATSC A/85 Short-form, Spotify, and Apple Podcasts rules
      against the corrected measurement lifetimes.
- [ ] Add Profile details and official source links only after the underlying metrics pass the
      long-duration verification above.
