# Dock Shared Settings Implementation

Date: 2026-11-04
Branch: `codex/dock-shared-settings`
Worktree: `.codex/worktrees/dock-shared-settings`

Design: [Shared Settings in the Normal Window and Dock](../specs/2026-11-04-dock-shared-settings-design.md).

## Completed foundation

- Extract Settings sections and their behavior into `SettingsContent.jsx`. Keep `SettingsPanel`
  as the normal-window adapter, using `SettingsSheetFrame` with its existing markup and animation.
- Add a stable `SettingsWindowFrame` for subsequent native-host integration. It displays the same
  content and does not close on blur. It is not yet an exposed native Dock window.
- Keep `AppSettingsOverlays` ownership mounted across normal/Dock form changes, while restricting
  its existing presentation and paste handling to normal form. Preserve the existing Dock-entry
  scene guards; no authoring draft is discarded to permit a transition.
- Move Feedback authoring, diagnostic capture, and submission into `useFeedbackDraft`. Its content
  can unmount without losing the draft or its scene guard. Canceling a session invalidates pending
  diagnostic results; duplicate submissions are guarded synchronously.
- Collect Settings, Theme, Profile, and Library Export view properties separately from rendering,
  preparing an explicit accessory adapter without copying the control definitions.
- Fix the inherited Tauri environment-marker type error so the worktree passes type checking.

## Remaining implementation

1. Add one lazily created native Settings accessory with explicit main-owned action dispatch,
   readiness/session acknowledgement, stale-draft rejection, and visible error handling.
2. Complete the Windows/macOS vertical slice: Settings section navigation, a native file-picker
   round trip, and Theme create/preview/save/cancel/discard. Verify typing immediately followed by
   Save and portal/focus behavior before extending the adapter.
3. Adapt Profile authoring, Feedback, and Library Export. Coordinate with existing import and update
   accessories so one flow has one visible presentation, and preserve explicit normal-only paths.
4. Route toolbar, tray, shortcut, status, and About entry points through one host-selection action.
   Expose the Dock Settings gear only once all reachable paths are usable.
5. Complete Agent Control navigation/settlement, Draft Control decisions, target geometry, and
   screenshot support for the accessory. Follow the contract synchronization checklist.
6. Validate native lifecycle, multi-monitor/DPI behavior, and resource stability; record the host
   decision in an ADR and update user documentation with the completed behavior.

## Foundation validation

- Full Vitest run: 592 files passed, one skipped; 6,368 tests passed, two skipped.
- Focused tests cover shared sections/control parity, semantic section navigation in the stable
  frame, Settings ownership across form changes, Feedback draft/scene-guard lifetime, cancellation
  during diagnostic collection, and duplicate submission.
- Frontend build, ESLint, and TypeScript checks passed.
- Agent Control captured the normal Settings surface at the original baseline and after extraction
  in the worktree's isolated dev app. Both captures are 1600 × 1000 and pixel-identical (zero changed
  pixels). Files are under ignored `artifacts/dock-shared-settings/`.
- This stage adds no native window and claims no Dock resource measurements or macOS verification.
  Native acceptance remains outstanding; the feature is not ready to publish.
