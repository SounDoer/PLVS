# ADR 0053: System Output Monitoring Follows Configured Speakers

**Status:** Accepted

**Date:** 2026-11-06

Supersedes the all-exposed-channel system-output scope in
[ADR 0052](0052-native-speaker-roles-are-session-metadata.md). Its separation of native metadata from
manual roles, conservative unknown-role handling and historical label ownership remain applicable.

## Context

A 16-channel interface configured for Stereo should behave as a Stereo system-output source on
every platform. Relabelling two of sixteen meter columns does not meet that expectation. Hiding
extra columns also leaves loudness, True Peak, dialogue, recording and exports measuring a different
signal from the one the user sees. A preferred stereo pair alone does not prove that a larger
stream is currently configured as Stereo.

## Decision

Resolve the system's configured speaker tracks and gather those PCM channels before analysis or
measured-source recording. Standard layouts use the shared table's standard order. This is channel
selection and reordering, not a stereo downmix: a 5.1 source remains six distinct channels.

Windows maps `PKEY_AudioEndpoint_PhysicalSpeakers` onto the captured endpoint's mix-format speaker
positions, including the legacy 5.1 side/back convention. A missing configured property falls back
to the actual mix-format mask; an incompatible mapping refuses capture. Zero-mask direct streams retain their
configured channel count with unknown positions. macOS uses explicit speaker layout descriptions,
expanded tags or bitmaps for the captured single-stream device. Unknown/unused device slots are
outside that explicit speaker configuration. A mere preferred stereo pair is sufficient only when
it covers the entire two-channel stream. Linux matches the output sink's configured positions to its
monitor source, and opens libpulse-simple with the source's exact native channel map.

Resolve the plan once per session outside the realtime callback. Include its physical indices and
roles in the private device inventory fingerprint so the existing device watch starts a new capture
session for mapping changes, including same-count pair changes. All consumers use the same selected
PCM; Linux retains its 20 ms measured-source cadence with the same plan used by its meter consumer.
Capture summaries/evidence use the same scope. Inputs and files retain their own topology.

Refuse output capture when a speaker scope cannot safely be established. Unsupported speaker roles
within an established scope remain visible and unknown; they are not silently assigned a standard
layout. Manual role settings affect measurement interpretation within the selected scope, not which
extra hardware tracks become part of system output monitoring.

## Consequences

- A Stereo configuration on ZenGoSC produces two measured/displayed channels despite sixteen
  exposed device channels. Non-first and swapped device assignments are gathered correctly.
- Unselected hardware tracks cannot influence any peak, loudness, dialogue or recorded sample.
- Same-count system routing changes reset accumulation through the existing capture session boundary.
- Physical input and file monitoring remain distinct from the system-output speaker scope.
- An optional all-device-output monitoring mode requires an explicit product selection; it must not
  be inferred from a manual role edit or from the interface's maximum channel count.

## References

- [Windows endpoint speaker configuration](https://learn.microsoft.com/en-us/windows/win32/coreaudio/pkey-audioendpoint-physicalspeakers)
- [Windows stream-to-speaker mapping and legacy 5.1 convention](https://learn.microsoft.com/en-us/windows-hardware/drivers/audio/mapping-stream-formats-to-speaker-configurations)
- [PulseAudio channel maps](https://www.freedesktop.org/software/pulseaudio/doxygen/channelmap.html)
