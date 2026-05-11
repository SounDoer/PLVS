# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.0.12] - 2026-05-11

### Added

- Appearance settings: Light / Dark / System toggle and fixed-colour-theme picker with `audiometer-dark` and `audiometer-light` builtins (#53, #54, #56).
- Prettier code formatter with CI enforcement (`npm run format:check`) (#62).
- `SettingsPanel` smoke tests covering system vs fixed appearance branches (#60).

### Changed

- `App.jsx`: capture device list, migration, and default-route preview extracted into `useAudioDevices` hook; shared `buildHistoryTimeAxisLabels` and `usePeakVis` between `App.jsx` and `FloatApp.jsx` (#57).
- `App.jsx` / `FloatApp.jsx`: loudness history viewport, display paths, HUD state, and metrics consolidated into `useLoudnessHistory` hook (#57).
- `LoudnessPanel`: history chart area extracted to standalone `LoudnessHistoryChart` component; panel reduced ~485 → ~210 lines (#61).
- `cpal_backend.rs`: device enumeration and ID resolution moved to `audio/device_enum.rs`; capture file retains only the I/O loop (#61).
- `tauri-plugin-log` gated to debug builds only via `[target.'cfg(debug_assertions)'.dependencies]` (#62).

### Fixed

- `needless_range_loop` clippy errors in `dsp/spectrum.rs` replaced with `enumerate().take().skip()` iterator form.
- `react-hooks/set-state-in-effect` and `react-hooks/purity` ESLint errors in `useLoudnessHistory`.
- `rustfmt` import ordering and function-signature formatting in `audio/device_enum.rs`.

### Documentation

- English README (#58).
- Release workflow reads matching `CHANGELOG.md` section via `scripts/changelog-release-body.mjs` (#58).

## [0.0.11] - 2026-05-11

### Added

- GitHub tracking issues for post-audit work (#57, #58, #59, #60, #61, #62).
- Vitest + `@testing-library/react` coverage for `useSettings` system→fixed theme seeding (#60).

### Changed

- Shared loudness history time-axis label builder (`buildHistoryTimeAxisLabels`) and peak-meter
  visual helper (`usePeakVis`) between `App.jsx` and `FloatApp.jsx`; hoisted static `buildVersion`
  / `STORE_KEY` in `App.jsx` (#57 partial).
- Chart stroke widths, vectorscope halo/opacity, and spectrum inner stroke are driven from builtin
  themes via CSS variables; removed duplicate chart colour blocks from `UI_PREFERENCES` in
  `preferences/data.js` (#59). Vectorscope grid inset follows the active theme in `App` / `FloatApp`.

### Documentation

- Root `CHANGELOG.md` and release-note extraction for tag builds (#58 partial).
