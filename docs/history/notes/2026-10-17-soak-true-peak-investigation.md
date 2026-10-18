# Capture soak True Peak investigation — 2026-10-17

## Original run

The complete four-hour run `artifacts/soak/soak-1792170561437.jsonl` used
commit `2a7b7aab43eff84942bd2ba83de424451c6ca4da` (0.21.0). Capture completed with
zero dropped chunks. The post-warmup True Peak Max spread was 0.5735610568 dB,
above the unchanged 0.01 dB limit. Integrated spread was 0.0046292440 dB;
the twelve earlier complete four-hour runs ranged from 0.0032823675 to
0.0045480192 dB. RSS rose from 17.1 to 18.0 MB.

The maximum changed only at the following reported times (10-second sampling
does not locate the event within the interval):

| Time (s) | True Peak Max (dBTP) |
| -------- | -------------------- |
| 10       | -19.91193461698195   |
| 60       | -19.47018116140967   |
| 4090     | -18.896620104617313  |

The earlier 0.20.0 run `soak-1791909738223.jsonl` also ended at exactly
-18.896620104617313 dBTP, but did not record periodic True Peak readings.

## Offline comparison

Standalone probe crates compile the actual `SummaryMeter` and its DSP dependencies
from `v0.20.0` and the current checkout, without the capture or player layers.
Their sources, inputs, results and independent FFmpeg logs are retained under
`artifacts/soak/investigation-20261017/`. The shared True Peak filters and the
summary meter's peak-update implementation are unchanged across these revisions.

Ten-second, 48 kHz stereo fixtures use a quantized 1 kHz sine with a -20 dB left
channel and a right channel 6 dB lower. Both revisions receive identical Float32
samples in one-second chunks.

| Input                                      | Old PLVS TP | Current PLVS TP | FFmpeg ebur128 TP |
| ------------------------------------------ | ----------- | --------------- | ----------------- |
| Continuous sine                            | -19.999470  | -19.999470      | -20.0             |
| 480-frame silence starting at frame 240013 | -18.896620  | -18.896620      | -18.9             |
| 19-frame phase jump at frame 240013        | -18.052648  | -18.052648      | -18.1             |

The artificial silence reproduces the original run's final peak exactly. This
supports a signal-discontinuity explanation but does not by itself prove where
the live discontinuity originated. Recording the actual cable output is the
next step. No algorithm or tolerance change is justified by this evidence.

## Result logging

The original ad hoc Windows PowerShell wrapper used native stderr redirection
with `ErrorActionPreference = Stop`. It raised `RemoteException` while printing
the failed verdict, so the wrapper did not retain the native exit code. The
complete JSONL was independently evaluated with `judgeSoak` to recover the
verdict; no run was repeated to hide that failure.

A replacement Node wrapper uses file descriptors for stdout/stderr and records
the child's close status. A self-test writes to both streams and exits 1; both
logs and exit code 1 were retained. It lives with this investigation's artifacts.

## Live playback comparison

After confirming disconnected RDP and successful WASAPI device enumeration, the
current harness was rebuilt. A 150-second soak with the original 60-second
looping playback held the rig lease throughout. FFmpeg independently recorded
140 seconds of the same cable output through DirectShow; this recording is not
claimed to be byte-identical to the WASAPI consumer's input.

`loop-probe.analysis.json` identifies three intervals at less than -80 dBFS for
at least 1 ms: 58.8407–59.0717 s (231.04 ms), 60.5693–60.5805 s (11.23 ms),
and 119.0829–119.2343 s (151.40 ms). The two long gaps align with file restarts.
The recorded silence contains low-level quantization noise, so an exact-zero
search would incorrectly report no gaps. The probe itself passed the soak limits;
it did not reproduce the original late maximum jump in this short interval.
Both old and current offline meters give the recording exactly the same True
Peak, -19.9968197145 dBTP; FFmpeg reports -20.0 dBFS.

The corrective change keeps one continuous file playing throughout capture. WAV
synthesis repeats phase-continuous PCM bytes inside the file with bounded memory;
it does not restart the player. Duration includes the 2-second settling interval
and 30 seconds of additional headroom. VLC looping/repeating is explicitly
disabled for the soak, and early player exit invalidates the run. Other rig
callers retain their default playback behavior. Drift limits and warmups are
unchanged. A default four-hour WAV uses about 2.77 GB of temporary storage.

Validation so far: all 525 Vitest suites / 5647 tests pass, including PCM byte
continuity across generated chunks and partial-tail/header sizing; format,
lint and typecheck pass. The continuous-playback recording and full-duration
validation are tracked in the adjacent investigation artifacts.

The corrected 150-second run also completed with exit 0 and zero dropped chunks.
Integrated spread was 0.0008 dB versus 0.0085 dB for the equally short looping
probe; both short probes had zero post-warmup True Peak spread. These are not
four-hour baseline replacements. The continuous recording has no quiet gaps
around the former 60/120-second restarts, but contains a 10.125 ms quiet interval
at 6.0696 seconds, during startup. Its old/current offline True Peak results are
identical (-19.9705857703 dBTP); FFmpeg reports -20.0. This confirms removal of
the periodic playback gaps, not the absence of every possible capture transient.
The short recording does not reproduce the original late True Peak maximum, so
the four-hour validation remains necessary before declaring the issue resolved.

The capture smoke also passed: file/live Integrated -22.030555/-22.033879 LUFS,
matching per-channel sample peaks, zero dropped chunks. No production DSP or
audio callback code was changed.

## Complete continuous-playback validation

`soak-1792218693057.jsonl` completed all 14,400 seconds on 2026-10-17 at
18:31:37 Asia/Shanghai. The Node wrapper retained native exit code 1; the
capture report itself has status `ok`, 14,400,000 captured milliseconds and
1,440 periodic samples, all with finite Integrated values. The player and
wrapper exited and the temporary 2.77 GB WAV was removed.

Recomputed post-warmup spreads:

| Metric | Spread |
| --- | --- |
| Integrated | 0.000551528994 dB |
| LRA | 0 LU |
| Max M | 0.001327956713 dB |
| Max S | 0.000177103055 dB |
| True Peak Max | 0.977574364430 dB |

True Peak Max is the only failed drift check. It stayed at -19.911934616982
dBTP through the 12,000-second reading, then reached -18.934360252552 at
12,010 seconds and stayed there. Max M changed in the same reporting interval;
Max S changed by the next interval. Integrated fell slightly at the event,
from -22.030557700585 to -22.030562307233 LUFS. Final sample peaks remained
-19.999469871547/-26.001535643526 dBFS. Dropped chunks remained zero throughout.
RSS was 18.4 to 19.0 MB; endpoints alone do not establish a leak trend.

All thirteen earlier complete four-hour runs were recomputed from their JSONL:
their looping-source Integrated spreads span 0.003282367461–0.004629243976 dB.
The new continuous-source spread is smaller, but playback changed, so this is
not a controlled algorithm comparison. Only the immediately preceding failed
run has periodic True Peak values; its spread was 0.573561056792 dB. Earlier
final maxima cannot establish their within-run drift.

**The issue is not resolved.** Removing the known periodic playback gaps was
insufficient to eliminate the late transient. The simultaneous maximum changes
and tiny Integrated decrease are consistent with a brief disturbance, but no
raw PCM was retained at this event. The summary cannot distinguish playback,
device/driver, capture delivery or DSP causes. Zero application-level dropped
chunks does not prove uninterrupted source audio. The next discriminating
experiment would retain the exact PCM delivered to the meter around a maximum
jump and replay it through both revisions and an independent reference.

The original failure and this complete failure are retained. No thresholds
were relaxed, no further run was started, and changes remain uncommitted.
The measured result and per-run baseline calculations are saved in
`artifacts/soak/continuous-validation-20261017/verified-result.json`.

## Exact-input evidence instrumentation

The next authorized diagnostic uses `--evidence` on the capture soak. This enables
only the feature-gated harness recorder, via `PLVS_CAPTURE_EVIDENCE_DIR`. It copies
the same interleaved Float32 slice consumed by `SummaryMeter`, before the pool
recycles that slice. The existing consumer thread retains a three-second ring;
no allocation, locking or I/O was added to the device callback.

After the unchanged 120-second peak warmup, an increase greater than 0.01 dB
relative to the last trigger baseline captures the preceding ring, the complete
trigger chunk and at least three seconds after it (rounded to a complete consumer
chunk). Up to four clips are queued to a dedicated writer; subsequent triggers
are counted as suppressed. Saved Float32 WAV files retain the sample values,
with source-frame offsets, trigger chunk end frame, elapsed time and peak values
in JSON. Incomplete tails at shutdown are marked; write/queue failures propagate
as capture errors. The directory must be fresh so earlier evidence is not replaced.

The synthetic validation in `artifacts/soak/evidence-diagnostic-20261017/` uses
an accelerated test clock, not real-time playback. A 10 ms gap in a 1 kHz tone
causes a real peak increase. The saved 6.1-second clip is byte-value identical to
the corresponding meter input; its replay through both old and current meters
returns -18.897237559154 dBTP, exactly matching the trigger metadata. Independent
FFmpeg ebur128 reports -18.9. Unit tests also cover warmup suppression, the four-clip
limit, incomplete tails, refusing existing output directories and disk-write failure.

Before the unmodified-signal long run, a deliberately marked 150-second live
`--evidence-self-test` will insert a 10 ms interruption at source time 130 s.
It must produce an evidence clip and the expected drift failure; this diagnostic
is not a normal soak baseline. Replaying saved clips must distinguish a real
event from any new filter transient introduced at the saved file's start.

### Live evidence self-test

At 23:10–23:12 Asia/Shanghai, the 150-second intentional-interruption run
`soak-1792249816925.jsonl` completed with native capture status `ok` and the
expected soak exit 1. It retained one complete 6.01-second clip, with no dropped
chunks. The event at capture elapsed 129.505110 s raised True Peak Max from
-19.911934616982 to -18.896620104617 dBTP. Both old and current offline meters
reproduce the latter value exactly; FFmpeg ebur128 reports -18.9. The saved
input contains exactly 10 ms of silence at clip time 3.002854 s. An independent
4x-resampled interior scan places the overshoot at 3.002823 s, excluding the
first and last seconds to avoid clip-boundary artifacts. Thus the live recorder
can retain and localize a known disturbance; this does not identify the cause
of the earlier spontaneous event.

Logs and exit status are in `artifacts/soak/evidence-live-selftest-20261017/`;
PCM, metadata and replay analysis are beside the self-test JSONL in its
`.evidence/` directory. This intentionally disturbed short run is excluded from
normal soak baselines. Before hardware validation, the full JavaScript suite
passed (5,651 tests), the full feature-enabled Rust workspace tests passed,
feature-enabled Clippy and the non-feature library check passed, and the
optimized harness build completed. The capture-rig suite also passed (32 tests)
after adding the self-test option. No production metering algorithm or verdict
threshold was changed.

### Four-hour evidence run started

The normal capture smoke passed with zero dropped chunks, live Integrated
-22.037848116687 LUFS versus file -22.030555445073 LUFS. With RDP session 1
confirmed disconnected and WASAPI device enumeration healthy, the single
four-hour evidence-enabled run started at 2026-10-17 23:13:43 Asia/Shanghai.
It uses the unmodified continuous tone, not the intentional self-test gap.
The first 10-second sample had finite Integrated -22.034233921767 LUFS and
zero dropped chunks; `format.json` confirms the recorder is armed at 48 kHz stereo.

Run logs, process identities, source/binary SHA-256 hashes and working diff are
in `artifacts/soak/evidence-longrun-20261017-run/`. HEAD is
`7d765e6e3d5bc27174d89c1220d2a935f2d0c48c`, plus the uncommitted investigation
changes. The series is `artifacts/soak/soak-1792250023255.jsonl`; evidence is in
the adjacent `.evidence/` directory. Runner PID was 128748 and soak PID 114968;
creation timestamps must be checked before using these identities later.
Expected completion is approximately 03:14 on October 18. The existing heartbeat
was updated to monitor only this run, analyze completed evidence clips, verify
the final report and historical baselines, and pause on completion.

An initial launcher attempt under `evidence-longrun-20261017/` failed with
`spawn C:\\Program ENOENT` because a spaced executable argument was split.
No soak process was created by that attempt. Its failure record is preserved;
the corrected launch uses `node` resolved from PATH in the wrapper.

### Evidence run interrupted by device loss

The run ended at 2026-10-18 02:15:02 Asia/Shanghai, before the requested four
hours. Native capture exited 1 with `Capture stopped: the audio device is no
longer available.` The soak wrapper recorded exit 2 (rig failure). The last
periodic sample was t=10,870 s (3 h 1 min 10 s); 1,087 periodic samples had finite
Integrated values and zero reported dropped chunks. Partial-run Integrated
spread was 0.000589128754 dB; LRA and all three maximum spreads were zero under
the existing warmups. No evidence clips were triggered, and the writer reported
zero clips and zero suppressed triggers. No final RSS summary was emitted.
These partial results are not a completed four-hour pass or a new baseline.

The user reconnected RDP near 02:14; session 1 was observed Active and the
reconnect was recorded in the run folder. The user then disconnected again;
session 1 was observed Disc at the failure check. The timing is consistent with
audio-device reconfiguration around that transition, but the artifacts do not
establish the precise upstream cause. The preceding spontaneous True Peak
event remains unresolved because it did not recur in the retained partial run.

`evidence-longrun-20261017-run/verified-result.json` records the verified failure
and partial metrics. All original artifacts are preserved. No replacement run
was started. The one-time monitor is being paused; a further uninterrupted-session
hardware run needs a separate user decision. The earlier advice that readings
were normal immediately after reconnect was a point-in-time observation, not
evidence that a subsequent disconnect would preserve the capture device.

### Separately authorized uninterrupted-session run on October 18

The user explicitly authorized one new four-hour evidence run and planned to
return six hours later. Session 1 was confirmed Disc before setup and launch.
`locateHarness` accepted the current binary; all seven source/binary hashes in
the preceding provenance were unchanged. Device enumeration passed, followed
by a fresh capture smoke with zero dropped chunks (live Integrated
-22.033998873377 LUFS versus file -22.030555445073 LUFS).

The new run started at 2026-10-18 11:55:45 Asia/Shanghai, with expected completion
around 15:56. Its folder is `artifacts/soak/evidence-uninterrupted-20261018/`, and
its series is `artifacts/soak/soak-1792295745750.jsonl`. The adjacent `.evidence/`
directory confirms the 48 kHz stereo recorder is armed. Runner PID 121440 and
soak PID 109808, with creation timestamps, source/binary hashes and the working
diff, are preserved in the new folder. The 20-second sample had finite Integrated
-22.032229185080 LUFS, True Peak Max -19.879286366129 dBTP, and zero dropped
chunks. This early peak is before the unchanged 120-second maximum warmup;
it is not yet a post-warmup drift result. No intentional gap was injected.

The existing heartbeat now monitors only this new run and will pause at completion
or blocking failure. No further automatic rerun is authorized. The prior partial
run and its device-loss evidence remain intact and excluded from complete baselines.

### October 18 completed result

The run completed at 15:55:50 Asia/Shanghai with wrapper exit 0, native capture
exit 0 (required by the soak completion check), final status `ok`, and exactly
14,400,000 captured milliseconds at 48 kHz stereo. All 1,440 ten-second samples
are present and have finite Integrated loudness; periodic and final dropped
chunks are zero. Recomputed `judgeSoak` has no failures:

| Metric | Post-warmup spread |
| --- | ---: |
| Integrated | 0.000551037295 dB |
| LRA | 0 |
| Max M | 0 dB |
| Max S | 0 dB |
| True Peak Max | 0 dB |

Final Integrated is -22.030557233167 LUFS and True Peak Max is
-19.879286366129 dBTP. RSS endpoints printed by the script are 19.5 to 20.2 MB,
a rounded increase of 0.7 MB; no full RSS time series was persisted, so endpoints
alone cannot establish a leak trend. The writer reports zero clips and zero
suppressed triggers, with no errors. The evidence directory contains only its
format metadata. All four saved run process IDs were absent at completion.

All 15 complete four-hour capture files were recomputed from actual JSONL, with
six incomplete/short files excluded (including the deliberate gap self-test).
The 13 historical looping-source Integrated spreads range from 0.003282367461
to 0.004629243976 dB. The prior continuous-source run has Integrated spread
0.000551528994 dB, close to this run, but True Peak spread 0.977574364430 dB;
this run has no post-warmup peak increase. Older files without periodic maximum
fields are recorded as unavailable, never as zero drift. Playback differs from
the looping baseline, so the smaller Integrated spread is not evidence of a
DSP algorithm improvement. Previous RSS endpoints were 17.1 to 18.0 MB for the
original failure and 18.4 to 19.0 MB for the continuous failure; the recorder
also changes the memory footprint, limiting direct comparisons.

This is a complete PASS for this run, and the first completed evidence-enabled
four-hour run. It does not establish that the earlier spontaneous peak fault
is fixed: the event did not recur and there is no new anomaly PCM to replay.
Preserve the opt-in recorder and all earlier evidence; a future recurrence
should be investigated from exact input before changing DSP or thresholds.
No further hardware test is started automatically. The verified measurements,
per-file baseline calculations and exclusions are saved in
`artifacts/soak/evidence-uninterrupted-20261018/verified-result.json`, with the
recomputation script beside it. The one-time monitor is paused after completion.
