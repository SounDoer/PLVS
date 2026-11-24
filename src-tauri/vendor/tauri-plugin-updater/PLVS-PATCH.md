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
  reuses native installer staging and arguments, explicitly supplies the installation directory as
  the final `/D=` argument, disables installer relaunch, and waits for the installer process.
  The spawn callback records process identity before waiting; even a callback failure waits for
  the installer to finish before returning. PLVS retains the cross-process startup fence for
  this entire call and owns relaunch and failure reporting.
- Stage signed Windows MSI and NSIS installers directly. PLVS publishes a signed NSIS executable for
  automatic Windows updates, so the vendored plugin drops the legacy Windows ZIP reader and crate.
  Linux AppImage archive handling has its own feature, and macOS still extracts signed tarballs.

No JavaScript API additions. The application owns cache persistence, cancellation, startup
coordination, and the user-confirmation boundary. Keep this patch small and replace it with an
upstream API when an equivalent supported interface becomes available.

`rustfmt.toml` keeps upstream's default formatting (4-space indentation). `cargo fmt --all` also
formats path dependencies, so without it the repository's 2-space style would rewrite every file
and bury the patch. Compare against upstream with a plain `diff`; only the changes above remain.

The updater is a PLVS Cargo workspace member. Its tests, including the signed Windows installer
probe in `scripts/probe-cached-updater.mjs`, use the same `src-tauri/Cargo.lock` as the application.
