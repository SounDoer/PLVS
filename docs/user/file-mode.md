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
