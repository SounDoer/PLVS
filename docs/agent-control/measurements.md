# Measurement Control

Measurement Control exposes one bounded, coherent snapshot of the latest LIVE measurement from the
already-running app, through `measurement describe` and `measurement inspect`, and the band levels
behind one Spectrum panel's curve through `measurement spectrum`
([Spectrum readout](#spectrum-readout)). Command syntax and arguments are in
[`generated/commands.md`](generated/commands.md).

All three commands are read-only queries. Apart from the Spectrum readout's panel and resolution,
they accept no source, revision, dry-run, input, output, or confirmation option. None starts LIVE,
clears a measurement, opens a panel, or activates Vectorscope or Dialogue analysis.

## Scope

V1 is LIVE-only. The inspection result does not expose File measurements, history, raw waveform
points, Spectrum or Spectrogram bands, Vectorscope paths, or Stereo Map bands; Spectrum bands are
read per panel through [`measurement spectrum`](#spectrum-readout). Waiting for a
different published sample is provided separately by [Measurement Wait](measurement-wait.md).
`app.inspect` continues to report controllable application state rather than high-rate measurement
data; use `measurement inspect` for readings.

`measurement describe` returns the ordered V1 metric catalogue. Every descriptor has a stable JSON
`path`, display `label`, `unit`, and one of these bases:

- `currentFrame` — the native frame identified by `sample.sequence`;
- `liveWindow` — a rolling window ending at that frame;
- `liveSession` — accumulated over the LIVE measurement. Stop and Start continue it; a clear, a
  failed capture, or a Source or format change while stopped begins a new one;
- `derived` — calculated from values in the same sample;
- `evaluation` — Loudness Profile interpretation of the same sample.

## Snapshot identity and freshness

The pair `source.sessionGeneration` and `sample.sequence` identifies the numeric sample.
`sessionGeneration` is process-local and advances after a new LIVE capture session succeeds and
after an explicit LIVE clear. It is not persisted and is independent of the Agent Control global
`revision`. A new generation does not by itself mean the `liveSession` values restarted: Start
after Stop opens a new capture session that continues the same measurement.

`sample.elapsedMs` is elapsed time of the current capture session from the native frame, not an
epoch timestamp; it restarts at each Start.
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
dialogueInactive
detectorError
noDialogue
insufficientChannels
belowSignalFloor
```

Channel peak and RMS rows use the same resolved auto/custom labels as the GUI. Loudness, dynamics,
Dialogue, and True Peak Max use the same canonical Stats mapping. Stereo values describe the same
pair as Stats: the first Vectorscope request already active in the engine, or Ch1/Ch2 when none is.
Measurement Control never creates a Vectorscope request.

`levels.truePeak.maxDbtp` is the maximum True Peak across every channel. `leftDbtp` and `rightDbtp`
report Ch1 and Ch2 only, whatever the channel count.

`loudnessLayout` is one of `mono`, `stereo`, `lcr`, `quad`, `5.0`, `5.1`, `7.0`, `7.1`, `7.1-wide`, `5.1.2`,
`5.1.4`, `7.1.2`, `7.1.4`, `9.1.6`, `custom`, or `unknown`. `custom` means the active role list
matches no named layout. Standard layouts use WAVE / ffmpeg channel order and ITU-R BS.1770-5
weights. When `loudnessLayoutKnown` is false, loudness is the stereo loudness of Ch1/Ch2. Check
`loudnessLayoutKnown`, not the layout name, to detect degraded loudness, and treat the value set as
open for future layouts.

For a received frame whose channel peaks are all at or below the signal floor, unavailable level
and loudness metrics use `belowSignalFloor`; `notReady` is reserved for audible warm-up or an
otherwise valid metric that has not produced a finite value yet. As in the Stats readout, a
loudness or True Peak value that rounds to -100.0 or lower is read as silence and reported as null:
filter state decaying after silence or Stop can otherwise leave meaningless values such as
-1832 LUFS. PSR, PLR and the Loudness-to-Dialogue Ratio are then not derived from it.

The `profile` object evaluates the effective Loudness Profile through the app's shared evaluator.
Its mode is `off`, `saved`, or `preview`; an open editor draft therefore produces the same preview
judgement the GUI shows. `overall` uses `fail > warn > pending > ok`.

## Read-only revision behavior

Measurement frames, age changes, session generation, and these queries do not change the global
revision and do not wake `app.wait`. Repeated inspection also performs no persistence write and
posts no GUI notice.

## Spectrum readout

`measurement spectrum --panel-id <id>` returns the numbers behind the curve one Spectrum panel last
drew, so an agent can judge frequency balance without reading a screenshot. The panel supplies them
from its own render: its Channel, View, Speed, Smoothing, Tilt, Slow Trace and Max mode are already
applied, and `display` echoes the ones that shape the numbers. The query never creates an analysis
request; a panel that is not rendered (an inactive tab, a Dock module) fails with `panelNotFound`,
and a panel of another module with `controlUnavailable`.

Levels are in the dB of the Spectrum level axis. That axis is a power-density scale calibrated so a
0 dBFS sine reads about 0 dB in the mid band; it is not dBFS, and a tone reads several dB higher on
the low band and lower on the high band. Tilt is included, as drawn. Values are rounded to 0.01.

`--resolution` merges the engine's 96-points-per-octave grid into fractional-octave bands centred on
1 kHz × 2^(k/n): `octave`, `third` (the default, 31 bands from 20 Hz to 20 kHz), `sixth`, `twelfth`,
or `full` for the grid itself (about 960 points). Each band is the power mean of the grid points
inside it, which keeps broadband material level at every resolution but dilutes a lone tone by the
band's width. `peaks` therefore lists up to five peaks per curve found on the full grid, with at
least 9 dB of prominence — the bar a peak label must clear on the chart — whatever the panel's Peak
Labels setting.

Each band row has `centerHz`, `lowHz`, `highHz` and `db`. A View of L / R or M / S adds the second
curve as `dbB`, named in `display.curves`. When Max is Decay or Hold the row adds `maxDb` (and
`maxDbB`): the engine's decaying peak or the held maximum, whichever fill the panel shows. A level
below -120 dB, the lowest the level axis can show, is null.

Identity and freshness follow `measurement inspect`: `source.sessionGeneration` with
`sample.sequence`, here the native frame the panel drew, which can trail `measurement inspect` by a
frame. `unavailable` is null or one reason, and no bands or peaks are returned unless it is null or
`belowSignalFloor`:

```text
noSample          no LIVE sample since launch or the last clear
notReady          the panel has no curve for its request yet
snapshotSelected  the panel shows a history Snapshot, not LIVE
fileSource        the panel shows the File source
belowSignalFloor  every band is below -120 dB
```

Spectrogram is not read: its numbers are the same rows over time, which belong to history.

Vectorscope has no readout by decision. Its meaningful numbers are already in `measurement inspect`:
`stereo.correlation` for phase and mono compatibility, `stereo.sideToMidDb` for width, and the
channel levels for balance. Polar Level is a 64-direction display envelope with its own attack,
release, smoothing and hold, and the Lissajous trace is raw sample points; neither adds a reading
those three do not. `stereo` follows the first Vectorscope request rather than a chosen panel; a
per-panel stereo reading is the change to make if one is ever needed.

## Chart gesture resets

Two clicks on a chart reset measurement state rather than read it. `measurement reset-hold
--panel-id` clears a Spectrum's held curve or a Vectorscope's Polar Level Max Hold, as clicking the
held curve or plot does. `measurement reset-true-peak-max --panel-id` resets TP Max, as clicking a
peak Level Meter's TP Max marker does during Live monitoring. The reset succeeds after the engine
has applied it and the frame channel has reached the reset boundary. Each is available exactly when the panel's gesture
reference lists it; otherwise it fails with `controlUnavailable`. A panel that is not rendered
fails with `panelNotFound`. Neither advances the global revision, and both require
`--expected-revision`.

Every gesture in the gesture reference has a reproduction through Agent Control, listed in
`src/agentControl/chartGestureCoverage.js` and guarded by its test: axis zoom, pan and reset through
Axis Control, Snapshot through Transport Control, the 3D view through Panel Control, Slow Trace
through `panel hold-slow` ([Panel Control](panels.md)), and the hover probe through the pointer
([Pointer Control](pointer.md)).
