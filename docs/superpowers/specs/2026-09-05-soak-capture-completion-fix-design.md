# Soak Capture Completion Fix

Date: 2026-09-05
Status: Approved

## Problem

The soak script treats only child exit code 2 as a startup failure and validates the final report
only when one exists. A capture process can emit enough stable samples, exit abnormally without a
final report, and still reach the “OK no drift” branch.

## Design

Before evaluating samples, require all three completion conditions:

1. Child exit code is exactly zero.
2. A final capture report was parsed.
3. The final report status is `ok`.

Extract this validation into a soak-specific pure helper. It throws `RigError` for any invalid
completion, preserving exit code 2 for an unusable run. Keep drift, dropped-chunk reporting, RSS,
and warmup behavior unchanged.

## Tests

Cover successful completion, nonzero exit, missing final report, and an error final report without
spawning a process or requiring the capture rig.
