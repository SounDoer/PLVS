# Release operations

This guide owns stable-release review records, packaged update acceptance, self-hosted capture
runners, broken-release response, and signing-secret inventory. The executable release sequence
remains in [the release skill](../.agents/skills/plvs-release/SKILL.md); everyday development and CI
conventions remain in [CONTRIBUTING.md](../CONTRIBUTING.md).

## Release public-content review

Every stable desktop release requires `docs/release-content-review.json`. This is the latest
review record; git retains previous records. Ordinary development CI does not require a fresh
record. Both `release:preflight` and the remote Release validation job enforce it before builds.

1. Fetch full history and tags. Review the complete range from the latest reachable stable
   `vX.Y.Z` tag to the candidate, including implementation changes, not just documentation diffs.
   Reconcile `docs/user/`, README highlights, website copy and screenshots. Inspect the current
   images against the shipping UI and retake affected screenshots when appearance changes.
2. Finish the version bump, CHANGELOG and content changes, run the required pre-commit checks,
   and commit the candidate. Run `npm run release:content:snapshot`. This read-only command prints
   a template with pending decisions; it never approves anything or overwrites an existing review.
3. Save the template as `docs/release-content-review.json`. For each of `userGuide`, `readme`,
   `website` and `screenshots`, set `status` to `updated` or `unchanged`, explain `rationale`, and
   supply a nonempty `evidence` array identifying the paths, comparisons or screenshots inspected.
   An unchanged surface still needs a concrete reason. Do not merely replace a stale fingerprint.
4. Run `npm run release:content:check`, then the required pre-commit checks and commit the record.
   Run the full `npm run release:preflight` before pushing and dispatching the exact final SHA.
5. When fixes land after the record, such as while iterating a standalone `update-acceptance.yml`
   or `capture-acceptance.yml` run, leave the record stale until the fixes are finished. Those
   workflows do not read it. Renew it once, reviewing the whole change since the reviewed
   candidate, immediately before the final preflight and dispatch.

The record binds the version, baseline tag and commit, reviewed candidate commit and a fingerprint
of the entire tracked candidate tree, including file modes and asset bytes. Only the review record
itself is excluded to avoid a circular fingerprint when committing it. Any other tracked change
requires renewed review; this deliberately includes implementation changes that can make unchanged
screenshots or prose obsolete. Uncommitted candidate changes, shallow history and missing stable
baselines fail closed. The remote checkout fetches full history and tags.

This gate ensures review decisions are present and current; it cannot prove prose is accurate or
that someone actually inspected an image. It does not replace the privacy review below, real-device
smoke tests, or verification that the subsequent website deployment succeeded.

## Packaged update acceptance

Packaged update acceptance builds two real versions from one clean commit under an isolated test
identity. It never uses the stable, dev, or Preview identity, data directory, updater key, or feed.
On Linux the packages keep the stable `plvs` package name and paths, which the Linux updater
requires, so the run installs them system-wide and restores the machine afterwards
([ADR 0038](adr/0038-linux-update-acceptance-installs-the-system-package.md)).

```bash
npm run update:acceptance:build
npm run update:acceptance:run -- artifacts/update-acceptance/<short-sha>
npm run update:acceptance:verify -- artifacts/update-acceptance/<short-sha>
```

The runner drives the real Update surfaces through acceptance-only Agent Control actions. It saves
the first-run preferences, opens details, retries rejected downloads, skips once, confirms both
installation attempts, and quits through the normal application business path. No pointer input or
operator checkpoint is part of a valid run. `update:acceptance:serve` remains a debugging command,
not a release step.

Stable releases call `update-acceptance.yml`. When the product update chain changed
(`UPDATE_ACCEPTANCE_PATHS` in `scripts/update-acceptance-code-changed.mjs`), its
self-hosted Windows, macOS and Linux jobs build and run the exact commit, export evidence without
the ephemeral private key or build cache, upload it as short-lived Actions artifacts, and verify all
three platform records in one hosted aggregate job. `release.yml` waits for that reusable workflow before
assembling the Draft, so maintainers never copy acceptance files between machines.

The same workflow also runs nightly (18:00 UTC) against the tip of `main`. A scheduled run compares
with the head commit of the latest successful `update-acceptance.yml` run instead of the last
release tag, and it also counts the acceptance harness (`UPDATE_ACCEPTANCE_HARNESS_PATHS`: the
acceptance-only Agent Control surface, the acceptance scripts and workflows). It reaches the runners
only when either changed since then. A release does not wait for a harness-only change, because the
harness cannot change what users receive; a broken harness instead fails overnight, and GitHub's
failure notification for the scheduled run is the signal. A standalone dispatch watches both by
default (`include_harness`).

The macOS runner stages the older app in a writable path containing spaces and launches that exact
bundle executable as a background child of the long-lived runner. This keeps the update helper's
process session alive while preventing duplicate copies with the same test identity from
redirecting launch to an older path. It first mounts the older DMG read-only, opens About settings,
captures the visible move-to-Applications guidance, proves that no ready package was staged, quits
the isolated app, and unmounts the image. If the cold WebKit snapshot does not settle, the runner
repeats that complete isolated DMG scenario once; a second failure remains a failed scenario.
Before staging the valid package, the runner serves a
stale signature and a truncated package in turn, waits for a real Update retry and visible error,
records screenshots, and proves that neither rejection left a ready package. It then stops the
loopback feed after the valid signed package is cached and records the offline replacement and
restored Dock. Before the successful replacement, the isolated debug identity pauses its helper
before any files change; the runner terminates that exact helper process, relaunches the old app,
captures the visible interrupted-install error, verifies that the cached package remains ready,
and retries through the normal UI. Release builds and non-acceptance identities ignore this fault
injection. Every driven action remains visible in the real product UI and is observed through the
same semantic state that a user action changes.
Do not grant Accessibility, administrator access, or other system permissions merely to make an
acceptance row green; the result must record that boundary explicitly. The Linux runner is the one
recorded exception (ADR 0038): installing a system package needs root, so the maintainer authorizes
its account once for exactly two Polkit actions.

On Windows the same runner silently installs the older isolated NSIS package into a path containing
spaces, launches the exact installed executable, verifies the installer PID recorded by the helper,
and uninstalls only that isolated registration after evidence capture.

On Linux the installed stable package is the only one the updater accepts (`/usr/bin/plvs`, owned
by the APT package `plvs`, with `/usr/lib/plvs/plvs-update-installer` and its Polkit action), so the
acceptance debs keep that package name and paths and isolate only the identity, data root and
updater key. Through `pkexec`, a root-owned tool installs the older deb offline, first recording
what the machine had: no `plvs`, or a `dpkg-repack` copy of the installed version. The run then
checks that Polkit authorizes the product action `com.soundoer.plvs.update` without a password,
drives the same scenarios on a private Xvfb display and session bus, lets the product helper
install the newer deb through its own `pkexec` installer and APT, and requires the installer PID and
the new package version (`apt-package-upgrade`). Cleanup restores the recorded state and fails the
run if `dpkg-query` disagrees. The Polkit password prompt and its cancellation remain a manual
check (`polkit-prompt-and-cancellation`). On every platform,
`update:acceptance:verify` checks package and evidence hashes, the exact source SHA and identity,
all routine scenario verdicts, cleanup, and explicit manual/release-only gaps. A platform claim is
valid only after this runner produces real evidence on that platform; contract tests on another OS
do not substitute for it.

Local stable release preflight reports retained platform evidence as advisory. When updater,
installer, signing, packaging or acceptance dependencies changed since the latest stable tag, the
called `update-acceptance.yml` workflow runs all three platforms for the exact release commit; missing,
invalid or incomplete evidence stops `release.yml` before the Draft. Other releases skip the
platform jobs. `scripts/update-acceptance-code-changed.mjs` owns
that deliberately narrow dependency list; update it when a new path can affect the installed update
chain, rather than broadening the gate to ordinary version or interface-only changes.

The shared acceptance report treats Linux as a base platform alongside Windows and macOS: every
report has a Linux column across update, Dock, capture, Agent Control and performance, and a Linux
cell without real Linux evidence stays visibly `missing`. Producers are connected one domain at a
time, keeping the common envelope and scenario semantics unchanged. Packaged update acceptance has
a Linux producer and gates releases on all three platforms. Contract tests on macOS or Windows are
not Linux acceptance evidence.

## Home capture runners

Hosted runners have no sound card, so every stable release also runs `smoke:capture` for the exact
release commit on three self-hosted runners: [`capture-acceptance.yml`](../.github/workflows/capture-acceptance.yml),
called by `release.yml` before the draft is assembled. Each runner carries the label `plvs-rig`
plus its platform. The draft waits for all three. A runner that is off or logged out makes the
release wait in the queue and then fail; there is no input that skips a platform.

The repository is public and every runner runs as the maintainer's own account, so a job on one
can do anything that account can on that machine. A fork pull request runs the workflow files it
brings itself, which the workflows on `main` cannot restrict. **The boundary is the repository
setting that requires approval before workflows from any external contributor run**
(`all_external_contributors`). `release:preflight` refuses to continue when it is weaker
(`scripts/check-fork-pr-approval.mjs`). Never approve a pull request's workflow run when the pull
request touches `.github/`.

On `main` itself, self-hosted jobs may only live in workflows triggered by `workflow_dispatch`,
`workflow_call` or `schedule`, and never receive secrets. `scripts/selfHostedWorkflowContract.test.js`
enforces this, including through reusable-workflow calls. It parses the workflows and treats any
`runs-on` other than a single hosted image label as self-hosted. It catches mistakes on `main`; it
is not a defence against a pull request.

Check a runner without a release:

```bash
gh workflow run capture-acceptance.yml -f commit_sha=$(git rev-parse HEAD)
```

Each job verifies its own `result.json` names the commit and platform and is `complete`, then
uploads it as `capture-evidence-<platform>`. The runner workspace is reused and cleaned by later
checkouts; the uploaded artifact is the record.

After the three builds, `release.yml` also calls
[`release-package-smoke.yml`](../.github/workflows/release-package-smoke.yml) on the same runners. It
downloads the exact `release-candidate-<platform>` artifact and runs
`scripts/release-package-smoke.mjs` on it: the portable ZIP on Windows, a copy of `PLVS.app` from
the DMG on macOS, the deb unpacked with `dpkg-deb -x` on Linux. Nothing is installed. The app starts
from a temporary directory with `--plvs-test-app-data-root` ([ADR 0035](adr/0035-packaged-builds-accept-an-isolated-data-root.md))
on a seeded profile in which only Agent Control is enabled, so the maintainer's own PLVS, running or
not, and its settings are untouched. The package's own `plvs-cli` runs the base Agent Control
smoke scenarios, selects the rig device, starts Live under the rig lease and requires the reading
to match the rig tone (integrated loudness and both channel peaks within 0.5 dB), then takes a
screenshot while metering. `release-package-evidence-<platform>` holds `result.json`, the
screenshots, the silent recording and the app log; `scripts/verify-release-package-evidence.mjs`
checks their sizes and SHA-256 before upload. Exit 1 is a package defect, exit 2 a rig or runner
problem.

Visual captures wait for WebView animation frames, which stop while a window is hidden, a display
sleeps or a remote-desktop session switches. Screenshots and the recording start therefore retry
once on `renderNotSettled` only, recording the retry in `warnings`; a second unsettled render or any
other failure still fails. On macOS this script and `run-update-acceptance.mjs` hold
`caffeinate -d -i` for their own lifetime. That cannot unlock a locked screen or render without a
display, so the Mac runner must not auto-lock or sleep and needs an active display (a monitor that
is on, or an HDMI dummy plug) whenever release or nightly acceptance can run; the first nightly
update acceptance failed on the Mac at 05:19 with the frontend no longer answering.

Check the runners against an earlier release run's candidates without a release:

```bash
gh workflow run release-package-smoke.yml -f commit_sha=<release commit> -f run_id=<release.yml run id>
```

Candidate artifacts are kept for seven days.

Setting up a runner (register with a short-lived token from
`gh api -X POST repos/SounDoer/PLVS/actions/runners/registration-token`, kept in memory only;
verify the runner archive against the SHA-256 in its GitHub release before extracting):

| Platform | Account and launch                                                                                                        | Rig                                                           | Traps                                                                                                                                                                                                                                                                                                  |
| -------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Windows  | Maintainer's logged-in account. Not a service: a logon launcher in the Startup folder runs `run.cmd` in the user session. | VB-Cable, VLC, Git for Windows                                | The first `bash.exe` on a Windows desktop's PATH is usually WSL's. The launcher must put `C:\Program Files\Git\bin` first on PATH; the runner cannot take a quoted shell path. Started from an agent inside the Claude desktop app, launch it through `explorer.exe` so it leaves the app's container. |
| macOS    | Maintainer's login account, `./run.sh` in a Terminal window that holds microphone permission.                             | BlackHole 2ch, VLC                                            | A LaunchAgent (`./svc.sh install`) captures silence: TCC attributes the request to the runner's Node, which has no audio entitlement. The runner does not return after a logout, reboot or closing that Terminal. Capture smoke itself passes while locked; package smoke does not (see below).        |
| Linux    | Desktop user's `systemd --user` unit running `runsvc.sh`, with `loginctl enable-linger`.                                  | `pactl`/`paplay` on PipeWire or PulseAudio, `/usr/bin/ffmpeg` | Copy `bin/runsvc.sh` to the runner root first, or the unit fails with `203/EXEC`. Put `~/.cargo/bin` on the unit's PATH and order it after the PipeWire user services. A dedicated user cannot reach the desktop user's audio session.                                                                 |

One-time setup for the release-package smoke, beyond the table above:

- **Windows:** the package smoke needs an active desktop session for recording. Keep the session
  unlocked and locally active while a release runs: locking it or disconnecting Remote Desktop can
  leave Media Foundation with no frames and error `0xC00D4A44`. The window opens on that desktop for
  about a minute.
- **macOS:** grant **Screen & System Audio Recording** permission to the Terminal that launches the
  runner. Without it, package-smoke recording fails with `screenCapturePermissionRequired`. After
  granting the permission, fully quit Terminal, reopen it, and restart the runner before testing.
  Changing how the runner is launched changes the process macOS authorizes, so grant the permission
  again for the new launcher. The copied app is started by the runner, and macOS attributes its audio
  capture to that Terminal, as it does for capture smoke.
- **Linux:** `sudo apt install xvfb`. The `systemd --user` unit has no display, and the smoke starts
  a private Xvfb server when `DISPLAY` and `WAYLAND_DISPLAY` are both unset; do not import the
  desktop session's display into the unit. Unpacking installs none of the deb's `Depends`; when the
  smoke reports missing packages, install them with `sudo apt install <names>`
  (`dpkg-deb -f PLVS_<version>_amd64.deb Depends` lists them all). Without a session bus in the
  unit's environment the app gets a private one from `dbus-run-session` (package `dbus`). The
  rig's `/usr/bin/ffmpeg` must include libx264 and AAC (Ubuntu's `ffmpeg` package does): the
  packaged app records with it, and the smoke exits 2 when recording is unavailable.

### Linux update acceptance runner

`update-acceptance.yml` installs the real `plvs` system package on the Ubuntu runner and restores the
machine afterwards ([ADR 0038](adr/0038-linux-update-acceptance-installs-the-system-package.md)).
The runner is unattended, so its account is authorized once, from that account in a checkout:

```bash
sudo apt install polkitd pkexec dpkg-repack xvfb dbus libasound2-dev libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
```

```bash
sudo bash scripts/update-acceptance-linux/setup.sh install
```

```bash
bash scripts/update-acceptance-linux/setup.sh verify
```

`install` writes three root-owned files and nothing else: the package tool
`/usr/local/libexec/plvs-update-acceptance-package`, its Polkit action
`com.soundoer.plvs.update-acceptance`, and `/etc/polkit-1/rules.d/49-plvs-update-acceptance.rules`,
which answers yes without a password to that action and to the product action
`com.soundoer.plvs.update`, for that one account only. The shipped Polkit policy keeps its
interactive default. Because the runner builds the debs it installs, this makes the runner account
root-equivalent on that machine; use it only on a dedicated test machine.
`sudo bash scripts/update-acceptance-linux/setup.sh remove` undoes it; it refuses while a run still
has an original PLVS to restore (`sudo /usr/local/libexec/plvs-update-acceptance-package restore`).
A run refuses to start while any PLVS runs on the machine, and `dpkg-repack` is needed only when a
PLVS package is installed before the run. To run it by hand on that machine from a clean checkout:

```bash
npm ci && npm run ffmpeg:fetch && npm run update:acceptance:build
```

```bash
npm run update:acceptance:run -- artifacts/update-acceptance/$(git rev-parse --short=8 HEAD)
```

Every clone and runner on one machine shares the rig lease (ADR 0039), so a manual `smoke:capture`
and a runner job queue behind each other instead of summing tones. Each runner keeps its own Rust
target directory, several GB. Before dispatching a release, check that all three runners are
`online` and idle:

```bash
gh api repos/SounDoer/PLVS/actions/runners --jq '.runners[] | "\(.name) \(.status) busy=\(.busy)"'
```

## Bad release response

Use this when a published stable release is broken badly enough that nobody else should install
it. Published Releases are immutable: the tag and assets cannot be replaced, and the version
number is consumed for good. The title, notes, prerelease flag and the **Latest** mark can still
change, and the response works through those.

How users reach a version:

- Installed apps read `https://github.com/SounDoer/PLVS/releases/latest/download/latest.json`
  (`plugins.updater.endpoints` in `src-tauri/tauri.conf.json`). GitHub resolves `releases/latest`
  to the release carrying the Latest mark, so moving the mark changes the manifest every installed
  app sees on its next check.
- PLVS sets no version comparator, so the vendored updater (`src-tauri/vendor/tauri-plugin-updater`)
  offers a release only when its version is greater than the running one. There is no downgrade.
- The homepage resolves its version label and download buttons in the visitor's browser from the
  GitHub API `releases/latest` (`website/index.html`), so it follows the Latest mark without a
  redeploy. The rest of the website (user guide, privacy policy) is static and was deployed from
  the bad tag by `release.yml`'s `deploy-website` job.

Steps, with `<bad>` the broken version and `<previous>` the last good stable version:

1. Stop new installs and updates by moving the Latest mark back:

   ```bash
   gh release edit v<previous> --latest
   gh release view --json tagName --jq .tagName
   curl -sL https://github.com/SounDoer/PLVS/releases/latest/download/latest.json
   ```

   The second command must print `v<previous>` and the manifest must carry `<previous>`. Apps older
   than `<previous>` are now offered `<previous>`; apps on `<previous>` or `<bad>` are offered nothing.

2. Warn in the bad release's notes. Put a short notice at the top of the existing body: what is
   broken, "do not install", and a link to `https://github.com/SounDoer/PLVS/releases/tag/v<previous>`
   for the previous version. Keep the rest of the body.

   ```bash
   gh release view v<bad> --json body --jq .body > notes.md
   # Edit notes.md, then:
   gh release edit v<bad> --notes-file notes.md
   ```

3. Ship a higher fixed version through the normal `plvs-release` flow. Never retag `<bad>`. The
   fixed release's `publish-release` job marks it Latest, and its `deploy-website` job redeploys the
   website from the new tag, which ends the response.

4. Check that the website does not point at `<bad>` while the fix is pending. Open the homepage and
   confirm the version label shows `v<previous>`. Then read
   `git diff v<previous> v<bad> -- docs/user website`: if the live guide or pages describe
   behaviour only `<bad>` has, or send users to it, redeploy the website from the previous tag:

   ```bash
   npm run website:review -- v<previous>
   gh workflow run deploy-website.yml --ref main -f ref=v<previous>
   ```

   The deployment gate accepts a stable tag whose commit passed push CI, and the live Sharesets
   history check still applies. Redeploying an older tag also reverts any independent website
   publication made since `<bad>`; the review output lists those files. Confirm the live
   `/publication.json` `websiteSha` equals `git rev-parse v<previous>^{commit}`.

What this cannot do:

- Users already running `<bad>` stay on it until the fixed version ships; the updater never
  downgrades, and nothing here reaches them. If the defect breaks the update path itself, they must
  download the fixed version manually.
- An app that already downloaded `<bad>` and shows it as ready still installs it: installation uses
  the cached signed manifest, which is still newer than the running version.
- `<bad>`'s assets remain downloadable from its release page; the tag and assets cannot be removed
  or replaced.

## Signing secrets inventory

These are every repository Actions secret that `release.yml` reads.
`GH_TOKEN` there is the automatic per-run `github.token`, not a stored secret. Never commit or paste
secret values anywhere, including this file; the backup column says where a value is kept, not
what it is.

| Secret                               | Used by                                       | What it signs                                                                                                   | If lost                                                                                                                                                                                                                                                   | Backup location                                 | Expiry / renewal                                                                                    |
| ------------------------------------ | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `TAURI_SIGNING_PRIVATE_KEY`          | `release.yml` Windows, macOS and Linux builds | Updater signatures for every platform's package in `latest.json`, including the Linux version-notice descriptor | **Not recoverable.** Every installed app trusts only the public key embedded at build time (`plugins.updater.pubkey` in `src-tauri/tauri.conf.json`). A new key reaches users only through a manual reinstall of a build that carries the new public key. | The maintainer's Bitwarden vault.               | Does not expire.                                                                                    |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Same jobs as the key                          | Unlocks the updater private key                                                                                 | **Not recoverable.** The key is unusable without it, with the same consequence as losing the key.                                                                                                                                                         | The maintainer's Bitwarden vault, with the key. | Does not expire.                                                                                    |
| `APPLE_CERTIFICATE`                  | `build-macos`                                 | Base64 Developer ID Application `.p12`: code signature of the `.app` and DMG                                    | Recoverable: issue a new Developer ID Application certificate under the same Apple team and export a new `.p12`. The updater does not depend on it.                                                                                                       | The maintainer's NAS.                           | Expires 2031-09-17. Renew in the Apple Developer account before that date, then replace the secret. |
| `APPLE_CERTIFICATE_PASSWORD`         | `build-macos`                                 | Export password of the `.p12`                                                                                   | Recoverable: re-export the `.p12` with a new password from the keychain that holds its private key, or issue a new certificate.                                                                                                                           | The maintainer's NAS.                           | Follows the certificate.                                                                            |
| `APPLE_API_PRIVATE_KEY_BASE64`       | `build-macos`                                 | Base64 App Store Connect API `.p8`: authenticates notarization of the app and DMG                               | Recoverable: Apple allows one download only, so revoke the key, generate a new one, and update `APPLE_API_KEY` with it.                                                                                                                                   | The maintainer's NAS.                           | No expiry date; revocable in App Store Connect.                                                     |
| `APPLE_API_KEY`                      | `build-macos`                                 | Key ID of the App Store Connect API key (identifier, not key material)                                          | Recoverable: shown in App Store Connect next to the key.                                                                                                                                                                                                  | App Store Connect                               | Follows the API key.                                                                                |
| `APPLE_API_ISSUER`                   | `build-macos`                                 | Issuer ID of the App Store Connect team (identifier, not key material)                                          | Recoverable: shown in App Store Connect.                                                                                                                                                                                                                  | App Store Connect                               | Does not expire.                                                                                    |

The Apple Developer Program membership renews on 2027-10-04. If it lapses, notarization fails and
`build-macos` stops the release, so renew it before that date.
