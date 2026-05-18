# PLVS

Real-time audio metering desktop app — Peak, Loudness (LUFS), Vectorscope, Spectrum, and Spectrogram.

## Download

Get the latest installer from [GitHub Releases](https://github.com/SounDoer/PLVS/releases):

- **Windows** — NSIS installer (`.exe`)
- **macOS** — DMG disk image (`-aarch64.dmg` for Apple Silicon)

## Installation

### macOS — Gatekeeper warning

PLVS is not notarized by Apple. If macOS blocks the app on first launch, run:

```bash
xattr -cr /Applications/PLVS.app
```

Alternatively: move PLVS.app to the Trash, then immediately move it back — this also clears the quarantine flag.

### Windows — SmartScreen warning

If Windows SmartScreen blocks the installer, click **More info** → **Run anyway**.

## Local Development

Requires [Node.js ≥ 20](https://nodejs.org/) and [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/) (Rust, platform build tools).

```bash
git clone https://github.com/SounDoer/PLVS.git
cd PLVS
npm install
npm run desktop        # start dev build with hot reload
```

Other useful commands:

```bash
npm test               # unit tests (Vitest)
npm run build          # build frontend to dist/
npm run desktop:build  # Tauri full release build
npm run desktop:release-nsis  # Windows NSIS installer only
npm run desktop:release-dmg   # macOS DMG only
npm run check          # full pre-merge check (format + lint + test + build)
```

## License

[MIT](LICENSE)
