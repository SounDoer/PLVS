# Unified panel presentation implementation plan

Date: 2026-10-15
Status: Implemented and verified; awaiting user review. Not committed.
Design: [Unified panel presentation](../specs/2026-10-15-panel-presentation-design.md)
Working tree: `.codex/worktrees/dock-flexibility`, branch `codex/dock-flexibility`.

## 1. Establish the baseline and state contract

- Confirm clean scope and capture native screenshots/state before changing rendering. Select the
  intended dev instance explicitly; record inspect revision and restore temporary review settings.
- Review `docs/pitfalls.md` sections on Windows/Dock geometry, persistence, rendering and Dock
  presets, plus `docs/agent-control/README.md` before touching those paths.
- Add a normalized presentation model with Workspace/Dock defaults and legacy compactPanels
  migration. Header visibility exists only for Workspace; axes/labels visibility is independently
  stored for each surface. Do not add a Dock header preference. Keep window chrome preferences separate.
- Integrate with `src/settings/defaults.js`, the settings persistence domain,
  `src/hooks/useViewSettings.js`, `src/hooks/WindowChromeContext.jsx`, and application contexts.
- Cover missing/partial/malformed input, explicit false, new-field precedence, independent updates,
  notifications from external writers, and reset to per-surface defaults.

Deliverable: one state owner and one effective-presentation selector; no duplicate mutable alias.

## 2. Preserve presets, portable data and automation contracts

- Update `src/hooks/usePresets.js`, preset snapshot/scene adapters, defaults, and preview consumers.
  Cover dock-disabled preset preservation, Dock-enabled restoration, dirty tracking, and refusal
  before mutation when blocking editors are open.
- Audit `src/transfer/portablePreset.js` and its format version rules. Extend serialization and
  validation together; test old supported fixtures and new round trips. Do not weaken unknown-field
  validation or silently discard presentation fields.
- Extend Agent Control View schema/read/patch/reset, inspect snapshots, capability descriptions,
  change paths and settlement. Keep compactPanels as a Workspace compatibility alias and reject
  conflicting alias/canonical updates before any mutation.
- Regenerate the reference with `npm run docs:agent-control`; run associated contract tests.

Deliverable: GUI, saved settings, presets, portable packs and CLI agree on the same values.

## 3. Replace ambiguous compact plumbing and reorganize Dock toolbar

- Update `src/components/FocusViewPopover.jsx` and `AppHeader.jsx` to use a reusable two-switch group:
  Hide Panel Headers, Hide Axes & Labels in Workspace. Dock exposes only Hide Axes & Labels;
  use explicit surface applicability, not an inert hidden-header setting. No extra tooltips or
  combined presentation dropdown.
- Update `src/workspace/LeafView.jsx`, `SplitLayout.jsx` and `AudioDataContext.jsx` to consume explicit
  presentation. Use Panel Header in component names/comments/selectors where it denotes that region.
- Extract shared header presentation where useful, preserving workspace tab/action semantics and
  context-menu access. Apply header visibility in fullscreen too.
- Remove presentation use of compact/compactPanels from new internal APIs. Separate Vector's
  minimum-height constraint from header visibility; retain unrelated compact layout terminology.
- Keep Dock panels headerless. Preserve existing module/settings editor access; do not create a
  Dock Panel Header component or reserve space for one.
- Add a Dock Views editor route/action through `accessoryProtocol.js`, Dock accessory state/owner,
  `accessories/DockHeader.jsx`, and the existing editor window. Accessory roots do not own stores.
- Put Hide Axes & Labels, Dock Off / Top / Bottom and Reserve Space in Dock Views. Route the last
  two controls through existing restore/edge/reservation business actions and capability checks.
  Remove their three standalone toolbar buttons; retain other existing functions.
- Add Device to the Dock toolbar and an accessory editor route. Audit the Workspace Device UI and
  state owner, extract/reuse applicable live device controls and route actions to that same owner.
  Carry device availability, selection, pending transitions and errors through accessory snapshots;
  do not mount an independent capture/settings owner in the accessory window.
- Test Workspace's four combinations, Dock's two annotation states and absence of a Dock header
  toggle. Cover Workspace hidden-header recovery, instance-correct settings, stale accessory
  snapshots and editor visibility lifecycle.
- Test Device parity, no reselection/restart on open or surface switch, normal device-change error
  handling, and Views Off/Top/Bottom/Reserve Space parity with the removed buttons. Confirm Off
  dismisses accessory editors and restores Workspace preferences without losing Dock preferences.

Deliverable: applicable presentation controls in each surface, plus Device and consolidated Views
in Dock, preserving the existing device and native-window business behavior.

## 4. Apply annotations policy across shared renderers

- Replace Dock's hardcoded `showAxes={false}` with resolved presentation in Dock Level, Spectrum,
  Stereo Map and Timeline wrappers. Keep one shared chart implementation per panel.
- Extend shared visibility inputs to channel/mode labels in Level Meter, Waveform, Stereo Map and
  every Vector mode. Hide M/ST identically to L/R. Do not blanket-hide every text node.
- Audit Spectrum, Loudness and Spectrogram including 3D label render paths. Preserve peak readouts,
  hover HUDs, Stats, error/empty states, live values and TP Max.
- Remove hidden rails from layout and pointer handling; retain configured grids, reference geometry,
  range settings and plot gestures. Verify no new analysis keys or subscriptions on toggle.
- Rework Vector fit calculations using visible rail heights; keep its correlation indicator and
  geometric proportions. Make `vectorscopeSizing.js` / `dockPanelSizing.js` visibility-aware, using
  measured/shared content requirements rather than another arbitrary compact width.
- Test visible/hidden label branches, retained measurements, TP Max edge protection, axes restored
  in Dock, hidden hit areas, and nonnegative layout calculations at small dimensions.

Deliverable: the same visibility contract works for all panels, independently of surface and header.

## 5. Native verification and documentation

- Through Agent Control, inspect capabilities and retain revision; use supported business APIs for
  every mutation. Capture before/after screenshots with the same repeatable data where possible.
- Review all panels in Workspace's four combinations and Dock's two annotation states. Include Dock Top/Bottom; 56 px,
  128 px and taller heights; narrow/wide panels; at least Small and a larger Interface Size.
- Specifically inspect Level Meter horizontal/vertical and M/ST/Peak modes; Vector all modes and
  correlation width; Stereo Map Position and other modes; Spectrogram heatmap/3D; multichannel labels.
- Verify Views/settings remain reachable, header actions fit or truncate safely, plot/axis gestures
  work as appropriate, and extreme sizes neither overlap labels nor cover toolbar access.
- Verify Dock has no panel headers or header toggle. Inspect Device and Views accessory sizing,
  focus and dismissal; exercise device selection, reservation and Dock Off/Top/Bottom from their
  new locations, including unavailable devices, platform capability limits and stopped capture.
- Repeat Snapshot/Go Live transitions, with capture stopped and running, to catch stuck toolbar and
  single-frame transport regressions. Confirm visibility toggles preserve history/ranges/holds.
- Restart the dev app and inspect saved settings to verify persistence; Vite reload is not evidence.
  Restore temporary review configuration after native checks.
- Update `docs/user/workspace.md`, `docs/user/panels.md`, relevant architecture sections and Agent
  Control prose in the implementation change. Replace claims that Dock always hides axes or keeps
  labels; document surface defaults, Workspace-only Panel Headers, Dock Device and consolidated
  Views (Off replaces Restore). No living links to history.

## 6. Completion gates

- Run targeted tests during implementation, then `npm test`, `npm run format:check`, `npm run lint`,
  and `npm run typecheck` before a requested commit. Run the frontend build to validate compiled
  styles/subgrid and renderer paths. Add Rust checks if native code proves necessary.
- Before a requested push/merge run `npm run check:changes`; do not publish as part of this plan.
- Report native visual evidence, passed checks and any remaining limitations. Implementation was authorized after design review; leave changes uncommitted until requested.


## Verification record — 2026-10-15

- Frontend gate: 506 Vitest files / 5,400 tests passed; formatting, ESLint (no warnings),
  typecheck, production build, version/license/catalogue checks and website validation passed.
- A final screenshot review found crowded horizontal Level Meter labels. Measured label widths
  now suppress colliding interior ticks while retaining endpoints; the final frontend gate was
  repeated after this fix.
- Native gate: Rust fmt and Clippy passed; Rust tests passed (one existing ignored test).
  The first full-gate run hit an MSVC linker failure while building a fixture example. Re-running
  `npm run rust:check` with `CARGO_BUILD_JOBS=1` completed successfully.
- Agent Control captures cover all four Workspace header/annotation combinations, Dock annotations
  on/off at 56 and 128 CSS px, and a Top Dock mode matrix: all three Vector modes, all four Stereo
  Map modes, heatmap/lines/surface Spectrogram, Peak/Short-Term Level Meter and both orientations.
- Native UI exercised Dock annotation and Reserve Space switches, Top and Off transitions, Device
  expansion and selecting the current Automatic device. Opening/selecting did not start capture.
- Snapshot selection/clear completed eight cycles stopped and eight cycles running. This verifies
  the command/state transitions; it does not establish absence of every single-frame visual flash.
- Nondefault Workspace and Dock preferences were inspected on disk and survived a complete process
  restart. Original presentation defaults, bottom Dock at 107 CSS px, reservation and stopped
  capture were restored. Panel controls used by the mode matrix were restored as well.
- Evidence and logs are under ignored `artifacts/dock-review/`: `presentation-full-check.log`,
  `presentation-rust-retry.log`, `presentation-*.png`, `matrix-*.png`, `matrix-result.json` and
  `persistence-after-restart.json`.
- Remaining user review focuses on visual feel, extreme panel proportions/Interface Size choices,
  custom multichannel names and rapid pointer-driven Snapshot/Go Live transitions. Native checks
  were on Windows with the current stereo device; other OS window behavior was not exercised.


## Frequency linking follow-up verification

- Added shared frequency adapters for Dock Spectrum, Spectrogram and Stereo Map, and reused the
  normal frequency range row/link controls in Dock Settings. Frequency visibility and membership
  remain independent. Unlink copies the visible range; rejoin adopts the shared range.
- Stored Dock membership and local ranges round-trip through local and portable Presets.
  Agent Control describes and patches `linkFrequency`, retains local `frequencyRangeHz`, and reports
  the effective frequency viewport. Workspace joins count existing linked Dock participants.
- Final gate: 507 Vitest files / 5,412 tests passed; lint, typecheck, formatting and production build
  passed. No Rust implementation changed in this follow-up.
- Native checks changed the shared range to 100–10000 Hz and confirmed all three Dock panels;
  detached Spectrum, moved the group to 200–5000 Hz, independently set Spectrum to 80–8000 Hz,
  and confirmed group updates still propagate with annotations hidden.
- The actual Dock Settings link button rejoined Spectrum to the 300–6000 Hz group. A complete
  process restart preserved an unlinked Spectrum and its 80–8000 Hz range. Review settings and
  window form were restored afterward. Evidence is in `artifacts/dock-review/frequency-*`.
## Final acceptance — 2026-10-15

- User testing accepted the implementation. The final requested adjustment makes Dock Hide Axes
  & Labels default to Off, matching Workspace; explicit saved choices remain unchanged.
- Defaults, legacy settings, portable Presets and generated Agent Control documentation agree.
- Final verification after that adjustment: 507 Vitest files / 5,414 tests, typecheck, lint and
  formatting passed. User acceptance does not extend the Windows native checks to other platforms.
- No implementation tasks remain in this plan. Branch integration is a separate repository step.
