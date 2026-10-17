# Cross-platform live-capture acceptance design

**Date:** 2026-10-18

**Status:** Approved for implementation

## Purpose

Give Windows and macOS the same automated answer to one release question: can the current PLVS
capture path ingest a known stereo signal from a real audio device and produce the same loudness
and channel peaks as file analysis?

The existing Windows smoke and soak commands already define the product-level contract. This
design preserves that contract and adds a platform adapter instead of creating a second macOS-only
test suite.

## User-facing form

The commands stay the same on both platforms:

```text
npm run smoke:capture
npm run soak:capture
```

The smoke run is short and gives one of three verdicts:

- `OK`: the real capture path agrees with file analysis;
- `FAIL`: the rig worked and PLVS produced an incorrect result;
- `RIG`: a prerequisite or route is unavailable, so the run says nothing about PLVS correctness.

The soak run holds the same signal for four hours by default and records periodic measurements in
`artifacts/soak/`. It detects leaks, dropped audio and metric drift that a short smoke cannot.

## Shared acceptance contract

Both platforms use the repository's 60-second, 48 kHz stereo PCM signal: a 1 kHz tone at -20 dBFS
left and -26 dBFS right. The asymmetry makes a channel swap visible.

The file analyzer supplies ground truth. Live capture must:

- report 48 kHz and two channels;
- drop no chunks during smoke;
- remain within 0.5 LU for integrated loudness;
- remain within 0.2 dB for each channel's sample-peak maximum;
- reject null, missing or non-finite measurements;
- use the shared lease so smoke, soak and other capture automation cannot contaminate each other;
- stop only the player process it created and remove its temporary signal on every exit path.

Soak retains the existing warmup, drift and maximum-to-integrated checks. Historical soak files
remain the human baseline for deciding whether a passing but unusual spread deserves investigation.

## Platform adapters

| Concern | Windows | macOS |
| --- | --- | --- |
| Rig dependency | VB-Cable | BlackHole 2ch |
| Player | VLC | VLC |
| Render target | MMDevice endpoint for `CABLE Input` | Core Audio `AudioObjectID` for `BlackHole 2ch` |
| PLVS capture target | `CABLE Output` capture row | `BlackHole 2ch` system-output-monitor row |
| Player backend | VLC `mmdevice` | VLC `auhal` |
| Harness executable | `plvs.exe` | `plvs` |
| Player cleanup | targeted `taskkill` process tree | targeted TERM, then KILL fallback |
| RSS sampling | PowerShell | `ps` |

BlackHole and VB-Cable are developer/test-rig prerequisites. PLVS does not install, bundle, update
or configure either driver.

## Rig discovery and validation

One shared resolver returns a normalized route containing the capture selector, player target,
display label and platform. Callers do not know OS-specific device identifiers.

Windows keeps the proven registry lookup and strict MMDevice id shape validation. macOS uses a
small repository-owned Swift/Core Audio probe to find exactly one output device named
`BlackHole 2ch`, obtain its numeric `AudioObjectID`, and verify two output channels at 48 kHz.

The capture harness gains a listing mode that emits the same device rows used by capture. The
JavaScript resolver chooses exactly one system-output-monitor row named `BlackHole 2ch`, verifies
two channels at 48 kHz, and passes its stable `lb-*` id back to capture. It never guesses between
the input and output rows by display name.

Missing VLC, a missing or duplicate virtual device, an unexpected format, malformed probe output,
or a stale harness is a `RIG` verdict. Silence after apparently successful routing remains a failed
measurement rather than a skipped assertion.

## Host safety

The runner never changes the default audio output, system-output device, volume, mute state or
nominal sample rate. Direct player routing prevents the test tone from reaching physical speakers.
Cleanup targets the spawned VLC process only; it never kills every VLC instance on the machine.

The platform adapter is allowed to install nothing and request no elevation. Setup documentation
may name the required driver and reboot, but command execution begins only after prerequisites are
already present.

## Evidence and compatibility

Console output retains the current metric table and adds the resolved rig route so failures are
diagnosable. The JSON artifacts and thresholds remain platform-neutral. Windows behavior is a
compatibility requirement: adding macOS must not change its endpoint lookup, VLC route or verdict
semantics.

CI continues to run unit and contract tests without audio hardware. Real smoke and soak runs stay
host-only because hosted runners do not have the virtual device or sound card. Windows evidence is
temporarily advisory until a Windows rig is available again; this does not weaken its automated
contract.

## Out of scope

- installing or managing virtual audio drivers;
- replacing the current capture engine or signal-analysis algorithm;
- using macOS application capture for this rig;
- automating notarization, installer authorization or other release acceptance;
- treating one soak's numeric threshold as a substitute for comparison with prior artifacts.
