# Cached updater feasibility

Date: 2026-10-16
Status: Offline reconstruction probe passed; installer handoff and platform validation pending.

The pinned updater 2.13.2 stores JavaScript downloads as a Rust resource containing `Vec<u8>`.
Its `Update` has private installation context, and its only public construction route is a network
check. Saving the JS resource ID cannot survive process exit. The Rust `install` method assumes
same-process previously verified bytes and does not itself reverify them.

A small vendored extension now shares the existing manifest parsing/platform/version selection
between `check` and `from_manifest`. `verify_cached` authenticates reloaded bytes using the current
application's configured key; `install_verified` performs that check before the original native
installer. No install destination or signing key is restored from cached metadata.

Probe command:

```powershell
cargo test --manifest-path src-tauri/vendor/tauri-plugin-updater/Cargo.toml --lib cached_ --target-dir src-tauri/target/updater-probe --locked
```

Result: three tests passed on Windows. A public fixture signed by the pinned Tauri CLI 2.12.1
also verifies offline; changed bytes and a changed announced version are rejected. They exercise reconstruction without endpoints, normal version
comparison, missing platform rejection, original install-path preservation, and invalid signature
rejection before native installation. They do not prove a real signed package upgrade or recovery.

The vendored crate retains its published lockfile for standalone tests: resolving without it fails
because its Windows ZIP v4 dependency versions are now yanked. PLVS uses its existing root lockfile;
the standalone probe does not replace application dependency resolution.

The application cache implementation uses installation-derived storage, atomic ready-state writes,
one transfer lease, and a persistent cancellation generation. Its checksum detects corruption but
is explicitly not a substitute for the updater signature check.

Remaining U1 exit criteria:

- Real installer artifacts from the current release signer (the non-executable signing fixture passes).
- Windows lock/installer handoff spanning old-process exit, including target path and relaunch.
- Real offline install and failure reconciliation using an isolated test installation.
- macOS replacement/relaunch, read-only mount behavior, authorization cancellation, and recovery.

Do not enable automatic staging/installation UI on the strength of the reconstruction probe alone.
