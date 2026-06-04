# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.2] - 2026-06-04

### Added

- Auto channel layout detection now recognizes mono, stereo, 5.1, and 7.1 streams for loudness routing.
- 7.1 loudness metering now follows the BS.1770 channel weighting path in the backend.
- Spectrum and spectrogram panels now support explicit channel selection from panel header controls, with persisted selections and snapshot metadata.
- Spectrogram history now marks channel changes so captured spectrum views can be interpreted in context.
- Panel header controls now centralize channel selectors and display toggles, including loudness stats visibility and loudness history layer controls.

### Changed

- Panel control state is now captured in workspace presets and restored through the app state path.
- Channel layout settings copy is simplified, and legacy channel preference keys are no longer used.

### Fixed

- Spectrum state now resets when the selected channel changes, avoiding stale spectral history.
- Restored vectorscope and spectrum channel selections are guarded against stale or invalid channel metadata.
- Snapshot mode no longer rewrites live vectorscope selections.
- Peak meters keep multichannel fill bars visible in narrow panels by scaling channel spacing with channel count.
- Peak channel labels are separated from fixed-width live values so changing dB text does not trigger wrapping jitter.
- Help icon and panel control hover states no longer add unintended visual backgrounds.

## [0.1.1] - 2026-06-03

### Added

- 7.1 surround channel layout preset (FL, FR, C, LFE, BL, BR, SL, SR); selectable in Settings alongside the existing 5.1 preset.
- Peak meter now displays ITU channel labels (L, R, C, LFE, Ls, Rs, Lb, Rb) when a layout is explicitly selected in Settings.
- Peak meter shows numbered labels (Ch 1, Ch 2 …) in Auto mode when the channel layout cannot be determined.
- Footer prompt "Multichannel detected (N ch) · Select layout in Settings" appears when a multichannel device is active in Auto mode.
- Peak meter capped at 16 channels; devices beyond that display the first 16 channels.

### Fixed

- macOS: Peak meter now correctly meters multichannel audio (5.1, 7.1) delivered as non-interleaved Core Audio buffers — previously all channel bars showed −∞ due to each channel being forwarded as a separate mono call.

## [0.1.0] - 2026-05-29

### Added

- Landing page now uses real product screenshots for appearance, history, multichannel, and system-audio sections.
- Snapshot scrubbing behavior is covered by a dedicated hook regression test.

### Changed

- Remaining user-facing app and tooling labels now use PLVS branding.
- Tauri debug logging dependency is declared with a supported Cargo configuration while keeping the plugin on debug builds only.

### Fixed

- Audio capture buffer handling is hardened against unbounded growth and dropped-buffer cases.
- Tauri desktop security configuration is tightened for the 0.1.0 release.
- Snapshot scrubbing no longer reads or mutates React refs during render.

## [0.0.18] - 2026-05-29

### Added

- Settings panel now shows the current app version.
- Landing page regression coverage for download fallbacks, mobile layout, release links, and system requirements.

### Changed

- Audio device picker now formats long device labels into a concise two-line display and uses the same formatter for the footer device summary.
- Settings panel now uses a direct LUFS reference value instead of loudness reference profile objects.
- Landing page download links now fall back to GitHub Releases, mobile layout stacks cleanly, and release notification points to GitHub Releases instead of a fake email form.

### Fixed

- Device toolbar icon visual size now matches neighboring toolbar glyphs.
- Clearing the LUFS reference input no longer writes `0`.

## [0.0.16] - 2026-05-19

### Added

- Four new built-in themes: **plvs-light** (warm cream / deep orange), **Phosphor** (CRT phosphor-green on near-black), **Tungsten** (incandescent amber on warm near-black), **Abyss** (bioluminescent cyan × volcanic coral).
- Keyboard shortcut change: pressing 1–6 now toggles fullscreen for that module; pressing the same key again or `Escape` restores the previous layout.

### Changed

- Peak panel: channel labels (name + dB) and **TP MAX** footer now centered within their respective columns; labels auto-hide when the panel is narrower than 220 px (container query).
- Vectorscope panel: **CORRELATION** footer now centered and auto-hides below 220 px.
- Peak panel footer alignment derived from layout structure via CSS `calc()` instead of a hardcoded 5.4 rem magic number.

### Fixed

- Bottom-edge gap appearing after panel resize or window scale.
- Header and footer border colour now uses `border-border` semantic token instead of hardcoded `border-white`.

### Removed

- Float mini-window feature.

## [0.0.15] - 2026-05-16

### Changed

- Header/footer minimal chrome redesign: replaced brand name, device dropdown, preset dropdown, and visibility popover with a compact `StatusPill` (READY / LIVE / SNAP) + `TransportButton` (START / STOP / LIVE) + four icon buttons (Clear, Audio Device, Layout & Modules, Settings) (#110–#118).
- Footer simplified to two context fields only: **DEVICE** and **REF**; removed status text, meter health badge, footnotes, and build version string (#113).
- Audio device selector and module visibility + preset controls now accessed through icon button popovers in the header (#116–#117).
- Session timer tracks elapsed time with a rAF loop (~10 Hz) decoupled from React state; clock displayed inside the status pill, survives window blur/focus (#114).
- Keyboard shortcuts: `Space` start/stop, `Cmd/Ctrl+K` clear, `Cmd/Ctrl+,` open settings (#118).

## [0.0.14] - 2026-05-15

### Added

- Split-tree workspace layout: panels are arranged in a recursive binary split tree (`SplitLayout` + `LeafView` + `SplitDivider`); each leaf holds a tab stack; splits can be horizontal or vertical and are resized via drag dividers (#105–#107).
- `treeUtils.js` — pure tree manipulation helpers (`insertLeaf`, `removeLeaf`, `movTab`, `setSizes`, …) with 325 unit tests (#105).
- `WorkspaceState.tree` reducer with storage format v2, `reducer-tree.test.js` with 316 unit tests; replaces the previous dock-slot reducer (#106).
- Dock+Tabs workspace foundation: `AudioDataContext` (audio state lifted to context, no prop drilling), `WorkspaceContext` + `useReducer` with localStorage persistence (`audiometer:workspace:v1`), `WorkspaceToolbar` (Modules visibility popover + preset dropdown with save-as), keyboard shortcuts 1–6 toggle, Ctrl+1–6 focus, F fullscreen, Esc exit (#93–#103).
- `LoudnessStatsPanel` split out from `LoudnessPanel` as an independent dockable module (#93–#103).
- Spectrogram panel: time axis below the canvas chart using `buildHistoryTimeAxisLabels`, matching the Loudness History X-axis style.

### Changed

- `ActivityBar` replaced by a Modules visibility popover inside `WorkspaceToolbar`; icon bar removed from the layout (#104).
- Tab pill now shows the module icon alongside the module name for visual consistency with the Modules popover.
- Slot highlight shown only while the Modules popover is open, not persistently.
- `MODULE_REGISTRY` `minWidth` / `minHeight` wired into drag-drop size constraints.

### Fixed

- Spectrogram canvas background unified with other panels: Inferno alpha scales with signal level (`t × 255`) so silence is transparent and `bg-muted` shows through, matching the SVG-on-`bg-muted` pattern of Spectrum and Vectorscope panels.
- `MOVE_TAB` reducer: guard against stale leaf path after a single-tab leaf is removed.
- `insertLeaf`: use flex-fill sizes (`0`) instead of fixed `200px` for newly created splits so panes share space proportionally.
- Module area edges aligned flush with header and footer; removed erroneous `max-w-*` constraint that prevented full-width layout.

## [0.0.13] - 2026-05-14

### Added

- Spectrogram panel: full-width waterfall below the 4-panel grid, synchronized zoom/pan/scrub with Loudness History; Inferno colormap, log-frequency Y-axis, `ImageData` rendering (~10 fps cap via data-change guard), resizable height splitter persisted to `localStorage` (#63–#66).
- Design token system documented in `docs/design-tokens.md`: 7-role font scale (`--ui-fs-*`), 6-namespace spacing tokens (`--ui-panel-*`, `--ui-chart-*`, `--ui-metric-*`, `--ui-modal-*`), `--ui-signal-*` meter-colour tokens; tabular-nums applied to all live-changing numeric displays (#67–#75).
- `Meter` trait (`push_pcm` / `reset`) in `dsp/meter.rs`; `LoudnessMeter`, `SpectrumMeter`, `VectorscopeMeter` all implement it; `meter_pipeline` now uses a uniform ctx-push loop (#81).
- `FrameIntake` class owns all live-data rings (`loudnessHist`, `audioSnap`, `corrSnap`, `vectorSnap`, `spectrumSnap`, …); `buildSpectrumDataSnapshot` absorbed into `FrameIntake`; 13 unit tests (#85).
- `PanelSet` component extracts the 4-panel grid from `App.jsx` (`~800 → 637` lines) (#86).
- `resolveDevice` / `buildDeviceStatus` extracted to `lib/audioEngineCommands.js` with 12 unit tests (#84).
- Vitest explicit config (`environment: 'jsdom'`, `globals: true`), `@vitest/coverage-v8`, `test:coverage` script, CI coverage lcov artifact upload (#76).
- Rust unit tests added to `engine/channel_layout.rs`, `dsp/filters.rs`, and `dsp/vectorscope.rs` (22 → 36 tests) (#78).

### Changed

- Design tokens: retire `--ui-color-*` bridge aliases; components now use shadcn tokens directly; `--ui-radius-card` replaced with `var(--radius)` (#67–#75).
- `tauriFrameApply`: parameter count reduced from 18 to 11 via `FrameIntake.pushFrame()` (#85).
- `getCurrentWindow()` moved into `ipc/floatWindowPrefs.js`; IPC seam fully isolated (#82).
- Non-hook utilities (`floatHistorySeed`, `tauriFrameApply`, `resetFloatMeteringState`) moved from `src/hooks/` to `src/lib/`; domain data (`scales`, `loudnessReferenceProfiles`) moved to `src/config/` (#79).

### Fixed

- `aria-describedby={undefined}` added to `SettingsPanel` `<DialogContent>` to clear the Radix accessibility warning (#77).
- Legacy web artifacts (`public/worklets/`, `public/CNAME`, `.nojekyll`) removed from `main` branch (#80).

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
