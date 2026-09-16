# Tauri auto-updater — design

## Problem

PLVS currently only *tells* users a new version exists: `useUpdateCheck` polls the
GitHub Releases API every 12h (and on a manual "Check" click in
`SettingsPanel.jsx`), and if a newer tag is found the user must click "Releases",
land on the GitHub release page in a browser, manually download the installer,
run it, and manually restart the app. This is friction that costs adoption,
independent of the (separate, not-yet-done) code-signing work.

## Goal

Add `tauri-plugin-updater` so the user can update in-app: check → click a new
"Update" button → download + signature-verify → install → prompt to restart.
Keep the existing check cadence and UI position; only change the data source
and add one button. Code signing / notarization (Gatekeeper / SmartScreen) is
explicitly out of scope for this round — the updater's own artifact signature
(below) is a separate, independent mechanism that we *can* finish now.

## Non-goals

- Windows code signing certificate / Azure Trusted Signing.
- macOS Developer ID signing / notarization.
- Forcing updates or blocking app usage pending an update.
- A custom update-manifest server (we use a static `latest.json` published to
  the existing GitHub Release).

## Architecture

**Rust (`src-tauri`)**

- Add `tauri-plugin-updater = "2"` to `Cargo.toml`; register
  `tauri_plugin_updater::Builder::new().build()` in `src-tauri/src/lib.rs`.
- Add `updater:default` permission to the relevant capability file under
  `src-tauri/capabilities/`.
- `tauri.conf.json` gains a `plugins.updater` block:
  ```json
  "plugins": {
    "updater": {
      "active": true,
      "endpoints": [
        "https://github.com/SounDoer/PLVS/releases/latest/download/latest.json"
      ],
      "pubkey": "<generated public key>"
    }
  }
  ```

**Signing key**

- Generated once locally via the Tauri CLI signer, producing a keypair.
- Public key committed in `tauri.conf.json` (above).
- Private key + its password are **not** committed; they're added as GitHub
  Actions repo secrets: `TAURI_SIGNING_PRIVATE_KEY` and
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Only the user can add repo secrets, so
  this is the one manual step.

**CI (`.github/workflows/release.yml`)**

- `build-windows` and `build-macos` jobs export the two signing env vars
  (from secrets) before `tauri build`. With the updater plugin active and
  those vars set, `tauri build` additionally emits update-bundle artifacts
  (e.g. NSIS `.nsis.zip` on Windows, `.app.tar.gz` on macOS) plus a `.sig`
  file per artifact.
- New job `publish-updater-manifest` (needs both build jobs, tag builds only):
  downloads the `.sig` files (and knows the artifact download URLs from the
  release), and assembles `latest.json`:
  ```json
  {
    "version": "0.6.4",
    "notes": "...",
    "pub_date": "2026-07-07T00:00:00Z",
    "platforms": {
      "windows-x86_64": { "signature": "...", "url": "https://github.com/.../PLVS-vX-x64-setup.nsis.zip" },
      "darwin-aarch64": { "signature": "...", "url": "https://github.com/.../PLVS-vX-aarch64.app.tar.gz" }
    }
  }
  ```
  and uploads it to the same GitHub Release (`softprops/action-gh-release`).

## Frontend

- `src/lib/updateCheck.js`: replace the GitHub Releases API call with
  `@tauri-apps/plugin-updater`'s `check()`. Keep the return shape close to
  today's `{ latestVersion, hasUpdate, releaseUrl }` so `App.jsx` and
  `SettingsPanel.jsx` need minimal changes; additionally expose the raw
  `Update` handle (needed to call `downloadAndInstall()` later) via a new
  field rather than re-fetching.
- `useUpdateCheck.js`: cadence/interval and manual "Check" trigger unchanged.
- `SettingsPanel.jsx` footer: when `hasUpdate` is true, show a new **"Update"**
  button next to "Check". Click → `update.downloadAndInstall()`. While in
  flight, disable the button and show a short "Downloading…" status in place
  of the version text. On success, show a small inline confirm ("Restart to
  finish updating?") — confirming calls `relaunch()` from the already-present
  `tauri-plugin-process`. Dismissing leaves the update installed for next
  natural restart (Tauri updater installs to a staged location that takes
  effect on next launch, depending on platform).

## Error handling

- Any failure (network, signature verification, install) re-enables the
  "Update" button and shows a transient "Update failed, try again later" in
  the footer status slot — it must not block or crash the app.
- Signature mismatch should be something we can trigger and observe in dev
  (e.g. deliberately misconfigured pubkey/endpoint against a real signed
  build) before this ships, not something discovered post-release only.

## Testing

- Unit tests for the rewritten `updateCheck.js` (mock the plugin's `check()`),
  updated `useUpdateCheck.test.js` if the return shape changes.
- `SettingsPanel.test.jsx`: new cases for the "Update" button appearing only
  when `hasUpdate`, disabled-while-downloading state, and the
  restart-confirm/relaunch call.
- CI: a manual dry run (`workflow_dispatch`) of `release.yml` on a throwaway
  tag to confirm `latest.json` is well-formed and the signatures verify,
  before relying on it for a real release.

## Manual steps (user)

1. After the keypair is generated, add two repo secrets in GitHub:
   `TAURI_SIGNING_PRIVATE_KEY` (the private key contents) and
   `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
2. Review this spec and the resulting implementation plan.
