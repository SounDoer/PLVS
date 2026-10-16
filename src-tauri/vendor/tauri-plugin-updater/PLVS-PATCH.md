# PLVS cached-update adapter

Base: crates.io `tauri-plugin-updater` 2.13.2, as pinned in PLVS before this patch.
The upstream MIT/Apache-2.0 licenses are retained alongside the source.

Local changes in `src/updater.rs`:

- Factor the existing manifest interpretation into `Updater::from_manifest`, shared by online
  checking and offline reconstruction. This does not authenticate metadata or change platform
  selection, version policy, install paths, or signing keys.
- Add `Update::verify_cached` and `Update::install_verified` to reauthenticate persisted bytes.
  The existing `install` API still has upstream behavior for same-process downloads.
- Add Windows-only `install_waited_verified` for the external helper. It accepts only NSIS,
  reuses upstream extraction and arguments, explicitly supplies the installation directory as
  the final `/D=` argument, disables installer relaunch, and waits for the installer process.
  The spawn callback records process identity before waiting; even a callback failure waits for
  the installer to finish before returning. PLVS retains the cross-process startup fence for
  this entire call and owns relaunch and failure reporting.

No JavaScript API additions. The application owns cache persistence, cancellation, startup
coordination, and the user-confirmation boundary. Keep this patch small and replace it with an
upstream API when an equivalent supported interface becomes available.
