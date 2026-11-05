# Dock Branch Main Synchronization and Readiness

Date: 2026-11-05 (Asia/Shanghai).

## Integration

The feature branch was rebased onto local `main` at `12f2c2c0`, incorporating three missing commits:
the themed scrollbar/selection/tooltip work, its Tauri probe typing fix, and Dock context-name tips.
Origin was fetched and local main had no missing origin/main commits.

The old feature-side Tauri probe typing commit was dropped because main already provides the
structural parameter annotation and ambient Window declaration. The Settings conflict was resolved
by retaining the shared content/presentation split and moving main's themed update-error HoverTip
into `SettingsContent`. Both normal and Dock frames therefore use the same footer implementation.

The complete rebase range-diff was inspected. Other feature changes replayed unchanged, apart from
the expected Dock-header test context adjustment. Main's Theme/Profile button HoverTips, Dock
context truncation tips, global themed scrollbars, and selection rules remain present.

Two regression cases now cover update-error tips in both Settings frames, including absence of a
native title attribute. Focused Settings/editor/header/transport/reorder tests passed before desktop
acceptance; the additional shared-footer cases also passed.

## Windows Desktop Acceptance

An embedded dev-identity build of rebased `d958cf7b` ran against isolated application data:

- Normal and Dock Settings both retained the ordinary 336 CSS px width. Their screenshots were
  reviewed, including the themed scrollbars.
- Palettes remained bounded with header/tabs/footer visible. Normal-mode Preview close restored a
  byte-identical complete window screenshot, including its scroll position.
- Dock Preview hid the editor and left the outer area transparent. Closing it restored identical
  header/body pixels and scroll position. The Preview button's hover appearance differed in the
  footer, so the Dock screenshot is not claimed to be byte-identical.
- An unsaved Theme draft and open Preview survived Dock-to-normal and normal-to-Dock transfers.
  The draft document and draft generation remained unchanged. The exact draft was saved through
  the supported editor-draft path.
- The Profile editor and Dock Settings reopened normally after authoring retirement.
- Sources and Settings were opened before leaving Dock. After the real one-minute warm interval,
  renderer count returned from four to one. Reopening Settings and Sources recreated ready hosts.
- The native app was restarted against the same isolated data root. Reopening the saved Theme
  confirmed the changed Primary Data color persisted and the draft was clean. No Vite reload was
  used as persistence evidence.

An immediate screenshot request during the first native host handoff returned `targetUnavailable`;
after inspecting the new form and waiting for readiness, capture succeeded. This was an observation
made before the accessory was ready, not a business mutation or an editor failure.

Local screenshots, capabilities, saved/restarted draft snapshots, and lifecycle records are under
ignored `artifacts/dock-shared-settings/main-sync-*`. All owned test processes were stopped before
the final gate. Final repository-gate output is recorded in `main-sync-check-final.log` there.

## Remaining Platform Scope

This acceptance is Windows-only. macOS desktop behavior, full-screen Spaces, and mixed-DPI monitor
migration are not claimed as tested. The repository's native CI includes macOS compilation/tests
for pull requests or main pushes; those remote checks were not run in this local integration step.
Cross-platform desktop release acceptance remains separate from this branch's local merge checks.

This step synchronized and validated the feature branch; it did not merge into or push main.
