# Windows Portable CLI Bundle Fix

Date: 2026-09-05
Status: Approved

## Problem

The Windows Release workflow publishes a renamed `plvs.exe` as a single Portable executable.
The public `plvs-cli.exe` forwarder is omitted, so Portable users cannot use the advertised CLI.
Publishing the forwarder separately would remain fragile because it requires a sibling named
exactly `plvs.exe`.

## Design

Publish one ZIP named `PLVS-<tag>-x64-portable.zip` containing:

```text
plvs.exe
plvs-cli.exe
```

Keep both original filenames so the thin forwarder can locate its host. The GUI executable is the
same release binary previously published directly; only the distribution container changes.

For workflow-dispatch builds, upload both executables in one `windows-portable` artifact. For tag
builds, stage the two files in a directory, compress it, and attach the ZIP to the GitHub Release.
Fail staging if either binary is absent.

Update current README and workflow wording from a single Portable EXE to the ZIP bundle. Do not
rewrite historical implementation plans or the separate dev-build workflow, which still describes
its actual output.

## Tests

Add a source-contract test for the Release workflow. It must prove that both binaries are checked
and copied, the ZIP is created and released, and the old single-EXE release name is absent.
