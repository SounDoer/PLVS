# Dock Window Performance Investigation

Date: 2026-11-05 (Asia/Shanghai)
Measured application commit: `84ed0183` (`codex/dock-shared-settings`).
Status: investigation and recommendations; production code is unchanged.

## Method and Scope

- Windows 11 Pro 22631, Intel Core i7-13700K, 24 logical processors, approximately 64 GiB RAM.
- Embedded, minified frontend in an optimized Rust release-profile dev-identity executable; no Vite server.
- Two measurement series, each with three independently launched instances and isolated application /
  WebView data. A small existing QA Library was copied with its valid migration marker; the app
  initialized fresh Workspace state. Other user data was not changed.
- Live capture was stopped, confirmed through Agent Control. These are idle-window/lifecycle tests,
  not audio-load, GPU-memory, frame-rate, battery, or long-running leak acceptance.
- Existing `readProcessTree` from `scripts/webview-observability.mjs` observes only the owned PLVS
  process and its WebView2 descendants. Private memory sums private committed pages across that tree.
  Working sets are also recorded but are not summed as unique physical RAM in the conclusions.
- Each settled stage has 8-10 process snapshots, roughly one second apart plus observer overhead.
  Windows settle for 4-8 seconds; recovery gets additional idle time. Memory is the median within
  each stage, then the median across independent runs. CPU uses cumulative process-time deltas over
  the observation interval, divided by elapsed time and 24 logical processors. It is not a peak or
  a guarantee of visible rendering responsiveness.
- Page targets are listed through the isolated WebView2 debugging endpoint without attaching a
  debugger during ordinary samples. The CPU profile was collected separately after its CPU/memory
  measurement. Application mutations use supported Agent Control business paths.
- Early preparation failures (an incomplete copied store and a CLI beside the wrong host identity)
  were corrected before valid samples. They are not included in the results.
- Windows monitor capture failed and accessibility state was unavailable during the Preview attempt.
  Preview was never opened in this run. Intended `preview-open` / `theme-restored` raw stages remained
  Theme-editor idle and are explicitly excluded by the summarizer. No Preview performance claim is
  made. Update and Import event windows were not triggered or benchmarked.

## Core Results

Three-run medians. The process-tree memory figures include main and all owned WebView2 processes.

| Stage                 | Private MiB | Idle CPU, whole-machine equivalent | Renderer processes |
| --------------------- | ----------: | ---------------------------------: | -----------------: |
| normal-cold           |       254.5 |                             0.027% |                  1 |
| dock-first-entry      |       376.3 |                             0.021% |                  3 |
| settings-open         |       408.7 |                             0.013% |                  4 |
| settings-closed       |       396.0 |                             0.020% |                  4 |
| theme-open            |       443.4 |                             0.047% |                  5 |
| theme-closed          |       390.8 |                             0.034% |                  4 |
| theme-after-10-cycles |       420.4 |                             0.048% |                  4 |
| dock-recovery         |       412.3 |                             0.048% |                  4 |
| normal-after-dock     |       421.6 |                             0.014% |                  4 |

`dock-first-entry` creates two additional renderers, even before opening a toolbar panel. Opening
Settings adds another renderer; closing Settings leaves it warm. Theme Editor adds a renderer and
closing it removes that renderer and its `dock-authoring` page. After exiting Dock, the toolbar,
small-panel host, and Settings host remain, explaining the higher normal-window footprint.

Theme Editor was additionally opened/closed ten times in each core run (30 cycles total). Every
post-close observation had four renderers and the same four pages: main, dock-header, dock-editor,
and dock-settings. Settings was cycled ten times in the first run; all post-close observations also
had four renderers. Neither sequence accumulated accessory pages or renderer processes.

Some private memory remained above early-session levels after cycling. In the Settings cycle series
it rose from about 398 MiB to about 437 MiB, then ended around 434 MiB; the subsequent recovery stage
was around 421 MiB. This is compatible with warm heaps/caches and is not proof of a leak or proof that
no leak exists. Do not equate a window's destruction with an immediate return to cold-process RAM.

Profile and Feedback close also removed their authoring renderer in the first core run. Feedback
was approximately 434 MiB open / 386 MiB closed, with idle CPU below 0.1% in both stages. Profile's
higher idle consumption prompted the separate comparison below.

## Reproducible Profile Editor Idle Work

The follow-up series opens the same saved Profile in the normal window, transfers it into Dock,
closes it, and opens Theme Editor as an additional control. Settings is never opened in this series,
so its window/process counts and memory must not be directly compared as identical layouts with the
core series.

| Stage               | Private MiB, median | Idle CPU, median | Renderers |
| ------------------- | ------------------: | ---------------: | --------: |
| normal-cold         |               254.3 |           0.041% |         1 |
| profile-normal-open |               414.4 |           2.876% |         1 |
| profile-dock-open   |               588.7 |           1.547% |         4 |
| profile-dock-closed |               362.6 |           0.027% |         3 |
| theme-dock-control  |               400.4 |           0.027% |         4 |
| dock-recovered      |               338.9 |           0.027% |         3 |
| normal-after-dock   |               362.6 |           0.013% |         3 |

Normal-mode Profile idle CPU was 2.876%, 3.011%, and 2.455%; Dock Profile was 1.584%, 1.547%, and
1.545%. These correspond to roughly 69% and 37% of one logical CPU at the medians. The principal
consumer in the initial Dock sample was the authoring renderer, not the native host or GPU process.
Closing it returned CPU to the low idle range and removed the renderer.

A separate ten-second CPU profile shows repeated React rendering and Select-item work while no
input occurs. The deferred rule-order synchronization callback is present in the captured stack.
Source inspection identifies a feedback cycle:

1. `LoudnessProfileEditor.jsx:423` creates a fresh `ruleIds` array on each render.
2. `usePointerReorder.js:45-61` depends on that array's identity and defers `setOrderedIds(ids)`.
3. After an ordinary rerender supplies a new array, that state update rerenders the editor, creating
   another equivalent but differently identified array and scheduling the next update.

A minimal jsdom probe imports the unmodified production hook, then triggers one ordinary parent
update. Fresh equivalent arrays yielded 11 renders after 150 ms and 21 after 300 ms; a stable array
stayed at two renders. This is a logical reproduction of the loop, not a desktop timing benchmark.
Together with the native CPU comparison and call stack, it gives a concrete first optimization target.
A production fix still needs before/after desktop measurements to establish its actual benefit.

## Recommended Order

1. **Fix shared Profile rule-order synchronization first.** Treat equal ID sequences as unchanged;
   preserve canonical resynchronization after a drag and changes to the rule list. Cover settling
   after unrelated parent updates, drag commit/cancel, and adding/removing rules. Repeat the normal /
   Dock measurements against this exact baseline. This addresses active CPU work in both modes.
2. **Add bounded idle reclamation for Settings.** For example, keep it warm for 30-60 seconds after
   close, then destroy it once all acknowledged actions settle. Cancel retirement on reopen. Reuse
   the existing orderly authoring-retirement pattern. Measure actual memory reduction and reopening
   latency before choosing the final delay; no fixed MiB saving is promised yet.
3. **Create the Dock small-panel host only when first used.** Keep the frequently used toolbar ready.
   Also consider reclaiming both toolbar/panel hosts after leaving Dock and reaching a safe idle
   point. This targets the measured first-entry and post-Dock retained footprint. Verify first-open
   readiness, quick mode switches, and any local pending interaction before retirement.
4. **Audit Update/Import for idle destruction later.** They are low-frequency candidates, but were
   not measured here. Do not retire active installation, download, or import work. Measure their
   real cost before assigning a quantitative benefit.

Keep the working on-demand authoring destruction mechanism and shared ordinary/Dock editor
presentation. Do not change window appearance or merge editor flows merely to reduce window count.

## Local Evidence

- `artifacts/dock-shared-settings/window-perf.mjs`: core measurement driver.
- `artifacts/dock-shared-settings/window-perf-profile.mjs`: Profile comparison and CPU profiling.
- `artifacts/dock-shared-settings/window-perf-summary.mjs` and `window-perf-profile-summary.mjs`:
  aggregation, including the explicit Preview exclusions.
- `artifacts/dock-shared-settings/window-performance/{results,summary}.json`: full core samples.
- `artifacts/dock-shared-settings/window-performance-profile/{results,summary}.json`: follow-up samples.
- `artifacts/dock-shared-settings/window-performance-profile/profile-dock-idle.cpuprofile`: CPU trace.
- `artifacts/dock-shared-settings/reorder-loop-probe.mjs` and
  `window-performance-profile/reorder-loop-probe.json`: minimal loop reproduction.

Raw artifacts are ignored local evidence, not portable committed fixtures. All owned test app
processes were stopped after measurement. No capture rig, Library item, or application setting in
user data was modified.
