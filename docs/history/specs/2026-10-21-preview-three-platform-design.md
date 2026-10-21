# Preview on Windows, macOS and Linux (2026-10-21)

The maintainer decided to bring Preview to parity on all three platforms and to keep Preview unable
to update itself. Preview had been used rarely (seven runs, last 2026-10-09), so correctness and
simplicity outweigh build time.

## Scope

1. macOS Preview DMG (Apple Silicon), `--features preview-identity`, signed and notarized with the
   release secrets and scripts, smoke-tested with `verify-macos-dmg.sh preview` on `macos-26`.
2. Linux Preview coexists with the stable deb.
3. `platform: all` (default) builds the three platforms in parallel into one immutable Pre-release.
4. `npm run preview:dispatch` replaces the skill's PowerShell dispatch snippet.
5. Each platform smoke-tests its exact package on hosted runners before the Draft; no `plvs-rig`.

## Linux coexistence investigation

Tauri's deb bundler (tauri-bundler `linux/debian.rs`, `linux/freedesktop/mod.rs`) derives paths as
follows:

| Path                                         | Derived from     | Stable     | Preview (before) |
| -------------------------------------------- | ---------------- | ---------- | ---------------- |
| `/usr/bin/<main binary>`                     | `mainBinaryName` | `plvs`     | `plvs`           |
| `/usr/bin/<externalBin without triple>`      | external binary  | `plvs-cli` | `plvs-cli`       |
| `/usr/share/icons/hicolor/*/apps/<main>.png` | `mainBinaryName` | `plvs.png` | `plvs.png`       |
| `/usr/share/applications/<product>.desktop`  | `productName`    | `PLVS`     | `PLVS Preview`   |
| `/usr/lib/<product>/` resources              | `productName`    | `PLVS`     | `PLVS Preview`   |
| `Package:`                                   | `productName`    | `plvs`     | `plvs-preview`   |
| `/usr/lib/<package>/sidecars`                | deb `files`      | `plvs`     | `plvs-preview`   |

Only the binaries and icons collided. Setting `mainBinaryName: "plvs-preview"` in
`tauri.linux-preview-deb.conf.json` and shipping the CLI as `binaries/plvs-preview-cli` moves all
of them; the desktop entry's `Exec=`, `Icon=` and `StartupWMClass=` follow the main binary name.

The code that locates the companion binary by name had to follow: the `plvs-cli` forwarder looks
for its host next to itself, and the GUI's CLI-path status, Agent Control toggle and doctor look for
the CLI next to the host. Both build scripts now emit `PLVS_HOST_BINARY` / `PLVS_CLI_BINARY`
(`plvs-preview` / `plvs-preview-cli` only for Preview on Linux). Agent Control endpoints and app data
were already keyed by the identifier. The generated Preview discovery manifest records
`usr/bin/plvs-preview-cli`.

These changes alter only the Preview package. Dropping `Conflicts: plvs-preview` from the stable deb
is metadata only; PLVS 0.23.0 keeps its conflict until the next stable deb.

## Verification design

`verify-linux-deb.sh` takes an optional companion deb. With it: install the companion, install the
primary, verify both (including `dpkg --verify` and the desktop entry), launch the primary and then
the companion while both are installed, purge the primary and check that none of its files remain,
verify and launch the companion again, purge it. The Preview Linux job builds the stable deb from the
same commit as the companion; it is not published. Release builds keep the single-package check.

## Workflow shape

`validate` → `build-{windows,macos,linux}-preview` (each `if` the platform is selected) →
`prepare-draft` (runs when validate succeeded and no build failed or was cancelled; downloads every
`preview-candidate-*`, validates the complete asset set for the selected platform, and records its
size) → `publish-preview` (checks the Draft has exactly that many assets).
