# Home runner measurements — capture acceptance

Date: 2026-10-20 (local evening; runs completed 2026-10-20 15:35–15:48 UTC)
Plan: `docs/history/plans/2026-10-20-three-platform-capture-acceptance.md`, Task 5
Spec: `docs/history/specs/2026-10-20-three-platform-capture-acceptance-design.md`

Phase 0 of the spec: install a self-hosted runner per platform and measure what reaches the
capture rig. Facts below were checked on each machine by the agent session running there and
reported back; items not checked are marked.

## Result

Run `39449749232` dispatched `capture-acceptance.yml` for `ef9bc0f8fd351b048e35529a6862b16780899e9a`.
All three jobs succeeded and uploaded `capture-evidence-<platform>`. Each `result.json` names that
SHA, `summary: complete`, and passes `rig-route`, `live-file-agreement` and `zero-dropped-chunks`
with 0 dropped chunks.

| Platform | Runner                         | Job time    |
| -------- | ------------------------------ | ----------- |
| Windows  | `plvs-company-pc`              | 6 min 39 s  |
| macOS    | `plvs-rig-mac-Xichen-Mac-Mini` | 10 min 39 s |
| Linux    | `plvs-rig-ubuntu-equb`         | 13 min 17 s |

## Repository setting

Fork pull request workflow approval: `first_time_contributors` (read through the REST API). This
meets the plan's minimum. Self-hosted safety rests on the trigger rule in
`scripts/self-hosted-workflow-guard.mjs`, not on this setting.

## Windows — company PC (temporary)

- The maintainer's home PC could not host the runner on 2026-10-20 (cause not recorded). The
  maintainer placed the Windows runner on the company PC instead, after confirming company policy
  allows it, as a temporary arrangement. Releases now wait while that PC is off or logged out.
- Runner 2.338.0, official archive verified against the release SHA-256, installed at
  `C:\actions-runner-plvs`; labels `self-hosted, plvs-rig, Windows, X64`.
- Account: the maintainer's own logged-in account. Not a Windows service: a logon launcher in the
  user's Startup folder (`PLVS capture runner.cmd`) starts `run.cmd` minimised in the user session,
  where VB-Cable is reachable.
- Rig: VB-Cable endpoints present and OK; VLC at `C:\Program Files\VideoLAN\VLC\vlc.exe`.
- **Trap:** the first `bash.exe` on this PC's PATH is WSL's `C:\Windows\System32\bash.exe`. With
  `shell: bash` the steps would run in WSL. A quoted shell path in the workflow does not work
  either: the runner split `"C:\Program Files\Git\bin\bash.exe"` at the quote and failed with
  `'C:\windows\system32\"C:'` (run `39448019559`, commit `36aa0bfc`). The launcher therefore puts
  `C:\Program Files\Git\bin` first on PATH before starting the runner (commit `ef9bc0f8`).
- **Trap:** the agent's own processes run inside the Claude desktop app's MSIX container. The
  runner was started through `explorer.exe` so that it runs outside it.
- Not measured: the session was reached over RDP at the time of the run and the job still passed;
  behaviour after the RDP session is disconnected was not tested.

## macOS — home Mac mini

- Runner 2.337.0 at `/Users/xichenshen/actions-runner-plvs-macos`; labels
  `self-hosted, macOS, ARM64, plvs-rig`.
- Account: the maintainer's own login account (`xichenshen`, admin). A dedicated account was not
  used.
- **Launch: manual, in Terminal.app (`./run.sh`).** A LaunchAgent installed with `./svc.sh install`
  built fine but captured silence. TCC attributed the audio request to the runner's bundled Node,
  which lacks the audio-input entitlement (`Client is not granted access`). Run from a Terminal
  that holds microphone permission, TCC attributes VLC and the harness to `com.apple.Terminal` and
  capture works. Consequence: after a logout, a reboot or closing that Terminal window, the runner
  does not come back by itself. `svc.sh uninstall` may leave an enabled `launchctl` override for a
  service that no longer exists; that override alone does not mean anything autostarts.
- Rig: BlackHole 2ch 0.7.1 (2 in, 2 out, 48 kHz); VLC 3.0.21.
- Power: `sleep 0`, `displaysleep 60`, `standby 0`, `autorestart 1`; screen lock immediate.
- **Locked screen works.** Job `118693702337` passed with `IOConsoleLocked=1` and
  `CGSSessionScreenIsLocked=1` throughout capture and evidence upload, as did the unlocked job
  `118682350633` (both at `5249e785`; truth/live about −22.031 LUFS). The screen lock stays on.
  The build phase of the locked job unlocked the screen once (cause unknown, possibly a paired
  device); it was locked again before capture began.
- Found while setting up: `actions/setup-node` probing Yarn let Corepack add a `packageManager`
  field to `package.json`, so the worktree was dirty and evidence refused to name a SHA. Fixed with
  `COREPACK_ENABLE_AUTO_PIN: 0` (commit `8f58c416`).
- Home-network checkouts were sometimes slow, over ten minutes, but kept progressing.

## Linux — home Ubuntu

- Runner 2.338.0 at `/home/xichen/actions-runner-plvs`; labels `self-hosted, plvs-rig, Linux, X64`.
- Account: the maintainer's own desktop account (`xichen`, in `sudo`, sudo needs a password). A
  dedicated user was not created, because it could not reach the desktop user's PipeWire session.
- Launch: a `systemd --user` unit
  (`~/.config/systemd/user/actions.runner.SounDoer-PLVS.plvs-rig-ubuntu-equb.service`, enabled)
  running `runsvc.sh`, with `loginctl enable-linger` (`Linger=yes`), so it starts after a reboot
  without a login.
- Audio: `pactl info` reports PulseAudio on PipeWire 1.0.5, 48 kHz float32 stereo;
  `pipewire`, `pipewire-pulse` and `wireplumber` user services active.
- Tools: `/usr/bin/ffmpeg` and `/usr/bin/ffprobe` 6.1.1; Rust 1.99.0; Node 24.19.0.
- Power: no suspend on AC idle; up continuously since 2026-10-18.
- Traps:
  - `runsvc.sh` is not in the runner root unless the root-level `svc.sh install` copied it; copy
    `bin/runsvc.sh`, or the unit fails with `203/EXEC`;
  - the user unit's `PATH` must include `~/.cargo/bin`;
  - the unit should order itself after the PipeWire services;
  - `pactl` fails inside an agent sandbox even when the session's audio is fine;
  - overlapping downloads corrupted the runner archive once, so verify the archive's SHA-256
    before extracting.

## Decisions for the remaining tasks

- Every runner uses the maintainer's own account. Spec §4 allowed this fallback; it rests on the
  trigger rule and the absence of secrets.
- `smoke:capture` is the Linux entry point (spec §2 open point). It routes through a private null
  sink and writes acceptance evidence.
- The setup guide (Task 7) documents per platform: macOS manual Terminal launch, Linux user unit
  plus linger, Windows logon launcher with Git Bash first on PATH.
- A possible macOS improvement, not adopted: a `.command` login item that opens Terminal would
  restore the runner after login, but not after a reboot with FileVault, where no automatic login
  happens.

## Not verified

- The lease queueing check (plan Task 5 Step 5: a manual `smoke:capture` running while a job
  starts) was not run.
- Windows runner behaviour after the RDP session disconnects.
- Why the home Windows PC failed.
