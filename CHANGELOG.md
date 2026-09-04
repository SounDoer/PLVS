# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.14.6] - 2026-09-04

### Added

- Dialogue Detection is now a global setting: the engine is chosen once in Settings instead of per panel, existing per-panel choices are migrated, and changing it clears the running measurement.
- Preset apply, preset save/update, and dock entry are refused while a draft editor is open, so they can no longer discard unsaved editor work. Enforced below the UI, so the popover, dock and tray all report the same reason.

### Changed

- Analysis request caps are gone; panels no longer compete for a limited number of analysis slots.
- A dock preset refused in FILE mode now says why. A platform without dock support still applies the rest of the preset silently.
- Dev builds use their own app identifier, so running from source no longer overwrites the installed app's settings, window geometry and dock state.

### Fixed

- Level Meter: a TP Max or value readout that leaves the axis range is pinned to the edge it left, keeping the real number, its reset click, and an arrow marking the direction.
- Panel settings: a row label's tooltip is no longer clipped by the settings body.
- Settings: the Dialogue Detection row leads with the default engine, and its link icon follows the iconography contract.
- The capture rig refuses to run against a `plvs-cli` older than its own sources, instead of silently verifying stale code.

## [0.14.5] - 2026-09-01

### Added

- UI frame drop observability: the desktop perf rig records dropped UI frames and attributes long animation frames, so a soak run says where the main thread went.

### Changed

- Spectrogram advances its paint window on the 25 Hz visual cadence at the live edge, so the waterfall no longer stutters on the 10 Hz history step. File analysis, stopped capture, history offset, and scrub selection keep the unchanged window.
- Removed the A/C weighting parameter from Spectrum. It had no production caller and always contributed 0 dB.

### Fixed

- Spectrogram's decimation stride rounds up, so the newest end is never truncated and the entering edge no longer shows a black slot that moved with the camera.
- Spectrogram's floor skirt closes the entering and frequency edges instead of the old height ramps, which held the newest 3.8s of a 60s span below its true height.
- Panel settings: every range row sits at the end of its tab. The Level Meter's Level Range and the Spectrogram's Time Range are now orderable at all.

## [0.14.4] - 2026-09-01

### Changed

- Spectrogram's 3D Surface mode now renders through WebGL2, with a closed floor skirt and capture gaps preserved.
- Spectrogram 3D rendering uses a lower-resolution surface and a faster hairline path to reduce GPU cost.
- Stereo Map, Spectrum, and Vectorscope avoid unused history and rendering work.
- Analysis frames and their ticks now share one clock reading.

### Fixed

- Spectrogram 3D Surface cadence stays aligned to the stable sampling grid, removing boundary mismatch and ridge-rebinding jitter.
- Corrected the Surface color lookup layout and gap tolerance.
- Surface mode no longer remains blank when its WebGL canvas initializes late.

## [0.14.3] - 2026-08-31

### Added

- Spectrogram slope tilt: the same per-octave tilt Spectrum has, now on the Spectrogram's own settings row, sorted after Mode and sharing one tooltip with Spectrum's.
- The Dock's spectrogram strip gets a dB Floor control.

### Changed

- Meter frames no longer cross to the interface as JSON text. Spectrum's and Stereo Map's per-band rows now travel as binary sections beside a small JSON envelope, at the width the values actually carry. A production-width frame drops from 131,886 to 36,000 bytes, and the interface spends 0.073 ms decoding one instead of 0.689 - about 38 ms per second of the main thread handed back at the frame rate. `JSON.parse` no longer appears in a renderer profile at all.
- Every panel went through a measured performance pass, and the ones that were doing avoidable work stopped:
  - Spectrogram repaints by sliding the painted image instead of redrawing the whole surface.
  - Stereo Map's four-hour history for one request key drops from 1.29 GiB to 0.81 GiB, stored in twelve bits per value rather than sixteen; the value stays well inside display precision, and the HUD says plainly that it is approximate.
  - Vectorscope builds its live outline into one buffer, redraws its canvases only when their inputs change, and stops decoding a persistence window it never draws.
  - Waveform skips the spectral metrics entirely when neither overlay is on, and finds its spectral window by search rather than by walking the ring.
  - Loudness stops remounting its axis ticks on every update, and starts its history queries at the right index level.
  - Theme tokens resolve once per theme instead of once per frame.
- The band frequency grid is sent once a second and cached by the interface, instead of riding along with every row.

### Fixed

- The Spectrogram's slide window is judged in whole pixels, so a refused slide is counted rather than silently dropping a column.
- The Spectrogram tilt control is restored and reachable from the Dock.

## [0.14.2] - 2026-08-28

### Changed
- Long-session memory: scalar history - loudness, audio snaps, and the waveform and loudness min/max indexes - is stored in packed Float32 columns instead of one object per row. At four-hour retention the scalar layer's live heap drops from ~205 MB to ~13 MB, and the longest GC pause from 40-124 ms to 3.6-5.3 ms.

### Fixed
- File-analysis coverage no longer breaks when a history timestamp is non-finite.

## [0.14.1] - 2026-08-27

### Added
- Linked axis viewports: Spectrum's X, Spectrogram's frequency Y and Stereo Map's X now navigate one shared frequency range, linked by default, with a link toggle on each panel's own Frequency Range row. The three timeline panels share their time viewport the same way. Membership and the shared range persist, and presets carry both.
- Time Range is now a settings row on the three panels that have a time axis, editable as the two numbers written at the ends of the rail - time-ago when live, absolute media time in file mode.
- Spectrum Max Hold: a cumulative per-band maximum drawn as one held outline per curve, in the curve's own color, clearable by clicking the held line. It works in snapshot mode, showing the hold as it stood at the selected row, and the Dock strip holds the spectrum peak too. The old decaying peak envelope stays, renamed Max Decay, and sits beside it.
- Stereo Map's level axis is editable by wheel and drag in Mono Loss and M/S Ratio, not just from the settings panel. Position and Correlation always show their whole range, so their rail stays inert.

### Changed
- Long-running panel histories are packed into chunked storage and freed once no open panel needs them or they age out of the retention window, cutting memory on long sessions.
- Sliders that change an analysis request key - Spectrum speed and tilt, Stereo Map speed - commit on release instead of on every pointer move.

### Fixed
- Idle CPU: a re-render loop in the Dock accessory visibility hook kept every non-docked session in a ~250 Hz render/effect churn, present since v0.10.0. Renderer CPU when idle drops from ~0.57 of a logical core to effectively zero.
- Idle Spectrogram animation polling stopped, and 3D ridge projection no longer allocates per vertex.
- Title-bar drags no longer strand event listeners for the life of the session.
- Level Meter's RMS level range now reaches the keys the meter actually reads.
- Linked frequency settings stay in sync across panels.
- Workspace state is no longer written to storage on every pointer move during a drag.

## [0.14.0] - 2026-08-21

### Added
- Waveform spectral coloring: two independent, opt-in toggles - Frequency Color (dominant frequency selects the hue, spectral tonality controls saturation) and Centroid (a spectral-centroid trace on a logarithmic frequency axis). Workspace and Dock persist their own settings, both default to Off, and the classic waveform stays the default look.
- Theme V2: themes are now authored as six core color roles with everything else derived, with editable palettes, curated Advanced role overrides, undo/redo on the unsaved draft, and inline theme actions plus Add Theme in the Theme Picker.
- Split dividers snap to the midpoint while dragging.
- Frameless header supports a double-click maximize gesture.

### Changed
- Less visual furniture: the Spectrum grid, Waveform zero line, Stereo Map baseline and Loudness grid are gone, and the Vectorscope diagonals are wider. Every remaining grid is painted in the color the theme gives it.
- Focus is consistent: default focus outlines are gone everywhere, replaced by a themed focus ring on every focusable element.
- Theme editor: every Advanced section is collapsed by default, and the Interface palette moved to the end of Palettes.
- Existing custom themes migrate to V2 automatically on load.
- Radii settled on a three-rung ladder; hover and active settled on two states.

### Fixed
- Stereo Map y axis labels no longer overlap on short rails.
- Floating editors scale with Interface Size, and the rule selects fit their labels at any Interface Size.
- Popovers inside the settings sheet stay clickable.
- Corrected the modal scrim and kept the discard confirmations dimmed.

## [0.13.1] - 2026-08-10

### Added
- Loudness Profile editor's rule list is drag-to-reorder, with a ring highlight on the row being dragged.

### Fixed
- Dialogue Integrated no longer shows the same warn color as an actual rule breach when dialogue coverage is too low to judge it; it's now evaluated the moment the engine has a value, the same as Integrated.

## [0.13.0] - 2026-08-05

### Added
- Spectrogram gained a 3D Surface view mode alongside 2D and 3D Ridges, with adjustable height scale, elevation, floor grid, and a dB floor shared with the 2D view.
- Toolbar and Dock highlight the Presets trigger while its popover is open, matching the active-preset highlight.
- Spectrogram settings sliders apply live while dragging, instead of only on release.

### Changed
- Shortcuts/help popover dropped the axis letter chip; axis gestures and range controls are now named after the axis they act on.

### Fixed
- Toolbar Presets icon no longer highlights while dirty, and correctly highlights when a preset is active.
- Dock's module settings accessory no longer inherits the wrong Loudness Profile provider.
- Fullscreen overlay no longer shows a default focus ring.

## [0.12.2] - 2026-07-29

### Fixed
- Presets and Loudness Profile drag-to-reorder now reliably commits the new order instead of sometimes reverting or leaving other views showing a stale list.
- Spectrogram in file mode no longer paints spurious blank gap stripes between frames.
- High-frequency setting changes (e.g. dragging in Presets/Loudness Profile lists) no longer trigger a full-file rewrite on every pointer move.
- Loudness HUD hover tooltip's Momentary/Short-term readouts now match the Stats panel when paused on a snapshot.

## [0.12.1] - 2026-07-28

### Added
- Each panel tab now has its own close control, so a single tab can be closed without hiding every tab in a shared slot.
- Add Module rows in Workspace mode support drag-to-place, dropping a new panel exactly where you release it instead of only at a fixed default split.
- Presets and Loudness Profile lists support drag-to-reorder.

### Changed
- Add Module (Workspace and Dock) now swaps into a picker view instead of opening a nested or floating popover, and wording is unified as "Add Module" in both modes; Dock's Modules editor gained a Reset to defaults control.

### Fixed
- Adding a panel via Add Module now gives it a modest ~30% slice instead of collapsing the existing layout to half the window.
- Dock's flexible-growth modules (Spectrum, Waveform, Spectrogram, Stereo Map) no longer auto-grow past their defined preferred max width.
- Dock preset drag-reorder now syncs to the main window instead of being silently dropped.
- Dock module list icons are now consistently sized with normal mode.

## [0.12.0] - 2026-07-28

### Added
- Stereo Map: a new frequency-domain stereo-analysis panel (Workspace panel and Dock module) showing where each frequency region sits in the stereo field, channel-pair correlation, mono fold-down phase cancellation, and Mid/Side energy dominance, with live capture, file analysis, history, and snapshot support.

### Changed
- Renamed Vectorscope Polar Level's `Peak hold` to `Max hold` and Stereo Map's `Hold` to `Max hold`, matching Vectorscope's always-on running-maximum behavior; renamed Spectrum's `Max hold` to `Max decay` to distinguish its decaying peak from the other two panels' non-decaying hold.
- All panel settings labels now use Title Case.
- Stereo Map rendering and history performance improved (canvas-based curve drawing, chunked hold reconstruction, cached hold summaries).

### Fixed
- Stereo Map no longer shows its mono-only message before capture has started.

## [0.11.3] - 2026-07-25

### Added
- Tray menu now includes a device switcher and preset selection.
- The update dialog shows every version's notes across a multi-release upgrade.

### Fixed
- Tray menu no longer freezes while audio devices load, and now marks the active preset.
- Update dialog heading fits multi-version notes.
- Native right-click menu is suppressed in dock accessory windows.
- Popover panels no longer pre-highlight their first option.

## [0.11.2] - 2026-07-24

### Fixed
- Dock Modules and Presets menus now use the same adaptive, capped width as the header popovers, so long custom module names no longer burst the panel; overflowing names truncate with a clipped-only hover tip.

## [0.11.1] - 2026-07-24

### Changed
- Unified all editor rename forms behind one shared component.
- Unified add/new entry points behind a single AddButton.
- Rule metric order in the profile editor now derives from the Stats panel.

### Fixed
- Long names no longer truncate incorrectly in capped popovers.
- Rename inputs no longer widen w-max list panels.
- Profile editor rule columns align on a shared grid; Reference is folded into the grid to reclaim metric width.
- Clipped metrics now show a tooltip.
- Number fields are sized in ch and settle at metric precision.

## [0.11.0] - 2026-07-23

### Added
- Loudness Profile: a rule-based profile editor (per-metric tolerances, reference line, watched-metric marking) replacing the old single numeric reference, with active-profile status surfaced in Stats, the footer, and the Level Meter TP Max marker, and profiles snapshotted into layout presets.
- History storage keeps an exact min-max summary index so zoomed-out views stay accurate without rescanning raw samples.

### Changed
- Loudness, Spectrum, Spectrogram, Vectorscope, and Waveform history rendering now scale to long capture sessions (chunked storage, binary-search timestamp resolution, ring buffers) instead of scanning or copying the full retained history on every frame.
- Toolbar popovers use tighter adaptive layouts.

### Fixed
- Waveform envelope keeps full vertical resolution and no longer flickers while idle, and preserves non-finite gaps correctly.
- Spectrogram and Spectrum history correctly preserve gap boundaries and retained tail rows.
- Stats metric labels no longer clip descenders.
- Numerous Loudness Profile editing edge cases (blank thresholds, half-typed rules, draft persistence across presets and Dock mode, renaming).

## [0.10.0] - 2026-07-21

### Added
- Vectorscope Polar display modes (Polar Level, Polar Sample) for both the panel and Dock, including click-to-reset Peak hold and Peak hold reconstruction while scrubbing snapshots.
- In-app updater now shows a changelog confirmation dialog before installing and relaunches automatically after install.

### Changed
- Polar Level now reads on a consistent Ozone/PAZ-style scale instead of shrinking whenever Peak hold is enabled.
- Snapshot Peak hold reconstruction uses ~25x less memory on long retention windows.

### Fixed
- Vectorscope pair-label alignment, spacing, and Dock behavior are unified across display modes.
- Snapshot Peak hold no longer shows a look-ahead of future samples.
- Updater release notes stay focused on actual changes.

## [0.9.4] - 2026-07-20

### Added
- CLI commands for probing media tracks and applying opt-in loudness and true-peak quality-control thresholds.
- CLI device listing and richer doctor diagnostics for capture devices, bundled VAD engines, and build capabilities.
- Dialogue-gated CLI analysis with selectable VAD engines, dialogue metrics, reference offsets, and batch-analysis support.
- CLI profile validation, export, and import for managing desktop configuration without launching the UI.

### Changed
- Dock mode is now limited to Windows and disabled on macOS.

### Fixed
- Keyboard shortcuts are captured consistently regardless of the currently focused control.
- Dock accessory windows remain open reliably while moving the pointer between related windows.
- Hidden Dock editors are measured before display, preventing incorrect initial sizing.
- Dock loudness history continues advancing after the retained history ring reaches capacity.

## [0.9.3] - 2026-07-17

### Changed
- Loudness, vectorscope, waveform, and spectrum trace stroke widths are now driven consistently by their theme tokens and rendered at true CSS-pixel widths, instead of some curves scaling incorrectly or ignoring the configured width.

### Fixed
- Window chrome (decorations/shadow) and geometry are now applied in the correct order across Dock, presets, and relaunch, fixing window drift and shadow inconsistencies.
- Dock accessory windows size correctly under Windows Text Size scaling instead of clipping their content.
- Panel settings menu stays within the viewport.
- Update status in Settings now reflects the latest check instead of a stale state.
- Popovers close when the window loses focus.

## [0.9.2] - 2026-07-16

### Fixed
- Restored macOS packaging by aligning the direct `window-vibrancy` dependency with Tauri.
- Kept the Dock AppBar anchored to its original monitor work area when Windows temporarily moves a minimized window offscreen.

## [0.9.1] - 2026-07-16

### Added
- Dock Mode with top and bottom placement, Windows work-area reservation, resizable modules, accessory editors, and preset integration.
- Dock modules for transport, level, loudness, stats, correlation, spectrum, vectorscope, waveform, and spectrogram monitoring.
- `plvs-cli capture` for recording live input into the shared summary metrics JSON contract.
- Small, Default, Large, and Extra Large interface size profiles for normal mode.
- Fractional-octave spectrum smoothing, tracked peak labels, and Max Hold controls.

### Changed
- Standardized normal-mode typography, iconography, and chart-axis geometry on semantic design tokens.
- Made the Settings drawer width and layout adapt to interface size and narrow application windows.
- Renamed Spectrum temporal `Smoothing` to `Speed` and `Peak hold` to `Max hold`.

### Fixed
- Stabilized Dock startup, edge transitions, AppBar reservation, accessory windows, and preset restoration.
- Kept Dock history, waveform, spectrogram, stats, and level displays responsive across module sizes.
- Improved Spectrum peak-label tracking and synchronized octave-smoothing analysis requests.
- Corrected History Length unit labels and optical alignment of panel pin controls.
- Made Windows-only Dock smoke tests platform-independent in Linux release verification.

## [0.9.0] - 2026-07-16

### Added
- Dock Mode with top and bottom placement, Windows work-area reservation, resizable modules, accessory editors, and preset integration.
- Dock modules for transport, level, loudness, stats, correlation, spectrum, vectorscope, waveform, and spectrogram monitoring.
- `plvs-cli capture` for recording live input into the shared summary metrics JSON contract.
- Small, Default, Large, and Extra Large interface size profiles for normal mode.
- Fractional-octave spectrum smoothing, tracked peak labels, and Max Hold controls.

### Changed
- Standardized normal-mode typography, iconography, and chart-axis geometry on semantic design tokens.
- Made the Settings drawer width and layout adapt to interface size and narrow application windows.
- Renamed Spectrum temporal `Smoothing` to `Speed` and `Peak hold` to `Max hold`.

### Fixed
- Stabilized Dock startup, edge transitions, AppBar reservation, accessory windows, and preset restoration.
- Kept Dock history, waveform, spectrogram, stats, and level displays responsive across module sizes.
- Improved Spectrum peak-label tracking and synchronized octave-smoothing analysis requests.
- Corrected History Length unit labels and optical alignment of panel pin controls.

## [0.8.1] - 2026-07-10

### Added
- Vectorscope hold now shows a phosphor-style persistence trace of recent samples instead of a smoothed live trace.

### Fixed
- Loudness history curve no longer freezes once a session exceeds the configured retention window.
- Timeline hover no longer shows Loudness/Waveform values over regions without real data.

## [0.8.0] - 2026-07-10

### Added
- History Length control in System Settings to configure how much history is retained.
- Vectorscope hold-to-slow: holding the plot briefly activates a smoothed trace display.

### Changed
- Loudness history and vectorscope rendering now scale to long capture sessions without degrading frame rate when zoomed out.

### Fixed
- Timeline zoom and live capture now stay aligned with the configured history retention window.
- History rings rebuild immediately when the retention capacity setting changes.

## [0.7.5] - 2026-07-09

### Fixed
- Windows Rust tests no longer panic when pre-expiring `Instant`-based meter timers.
- Vectorscope traces are easier to read during live monitoring.
- Live snapshot timestamps now stay aligned with the active transport session.

## [0.7.4] - 2026-07-09

### Added
- A header notice now surfaces transport errors directly, replacing the removed status broadcast path.

### Changed
- The runtime context value is memoized so meter-frame-rate re-renders no longer cascade to every consumer.

### Fixed
- Clearing peaks and history now also resets the live timestamp origin.

## [0.7.3] - 2026-07-08

### Fixed
- macOS DMG smoke verification now accepts the per-platform agent discovery manifest format.

## [0.7.2] - 2026-07-08

### Fixed
- macOS release builds now use the same `window-vibrancy` version as Tauri, avoiding duplicate symbol failures during DMG packaging.

## [0.7.1] - 2026-07-08

### Changed
- PLVS CLI now ships as a thin forwarder into the main binary, reducing duplicate installer weight.
- Added a size-focused release profile.
- Refactored shared BS.1770 DSP math into reusable gating and filter modules.

### Fixed
- Agent discovery manifest now reports truthful per-platform CLI paths.
- File history selection is clamped to the available sample range.
- Version bumps now regenerate the agent discovery manifest automatically.

## [0.7.0] - 2026-07-08

### Added
- In-app auto-update: check, download, verify, and install updates directly from Settings, backed by signed release artifacts and a published update manifest.
- PLVS CLI: `analyze` (single file), `analyze-batch`, `doctor`, and markdown/JSON report output.
- CLI added to the user PATH via the Windows installer, with a Settings control to add/remove it.
- File-mode analysis report export.

### Changed
- Polished vectorscope correlation marker smoothing.
- Polished file analysis summary and source transport chrome.

### Fixed
- Rejected unexpected bundled executables and slimmed the CLI installer to avoid stray PATH hooks.
- Windows-only Path/PathBuf import gating for the CLI path module.
- Shortened the report export button in file mode.

## [0.6.4] - 2026-07-05

### Added
- RMS mode for the Level Meter panel.
- macOS Glass effect support with a Views switch, settings persistence, and preset capture / apply support.

### Changed
- Polished range slider styling and moved the Glass switch below the Opacity slider.

### Fixed
- Kept macOS vibrancy setup idempotent and macOS-only, with Glass disabled on Windows.
- Corrected transparent window opacity and reduced Acrylic tint interference.

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
- Hide FFmpeg sidecars from the file picker, reuse probe metadata, and reject unexpected Windows bundle executables.

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
