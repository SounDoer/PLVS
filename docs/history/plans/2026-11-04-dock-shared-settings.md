# Dock Shared Settings Implementation

Date: 2026-11-04
Branch: `codex/dock-shared-settings`
Worktree: `.codex/worktrees/dock-shared-settings`

Design: [Shared Settings in the Normal Window and Dock](../specs/2026-11-04-dock-shared-settings-design.md).

## Implemented

- Extract shared Settings content and normal/stable presentation frames. Keep the existing normal
  Sheet, including its animation and focus behavior. Keep Settings ownership mounted across forms.
- Keep preferences, Theme/Profile drafts, preview, persistence, Feedback diagnostics/submission,
  file operations, and scene guards in main. No accessory SettingsProvider or audio runtime exists.
- Lazily create one fixed-label `dock-settings` WebView. Reuse it for Settings, Theme, Loudness
  Profile, Feedback, and Saved Items export. Native close uses the existing dismissal decision;
  blur does not dismiss. Inactive content unmounts and stops its subscriptions and publication.
- Use an explicit per-view action allowlist, session IDs, ordered callbacks, duplicate/stale refusal,
  and receipt/completion acknowledgements. Preserve typed values ahead of acknowledgements and
  explicitly encode clearing a Profile threshold. DOM events never enter the wire contract.
- Parent Settings file dialogs to the visible Settings host through the dialog plugin's supported
  API. Keep the operation in main and accessory permissions restricted to event exchange. Waiting
  for a user-paced native dialog no longer produces a false ten-second transport timeout.
- Route Dock toolbar, tray, status, and keyboard Settings entry through the shared owner. Accessory
  keyboard handling reuses the ordinary interpreter without adding native shortcut registrations.
- Suspend Settings presentation for the existing update/import accessories and restore it afterward.
  Quick Tour keeps its ordinary-window prerequisite. Preserve editor guards through form changes.
- Integrate UI/Draft Control, nested discard decisions, dropdown navigation, pointer targets, and
  `visual screenshot --target dock-settings`. Empty child registries clear prior-view surfaces;
  reopened surfaces get fresh IDs, including editing the same saved Theme again.
- Register the existing Dock import review/completion with UI Navigation after native visibility.
  Preserve file versus clipboard origin in its title. Regenerate command docs through tooling.
- Record ADR 0049 and update the corresponding user and Agent Control documentation.

## Verification

- Foundation: 6,368 Vitest tests passed; normal Settings before/after extraction screenshots were
  1600 �� 1000 and pixel-identical. The inherited Tauri marker type issue was fixed separately.
- The native implementation passed the Rust workspace tests (including 854 library tests, with
  three ignored), Clippy with warnings denied, and the embedded dev-identity desktop build.
- The implementation's full frontend run passed 6,381 tests before the last registry/import
  acceptance fixes. Focused regression tests subsequently cover those fixes, native-dialog waits,
  shared controls, reset cancellation, stale/duplicate operations, explicit blank thresholds,
  shortcuts, capability boundaries, and fresh surface identities.
- Windows acceptance uses an embedded build and an isolated `--plvs-test-app-data-root`, avoiding
  Vite reload as evidence of persistence. Theme name Save was checked immediately after typing;
  preview/discard, nested confirmation, and the original Core color were checked after restart.
  Profile name, Reference LUFS, and a rule were saved and read after restarting the app.
- Exiting Dock with a clean open Profile preserves the editor and blocking registration in the
  normal window. Feedback opens/cancels without transmission. Top/bottom Settings, Theme, Feedback,
  and a nested dropdown were inspected through actual native screenshots at 125% display scale.
- Private dev fixtures established update details, import review, import completion, and Library
  Export in Dock. Each settled with exactly its active surface, reset successfully, and allowed
  Settings to be shown again. No update installation, Feedback submission, or real setup reset ran.
- The native configuration Save As dialog is owned by Settings, remains open beyond ten seconds
  without an error, and Escape returns to Settings. The desktop automation helper could not reliably
  address its modal edit control (`element ... is not available in cached app state`), so selecting
  an export destination and completing the native save remain manual acceptance.
- A fresh Dock process had three renderers and 369.80 MB private memory before Settings. First
  opening added exactly one renderer (447.68 MB total); after closing and idling, four renderers
  and 429.40 MB remained. The hidden host therefore has a retained cost of about 60 MB in this run.
- Two batches totaling 60 Settings open/close plus 60 Theme edit/cancel cycles completed without
  stale surfaces. All warmed samples retained 13 processes and six renderers after the update/import
  accessories had also been exercised. Total private memory rose during rapid cycling, then fell:
  586.61 MB warm, 708.34 MB after the first batch, 567.66 MB after idle; after the second batch and
  extended idle it reached 558.34 MB. The final closed 40-second interval used 0.484 process-tree CPU
  seconds. These are bounded Windows development measurements, not a long-run or capture benchmark.
- Artifacts and exact measured samples are under ignored `artifacts/dock-shared-settings/`, including
  `resource-samples.jsonl`, `flow-results.json`, `handoff-results.json`, and native screenshots.

## Remaining platform acceptance

- macOS native focus, file dialog completion, full-screen ordering, and close behavior need a macOS
  runtime. Windows tests do not establish these properties.
- Monitor migration and display scales other than the tested 125% need desktop verification.
- The toolbar gear is rendered and its business route is covered by tests. Actual automated clicking
  was limited by the desktop helper reporting `window bounds changed` followed by
  `unknown screenshotId screenshot-0`; final physical click/shortcut checks remain manual.
- No audio callback, DSP, or capture engine code changed. No hardware smoke/soak or capture-drop
  measurements are claimed by the window lifecycle checks.

The branch is for review; publication and cross-platform release acceptance are separate work.
