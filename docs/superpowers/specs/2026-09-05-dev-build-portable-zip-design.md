# Dev Build Portable ZIP

Date: 2026-09-05
Status: Approved

## Goal

Make the rolling Windows Dev Build publish the same Portable layout as the official Release: one
ZIP containing `plvs.exe` and `plvs-cli.exe`.

## Design

In `.github/workflows/dev-build.yml`, stage both release binaries in a temporary directory named
with the existing `-dev.<short-sha>` label, then compress that directory into
`PLVS-v<version>-dev.<short-sha>-x64-portable.zip`. Keep the NSIS asset unchanged.

Update `skills/plvs-dev-build/SKILL.md` so its workflow description, artifact table, and handoff
instructions name the ZIP and its two files.

## Verification

Extend the existing release workflow contract test to assert that the Dev Build workflow:

- stages both `plvs.exe` and `plvs-cli.exe`;
- invokes `Compress-Archive`;
- publishes a `-x64-portable.zip` asset;
- no longer publishes the old single Portable EXE.

No release version, tag, changelog, application identity, or installer behavior changes.
