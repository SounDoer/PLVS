# PLVS product scope

PLVS is a local desktop audio meter for sound designers and mix engineers. It gives them a
readable view of the signal during long sessions, through Live monitoring and local File analysis.
The application observes audio without changing the signal chain. The [user guide](user/README.md)
describes available sources, panels and platform support.

## Trust and control

- Monitoring starts on request. Background residence, launch at login and global shortcuts are
  explicit choices. The app shows when it remains running and can still capture.
- Capture failure, degraded readings and loss of data are visible. A stopped or incomplete reading
  must not be presented as trustworthy live measurement.
- Audio and metering stay local by default. PLVS has no default telemetry. Automatic outbound
  requests are for update checks by default. Feedback diagnostics and crash reports are sent only
  after explicit user action, and their attachments never include audio samples.
- Official builds are distributed through GitHub Releases. The app offers in-app update checks.
  See the [installation guide](user/getting-started.md) for platform availability and package details.

## Metering

- Loudness follows ITU-R BS.1770, with EBU R128 production and gating terminology. Editable
  Loudness Profiles provide monitoring rules over the same measurements. Profiles with a
  published basis identify their sources and carry no certification or endorsement claim.
- Spectrum is an FFT RTA reference with in-band levels in the dBFS domain. It makes no IEC 61260
  filter-bank claim. [Architecture](architecture.md#4-audio-pipeline) defines the detectors and
  processing.
- System output monitoring follows the configured speakers. Panels, analysis and measured-source
  recordings use the same monitored channels. Physical inputs and files keep their own topology.
- Known standard layouts use their BS.1770 channel weights, excluding LFE from loudness. True Peak
  Max covers all monitored channels. If the layout cannot be established, mark the Ch1/Ch2 loudness
  fallback wherever it is shown. Automatic count-based detection stops at eight channels. See
  [multichannel monitoring](user/multichannel.md) for detection and manual roles.

## Workbenches, sessions and export

Each workbench meters one Source and owns its active scene. Where supported, separate workbenches
can run in parallel and share the saved Library and identity-wide preferences. Workbench names
come from the Source. See the [Workspace guide](user/workspace.md) for platform qualification.

Measurement history and File analysis results are session-scoped. File supports explicit local
whole-file reports and statistics CSV for the current session. Reopening the application does not
restore a previous measurement session.

## Scope boundaries

The project scope excludes effects, routing that controls the audio output, audio plug-in
formats, general Live or time-series export, multi-source A/B in one workbench, a general-purpose
preferences framework and object or scene-based audio rendering. Agent Control uses the CLI.
Its screenshots and recordings serve automation.

App Store distribution, additional UI languages, a dedicated accessibility initiative, one-click
diagnostic bundle export and an MCP server are outside current commitments. English is the
default UI language. Platform-specific accessibility interactions used by existing features still
follow their documented behavior.
