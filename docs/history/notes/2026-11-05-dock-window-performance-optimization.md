# Dock Window Performance Optimization Acceptance

Date: 2026-11-05 (Asia/Shanghai).
Measured optimized application commit: `848442c4`.
Baseline application commit: `84ed0183`.

## Changes

- The shared reorder hook ignores equivalent ID sequences. It retains deferred canonical-order
  resynchronization when the actual sequence changes, including positional IDs after drag commits.
- Settings retires after a 60-second idle interval, starting only after its client has acknowledged
  outstanding business operations. Reopening cancels retirement; a retired host is recreated using
  the normal readiness handshake.
- Dock entry prepares only the toolbar. The shared panel host is prepared on first panel use.
- After Dock exits, toolbar and panel hosts retire after 60 seconds. Re-entry cancels the timer.
  Preparation and retirement are serialized. Native retirement checks the real Dock flag and destroys
  the hosts on the UI thread; a stale request after native re-entry is refused.
- Theme/Profile/Feedback retain their existing immediate ordered-idle destruction. Presentation,
  editor drafts, geometry ownership, and audio ownership remain shared/main-owned as before.

The lifetime decision is recorded in ADR 0051. Update and Import lifetimes were not changed.

## Repeated Optimized Desktop Measurements

Same process-observation and aggregation method as the baseline investigation: optimized embedded
Windows dev identity, isolated application/WebView data, capture stopped, 24 logical processors.
The core and Profile comparison series each use three independent launches. CPU is whole-machine
capacity equivalent, calculated from process-time deltas; memory is private MiB across the owned
PLVS/WebView2 process tree. CPU profiling runs separately after ordinary measurements.

| Profile scenario    | Baseline idle CPU | Candidate idle CPU | Baseline private MiB | Candidate private MiB |
| ------------------- | ----------------: | -----------------: | -------------------: | --------------------: |
| profile-normal-open |            2.876% |             0.087% |                414.4 |                 291.8 |
| profile-dock-open   |            1.547% |             0.045% |                588.7 |                 432.1 |

All three candidate normal Profile runs were below 0.1% and all Dock Profile runs below 0.05%.
The after-change ten-second authoring JavaScript profile is 99.36% idle by sampled VM time; the
baseline profile was dominated by repeated React/Select rendering. This is corroborating diagnostic
information, not a substitute for the independent process CPU samples.

The minimal production-hook probe also settles: after one normal parent update, the fresh-array
case remained at two renders at both observation points, matching the stable-array control. The
baseline fresh-array case continued from 11 to 21 renders. Drag commit, deferred reset, mid-drag
updates, and consecutive drags remain covered by the hook/editor tests.

## Window Lifecycle Acceptance

- `normal-cold`: 275.7 MiB, renderer counts [1, 1, 1], 3 run(s).
- `dock-first-entry`: 363.5 MiB, renderer counts [2, 2, 2], 3 run(s).
- `settings-closed`: 393.2 MiB, renderer counts [3, 3, 3], 3 run(s).
- `settings-after-idle`: 335.4 MiB, renderer counts [2], 1 run(s).
- `settings-reopened`: 356.4 MiB, renderer counts [3], 1 run(s).
- `settings-reopen-cancels-retirement`: 346.5 MiB, renderer counts [3], 1 run(s).
- `normal-after-idle`: 314.3 MiB, renderer counts [1], 1 run(s).
- `panel-first-open`: 392.1 MiB, renderer counts [3], 1 run(s).

The one-minute deadline was exercised with real elapsed time. Reopening Settings within the warm
interval kept it alive beyond the original close deadline. Reopening after actual retirement
created a fresh ready host. Theme Editor was additionally opened/closed 30 times; closed-cycle page
lists contained no authoring host. Settings can disappear later as its separate idle timer expires,
so closed-stage renderer counts may legitimately fall during recovery.

A final dedicated run opened the shared Sources panel and Settings before leaving Dock, exercising
retirement with both toolbar and panel hosts actually present:

| Dedicated stage                  | Private MiB | Renderer count | WebView pages                                 |
| -------------------------------- | ----------: | -------------: | --------------------------------------------- |
| header-only                      |       365.5 |              2 | dock-header, main                             |
| panel-first-use                  |       407.8 |              3 | dock-editor, dock-header, main                |
| normal-warm-all-accessories      |       509.2 |              4 | dock-editor, dock-header, dock-settings, main |
| normal-retired-all-accessories   |       313.8 |              1 | main                                          |
| panel-recreated-after-retirement |       422.4 |              3 | dock-editor, dock-header, main                |

The final run also reopened retired Settings successfully. Agent Control show-command round trips
were 357 ms for first creation, 102 ms for warm reuse, and 325 ms after
retirement. These include CLI/IPC/handshake overhead and are not pointer-to-first-paint benchmarks.
The warm interval therefore retains a measurable reopen benefit while bounding idle retention.

An earlier final cleanup attempt encountered an expected UI-generation conflict after Settings
recreation. Its stale close was refused. The complete dedicated scenario was rerun in a new isolated
root, with explicit reinspection/reconciliation and UI settling for close operations; the final run
completed without conflicts. The earlier raw result is retained separately for audit.

## Validation and Limits

- Focused hook/editor/Dock/documentation tests: 517 passed. Lint, type checking, Rust formatting,
  and warning-denied Clippy passed before optimized desktop acceptance.
- Added coverage includes equivalent-array settling; positional IDs over consecutive drags; pending
  action acknowledgement before Settings retirement; warm cancellation; fresh Settings readiness;
  panel requests during toolbar preparation; inactive retirement; quick re-entry; overlapping
  retirement/re-entry; native retirement refusal; and no tight creation retry loop after failure.
- Agent Control screenshots of normal and Dock Profile editors were reviewed: the existing rounded
  frame, Reference/rule controls, and footer remain present. Screenshot scales differ from earlier
  historical UI captures, so they are not presented as byte-identical before/after images.
- Baseline and candidate were measured at different times. Absolute memory and low idle CPU vary
  with browser caches, display state, and background activity. Within-run retirement transitions and
  exact page/process counts are stronger evidence than assigning every cross-run MiB difference to
  one change. No fixed memory saving, battery gain, or frame-rate improvement is promised.
- Capture stayed stopped. No capture-layer code changed. Live-load/long soak and macOS desktop
  acceptance were not performed. This round does not add a Preview performance claim.
- All owned optimized test instances were stopped before the final repository gate.

## Local Evidence

- `artifacts/dock-shared-settings/window-performance-after/`: three-run core samples and summaries.
- `artifacts/dock-shared-settings/window-performance-profile-after/`: three-run Profile comparison,
  screenshots, and separate CPU trace.
- `artifacts/dock-shared-settings/window-lifecycle-after-reconciled/`: complete four-to-one renderer
  retirement/recreation acceptance and command timings.
- Corresponding `window-perf-after.mjs`, `window-perf-profile-after.mjs`, and
  `window-lifecycle-after-reconciled.mjs` preserve the measurement drivers under that artifact root.
- `artifacts/dock-shared-settings/reorder-loop-probe-after.json` preserves the post-change logical probe.
- `artifacts/dock-shared-settings/perf-optimization-check-final.log` records the final repository gate.

Raw artifacts are ignored local evidence. The baseline report remains a historical pre-change record.
