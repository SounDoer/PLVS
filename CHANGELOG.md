# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- `App.jsx`: capture device list / migration / default-route preview moved into `useAudioDevices` (#57 partial).

### Documentation

- Release workflow reads matching `CHANGELOG.md` section via `scripts/changelog-release-body.mjs` (#58 partial).

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
