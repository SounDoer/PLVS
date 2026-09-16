# Agent Control Measurement V1 — Design

Date: 2026-09-07
Status: Implemented

## 1. Goal

Add a bounded, read-only Measurement family that lets agents, scripts, support tools, and users
read the latest semantic LIVE measurement from the already-running PLVS app. The result must be
coherent, explicit about freshness and unavailable values, and useful without reproducing panel
pixels or exposing internal history storage.

Measurement V1 answers questions such as:

- Is LIVE running, and is the returned sample fresh?
- What are the current channel peak and RMS levels?
- What are the current and accumulated loudness statistics?
- Is the active Loudness Profile currently passing, pending, warning, or failing?
- Which otherwise-supported values are unavailable, and why?

It does not turn PLVS into a headless analyzer and does not add a second measurement engine.

## 2. First-slice scope

In scope:

- a machine-readable catalogue of the V1 measurement fields;
- one coherent latest LIVE sample, independent of the currently displayed source or history scrub;
- LIVE lifecycle, sample identity, capture time, receive time, age, and freshness;
- channel topology, labels, current sample peak, and current RMS;
- momentary, short-term, integrated, maxima, LRA, True Peak Max, PSR, and PLR;
- correlation and Side/Mid for the analysis pair already active in the running app;
- dialogue activity, coverage, integrated loudness, range, and offset when dialogue analysis is
  already active;
- evaluation by the currently effective Loudness Profile, including editor preview semantics;
- JSON-safe `null` values and machine-readable unavailability reasons;
- retained final values after LIVE stops, marked stale rather than presented as current.

Out of scope:

- File-analysis measurements or reports;
- history, time ranges, downsampling, streaming, subscriptions, or `measurement wait`;
- raw waveform, Spectrum, Spectrogram, Vectorscope point clouds, or Stereo Map band arrays;
- opening panels or adding analysis requests to satisfy a query;
- changing settings, clearing measurements, resetting maxima, or controlling transport;
- a general expression or quality-control rule language;
- human-readable/table output in the first slice;
- macOS Agent Control transport work.

## 3. Product boundary: measurements, not panels

PLVS panels are views over shared measurement state. The public contract therefore names semantic
facts rather than panel instances:

| GUI surface            | V1 semantic coverage                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------ |
| Level Meter            | per-channel sample peak and RMS; current/program True Peak summary                   |
| Loudness               | Momentary, Short-term, Integrated, M Max, ST Max, LRA, TP Max, PSR, PLR              |
| Stats                  | the same canonical scalar catalogue, plus Dialogue and stereo metrics when available |
| Vectorscope            | correlation and Side/Mid for an already-active pair; no path or points               |
| Spectrum / Spectrogram | no V1 output; visual band data is request-keyed and potentially large                |
| Waveform               | no V1 output; history samples are not a latest semantic metric                       |
| Stereo Map             | no V1 band output; its measurement depends on pair, speed, and smoothing controls    |

This means a panel need not be visible for a core metric to appear, provided the running engine
already computes it. Conversely, `measurement inspect` must not create a panel or analysis demand
merely to make an optional value available.

## 4. Existing semantic owners

The native meter pipeline emits one `AudioFramePayload` with a per-session `seq` and
`timestampMs`. The frontend frame handler reduces that frame into the latest audio state while
`FrameIntake` separately retains scalar and visual history. `buildStatsValues` is the authoritative
mapping from that audio state to the Stats metric IDs, and `loudnessProfileEvaluate` is the
authoritative rule evaluator.

Measurement V1 reuses those owners:

1. the LIVE frame path captures a source-specific latest measurement record at the same boundary
   where it reduces the native frame;
2. a pure formatter turns that record plus low-frequency LIVE/profile/channel context into the
   public JSON result;
3. Agent Control serves the result without mutating React state, persistence, native capture, or
   analysis requests.

It must not read the shared `displayAudio` value directly. That value can represent File mode or a
historical scrub and is intentionally presentation-oriented. It also must not assemble fields by
reading multiple mutable refs at unrelated times; the numeric sample is frozen from one reduced
frame before request formatting begins.

## 5. Public commands

```text
plvs-cli measurement describe --json
plvs-cli measurement inspect --json
```

Wire methods are:

```text
measurement.describe
measurement.inspect
```

Both commands require the authenticated local Agent Control endpoint of a running PLVS app. They
are queries: neither accepts `--expected-revision`, `--dry-run`, confirmation flags, input files,
or output files.

V1 deliberately has no `--source` option. It always means LIVE. A future File slice may add an
explicit `--source active-file` without changing the default or the V1 LIVE result.

## 6. Describe contract

`measurement describe` is available whether or not LIVE has ever produced a frame. It returns the
fixed public catalogue rather than current readings:

```json
{
  "revision": 44,
  "schemaVersion": 1,
  "source": "live",
  "freshnessThresholdMs": 2000,
  "metrics": [
    {
      "path": "levels.channels[].peakDbfs",
      "label": "Sample Peak",
      "unit": "dBFS",
      "basis": "currentFrame"
    },
    {
      "path": "loudness.integratedLufs",
      "label": "Integrated",
      "unit": "LUFS",
      "basis": "liveSession"
    }
  ],
  "availabilityReasons": [
    "noSample",
    "notReady",
    "analysisInactive",
    "dialogueInactive",
    "noDialogue",
    "insufficientChannels",
    "belowSignalFloor"
  ]
}
```

Every metric descriptor has `path`, `label`, `unit`, and `basis`. `basis` is one of:

- `currentFrame` — describes the native frame identified by `sample.sequence`;
- `liveWindow` — describes a rolling window ending at that frame;
- `liveSession` — accumulated since the current LIVE measurement was cleared/restarted;
- `derived` — calculated from other fields in the same coherent sample;
- `evaluation` — Loudness Profile interpretation of same-sample metric values.

The catalogue is a versioned, ordered constant. It is not inferred from open panels, and labels are
descriptive only; JSON paths are the stable identifiers.

## 7. Inspect contract

A populated result has this shape:

```json
{
  "revision": 44,
  "schemaVersion": 1,
  "observedAt": "2026-09-07T14:05:12.240Z",
  "source": {
    "kind": "live",
    "state": "running",
    "sessionGeneration": 7
  },
  "sample": {
    "sequence": 918,
    "elapsedMs": 15342,
    "receivedAt": "2026-09-07T14:05:12.222Z",
    "ageMs": 18,
    "freshness": "fresh"
  },
  "topology": {
    "channelCount": 2,
    "channelLabels": ["L", "R"],
    "loudnessLayout": "stereo",
    "loudnessLayoutKnown": true
  },
  "levels": {
    "channels": [
      { "index": 0, "label": "L", "peakDbfs": -5.2, "rmsDbfs": -18.4 },
      { "index": 1, "label": "R", "peakDbfs": -6.1, "rmsDbfs": -19.0 }
    ],
    "truePeak": {
      "leftDbtp": -4.8,
      "rightDbtp": -5.5,
      "maxDbtp": -0.9
    }
  },
  "loudness": {
    "momentaryLufs": -18.2,
    "shortTermLufs": -19.1,
    "integratedLufs": -20.4,
    "momentaryMaxLufs": -14.2,
    "shortTermMaxLufs": -16.0,
    "rangeLu": 5.7,
    "psrDb": 18.2,
    "plrDb": 19.5
  },
  "stereo": {
    "pair": { "x": 0, "y": 1, "labels": ["L", "R"] },
    "correlation": 0.91,
    "sideToMidDb": -12.4
  },
  "dialogue": {
    "active": true,
    "activeNow": false,
    "coveragePercent": 61,
    "integratedLufs": -21.1,
    "rangeLu": 3.2,
    "offsetLu": -0.7
  },
  "profile": {
    "mode": "saved",
    "id": "broadcast-ebu",
    "name": "Broadcast EBU",
    "overall": "ok",
    "byMetric": { "integrated": "ok", "truePeak": "ok" }
  },
  "unavailable": {}
}
```

All numeric metric fields are JSON numbers or `null`; `Infinity`, `-Infinity`, and `NaN` never
cross the contract. Objects and keys remain present even when a whole optional group is
unavailable, so consumers do not have to infer whether a missing key means an old server or a
missing reading.

## 8. Sample identity and coherence

`source.sessionGeneration` is a process-local monotonic integer. It advances when a new LIVE
measurement session starts and when the measurement is explicitly cleared. It is not persisted
across app launches and is not a configuration revision.

`sample.sequence` is the native per-session frame sequence. The pair
`(sessionGeneration, sequence)` identifies the numeric sample. All values under `levels`,
`loudness`, `stereo`, and `dialogue` are derived from the one reduced frame associated with that
pair. Low-frequency context such as channel labels and the effective profile is captured once when
the query begins and evaluated against those frozen values.

The result also contains the global Agent Control `revision` so a caller can relate the sample to
configuration state. Measurement frames, freshness transitions, LIVE lifecycle changes, and
session generation do not increment that revision and do not wake `app.wait`.

## 9. Time and freshness

For LIVE, native `timestampMs` is elapsed measurement time, not a wall-clock epoch. It is exposed as
`sample.elapsedMs`. The frontend records `receivedAt` with a wall-clock reading when the complete
frame reaches the LIVE handler. `observedAt` is captured once when the query is served, and
`ageMs = max(0, observedAt - receivedAt)`.

`sample.freshness` is:

- `fresh` when LIVE is running and the last frame is at most 2000 ms old;
- `stale` when a retained sample exists but LIVE is stopped, failed, transitioning, or the sample
  is older than 2000 ms;
- `unavailable` when no LIVE sample has been produced since launch or the last clear.

The threshold is returned by `describe`; clients must not duplicate an undocumented constant.
Freshness says whether a sample is current, not whether every accumulated metric is ready.

When no sample exists, `sample.sequence`, `elapsedMs`, `receivedAt`, and `ageMs` are `null`; every
metric value is `null`; and `unavailable` maps those metric paths to `noSample`. This is a
successful query, not an operational error.

## 10. Metric semantics

### 10.1 Levels and True Peak

`levels.channels` contains one row per current LIVE channel in index order. Labels use the same
resolved auto/custom channel-label owner as the GUI. `peakDbfs` is the current emitted frame's
sample peak; `rmsDbfs` is the engine's current RMS window value.

The existing loudness engine exposes current True Peak as left/right semantic values and one
session-wide True Peak Max. V1 keeps that shape rather than pretending it has arbitrary
per-channel True Peak for multichannel input. A later engine enhancement may introduce a separate
per-channel field without changing these names.

### 10.2 Loudness and Stats

V1 uses `buildStatsValues` as the canonical mapping:

- `momentaryLufs`, `shortTermLufs`, and their maxima map to Momentary, Short-term, M Max, and ST Max;
- `integratedLufs` and `rangeLu` map to Integrated and LRA;
- `maxDbtp` maps to True Peak Max;
- `psrDb = maxDbtp - shortTermLufs`;
- `plrDb = maxDbtp - integratedLufs`.

The API returns raw engine precision. It does not round to panel display precision or return
formatted strings.

### 10.3 Stereo

Correlation and Side/Mid describe the first already-active Vectorscope request selected by the
same deterministic request order used by the engine. `stereo.pair` identifies its channel indexes
and labels. If no Vectorscope analysis request is active, both values and the pair are `null` with
`analysisInactive`; the command never creates a request.

With fewer than two available channels, the reason is `insufficientChannels`. When the selected
channels are below the existing Stats correlation signal floor, the values are `null` with
`belowSignalFloor`, matching the GUI's indeterminate `-` rather than reporting a misleading zero.

Stereo Map requests are not substituted for a Vectorscope request: their speed/smoothing/band
semantics are different. That family belongs in a later structured-analysis design.

### 10.4 Dialogue

`dialogue.active` reports whether the existing workspace-derived Dialogue Detection demand is
active for LIVE. Inspecting measurements never changes it.

When inactive, dialogue values are `null` with `dialogueInactive`, including coverage. When active
but no dialogue-gated integrated value exists yet, the relevant values use `noDialogue` or
`notReady` according to the existing engine state; `activeNow` remains a boolean once a sample
exists. Zero coverage is a real zero only when the detector was active for the sample.

### 10.5 Loudness Profile evaluation

The numeric values are evaluated with `loudnessProfileEvaluate`, not a CLI copy of its rules.
`profile.mode` is:

- `off` when there is no effective document;
- `saved` for the selected saved profile;
- `preview` while the profile editor's shared draft preview is effective.

For `off`, identity fields are `null`, `overall` is `off`, and `byMetric` is empty. Otherwise
`byMetric` contains only metrics watched by filled rules, with existing statuses `ok`, `pending`,
`warn`, or `fail`. `overall` uses severity order `fail > warn > pending > ok`. This evaluation is
advisory current state; it does not mutate the profile or block a query while an editor is open.

## 11. Unavailability model

`unavailable` is a flat object keyed by the exact numeric JSON path, for example:

```json
{
  "loudness.integratedLufs": "notReady",
  "loudness.rangeLu": "notReady",
  "loudness.plrDb": "notReady",
  "stereo.correlation": "analysisInactive",
  "dialogue.integratedLufs": "dialogueInactive"
}
```

For array metrics, the path includes the concrete index, such as
`levels.channels[1].rmsDbfs`. Reasons are closed V1 enum values listed by `describe`:

- `noSample` — no retained LIVE frame exists;
- `notReady` — the engine/window has not produced a meaningful value yet;
- `analysisInactive` — an optional request-keyed analysis is not already active;
- `dialogueInactive` — Dialogue Detection is not active;
- `noDialogue` — detection is active but no dialogue-gated value exists yet;
- `insufficientChannels` — the metric requires a valid pair;
- `belowSignalFloor` — the GUI treats the stereo reading as indeterminate.

Reasons explain `null`; they do not replace freshness. A stale retained sample may still contain
finite values, and those values remain present while `sample.freshness` is `stale`.

## 12. Query, bounds, and error semantics

Both methods are bounded constant-size queries. V1 has no caller-controlled metric expansion and
never includes request-keyed arrays or history rows. Channel rows are bounded by the engine's
existing maximum channel count; labels use the same public string bound as other Agent Control
surfaces.

Normal runtime states — stopped LIVE, silence, warm-up, missing dialogue, inactive analysis, or no
sample — return exit 0 with explicit state and nullability. Errors are reserved for protocol and
internal failures:

- malformed/unknown options are CLI-side `invalidArguments` failures;
- unsupported server capability follows the existing compatibility error;
- failure to form one internally coherent snapshot is `measurementSnapshotFailed`, exit 1.

There is no retry, implicit start, implicit clear, or automatic fallback to File measurements.

## 13. Revision and notifications

Measurement describe/inspect never:

- require an expected revision;
- increment the global revision;
- increment the Device inventory generation;
- dirty Presets;
- write persistence;
- wake revision waiters;
- post GUI notices.

The process-local measurement session generation exists only to disambiguate samples across LIVE
clear/restart boundaries.

## 14. Acceptance criteria

- `measurement describe/inspect` appear in capabilities, root/family help, protocol tests, and
  public Agent Control documentation.
- inspect always reads the latest LIVE sample, even while File is selected or the GUI is scrubbing
  history.
- every numeric group is derived from one source/session/sequence snapshot.
- stopped LIVE retains finite values but marks the sample stale; clear returns no sample.
- JSON output contains no non-finite number and explains every metric `null` through
  `unavailable`.
- current peak/RMS, loudness, dialogue, stereo, and profile results match their existing GUI
  semantic owners.
- no inspect call adds an analysis request, opens a panel, restarts capture, writes persistence, or
  changes any revision.
- optional stereo/dialogue values truthfully report inactive, insufficient-signal, and warm-up
  states.
- output is bounded and contains no raw history, spectrum bands, waveforms, canvas paths, or point
  clouds.
- focused JS/Rust contract tests and `npm run check` pass.

## 15. Proposed decisions to confirm

This first draft proposes:

1. V1 is LIVE-only and has no `--source`; File remains a later explicit slice.
2. the default query is always the latest unscrumbed LIVE sample, not whatever the GUI happens to
   display;
3. freshness uses a documented 2000 ms threshold and retained stopped values are returned as
   stale;
4. `sessionGeneration + sequence` is the sample identity, separate from global revision;
5. optional analysis is passive: inspect never enables Vectorscope, Dialogue, Spectrum, or any
   other request;
6. values are raw-precision numbers/null plus a flat path-to-reason map;
7. profile evaluation includes the shared editor preview because it is the effective profile the
   GUI is currently showing;
8. visual arrays and `measurement wait` are explicitly postponed until this snapshot contract has
   shipped and proved useful.
