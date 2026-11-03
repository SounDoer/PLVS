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

Yes. macOS supports an always-on-top strip at the top or bottom of the screen, including over
native full-screen Spaces with **Above Full Screen** enabled (the default). The toolbar and editors
stay in that Space. This overlay needs no Accessibility permission. Optional **Reserve Space** uses
Accessibility permission to move or shrink ordinary application windows away from the strip;
native full-screen applications are not resized. See [Dock](workspace.md#dock).

## Is there a Linux build?

Yes. PLVS ships a `.deb` package for Ubuntu 24.04 x86_64. Current stable packages can download a
signed update in PLVS and install it through Ubuntu's administrator authentication and APT; older
packages need one manual update from GitHub Releases to add that support. Dock is not available on
Linux. See [Getting Started](getting-started.md#linux).

## Is PLVS available as a plugin (VST/AU/AAX)?

No. PLVS is a standalone desktop app only.

## Why does my OS warn me when I first open PLVS?

Windows builds aren't code-signed yet, so SmartScreen may show its standard first-run warning.
Official macOS builds are Developer ID signed and Apple-notarized; Gatekeeper should accept an
unaltered download. See [Getting Started](getting-started.md) for installation details.

## Does PLVS send my audio anywhere?

No. All audio and metering data stays on your device, and there's no default telemetry. Update checks
are automatic. Feedback diagnostics and locally saved crash reports are sent only after you explicitly
choose to send them, and audio samples are never attached.

The [Privacy Policy](https://plvs.soundoer.com/privacy/) explains the data in each request, where it
is processed, how long it is kept and how to request deletion.
