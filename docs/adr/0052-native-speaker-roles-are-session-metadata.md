# ADR 0052: Native Speaker Roles Are Session Metadata

**Status:** Accepted

**Date:** 2026-11-06

## Context

A multichannel output device can expose a 16-channel stream while macOS assigns only channels 1
and 2 to stereo speakers. Channel count does not identify speaker roles. Treating that stream as
stereo would discard real tracks; treating every unspecified role as the existing `generic` manual
role would add those tracks to loudness, because that role has weight 1. Windows speaker masks also
carry channel-order information that count-based detection loses.

## Decision

Read native roles for the exact captured endpoint on Windows and the captured single-stream device
on macOS. Expand Core Audio tags/bitmaps, preserve stream channel order, and retain unsupported or
unspecified positions as `generic` metadata. Do not apply a device-wide layout to a stream-local
buffer on a multi-stream device. Windows application capture keeps its explicitly requested format
rather than borrowing the default output's possibly different speaker mask.

Refresh metadata on the PCM consumer thread, outside the audio callback. A valid manual selection
wins. Otherwise a complete native role list supplies measurement weights and labels; a partial list
supplies labels and dialogue roles but keeps the existing channels 1/2 loudness fallback and unknown
layout warning. Without usable native metadata, retain the existing count-based fallback through
eight channels. Dialogue uses the same bounded fallback rather than guessing immersive layouts
from larger channel counts.

Keep automatic metadata out of persisted manual overrides. Carry it with frames and history so
Snapshot labels describe the recorded stream, and expose those same labels through Agent Control.
Changing the effective measurement selection resets loudness accumulation through the existing
pipeline transition. Every physical channel remains available to level metering and True Peak Max.

## Consequences

- Stereo speaker mapping does not imply a two-channel capture stream.
- Partial metadata remains visibly incomplete instead of being reported as a fully known layout.
- The stereo-only monitoring/display choice is separate work with an explicit measurement scope.
- Metadata queries are throttled to once per second; native endpoint format changes still follow
  the existing capture restart path.
- Windows, macOS and Linux share the resolver contract, while native adapters require platform
  compilation and real-device validation in addition to unit tests.
