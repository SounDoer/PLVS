# CLI FILE Action Status Fix

Date: 2026-09-05
Status: Approved

## Problem

The bridge currently labels every Transport action `status: "completed"`. FILE Analyze and
Reanalyze return once Rust accepts the asynchronous analysis, not when analysis reaches a terminal
state, so that status overstates what the command has guaranteed.

## Design

Return `status: "accepted"` for `transport.file.analyze` and
`transport.file.reanalyze`. Keep `status: "completed"` for LIVE Start, LIVE Stop, and FILE Stop,
whose command boundary represents completion of their requested native transition.

Do not change response fields, revision behavior, execution settlement, or FILE lifecycle state.
Callers continue to use `transport inspect` or `app wait` to observe analysis completion.

## Tests

- Assert Analyze and Reanalyze actions return `accepted`.
- Preserve the existing LIVE Start assertion for `completed`.
- Run the focused bridge suite and the complete merge gate.
