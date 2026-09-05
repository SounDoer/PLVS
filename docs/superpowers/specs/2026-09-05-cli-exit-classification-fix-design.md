# CLI Exit Classification Fix

Date: 2026-09-05
Status: Approved

## Problem

The frontend returns feature-specific public error codes, while the CLI exit mapper recognizes
only generic names. Valid commands refused by current application state therefore fall through to
exit `1` instead of exit `4`; feature-specific missing resources likewise miss exit `3`.

## Design

Keep classification on stable public `error.code` values. Extend the existing explicit match:

- exit `3`: invalid parameters and missing user-addressed resources;
- exit `4`: revision/editor/concurrency/availability/current-state refusals;
- exit `5`: timeout and cancellation;
- exit `1`: application, persistence, settlement, and unknown runtime failures.

Do not classify by message text or broad RPC-code ranges. JSON-RPC `-32602` remains an input error,
but feature-specific semantic errors use their stable public codes.

## Tests

Expand the Rust table test with every feature-specific code currently emitted by the frontend.
Keep an unknown code pinned to exit `1`, ensuring new codes do not silently enter the wrong class.
Run focused Rust tests and the complete merge gate.
