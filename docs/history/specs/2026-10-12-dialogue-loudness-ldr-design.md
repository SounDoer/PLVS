# Dialogue Loudness and LDR — design

Date: 2026-10-12
Status: approved

## Problem

PLVS already exposes Dialogue Coverage, Dialogue Integrated, Dialogue Range, and Dialogue Offset,
but the implementation and presentation do not form a standards-aligned system:

- Dialogue Integrated reuses the programme Integrated accumulator, including its −10 LU relative
  gate. Speech-gated measurement in ATSC A/85 instead uses the BS.1770 loudness calculation with
  speech selection and without that programme-relative gate.
- Dialogue Offset is `DL − PL`, the opposite sign from the EBU R 128 S4 Loudness-to-Dialogue Ratio
  (`LDR = PL − DL`).
- Dialogue Coverage currently excludes programme blocks below −70 LUFS from its denominator, so it
  describes the share of audible gated blocks rather than the share of valid measurement time.
- Dialogue Range feeds ordinary three-second programme Short-term values into the EBU LRA
  accumulator whenever speech is active. A selected value can therefore contain mostly music or
  effects, and the result resembles standardized Programme LRA without having a standardized
  dialogue definition.
- Detection currently averages every input channel to one mono signal before inference. That can
  cancel out-of-phase speech and dilute dialogue in multichannel programme material.
- Dialogue detection runs only when a dialogue row is visible in Stats. Measurement semantics
  therefore depend on panel configuration.
- The three selectable engines have diverged in maintenance status. FireRed remains a credible
  current engine, the embedded Silero model is V5 while upstream has moved to V6.2, and the current
  TEN upstream license contains additional restrictions that are not reflected in PLVS's
  Apache-2.0 notice.

The product needs internally consistent measurements, an honest boundary between standardized and
PLVS-defined quantities, and results whose scope does not depend on which rows happen to be visible.

## Goals

- Base all loudness energy on the existing ITU-R BS.1770-5 signal path and channel weighting.
- Align Dialogue Loudness and LDR semantics with ATSC A/85 and EBU R 128 S4 where those documents
  define them.
- Keep speech detection separate from loudness math so detectors can be evaluated or replaced
  without redefining the loudness metrics.
- Give Dialogue Coverage and Dialogue Range exact, useful, explicitly PLVS-owned definitions.
- Use the same metric definitions in Live and File analysis.
- Preserve an honest monitoring-tool claim; this work does not make PLVS a certified meter or turn
  an open VAD into Dolby Dialogue Intelligence.

## Non-goals

- Separating dialogue into a clean audio stem.
- Identifying speakers, transcribing speech, or understanding narrative importance.
- Guaranteeing separation of foreground dialogue, background speech, television speech, or singing.
- Adding another user-selectable VAD in this work.
- Defining compliance thresholds for PLVS auxiliary metrics in built-in standards Profiles.

## Standards boundary

The normative references for this design are:

- ITU-R BS.1770-5 for K-weighting, channel weighting, block energy, and loudness units;
- EBU R 128 and R 128 S4 for Programme Loudness, Dialogue Loudness, and the sign and meaning of LDR;
- EBU Tech 3342 for Programme Loudness Range, which remains distinct from PLVS Dialogue Range;
- ATSC A/85 for speech-gated long-form measurement without the programme-relative gate.

The standards do not prescribe PLVS's automatic VAD model, multichannel detector fusion, Dialogue
Coverage, or Dialogue Range. Those parts are product definitions and must be described as such.

## Dialogue semantics

For this version, **dialogue means automatically detected spoken-voice activity in the programme
mix**. The detector can include background speech or singing and can miss quiet, masked, processed,
or unusual speech. PLVS must not imply that it understands which voice is narratively primary.

The UI and user guide use “Dialogue” because the metrics serve dialogue-oriented programme
monitoring, while their help text states that the selection is an automatic local estimate. No
audio leaves the device.

## Metric definitions

All four dialogue metrics share one time-aligned dialogue mask. A detector failure makes all four
unavailable rather than silently selecting another engine or continuing with stale decisions.

### Dialogue Loudness (DL)

Dialogue Loudness is the energy average of BS.1770 programme blocks selected by the dialogue mask.

- The measured audio remains the full programme mix with its configured BS.1770 channel roles and
  weights. The VAD selects time; it does not replace the programme audio with a detector downmix.
- Selected blocks must pass the −70 LUFS absolute gate.
- There is no −10 LU programme-relative gate.
- The result covers the complete current Live Measurement Session or complete File Programme.
- Unit: LUFS.
- No qualifying dialogue produces an unavailable value, displayed as `—`.

This requires a dedicated dialogue accumulator. Reusing `IntegratedAccumulator` is not valid because
that type deliberately applies the Programme Loudness relative gate.

### Loudness-to-Dialogue Ratio (LDR)

`LDR = Programme Loudness − Dialogue Loudness`

- Programme Loudness is PLVS's existing whole-session or whole-file Integrated value.
- Dialogue Loudness is the value defined above over the same measurement scope.
- Unit: LU.
- A positive value means the programme is louder than its dialogue-gated measurement.
- If either input is unavailable, LDR is unavailable.

The existing `Dialogue Offset = DL − PL` presentation is removed rather than retained as a second,
opposite-sign metric.

### Dialogue Coverage (Dlg Cov)

`Dialogue Coverage = detected dialogue duration / valid measurement duration × 100`

- Silence is valid measurement time and remains in the denominator.
- Capture gaps, dropped or invalid audio, decoder gaps, and time before detection is ready are not
  valid measurement time.
- Coverage does not use a loudness gate. Quiet detected speech still counts as dialogue time even if
  it is below the −70 LUFS gate used by DL.
- Unit: percent.
- A valid interval with no detected dialogue produces `0%`.
- Detector failure produces `—`, not `0%`.

Coverage is a PLVS auxiliary metric, not a BS.1770, EBU, or ATSC metric.

### Dialogue Range (Dlg Rng)

Dialogue Range describes variation within detected dialogue and is deliberately not called
Dialogue LRA.

1. Keep time-aligned 100 ms BS.1770 programme energies and dialogue decisions.
2. At a one-second cadence, form a complete three-second observation window.
3. Within that window, average only dialogue-selected blocks that pass the −70 LUFS absolute gate.
   Non-dialogue blocks do not dilute the observation.
4. Give the resulting observation a weight equal to its qualifying dialogue duration.
5. Across the Measurement Session or File Programme, compute the weighted 95th percentile minus
   the weighted 10th percentile.

The calculation has no relative gate. Percentiles provide outlier resistance without presenting
the EBU Programme LRA algorithm as a dialogue standard. Unit: LU.

- No valid dialogue observation produces `—`.
- One valid observation produces `0.0 LU`.
- Before a complete three-second observation can exist, the value is `—`; no separate Collecting
  status is shown.

Dialogue Range is a PLVS auxiliary metric. It is useful for comparing steady dialogue with dialogue
that varies substantially over a programme, but it is not a compliance measurement.

## Detection pipeline

### Engine set

The shipped user choices become FireRed and Silero.

- FireRed remains the provisional default until PLVS's programme corpus says otherwise.
- Silero V5 is measured against Silero V6.2. V6.2 replaces V5 only if it passes accuracy, runtime,
  packaging, and platform checks.
- TEN and its embedded model are removed. A persisted `ten` selection normalizes to FireRed.
- NeoVAD and other new detectors are not introduced. They may be reconsidered in a later, separately
  reviewed evaluation.

There is no automatic runtime fallback between FireRed and Silero. A selected detector that cannot
initialize or stops producing valid results creates one explicit detection error and unavailable
dialogue metrics.

### Evidence before decisions

Engine adapters preserve the richest practical frame evidence, including probability when an engine
provides it, plus engine timing and readiness. Engine-native frame sizes and post-processing remain
inside the adapter. A common layer then aligns decisions to the 100 ms loudness blocks.

The common interface must not pretend that scores from different models are calibrated identically.
Thresholds and hysteresis are engine-specific, versioned configuration selected by evaluation.

### Multichannel detection

Detection no longer begins with an arithmetic average of all channels.

- Run detection evidence over each non-LFE channel or over explicitly reviewed detector feeds
  derived from those channels.
- Preserve configured channel roles at the fusion boundary.
- Exclude LFE from speech evidence.
- Evaluate at least independent-channel maximum, energy-weighted fusion, and centre-priority with
  non-LFE fallback.
- For an unknown layout, make no centre assumption and fuse independent non-LFE evidence.

The benchmark selects the shipped fusion policy. The architecture keeps that policy separate from
engine adapters and from BS.1770 loudness accumulation. A change of fusion policy is an algorithm
change and must restart the measurement.

## Measurement lifetime and reset rules

Dialogue Detection is enabled by default and is independent of Stats visibility. Hiding every
dialogue row stops rendering those values but does not change the measurement.

The following changes start a new complete Live Measurement Session so Programme Loudness and
dialogue-derived values always cover the same scope:

- VAD engine or model version;
- engine threshold or material post-processing configuration;
- multichannel fusion policy;
- channel-role configuration when it changes the detector feed or BS.1770 measurement;
- enabling Dialogue Detection after it has explicitly been disabled.

The reset includes Programme Loudness, dialogue accumulators, session maxima, retained Live history,
Snapshot selection, and the measurement clock through the existing coherent Clear operation.

File analysis captures the engine, model version, detector configuration, channel roles, and fusion
policy at start. Those inputs remain fixed until the run completes or is cancelled.

## Presentation

Stats uses the existing responsive full-label/short-label behaviour. Dock always uses short labels.

| Full label                 | Short label | Unit |
| -------------------------- | ----------- | ---- |
| Dialogue Loudness          | DL          | LUFS |
| Loudness-to-Dialogue Ratio | LDR         | LU   |
| Dialogue Coverage          | Dlg Cov     | %    |
| Dialogue Range             | Dlg Rng     | LU   |

The whole Stats row provides the existing hover explanation; no permanent question-mark icon is
required. Help text identifies DL and LDR's standards relationship and labels Coverage and Range as
PLVS auxiliary metrics.

Only `warn` and `fail` are visual Profile breach states. PLVS does not invent universal Collecting,
Insufficient, or Pass thresholds:

- unavailable math displays `—`;
- an available metric with no applicable Profile rule remains neutral;
- an available metric inside an applicable rule remains neutral;
- `warn` or `fail` appears only when a rule is breached;
- detector failure is an explicit error and displays `—` for dialogue metrics.

Built-in standards Profiles may judge metrics defined by their source specification. They do not
judge Dialogue Coverage or Dialogue Range. Custom Profiles may use those auxiliary metrics.

## Reports, history, and reproducibility

Live Snapshots remain transient history selections; this design does not introduce saved Snapshot
documents.

File reports and machine-readable inspection include enough method identity to interpret the result:

- metric algorithm version;
- selected VAD engine and model version;
- engine configuration identity;
- multichannel fusion policy;
- DL, LDR, Coverage, and Range values or explicit unavailability.

Reports must not describe a result as certified. A future algorithm revision that can materially
change an auxiliary metric receives a new method version rather than silently changing the meaning
of an old report field.

## Evaluation gate

No detector or fusion policy becomes recommended from an upstream headline benchmark alone. PLVS
uses an annotated programme-material corpus containing at least:

- clean speech and speech over music or effects;
- quiet, whispered, shouted, telephone-band, and heavily processed dialogue;
- multiple languages and accents;
- singing, instrumental music, crowd sound, and background or secondary speech;
- stereo, centre-led surround, off-centre dialogue, and unknown layouts;
- silence and very low-level material.

Evaluation reports both detection quality and downstream product error:

- precision, recall, false-positive duration, and false-negative duration;
- onset and release timing error;
- DL error in LU against the annotated reference mask;
- LDR error in LU and Coverage error in percentage points;
- Dialogue Range stability and sensitivity to short false positives;
- realtime factor, callback-to-result latency, CPU, and memory on Windows and macOS.

FireRed remains default only if it provides the best overall programme-monitoring trade-off. Silero
V6.2 ships only after the same evaluation. Benchmark fixtures and expected annotations are versioned
so later model updates can be compared with the same evidence.

## Verification

Implementation is complete only when:

- conformance fixtures prove the DL absolute-only gate and LDR sign;
- silence affects Coverage's denominator while invalid gaps do not;
- the Dialogue Range implementation matches an independent weighted-percentile reference;
- music-only portions surrounding a short dialogue event do not enter its masked range energy;
- hiding or showing Stats rows cannot change accumulated dialogue values;
- changing a detector or its material configuration performs one coherent full-session reset;
- Live and File produce equivalent final values for the same decoded samples and fixed settings;
- multichannel phase-cancellation and dialogue-routing fixtures cover the selected fusion policy;
- old persisted `ten` selections normalize to FireRed and no TEN binary asset ships;
- File reports identify the algorithm and detector method used;
- user-facing help and the user guide state the automatic-detection limitations;
- capture smoke passes and a four-hour capture soak is reviewed against retained local baselines.
