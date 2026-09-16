# Portable FFmpeg Sidecars

Date: 2026-09-05
Status: Approved

## Problem

The Windows Portable ZIP contains `plvs.exe` and `plvs-cli.exe`, but file analysis resolves
`ffmpeg.exe` and `ffprobe.exe` beside the host executable. The installer includes those sidecars;
the Portable ZIP does not, so an extracted Portable build reports both sidecars unavailable and
cannot analyze files.

## Design

Package these four release outputs together in both official and rolling Dev Build Portable ZIPs:

- `plvs.exe`
- `plvs-cli.exe`
- `ffmpeg.exe`
- `ffprobe.exe`

Keep NSIS packaging, application identity, versioning, and updater behavior unchanged. Update
Portable documentation to tell users to keep all extracted files together.

## Verification

Extend workflow contract tests to require all four files in both ZIP staging paths and to reject
the prior two-file wording. Rebuild the Dev Build, download the real ZIP, and run `doctor` plus a
file-analysis test from the extracted directory.
