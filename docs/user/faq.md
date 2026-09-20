# FAQ & Known Limitations

What PLVS intentionally does not do, and why.

## Does PLVS process or change my audio?

No. PLVS is read-only monitoring — it never adds effects, EQ, or rerouting, and it never changes what
you hear.

## Why can't PLVS hear my ASIO interface?

ASIO bypasses the Windows audio mixer, so loopback capture cannot intercept it. Switch your DAW to
WASAPI, or route through a virtual audio cable to a WASAPI-visible device. See
[Signal Source](signal-source.md).

## Can I export the metered data, like CSV?

CSV or session-data export is not implemented yet. File Mode can export an analysis report, Agent
Control can save a screenshot or a bounded H.264 recording of the rendered app, and configuration can
be exported and imported separately.

## Are the dialogue readouts certified?

No. They are a monitoring estimate; see
[Dialogue-Gated Loudness](dialogue-gated-loudness.md#limits).

## Is Dock available on macOS?

No. Dock mode is Windows-only.

## Is there a Linux build?

No, and there's no near-term plan for one.

## Is PLVS available as a plugin (VST/AU/AAX)?

No. PLVS is a standalone desktop app only.

## Why does my OS warn me when I first open PLVS?

PLVS builds aren't code-signed (Windows) or notarized (macOS) yet, so SmartScreen and Gatekeeper show
their standard first-run warnings. See [Getting Started](getting-started.md) for how to get past
them.

## Does PLVS send my audio anywhere?

No. All audio and metering data stays on your device, and there's no default telemetry. Update checks
are automatic. Feedback diagnostics and locally saved crash reports are sent only after you explicitly
choose to send them, and audio samples are never attached.

The [Privacy Policy](https://plvs.soundoer.com/privacy/) explains the data in each request, where it
is processed, how long it is kept and how to request deletion.
