# Update Preferences and Deferred Installation

Date: 2026-10-16
Status: Agreed product design; implementation pending
Branch: `codex/update-preferences`
Investigation baseline: `10176bb4`, updater plugin 2.13.2

## Purpose and final decision

Give users control over background update requests and downloads without interrupting audio work.
Automatically downloaded updates are offered for installation on a subsequent application launch.
Installation always requires an explicit user action in the existing update-details dialog.

This final decision supersedes the earlier discussion of unattended installation at next launch.
There is no countdown, automatic acceptance, or installation merely because PLVS was opened.

## Preferences

Settings exposes these controls in its Updates area:

| Control                         | Behavior                                                                                                 |
| ------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Automatically Check for Updates | Check at launch and every 12 hours while running.                                                        |
| Automatically Download Updates  | Download and verify available updates in the background; offer installation on the next eligible launch. |

The second control explains: "Downloaded updates are offered for installation the next time you start PLVS."

- Automatic download requires automatic checking. With checking disabled, the download toggle is
  off and disabled, with an explanation of the dependency.
- Disabling checking also disables downloading and cancels any pending installation offer.
- Disabling downloading cancels background work and the pending offer, and cleans up staged files.
  An in-flight completion must not recreate canceled pending state.
- Re-enabling checking does not re-enable downloading.
- Once actual installation has begun, it cannot be canceled through preferences.
- Manual checking and manual updating remain available regardless of automatic preferences, subject
  to distribution support and existing editor/multi-instance guards.
- Preferences belong to identity-wide settings, not individual workspaces or presets. All windows
  must observe changes through the established persistence and synchronization paths.

## First launch and existing users

Use one lightweight first-launch setup in the application for Windows and macOS. Do not add
installer pages or website download checkboxes.

- Before a new user makes a choice, do not issue update requests.
- Explain that update checks connect to GitHub and link the privacy policy.
- Offer explicit choices to enable automatic checking or use manual checks only.
- Automatic downloading is initially off and can be selected only when checking is enabled.
- Skipping setup records both options as off; Settings remains available later.
- Existing users retain automatic checking and receive automatic downloading off, without a new
  first-launch prompt. Detect an existing installation from preexisting persisted user state before
  default initialization, not simply from the absence of the new preference keys.
- Normal upgrades or reinstallations preserve explicit choices. Missing preference keys must not
  overwrite previously recorded choices.
- Preview builds continue to have no updater; do not present nonfunctional update setup controls.

## Download and pending-update lifecycle

Conceptual states are checking, update available, downloading, ready, installing, and failed, with
idle/disabled states as appropriate. Checking for a newer release must not discard a ready package.

The Rust side owns durable staging and pending metadata. The current JavaScript plugin download
resource is memory-backed and does not survive process exit.

- Stage partial files separately from ready packages; only publish ready state after complete
  download and signature verification.
- Persist sufficient validated metadata to install the selected package after restart without
  requiring another network check. Do not persist JavaScript resource IDs as durable handles.
- Revalidate cached bytes before installation with the application-trusted update key. A digest
  stored beside the package alone is not signature verification.
- Bind pending state to application identity, platform, architecture, target installation, and
  version. Reconcile it against the running version at startup; remove obsolete pending state.
- Retain at most one ready version. A newer candidate replaces it only after successful download
  and verification; temporary coexistence during replacement is expected.
- A download failure is nonmodal, visible in Settings, and subject to bounded retries/backoff.
  Do not continuously retry or interfere with audio work.
- Closing PLVS during download must leave recoverable state, never a falsely ready package.
  Resumable byte-range downloads are not required; safely restarting an incomplete download is fine.
- A completed download may show "Update Ready" / "Ready to Install on Next Launch" and a manual
  route to the update-details dialog. Do not open a new modal during the current working session.

## Launch-time installation offer

Reuse the current changelog-bearing update-details dialog rather than designing a second updater UI.

- Title: **Update Ready**. Show the staged version and its corresponding changelog.
- Primary action: **Update and Restart**.
- Secondary action: **Skip This Time**.
- Closing or dismissing the dialog also means skip for this launch.
- Skipping opens the current version normally and retains the verified package for a future launch.
- Do not reopen the offer during the same launch as a result of polling, rerenders, or a failed
  installation attempt.
- Once installation starts, reuse applicable progress/status UI and prevent duplicate actions.
  Do not invent percentage progress when the native installer does not report it.
- Freeze the displayed version and installation target for the open dialog; a later background
  check must not silently switch the package that its primary action installs.

An eligible launch is a fresh application session after all instances using the installation have
exited. Hiding a window, minimizing to tray, or opening another workspace is not an eligible launch.
If another instance is still working, defer the automatic offer rather than asking it to stop.

The user can also deliberately initiate an update from Settings during a session. Preserve the
existing explicit-update coordination and blocking-editor checks for that path.

## Concurrency and startup integration

Only one owner may download or install a particular pending update. Installation requires a native
exclusive gate covering startup and replacement, so two simultaneous launches cannot both install
or enter normal operation while files are being replaced.

The existing coordinator role and live-instance registry are useful integration points, but role
ownership alone is not evidence that no other process uses the installation. Recheck actual peers
when the user confirms installation, and handle launches racing with that confirmation.

Automatic offers must not invoke the current prepare-global operation just to discover peers:
that operation stops capture. Do not interrupt other instances as a side effect of background
update work or launch-time prompting. Preserve workspace restoration and existing persistence
flush behavior when the user explicitly proceeds with an update.

## Platform behavior

### Windows installed build

Use the signed NSIS updater artifact. After user confirmation, hand off to the installer, exit the
old process, and reopen the updated application. Preserve the actual installation destination and
the expected launch/workspace context. Account for the interval between process exit and installer
completion in the exclusive-install protocol.

The current plugin launches the installer and exits; successful handoff is not proof of successful
installation. Persist attempt state before handoff and reconcile the running version on a later
launch. Do not repeatedly install the same failed package on every launch.

### macOS

Use the signed updater app archive, replace the application bundle after confirmation, and relaunch.
Installation may require system authorization when the destination is not writable. Cancellation
defers the update without repeated authorization prompts in the same session. Read-only DMG launches
must not attempt automatic replacement; explain that PLVS must be installed in a writable location.

The plugin includes bundle swap/replacement and best-effort restoration paths. These do not constitute
a guarantee of recovery from every filesystem failure.

### Windows Portable

The first implementation supports checking and manual download of the Portable ZIP only. The
automatic-download/install toggle is unavailable with a short explanation. Neither automatic nor
manual in-app update actions may launch the NSIS installer for a Portable copy.

Investigation found that the release pipeline currently copies the same executable into the ZIP
and publishes an NSIS URL for `windows-x86_64`. This needs explicit distribution detection and
routing; the existing updater endpoint does not provide portable-preserving installation.

Match the running executable's installation location to installation records, rather than checking
only whether PLVS is registered somewhere on the machine. Treat uncertain classification
conservatively. Installed and Portable copies can coexist, so capability checks and pending-package
ownership must remain installation-specific even when identity-wide preferences are shared.

## Failures and scope boundaries

Keep the currently usable application available wherever possible. Corrupt packages, partial
downloads, verification failures, and pre-install failures must not block normal application use.
Actual replacement failures may require recovery guidance; do not promise guaranteed rollback.

Record failed attempts and avoid launch/install loops. Offer a deliberate retry or manual download
instead of repeatedly interrupting startup. Successful installation is confirmed by the expected
running version, not merely by starting an installer.

Not included:

- Unattended installation or forced restarts.
- Automatic downgrade after a successfully installed version proves buggy.
- Settings-format rollback or a general application recovery system.
- A custom self-updater for Portable ZIP distributions.
- Installer preference pages, Linux distribution support, or changes to Preview updater availability.

## Implementation documentation obligations

When behavior is implemented, update the matching `docs/user/` chapter, current architecture
documentation where needed, and the privacy policy/review record for changed update requests,
downloads, and local retention. This historical spec is not the source of shipped behavior.
Review any Agent Control surface changes against its synchronization contract. Do not bypass
frontend business functions or existing persistence ownership to expose settings through the CLI.

## Acceptance and validation

1. Fresh installation makes no update request before selection; skipping keeps both settings off.
2. Existing-user migration preserves checking and leaves downloading off; explicit preferences
   survive restart, upgrade, and cross-window changes.
3. Turning checking off disables downloading and cancels pending work, including racing completions.
4. Downloaded, verified packages survive full process exit and can be offered/installed offline.
5. Corruption, partial downloads, and replacement of a ready candidate never create false ready state.
6. The existing changelog dialog shows the staged version; skip/dismiss preserves it and does not
   prompt again that launch. Installation requires the primary action without a countdown.
7. Active peers continue working undisturbed. Concurrent launches and a peer starting during the
   offer cannot race installation or cause duplicate handoffs.
8. Manual updates retain blocking-editor refusal, persistence flush, and workspace restoration.
9. Test Windows installed upgrade and macOS app upgrade using real packages, including authorization
   cancellation, nondefault installation paths, and failure/next-launch reconciliation.
10. Portable checks route to a ZIP and never invoke NSIS, including when an installed copy coexists.
11. Verify startup details, ready state, and progress visually; do not rely solely on component tests.
12. Exercise signature rejection, unavailable network, low disk space/write failures, and interrupted
    download/install attempts. Document limits where a failure cannot safely be reproduced.

Source inspection establishes feasibility, not completed end-to-end validation. The offline install
adapter, installer handoff gate, and platform recovery behavior require focused implementation probes.

## Investigation references

- `src/hooks/useUpdateCheck.js`: launch check and 12-hour interval.
- `src/hooks/useApplyUpdate.js`: current explicit download/install/relaunch path.
- `src/runtime/coordination.js`: global preparation stops capture and checks blocking editors.
- `src-tauri/src/lib.rs`: persistence hydration, coordinator acquisition, and instance registration.
- `.github/workflows/release.yml`: Portable executable staging and NSIS/macOS updater descriptors.
- `src-tauri/nsis/installer-hooks.nsh`: installed-location registry records.
- `tauri-plugin-updater` 2.13.2 `commands.rs` and `updater.rs`: memory-backed download resource,
  signature verification on download, native installation, and platform-specific handoff/replacement.
- [Tauri updater documentation](https://v2.tauri.app/plugin/updater/).
