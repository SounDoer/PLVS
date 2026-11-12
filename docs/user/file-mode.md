# File Mode

Inspect a local audio file offline, using the same meter panels as live monitoring.

## Opening a file

In File Mode, drag an audio file or a video with an audio track over the window. Release it when
**Drop File to Analyze** appears. You can also choose **Open** in the transport pill.
PLVS analyzes files locally using bundled ffprobe and FFmpeg.

When a file contains multiple audio tracks, choose one in **Select Audio Track**, then choose
**Analyze**. The default-marked track is selected initially. Cancelling leaves the current file
and result unchanged. To choose another track, open or drop the file again; each track has its own
analysis entry. Reopening an unchanged file and track reuses its existing result. If there is no
completed result, reopening starts a new analysis in the same entry. Agent Control's
`transport file analyze` follows the same rules and takes `--track <index>` for a file with several
audio tracks.
Reanalyze keeps the original track. If the source contents changed, reanalysis creates a new entry
and preserves the old result. Missing sources do not remove results or reports already in memory.

Source versions use a content fingerprint taken when the file is opened and checked again after
decoding; Cancel also stops a fingerprint read in progress. Completed
duration comes from decoded audio frames; container duration is only a progress estimate.

The pill shows progress and **Cancel** while the current file is working, **Retry** after a
failure, and the duration after success. **Result** returns from a selected
time without resetting zoom or scroll. The toolbar's **Sources** button stays in place and is
disabled in File Mode. Open and other task starts are disabled while a file task is active.

## File Summary

Open **Files** at the left of the summary bar to switch files, analyze again, export a report, or remove an entry. An
analysis on a different file stays in the background; its progress and cancellation are on that
file's row. During reanalysis, the previous result remains visible and you can keep inspecting a
time point. A successful reanalysis replaces the result. The whole-file metrics on the right stay
independent of timeline inspection.

Long filenames in the summary bar and **Files** menu are shortened in the middle to keep the
ending visible. Hover over a shortened name to see the full filename. The summary bar gives
selected metrics priority and uses spare space to show more of the filename.

Use **Clear All Files…** at the bottom of the **Files** menu to remove all entries and results after
confirmation. Audio files on disk are kept.

Hover the information, warning, or metric controls for details. Click to keep the same details
open, and click again, press Escape, or click outside to close them. Peak details include each
decoded channel's maximum and occurrence time. **Loudest Range** shows the start and end of the loudest
Momentary or Short-term window within the track. A settings warning explains which changes need
reanalyzing without discarding the previous result.

**Summary Metrics** chooses and orders the displayed readings, including no readings at all.
Integrated, LRA, and True Peak Max are the defaults. A narrow window puts remaining readings under
**+N**. The choice is a global preference, independent of Presets and the Stats panel.

## Statistics CSV

At the bottom of the **Files** menu, choose **Export Statistics…**. All successful results are selected by
default. Choose any number of them, including one, and then **Export CSV…**. An entry with a
previous successful result remains eligible while it is reanalyzing. The export uses the selected
successful results and the Loudness Profile active when you choose Export CSV. The suggested
filename starts with `plvs-file-statistics-` and includes the local export time to the second. The timestamp inside the CSV uses UTC.

Each row contains one result, with numeric measurements and positions in seconds, plus channel
columns through the highest selected channel count. A nonexistent channel's columns are empty;
an unavailable measurement has an explicit reason. The complete Profile rules and metric verdicts
are repeated on every row. A metric with no rule is `notApplicable`.

The CSV uses UTF-8 with a byte order mark, comma-separated fields, and quoted multiline text.
Text that starts with `=`, `+`, `-`, `@`, a tab or a line break, such as a file named
`-6dB Mix.wav`, is prefixed with an apostrophe so a spreadsheet shows it as text instead of running
it as a formula. Scripts that read the CSV see that apostrophe. Numeric cells are unaffected. Full
file paths are omitted. `result_id` identifies a result only within the session that exported it.
This is whole-file statistics; time series are not included.

Where the system uses a comma as the decimal separator, double-clicking the CSV can open it in
Excel as a single column. Import it with **Data › From Text/CSV** and choose comma as the
delimiter instead.

## Scrubbing

Move through the file's timeline and every panel updates to match, exactly like live monitoring.
Analysis stays read-only and local to the current session. File history covers the complete file and
does not use the Live **History Length** setting. Long files use fewer display checkpoints while
remaining navigable from beginning to end.

Changing Live History Length does not reset the File timeline's zoom, scroll, or selected time.
Changing the Dialogue Detection engine in Settings also preserves File entries and results; a
running analysis continues with the conditions captured when the run was requested, including
while file metadata is being read. Reanalyze the file
to use a different detector. Live measurements retain their existing reset behavior.

Reanalysis retains the previous completed result and its browsing history until the replacement
succeeds. You can continue inspecting and exporting that result while the new run is in progress.
Cancelling or failing a replacement does not discard the previous successful result.

Completed statistics remain available for every entry during the session. Browsing histories share
an internal resource budget; PLVS releases the least recently viewed eligible history first. The
current file and an active task's previous/staging histories are protected, so this budget is a
retention target rather than a hard memory ceiling. Live history is managed independently.

When history has been released, selecting the file keeps its statistics and reports available and
does not start analysis. Choose **Restore History** to rebuild browsing data with the original
track and analysis conditions. Restoration does not replace the statistical result or its analysis
time. Missing or changed sources cannot restore the old history; **Reanalyze** uses current settings
and creates a new entry when the source changed. Failed or cancelled restoration preserves the result.

## Reports

Exported report filenames start with `plvs-report-` followed by the audio filename stem.
When analysis completes, the file's row in the **Files** menu can export a report: **Export Markdown**,
**Export JSON**, or **Copy as Markdown**. Reports include the channel layout and the verdicts of the
active [Loudness Profile](loudness-profiles.md).

Markdown has five chapters: **Summary**, **File**, **Measurements**, **Loudness Profile**, and
**Analysis Details**. Reports always include the whole track's measurements, independent of the
visible summary. They evaluate the Loudness Profile active at export, including an unsaved preview,
and count each configured metric once at its worst verdict. Fail takes precedence over Warn, then
Not Fully Evaluated, then OK. An off or empty Profile is Not Evaluated.

JSON report schema version 3 removes `source.path`. Use `source.fileName`, `source.version` and
the selected track to identify the result. `source.durationMs` describes decoded audio;
`source.declaredDurationMs` preserves the container estimate separately. Reports omit full local
paths and retain the run's original analysis conditions, regardless of later setting changes.
Unavailable values are `null` with codes in `unavailableReasons`; Markdown groups shared causes.
Detector failures leave the affected dialogue values unavailable while retaining programme results.

Integrated, Loudness Range, Max, and dialogue results in the report are calculated from the complete
decoded audio track, independently of the display checkpoints used for scrubbing.

Completed file summaries and JSON/Markdown reports include whole-file Sample Peak Max and True
Peak Max for every decoded channel. `summary.channelPeaks` is ordered by zero-based `channelIndex`;
Each entry carries its result-bound channel label, with generic labels for unknown layouts.
`samplePeakMaxDb` and `truePeakMaxDbtp` are the maxima across **all** channels, including channels
outside the loudness layout. Unavailable values (including digital silence) are JSON `null` and
shown as a dash in text. The compatibility fields `samplePeakMaxLDb` and `samplePeakMaxRDb` mean
decoded channels 1 and 2; mono duplicates channel 1 in both.

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
