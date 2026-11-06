# ADR 0055: Windows Complete Stereo Mix Is a Safe Monitoring Scope

**Status:** Accepted

**Date:** 2026-11-06

Amends the incompatible Windows mapping refusal in
[ADR 0053](0053-system-output-monitoring-follows-configured-speakers.md). All other scope rules remain.

## Context

After switching from 7.1 to spatial sound, a Windows dev session repeatedly refused capture with
an incomplete speaker mapping. The original log did not retain the masks, so it cannot establish
the precise failing configuration. Windows exposes physical speaker configuration separately from
the audio engine's shared-mode mix format; those descriptions need not describe the same stage.
Requiring every configured surround speaker to exist in a complete L/R stereo mix prevents safe
monitoring of that mix. Falling back to all device tracks would reintroduce unrelated hardware audio.

## Decision

Accept the entire Windows mix as stereo when it contains exactly two channels, its explicit speaker
mask is L/R (`0x3`), and the configured speaker mask includes L/R. No spatial sound provider detection
is required: the decision is about the supplied PCM scope, not which effect produced it.

Keep normal configured-speaker projection for wider streams. Do not infer this exception from a
two-channel count, an unlabelled stream, or the first L/R pair of a larger stream. Other incompatible
mappings still refuse capture. Inputs, application capture, macOS and Linux retain their existing rules.

Log raw Windows layout information at capture startup, rather than during inventory polling, so a
future failure identifies the requested width, actual mix width, masks and resolved mapping.

## Consequences

- A stereo engine mix can be measured despite a retained surround configuration containing L/R.
- This does not reconstruct surround channels, decode spatial objects or promise a particular
  position in a provider's effects chain; measurement applies to the PCM WASAPI supplies.
- Multichannel hardware still excludes tracks outside the configured speaker scope.
- Provider-specific switching requires live validation; synthetic tests alone do not reproduce it.

## References

- [Windows physical speaker configuration](https://learn.microsoft.com/en-us/windows/win32/coreaudio/pkey-audioendpoint-physicalspeakers)
- [Windows shared-mode mix format](https://learn.microsoft.com/en-us/windows/win32/api/audioclient/nf-audioclient-iaudioclient-getmixformat)
