# CLI Doctor Command Capabilities Fix

Date: 2026-09-05
Status: Approved

## Problem

The Doctor capabilities check still advertises the removed `probe`, `analyze`, `analyze-batch`,
`capture`, `devices`, `profile`, and `report` command families. The same binary correctly rejects
those names, so discovery contradicts actual parsing.

## Design

Replace the static command list with the two public v1 command families: `doctor` and `app`.
Keep the capabilities check and its other diagnostic fields unchanged. Do not couple Doctor to the
CLI parser solely to derive a two-entry list.

## Test

Call the capabilities check directly and assert that its command list is exactly
`["doctor", "app"]`. Run the focused Rust test and the complete merge gate.
