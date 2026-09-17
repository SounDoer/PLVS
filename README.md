# PLVS

**Real-time audio metering for listening closely. Free & open source.**

[![Latest Release](https://img.shields.io/github/v/release/SounDoer/PLVS?label=latest&style=flat-square)](https://github.com/SounDoer/PLVS/releases)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/SounDoer/PLVS/ci.yml?label=ci&style=flat-square)](https://github.com/SounDoer/PLVS/actions/workflows/ci.yml)
[![Downloads](https://img.shields.io/github/downloads/SounDoer/PLVS/total?style=flat-square)](https://github.com/SounDoer/PLVS/releases)

<p align="center">
  <img src="https://raw.githubusercontent.com/SounDoer/PLVS/main/landing/assets/landing-hero.webp" alt="PLVS workspace with live metering panels" width="100%"/>
</p>

## What is PLVS?

PLVS (reads as _"plus"_) is a **read-only desktop companion** for **sound designers and mix
engineers** on Windows and macOS. It keeps your audio's level, shape, and movement in view while you
work — no DAW routing, no virtual cables, no plugin slots. PLVS **does not process, route, or modify
audio**.

- **Level Meter, Loudness, Stats, Spectrum, Spectrogram, Vectorscope, Stereo Map, and Waveform** in
  one arrangeable workspace
- **System output, a single application, or a physical input**, captured natively
- **Loudness** following ITU-R BS.1770 / EBU R128, with your own **Loudness Profiles** and optional
  **dialogue-gated** readouts
- **Multichannel** from mono through 9.1.6
- **Session history and snapshots**, plus **File Mode** for analysing local audio files
- **Dock mode**, compact views, and custom themes
- **`plvs-cli`** for diagnosing the installation and controlling the running app
- **Private by default**: audio stays on your device, with no telemetry by default

Read the **[User Guide](docs/user/README.md)**, also published at
[plvs.soundoer.com/docs](https://plvs.soundoer.com/docs/).

## Download

Get the latest version from [**GitHub Releases**](https://github.com/SounDoer/PLVS/releases) or the
[website](https://plvs.soundoer.com).

| Platform                  | Package                            | Notes                                    |
| ------------------------- | ---------------------------------- | ---------------------------------------- |
| **Windows 10/11 (x64)**   | `PLVS_<version>_x64-setup.exe`     | Installer                                |
| **Windows 10/11 (x64)**   | `PLVS-v<version>-x64-portable.zip` | Portable — keep extracted files together |
| **macOS (Apple Silicon)** | `PLVS-v<version>-aarch64.dmg`      | Requires macOS 14.2 or later             |

Builds are not code-signed or notarized yet. On Windows, choose **More info** → **Run anyway** if
SmartScreen warns. On macOS, run `xattr -cr /Applications/PLVS.app` once if Gatekeeper blocks the
first launch. See [Getting Started](docs/user/getting-started.md) for details.

## Documentation

- [**User Guide**](docs/user/README.md) — how to use PLVS
- [**CLI Reference**](docs/user/cli.md) — `plvs-cli` commands and JSON contract
- [**CHANGELOG**](CHANGELOG.md) — what changed in each version
- [**Developer documentation**](docs/README.md) — architecture, product boundaries, and decision
  records, for maintainers and agents

## Development

```bash
git clone https://github.com/SounDoer/PLVS.git
cd PLVS
npm install
npm run desktop        # start the development app
npm run check          # the full gate before sending a change
```

Setup requirements, build and release commands, and conventions are in
[CONTRIBUTING.md](CONTRIBUTING.md). Contributions are welcome.

## Acknowledgements

PLVS stands on the shoulders of excellent open-source work. In particular:

- **Voice activity detection** — dialogue-gated loudness can run on any of three selectable on-device VAD engines:
  - [**Silero VAD**](https://github.com/snakers4/silero-vad) _(default)_ — bundled via the [`voice_activity_detector`](https://github.com/nkeenan38/voice_activity_detector) crate (MIT).
  - [**FireRedVAD**](https://github.com/FireRedTeam/FireRedVAD)
  - [**TEN VAD**](https://github.com/TEN-framework/ten-vad)
- [**CPAL**](https://github.com/RustAudio/cpal) — cross-platform audio capture (Apache-2.0).
- [**RustFFT**](https://github.com/ejmahler/RustFFT) & [**RealFFT**](https://github.com/HEnquist/realfft) — the FFT engine behind the spectrum and spectrogram (MIT / Apache-2.0).
- [**Rubato**](https://github.com/HEnquist/rubato) — sample-rate conversion (MIT).
- [**Tauri**](https://v2.tauri.app/) — the desktop application framework (MIT / Apache-2.0).

Thanks to all the maintainers and contributors of these projects.

## License

[MIT](LICENSE)
