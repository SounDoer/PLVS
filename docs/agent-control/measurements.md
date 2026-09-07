# Measurement Control

Measurement Control exposes one bounded, coherent snapshot of the latest LIVE measurement from the
already-running app:

```powershell
npm run desktop:control -- measurement describe --json
npm run desktop:control -- measurement inspect --json
```

Both commands are read-only queries. They accept no source, revision, dry-run, input, output, or
confirmation option. Inspect never starts LIVE, clears a measurement, opens a panel, or activates
Vectorscope or Dialogue analysis.

## Scope

V1 is LIVE-only. It does not expose File measurements, history, raw waveform points, Spectrum or
Spectrogram bands, Vectorscope paths, Stereo Map bands, or a measurement wait operation.
`app.inspect` continues to report controllable application state rather than high-rate measurement
data; use `measurement inspect` for readings.

`measurement describe` returns the ordered V1 metric catalogue. Every descriptor has a stable JSON
`path`, display `label`, `unit`, and one of these bases:

- `currentFrame` — the native frame identified by `sample.sequence`;
- `liveWindow` — a rolling window ending at that frame;
- `liveSession` — accumulated since the current LIVE session or clear;
- `derived` — calculated from values in the same sample;
- `evaluation` — Loudness Profile interpretation of the same sample.

## Snapshot identity and freshness

The pair `source.sessionGeneration` and `sample.sequence` identifies the numeric sample.
`sessionGeneration` is process-local and advances after a new LIVE capture session succeeds and
after an explicit LIVE clear. It is not persisted and is independent of the Agent Control global
`revision`.

`sample.elapsedMs` is measurement elapsed time from the native frame, not an epoch timestamp.
`receivedAt` is when that complete frame reached the frontend. At query time, `ageMs` is calculated
from the single `observedAt` timestamp.

- `fresh`: LIVE is running and the frame is at most the advertised 2000 ms threshold old;
- `stale`: a retained frame exists, but LIVE is stopped, failed, transitioning, or too old;
- `unavailable`: no LIVE frame exists since launch or the last clear.

Stopping or failing LIVE retains the final finite values as stale. Clear removes the retained
sample. Normal no-sample, silence, warm-up, inactive-analysis, and no-dialogue states are successful
queries.

## Values and unavailability

All metric numbers are raw engine precision and are JSON numbers or `null`. The fixed objects remain
present when values are unavailable. `unavailable` maps each null metric path to one reason:

```text
noSample
notReady
analysisInactive
dialogueInactive
noDialogue
insufficientChannels
belowSignalFloor
```

Channel peak and RMS rows use the same resolved auto/custom labels as the GUI. Loudness, dynamics,
Dialogue, and True Peak Max use the same canonical Stats mapping. Stereo values describe only the
first Vectorscope request already active in the engine; Measurement Control never creates one.
For a received frame whose channel peaks are all at or below the signal floor, unavailable level
and loudness metrics use `belowSignalFloor`; `notReady` is reserved for audible warm-up or an
otherwise valid metric that has not produced a finite value yet.

The `profile` object evaluates the effective Loudness Profile through the app's shared evaluator.
Its mode is `off`, `saved`, or `preview`; an open editor draft therefore produces the same preview
judgement the GUI shows. `overall` uses `fail > warn > pending > ok`.

## Read-only revision behavior

Measurement frames, age changes, session generation, and these queries do not change the global
revision and do not wake `app.wait`. Repeated inspection also performs no persistence write and
posts no GUI notice.
