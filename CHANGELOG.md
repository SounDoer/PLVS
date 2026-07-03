# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.6.3] - 2026-07-03

### Added
- In-app feedback entry in Settings with a feedback dialog and submission client.
- Docs link in the Settings footer.
- Latest-edge hint on the timeline.

### Changed
- Enhanced vectorscope stereo metrics and aligned the correlation axis styling.
- Polished panel help and the loudness HUD.
- Kept panel resizing local when pinned sizes are active.
- Softened landing-page typography.

### Removed
- Removed vectorscope display toggles.

### Fixed
- Mounted the feedback dialog outside the Settings sheet so it opens correctly.
- Reserved Level Meter TP Max marker axis width.
- Matched Level Meter M / ST sentinel readouts to Stats formatting.

## [0.6.2] - 2026-07-02

### Added
- Level Meter playback max readout with per-metric TP Max reset.
- Landing-site docs entry and newsletter subscribe form.

### Changed
- FireRedVAD is now the default dialogue VAD engine.
- Loudness reference control now lives in Loudness panel settings.
- Landing page visuals, copy, and docs navigation were refreshed.
- Level Meter TP Max marker and readout toggles now default off.

### Fixed
- Disabled the spacebar start / stop shortcut.
- Preset edits now preserve the active preset id and track panel divergence.
- Settings, modules popover, shortcut rows, and small-screen docs navigation were polished.
- Replaced stray native title tooltips with HoverTip.

## [0.6.1] - 2026-06-30

### Changed
- Tightened narrow-panel metric labels in Stats and Level Meter panels.
- Polished Level Meter markers and mode labels.
- Replaced the vectorscope correlation footer with a rail and removed the marker glow.

### Fixed
- Corrected loudness hover guide layer selection.

## [0.6.0] - 2026-06-29

### Added
- File analysis now decodes through a bundled FFmpeg / ffprobe sidecar (replacing Symphonia), with wider file-picker format support.
- Dialogue VAD engine selection — choose among multiple voice-activity-detection adapters for dialogue gating.
- File-list popover gains a stop control and progress indicator; the pill follows the active file and disables analyze during background work.
- Local configuration profiles in settings.
- Trimmed file-mode summary region (filename, metadata, three delivery chips) and a clearer file-list trigger icon.

### Changed
- Optimized request-keyed file analysis; polished the file-analysis summary UI and aligned level-meter axis label styling.
- Greyed-out transport action when it cannot run.

### Fixed
- Preserve history cadence during file analysis — the time axis no longer compresses on large FFmpeg read chunks.
- Stop background analysis from driving the active file's panels.
- Hide FFmpeg sidecars from the file picker and reuse probe metadata; keep the diagnostic binary out of Windows bundles.

## [0.5.3] - 2026-06-27

### Changed
- Close confirmation dialog now uses a more compact layout
- Pinned panel state now uses the PinOff icon instead of accent fill
- Range endpoint labels now use `-` as the separator

### Fixed
- Persist the close dialog "don't ask again" setting reliably
- Preserve dialogue-active state in snapshot playback history
- Scope pinned panel size changes to the nearest matching-direction split

## [0.5.2] - 2026-06-26

### Added
- Interactive zoom/pan axes with adaptive nice-number ticks
- Spectrum hold smoothing
- Chart help moved into panel toolbar
- Refined panel range controls and axis viewport interactions
- Live chart hover probe refresh

### Fixed
- Smooth waveform fullscreen interactions and reduce resize stalls
- Sync package-lock.json version in bump script

## [0.5.1] - 2026-06-21

### Added
- Panel size pinning for workspace panels
- Hide Chrome toggle with native context menu suppression

### Fixed
- Preserve subpixel panel pin sizes
- Bold value marker now hidden when below scale range
- Lower default spectrum display shaping
- Tuned multiresolution spectrum smoothing

## [0.5.0] - 2026-06-25

### Added
- File mode: local audio-file analysis with probe, decode, media-time history, scrub support, and in-memory session history.
- Analysis: per-instance panel controls, request-keyed live results, and over-cap analysis panels.
- Theme: custom themes, theme editor, derived instrument colors, and theme-driven spectrogram colormap.
- Views: opacity control for panels, presets, meter bars, spectrogram canvas, and transparent window support.
- Spectrum: display controls, y-axis range controls, slab-backed visual history, and timestamp-positioned rendering.
- Panels: unified panel settings entry, level meter value marker, and Stats panel abstraction.

### Changed
- UI: renamed Focus View to Views and tightened app chrome, headers, panels, settings, and compact layouts.
- Settings: centralized defaults, persistence, and reusable settings primitives.
- Spectrogram: read history through slab/frozen view interfaces instead of rebuilding arrays per tick.
- File analysis: active source is modeled as a single backend source and shares decode/probe helpers.

### Fixed
- Release: build macOS DMG by limiting transparent-window builder setup to Windows.
- Spectrogram: preserve history across capture restart, align live timeline rendering, and mark missing data inside gaps.
- File mode: keep history selector visible, isolate live/file history, and render panels correctly during file analysis.
- Views: panel opacity now reaches headers, footers, fullscreen state, auto-hide borders, and shell backgrounds consistently.
- Panels: align neighboring axes, preserve per-instance controls, and fix compact/label behavior.
- Persistence: seed custom themes in release builds and ignore minimized persisted window bounds.

## [0.4.0] - 2026-06-18

### Added
- Loudness: replace reference line with over-reference gradient on M/ST curves
- UI: add Focus View controls
- Layout: lower panel drag-resize minimums to reduce stuck feeling
- Release: auto-append bilingual install guide to GitHub Release notes

### Changed
- UI: unify Devices toolbar picker with other popover buttons

### Fixed
- Settings: allow free editing of the loudness reference input
- UI: keep Focus View controls visible during popovers
- UI: allow Focus View frameless window controls

## [0.3.7] - 2026-06-18

### Added
- Presets: settings-managed view snapshots
- Presets: toolbar popover for preset management (moved out of Settings)

### Changed
- Presets: remove Presets block from SettingsPanel (moved to toolbar)
- UI: update icon tooltips

### Fixed
- Presets: clarify rename and active row layout
- UI: restore missing PresetsPopoverContent import in App.jsx
- UI: improve presets popover accessibility
- Engine: reduce retained history memory

## [0.3.6] - 2026-06-17

### Added
- Window: persist window geometry on move/resize
- Window: inject persisted state pre-paint and restore window bounds
- Window: add window-bounds clamp helper with tests
- Persistence: select plugin-store backend under Tauri
- Persistence: add sync-cache plugin-store backend
- Persistence: clean up legacy storage keys on boot
- Persistence: add one-shot legacy-key cleanup helper
- Persistence: add settings/workspace domain stores and exportAll/resetAll
- Persistence: add createDomainStore factory
- Persistence: add localStorage backend

### Changed
- Persistence: single-source panelControls in workspace state
- Persistence: move theme/referenceLufs/channelLabelOverrides to settings domain
- Persistence: move closeAction/windowPinned to settings domain
- Workspace: remove focusId from the state model
- Layout: remove vestigial ratio layout (PanelSet, useLayoutDrag)

### Fixed
- Engine: bound UI frame backlog with ack-based backpressure
- Panel: stabilize updatePanelControls to stop render loop on Start
- Window: restore bounds in physical pixels to stop HiDPI growth
- Window: store windowBounds under its own Rust-owned key

## [0.3.5] - 2026-06-16

### Added
- Waveform: sub-block precision with pixel-decimated envelope rendering
- Waveform: column-indexed hover dBFS with window-based time label
- Waveform: absolute-anchored pixel-width decimation for scroll stability
- Spectrogram: absolute-anchored column-range mapping for anti-flicker
- Loudness: drag-reorder and reset for stats popover
- Loudness: configurable stats metric ordering via panel controls

### Changed
- Waveform: grow envelope from the right like loudness history
- Spectrogram: emit exactly W columns (1:1 pixel) to fully anchor scroll
- Workspace: make all panel bodies non-selectable at the leaf shell

### Fixed
- Vectorscope: hide center dot until capture starts
- Loudness: restore m max / st max / dialogue stats in snapshot mode
- Loudness: prevent text selection while dragging stat rows
- Spectrogram: derive bandCount from newest snap, not oldest visible
- Shell: make app chrome non-selectable at the shell inner container

## [0.3.4] - 2026-06-15

### Added

- Spectrum: M/S + L/R channel overlay with dual-curve display
- Spectrum: peak-hold filled-area rendering (replaces dashed line)
- Spectrum: peak-hold toggle chip in panel header
- Spectrum: combined / L/R / M/S view toggle in panel header
- Spectrum: color-coded hover dB rows in overlay mode
- Spectrum: secondary curve legend and 2-row hover tooltip

### Fixed

- Timeline: stabilize initial history viewport
- Workspace: show panel header chip in fullscreen overlay
- CI: resolve clippy errors on Windows

## [0.3.3] - 2026-06-15

### Added

- Spectrum: multi-resolution PSD bank with crossfaded crossovers
- Spectrum: single-size STFT analyzer producing per-bin PSD
- Spectrum: log-frequency render grid
- Spectrum: drive display from multi-resolution bank with 4.5 dB/oct slope
- Spectrum: calibrate display offset to 0 dBFS reference
- Spectrum: timed peak-hold default (1.5s hold, 8 dB/s fall)
- Spectrum: show note name in spectrum and spectrogram hover

### Fixed

- Audio: reset meters on format restart
- Loudness: tighten value-to-unit gap in stats rows
- Spectrogram: reuse live-frame grid centers for visual ticks
- Spectrum: remove octave smoothing + level fudge for honest, consistent dB
- Spectrum: reference display so full-scale sine reads ~0 dBFS
- Spectrum: pivot display slope at 1 kHz to avoid inflating the curve

## [0.3.2] - 2026-06-13

### Fixed

- Prevent split resize overflow in layout
- Remove refs lint warnings in hooks
- Unify max stats on frame payload in loudness panel
- Reset Silero VAD state on dialogue gating toggle
- Portal hover tips outside scroll containers for better UX
- Reduce stats value size in loudness panel

### Changed

- Documentation updates for dialogue-gated loudness feature and acknowledgements

## [0.3.1] - 2026-06-13

### Added

- Dialogue-gated loudness metering with VAD speech sidechain
- Four dialogue metric rows: Coverage, Range, Avg. Offset, Active Now (with live speaking indicator)
- Hover hints on loudness stats panel rows and picker options
- Unified stats label/unit/hint registry as single source
- HoverTip component for consistent tooltips across the app

### Changed

- Consolidated plvs.ui persistence into one adapter
- Extracted two-timeline reconciliation into resolveSnapshot
- Unified displayed text casing across the app

### Fixed

- Clipped descenders and tight row gap in loudness stats
- Idle channel labels unified to L/R across all panels
- Stats/Layers popover sized to content so labels don't wrap
- Dialogue rows placed after Avg. Dynamics, not mid-list
- Empty placeholder unified to '-' for dialogue coverage/offset
- Build compatibility with tauri-utils (pinned time crate)

### Removed

- Dialogue singing-counts-as-speech footnote hint
- Unwired meter-health and footnote dead code

## [0.3.0] - 2026-06-12

### Added

- Auto channel layout detection with loudness weights for 5.0, 5.1, 7.0, 7.1 surround formats
- Channel label overrides in Settings for custom channel naming
- Refreshable update checks with manual refresh button
- Global keyboard shortcut for Clear action with customizable combo
- Keyboard shortcuts section in Settings
- ShortcutCapture key-recording control for recording custom shortcuts

### Changed

- Removed manual Channel layout setting (now auto-detected from audio stream)
- Settings panel layout improvements (labels and controls on same line for dropdowns)
- Removed Settings title from panel header for cleaner UI

### Fixed

- Channel labels for quad/LCR/5.0 layouts in auto mode
- Global hotkey now freed while recording a new combo
- Clear combos now reject collisions with in-app shortcuts

## [0.2.3] - 2026-06-10

### Added

- System behavior settings (Open at login and Close behavior)
- Automatic theme-aware tray icon switching
- PLVS P lettermark icons replacing placeholder icons

### Changed

- Waveform envelope outline now strokes once to match line weight of other panels
- Landing page hero screenshots updated with new app captures

### Fixed

- Prettier formatting for CI

## [0.2.2] - 2026-06-09

### Performance

- Removed dead meter_history ring buffer and export command from engine
- Stopped storing per-row spectrum/vectorscope SVG paths in intake
- Shared RTA band arrays across history rows for better memory efficiency

## [0.2.1] - 2026-06-09

### Added

- Unified hover HUD for all chart panels (Spectrum, Vectorscope, Spectrogram, Loudness History, Waveform)

### Changed

- README now documents ASIO limitation and WASAPI workaround for DAW users

## [0.2.0] - 2026-06-09

### Added

- Visual history ring buffers at 25Hz for Spectrum and Vectorscope panels, enabling smooth scrubbing playback
- O(1) RingBuffer data structure for efficient visual history storage
- SVG reconstruction helpers for visual history scrubbing
- Loudness history depth extended to 2 hours
- System tray icon with P-shape PNG icon
- HelpPopover tooltip to WaveformPanel
- Visual history support for Spectrum and Vectorscope scrubbing

### Changed

- Time axis and scrub data now use visual history sample counts for better accuracy
- Default workspace preset renamed from "PLVS Full" to "PLVSSW"
- Spectrogram viewport parameters scaled to visual 25Hz units for canvas range

### Fixed

- Spectrogram blank display fixed by using buildRtaBands for visual spectrum bands
- Visual history and chart axes alignment across all panels
- RingBuffer bounds check, zero-capacity guard, and capacity getter
- Loudness/Waveform time axis alignment with Spectrogram
- Waveform zero line and fill using theme grid-line token
- Tray icon StrictMode/race bugs

### Performance

- Spectrum history memory reduced by caching band objects in spectrumDataSnap

## [0.1.6] - 2026-06-05

### Fixed

- WASAPI loopback capture now stays active when no audio is playing by playing a silence stream on Windows. This keeps the loudness history and spectrogram time axis scrolling consistently with the session timer.
- CI builds now correctly gate Windows-specific loopback code behind platform cfg attributes.

### Changed

- README revamped with badges, features overview, quick start guide, and development instructions.

## [0.1.5] - 2026-06-05

### Fixed

- Clear now resets the current measurement window and timer without stopping active capture.
- Release links continue to open in the system browser, and obsolete float-metering remnants were removed from the release path.

## [0.1.4] - 2026-06-05

### Added

- App startup now checks GitHub Releases for newer PLVS versions and surfaces available updates in the footer and Settings.
- Settings now links to the current release notes from the version row.

### Changed

- Settings version information is shown as a compact single-line status: current version, update state, and release link.

### Fixed

- Release links now open through Tauri's system-browser opener instead of relying on WebView link navigation.

## [0.1.3] - 2026-06-04

### Changed

- Loudness history chart traces now distinguish Momentary and Short-term as sibling primary curves using theme-owned color and stroke-width tokens.
- Chart snapshot traces now use a consistent theme-owned snapshot color family across Loudness, Vectorscope, and Spectrum.
- Spectrum live peak overlays now use the live spectrum token instead of consuming snapshot state colors.

### Fixed

- Panel header controls remain visible in all panel sizes so channel, stats, and layer controls are not hidden by narrow panel layouts.
- Snapshot color tests now guard built-in themes against barely distinguishable or inconsistent chart snapshot traces.

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
