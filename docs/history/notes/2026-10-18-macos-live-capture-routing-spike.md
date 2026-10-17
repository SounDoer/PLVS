# macOS live-capture routing spike

**Date:** 2026-10-18

**Source:** `9fb067785b0c142b7cff5601d48ca6511e666f3f`

**Host:** macOS 15.6.1, Apple Silicon

**Status:** Complete; both native application isolation and the preferred BlackHole rig route were
proved on real hardware

## Question

Can the macOS live-capture acceptance adapter feed PLVS a deterministic stereo signal, exclude
unrelated system audio, survive application restart, and restore the machine without relying on
the Windows VB-Cable mechanism?

## Host inventory

No virtual Core Audio device was installed. The available outputs were:

| Device            | Input channels | Output channels | Nominal rate |
| ----------------- | -------------: | --------------: | -----------: |
| K4                |              4 |               4 |     48,000 Hz |
| Mac mini Speakers |              0 |               2 |     48,000 Hz |
| Odyssey G60SD     |              0 |               2 |     48,000 Hz |

VLC 3.0.21 was available as a command-line-controllable, bundle-identified player. PLVS discovered
it as one macOS capture application with the stable id
`app-a361a3eec68f8e209cc102ce0d743cd1`.

## Method

The existing repository signal generator produced a 60-second, 48 kHz stereo PCM file with a 1 kHz
tone at -20 dBFS in the left channel and -26 dBFS in the right channel. VLC looped that file while
the system output was temporarily muted. A current-source dev build captured only the VLC
application through the existing Core Audio process tap.

The internal file analyzer supplied ground truth. Agent Control supplied live measurements from the
same running source. QuickTime Player then played another copy of the signal as an unrelated
application while the VLC-only capture continued. Finally, PLVS was stopped and relaunched while
VLC remained alive to check application identity and source restoration.

All processes created by the spike were stopped. The temporary files were moved to Trash. Output
volume and mute state were restored explicitly to 100 and unmuted, matching the pre-spike values.

## Measurements

File ground truth:

| Metric                    | Value       |
| ------------------------- | ----------: |
| Integrated loudness       | -22.0306 LUFS |
| Left sample peak maximum  | -19.9995 dBFS |
| Right sample peak maximum | -26.0015 dBFS |
| True-peak maximum         | -19.9995 dBTP |

Current-source application capture after restart:

| Metric                    | Value       | Difference from file |
| ------------------------- | ----------: | -------------------: |
| Integrated loudness       | -22.0415 LUFS | 0.0110 LU |
| Left sample peak          | -20.0124 dBFS | 0.0129 dB |
| Right sample peak         | -26.0143 dBFS | 0.0128 dB |

The live result is well inside the existing capture-smoke tolerances. During the unrelated
QuickTime playback, repeated live samples remained near -22.03 LUFS, -20 dBFS left and -26 dBFS
right. A system mix would have risen by about 6 dB because the two files were identical. The native
application tap therefore excluded the unrelated application.

The application id survived PLVS restart and the restored workbench started capture without
reselecting VLC. Unattended VLC playback also survived the PLVS restart.

## Findings

### Native application isolation works

The Core Audio process tap is suitable for contamination isolation. It preserves the asymmetric
left/right signal and excludes a second application's identical playback. No microphone input is
part of this route.

### The default output still owns the tap format

The selected application was stereo, but the default K4 output exposed a 4-channel, 48 kHz stream.
PLVS reported `L`, `R`, `Ls`, and `Rs`; the first two carried the expected signal and the latter two
were silent. Consequently, native application isolation alone does not guarantee the shared
acceptance contract's fixed 2-channel topology on an arbitrary developer machine.

The macOS adapter should use a dedicated 2-channel virtual Core Audio device and verify 48 kHz
before playback. The device is a test-rig prerequisite only. It must not be bundled with PLVS or
installed by the product.

### Application sources are not fully controllable through Agent Control

The UI can discover, select, persist, and capture a macOS application source. The current Agent
Control `device list` omits application sources, `device select` rejects `app-*` ids, and
`device inspect` reports a persisted application selection as unavailable even while transport can
start it successfully. Any future application-source acceptance runner must close this contract
gap rather than use UI clicks or edit persistence directly. The final BlackHole adapter below does
not depend on application-source control.

### Player loops affect true-peak maxima

After several VLC loops, the live true-peak maximum reached about -18.25 dBTP while sample peaks and
integrated loudness remained correct. The file's end-to-start discontinuity is the likely cause.
The existing smoke comparison deliberately judges integrated loudness and per-channel sample peaks,
not true peak. A future soak signal must either be seamless at its loop boundary or avoid using
looped true-peak maxima as a stability claim.

### Exact application binding is mandatory

macOS can retain several old test bundles with the same display name. Display-name automation
briefly opened a previously built `PLVS Dev.app` instead of the current `cargo run` process. Live
acceptance must bind the exact runtime identity and executable path, then confirm the source SHA or
build receipt before accepting evidence.

### Audio restoration must record volume and mute separately

The AppleScript form `set volume without output muted` reset output volume to zero on this host.
The runner must snapshot numeric output volume and mute state independently, and restore both with
an explicit numeric command. Cleanup must verify the final values instead of assuming that clearing
mute preserves volume.

## Preliminary adapter decision

The pre-reboot result suggested combining the native macOS application tap with a dedicated
two-channel virtual Core Audio device. The post-reboot continuation below superseded that direction
with the simpler direct VLC-to-BlackHole route.

The preferred rig device is BlackHole 2ch. Homebrew currently offers version 0.7.1 and states that
a reboot is required after installation. An installation attempt reached the administrator
password prompt and was cancelled; the partial Homebrew cask registration was then removed, and no
package or HAL plug-in remains installed.

## Post-reboot BlackHole continuation

BlackHole 2ch 0.7.1 was installed with administrator authorization and the host was rebooted. Core
Audio then exposed exactly one two-channel input and one two-channel output named `BlackHole 2ch`,
both at 48 kHz. The host's K4 device remained the default output throughout the continuation.

Passing VLC the BlackHole display name did not route audio reliably. Resolving BlackHole's numeric
Core Audio `AudioObjectID` and launching VLC's AUHAL output with that id did. The current capture
harness selected PLVS's `lb-*` system-output-monitor row for BlackHole and measured:

| Metric                    | File truth | 10 s live capture | Difference |
| ------------------------- | ---------: | ----------------: | ---------: |
| Integrated loudness       | -22.0306 LUFS | -22.0305 LUFS | 0.0000 LU |
| Left sample peak maximum  | -19.9995 dBFS | -19.9995 dBFS | 0.0000 dB |
| Right sample peak maximum | -26.0015 dBFS | -26.0013 dBFS | 0.0002 dB |

The capture was stereo at 48 kHz with zero dropped chunks. After VLC was stopped, a two-second
capture returned all-null loudness and peak metrics, proving that no other route was feeding the
device. VLC was then restarted and a second five-second capture again returned -22.0305 LUFS with
the expected asymmetric channel peaks and zero dropped chunks.

Cleanup stopped the exact VLC and PLVS processes created by the spike and moved the temporary WAV
to Trash. No player or app process remained. Because the route never changed the default output,
system output, volume, mute, or sample rate, there was no host audio state to restore.

## Final adapter decision

Use direct VLC-to-BlackHole routing and capture PLVS's BlackHole system-output-monitor row. This is
the macOS equivalent of the existing Windows VLC-to-VB-Cable route:

- both use a dedicated two-channel virtual audio device at 48 kHz;
- both route only the repository-owned player process into that device;
- both compare live capture against file analysis of the same asymmetric signal;
- neither changes the user's default output or plays the tone through physical speakers.

The native application-tap result remains useful product evidence, but it is not required by the
acceptance adapter. Avoiding it removes the arbitrary default-output channel topology and means the
Agent Control application-source gap is a separate product/tooling improvement rather than a
prerequisite for cross-platform capture acceptance.

The reusable runner must resolve the PLVS capture row and VLC render target independently. On
macOS that means a stable `lb-*` capture id plus the numeric Core Audio `AudioObjectID`; on Windows
it means `CABLE Output` plus the MMDevice render endpoint id. It must validate the expected stereo,
48 kHz topology before interpreting any measurement as a code signal.
