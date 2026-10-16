# PLVS cached-update adapter

Base: crates.io `tauri-plugin-updater` 2.13.2, as pinned in PLVS before this patch.
The upstream MIT/Apache-2.0 licenses are retained alongside the source.

Local changes in `src/updater.rs`:

- Factor the existing manifest interpretation into `Updater::from_manifest`, shared by online
  checking and offline reconstruction. This does not authenticate metadata or change platform
  selection, version policy, install paths, or signing keys.
- Add `Update::verify_cached` and `Update::install_verified` to reauthenticate persisted bytes.
  The existing `install` API still has upstream behavior for same-process downloads.

No JavaScript API additions. The application owns cache persistence, cancellation, startup
coordination, and the user-confirmation boundary. Keep this patch small and replace it with an
upstream API when an equivalent supported interface becomes available.
