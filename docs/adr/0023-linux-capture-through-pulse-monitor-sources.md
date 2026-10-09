# ADR 0023: Linux capture through PulseAudio monitor sources

## Status

Accepted for experimental Linux builds

## Context

The generic cpal path originally treated output devices as capturable loopbacks, which is valid
for the Windows WASAPI backend but not for Linux ALSA or PulseAudio sinks. Linux also has two
desktop audio servers to accommodate: PulseAudio and PipeWire. The locked cpal dependency provides
a PulseAudio backend that can connect to either PulseAudio or PipeWire's compatible pulse service.

## Decision

Use cpal's PulseAudio host explicitly on Linux. Discover source roles from PulseAudio metadata and
open each sink's monitor as an input stream. Use native source identifiers for persistence and
resolve Automatic from the default sink's reported monitor, never by selecting the first device
or falling back to a microphone. Request float PCM at the source rate and channel count, keeping
the existing callback pool, delivery queue, meter pipeline, and drop accounting.

Metadata discovery stays outside realtime callbacks and has a bounded caller wait. A single
in-flight discovery worker prevents a nonresponsive server from accumulating worker threads.

## Consequences

PipeWire users need `pipewire-pulse`; direct ALSA, JACK, and native PipeWire-only sessions are not
supported by this first backend. This deliberately avoids implementing another PCM transport and
lifecycle before validating the existing pipeline on Linux. A future native PipeWire backend
must justify its extra implementation and testing cost against requirements the pulse protocol
cannot satisfy, such as additional routing or application-source behavior.

A null-sink smoke can verify the real protocol capture path without audible output or changing
the default device. WSLg can run that smoke but cannot establish native desktop, physical-device,
multichannel, or long-running capture reliability.
