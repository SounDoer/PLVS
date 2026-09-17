# File Mode

Inspect a local audio file offline, using the same meter panels as live monitoring.

## Opening a file

Drop an audio file onto the window, or choose **Open file** in the toolbar. PLVS reads the file's
metadata with ffprobe and decodes it with a bundled FFmpeg — no external tools to install.

## Scrubbing

Move through the file's timeline and every panel updates to match, exactly like live monitoring.
Analysis stays read-only and local to the current session.

## Reports

When analysis completes, the summary can be exported as a report: **Export Markdown**,
**Export JSON**, or **Copy as Markdown**. Reports include the channel layout and the verdicts of the
active [Loudness Profile](loudness-profiles.md).
