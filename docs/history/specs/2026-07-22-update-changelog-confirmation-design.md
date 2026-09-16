# Update changelog confirmation — design

## Problem

The System Settings footer currently calls `update.downloadAndInstall()` as
soon as the user clicks **Update**. This starts a download and installation
without first showing what changed or confirming that PLVS will restart.

The updater manifest already carries release notes, but the frontend does not
read or display the Tauri `Update.body` field.

## Goal

Insert a modal confirmation step between clicking **Update** and starting the
download. The modal shows the target version and its changelog, lets the user
cancel, and starts the existing updater only after explicit confirmation.

After a successful installation, PLVS relaunches automatically.

## Non-goals

- Forced or background updates.
- Skipping a release or persisting a dismissed-version preference.
- Download percentage or transfer-speed reporting.
- Changes to the Rust updater registration, updater endpoint, or custom IPC.
- Refactoring the existing close-confirmation dialog into a shared dialog
  abstraction.

## User flow

1. The existing update check discovers a newer version.
2. System Settings continues to show the **Update** button.
3. Clicking **Update** opens an update modal. It does not download anything.
4. The modal shows:
   - `Update available`
   - `What's new in vX.Y.Z`
   - the release changelog rendered as basic Markdown
   - **Cancel** and **Update and Restart** actions
5. Before installation starts, **Cancel**, Escape, and clicking the overlay all
   dismiss the modal without changing the available-update state.
6. Clicking **Update and Restart** starts `downloadAndInstall()`. The modal
   remains open, displays **Updating...**, and cannot be dismissed or submitted
   again while work is in progress.
7. A successful installation immediately calls `relaunch()`.
8. An installation failure keeps the modal open, displays an inline failure
   message, and offers **Cancel** and **Retry**.
9. If installation succeeds but relaunch fails, PLVS does not download the
   update again. The modal reports that the update is installed and offers
   **Close** and **Restart**.

## Architecture and responsibilities

### Update metadata

`src/lib/updateCheck.js` maps `Update.body` to a `releaseNotes` field in the
existing check result. It continues to expose the raw `Update` handle for
installation and does not fetch release data separately.

### Dialog ownership

A dedicated `UpdateDialog` component owns the update-confirmation presentation.
It receives the target version, release notes, update status, and action
callbacks. It does not call Tauri APIs directly.

`AppSettingsOverlays` owns whether the dialog is open. The update callback
passed to `SettingsPanel` opens the dialog instead of starting installation.
Canceling the dialog leaves `updateInfo` unchanged, so the Settings **Update**
button remains available and can reopen it.

The dialog follows the established Radix Dialog behavior and visual language of
`CloseConfirmDialog`, but it remains a separate component because its content
and asynchronous state machine are materially different.

### Applying and restarting

`useApplyUpdate` remains the boundary around `downloadAndInstall()` and
`relaunch()`. Its state must distinguish:

- idle
- installing
- installation failure
- relaunch failure after a successful installation

On successful installation it relaunches automatically. A relaunch retry calls
only `relaunch()` and never repeats `downloadAndInstall()`.

The existing Settings-level **Restart** button is removed from the normal flow.
The restart-failure action lives in the modal.

## Dialog design

The modal uses the existing overlay, card, border, radius, button hierarchy,
and interface-size typography tokens. It is wider than `CloseConfirmDialog` to
fit release notes.

The changelog area has a maximum height and scrolls independently so long
release notes cannot expand the dialog beyond the window.

Supported Markdown presentation includes headings, lists, emphasis, inline
code, fenced code blocks, separators, and links. Raw HTML is not rendered.
Links open in the system browser through the existing external-open boundary;
they must not navigate the application WebView.

The modal preserves standard focus trapping, keyboard navigation, an accessible
title, and visible keyboard focus.

## Release-note source

The current release-note generator appends bilingual manual installation,
SmartScreen, and Gatekeeper instructions after each version changelog. That
full body is appropriate for GitHub Releases but not for the in-app updater.

The release script gains a changelog-only output mode:

- GitHub Release bodies continue to use the current changelog plus installation
  instructions.
- `latest.json.notes` uses a separate changelog-only file for the tagged
  version.
- The changelog-only generation fails the release if the tagged version has no
  matching `CHANGELOG.md` section. This enforces the product invariant that
  every published update has a changelog.
- The frontend does not trim or parse delimiters out of a larger release body.

## Error handling

- An install error is recoverable with **Retry**, which retries the full
  download-and-install operation.
- A relaunch error is recoverable with **Restart**, which retries only
  `relaunch()`.
- Error messages stay inside the modal and do not require a new global toast.
- The modal cannot be dismissed while installation or relaunch is in progress.
- Missing release notes have no dedicated UI fallback because the release
  pipeline rejects a tagged updater release without a changelog.

## Dependencies

Add a focused React Markdown renderer. Keep raw HTML disabled and route links
through the existing external URL opener. No Rust dependency or permission
change is required.

## Testing

Automated coverage must verify:

- `checkForUpdate()` exposes `Update.body` as `releaseNotes`.
- Clicking Settings **Update** opens the modal without calling
  `downloadAndInstall()`.
- **Cancel**, Escape, and overlay dismissal do not start an update.
- **Update and Restart** is the only initial action that starts installation.
- The modal cannot close or submit twice while installation is active.
- A successful installation calls `relaunch()` automatically.
- An installation failure exposes full-update retry behavior.
- A relaunch failure retries only `relaunch()`.
- Markdown links use the external URL opener and raw HTML is not rendered.
- Changelog-only generation excludes manual installation instructions.
- Changelog-only generation fails when the tagged version section is absent.
- Existing update checks and Settings footer states continue to work.

Run the relevant Vitest suites during development and `npm run check` before
merge. This change does not touch the audio capture layer, so capture smoke and
soak tests are not required.

## Success criteria

- No download begins before explicit confirmation in the changelog modal.
- Users can read the complete version changelog before updating.
- Canceling has no persistent side effect and leaves the update available.
- Updating provides a locked in-progress state, recoverable failure states, and
  an automatic relaunch on success.
- In-app release notes contain only the tagged version changelog.
