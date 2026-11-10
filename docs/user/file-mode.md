# File Mode

Inspect a local audio file offline, using the same meter panels as live monitoring.

## Opening a file

Drop an audio file onto the window, or choose **Open file** in the toolbar. PLVS reads the file's
metadata with ffprobe and decodes it with a bundled FFmpeg — no external tools to install.

## Scrubbing

Move through the file's timeline and every panel updates to match, exactly like live monitoring.
Analysis stays read-only and local to the current session. File history covers the complete file and
does not use the Live **History Length** setting. Long files use fewer display checkpoints while
remaining navigable from beginning to end.

Changing Live History Length does not reset the File timeline's zoom, scroll, or selected time.
Changing the Dialogue Detection engine in Settings also preserves File entries and results; a
running analysis continues with the detector selected when its worker started. Reanalyze the file
to use a different detector. Live measurements retain their existing reset behavior.

Reanalysis retains the previous completed result and its browsing history until the replacement
succeeds. You can continue inspecting and exporting that result while the new run is in progress.
Cancelling or failing a replacement does not discard the previous successful result.

## Reports

When analysis completes, the summary can be exported as a report: **Export Markdown**,
**Export JSON**, or **Copy as Markdown**. Reports include the channel layout and the verdicts of the
active [Loudness Profile](loudness-profiles.md).

JSON report schema version 2 names Dialogue Loudness, LDR, Dialogue Coverage, and Dialogue Range
explicitly and records the dialogue metric algorithm version, detector configuration, and
multichannel fusion identity used for the run. If Dialogue Detection fails, the report records the
failure code and keeps the affected dialogue values unavailable while retaining programme results.

Integrated, Loudness Range, Max, and dialogue results in the report are calculated from the complete
decoded audio track, independently of the display checkpoints used for scrubbing.

Completed file summaries and JSON/Markdown reports include whole-file Sample Peak Max and True
Peak Max for every decoded channel. `summary.channelPeaks` is ordered by zero-based `channelIndex`;
Markdown labels these Ch1, Ch2, and so on, without inferring speaker roles from channel count.
`samplePeakMaxDb` and `truePeakMaxDbtp` are the maxima across **all** channels, including channels
outside the loudness layout. Unavailable values (including digital silence) are JSON `null` and
shown as a dash in text. The compatibility fields `samplePeakMaxLDb` and `samplePeakMaxRDb` mean
decoded channels 1 and 2; mono duplicates channel 1 in both. Additive fields retain schema version 2.

### Maximum locations

File analysis opts into location tracking; Live keeps it disabled and exposes no new measurement
fields. `summary.maximaLocations` contains `samplePeakMax`, `truePeakMax`, `mMaxWindowEnd`, and
`stMaxWindowEnd`. Every available location has `framePosition` and `timeSeconds`, relative to the
start of the decoded audio track at its analysis sample rate. Global peak locations also carry
zero-based `channelIndex`. Each `channelPeaks` entry has `samplePeakMaxLocation` and
`truePeakMaxLocation`. Missing locations, including silence and older results, are JSON `null` and
a dash in Markdown/text. Integrated, LRA and dialogue metrics do not have locations.

Sample Peak uses its zero-based sample frame index. Momentary/Short-term Max uses the exclusive
**Window End**: after the first decoded sample this is frame 1, at `1 / sampleRateHz` seconds.
The existing full-length windows and silence before the track start are unchanged. Equal maxima
keep the earliest source position; global peak ties at the same position use the lowest channel
index. Locations identify maxima at the meter's internal precision, before report rounding.

True Peak preserves the existing comparison of direct samples and FIR-interpolated candidates.
For interpolation phase `p` (1, 2 or 3) evaluated while processing source frame `n`, the source coordinate is
`n + p / 4 - 15.875` frames (4×, 32-tap-per-phase FIR). The original direct-sample candidate uses
`n`. Locations therefore have eighth-frame precision. A delayed candidate can tie an already
processed direct sample but still occur earlier in source time. Negative coordinates in the
existing start-padding region are retained and labelled **Before Start**, never clamped to zero.
The existing algorithm does not flush an extra zero-padded FIR tail after end-of-file; adding
locations does not introduce new candidates or change the measured maximum. Near the end, locations
refer to the direct samples and delayed interpolation candidates the meter actually evaluated.
