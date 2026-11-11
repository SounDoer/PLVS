# File Mode Workflow Refinement Implementation Plan

**Date:** 2026-11-10  
**Status:** Implementation in progress  
**Spec:** [Final design](../specs/2026-11-10-file-mode-workflow-refinement-design.md)  
**Audit:** [Implementation findings](../notes/2026-11-10-file-mode-implementation-audit.md)  
**Starting revision:** `e5a312aca944c5497d4ef5588b1b537a4452df52`  
**Existing worktree:** `C:\Users\shenxichen\repos\PLVS\.codex\worktrees\file-mode-review-20261110`  
**Existing branch:** `codex/file-mode-review-20261110`

## Implementation progress

| Stage                                      | State                          | Evidence                                                                                                                                                                                             |
| ------------------------------------------ | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Live/File reset isolation               | Implemented in `1dd9f2fa`      | Provider regressions, settings tests, typecheck and lint passed                                                                                                                                      |
| 2. Successful result / replacement staging | Core implemented in `fb7f29b1` | Retained result/export, history routing and coherent display replacement tests passed; desktop acceptance remains                                                                                    |
| 3. Frozen conditions / attempt isolation   | Implemented in `3dd923ef`      | Deferred probe cancellation, stale same-path events, final-frame settlement, stop failure and request snapshot tests passed; native validation test and compile passed                               |
| 4. Source/track identity and metadata      | Core implemented               | Track picker/import/replacement regressions passed (59 frontend tests), typecheck passed, real FFmpeg file-analysis smoke passed (28 native tests); fingerprint timing and desktop acceptance remain |
| 5. History accounting and restore          | Core implemented               | 483 focused frontend tests, typecheck and native CLI parsing passed; memory baseline recorded and Windows File decode verified. Real desktop eviction/restore and process memory acceptance remain.  |
| 6. Complete reports and Profile evaluation | Core implemented               | 263 focused frontend/contract tests and typecheck passed; 159 native CLI tests passed. Version 3 removes paths and adds measurement reasons.                                                         |
| 7. Pill, file region and summary settings  | Core implemented               | 103 focused tests and typecheck passed; Windows normal and 431 CSS-px captures verified readable columns and +N. Live pill pixels match apart from two subpixel differences.                         |
| 8–9                                        | Pending                        | No completion claim                                                                                                                                                                                  |

Stage 4 integration and focused verification completed in `86c861e7`. Stage 5 retains all results
and implements the measured File-only history target and explicit restore. See the
[history validation record](../notes/2026-11-11-file-history-budget-validation.md). Windows dev-app
baseline captures are in `artifacts/file-mode-history/before-live-ready.png` and
`artifacts/file-mode-history/before-file-result.png`. The restart acceptance exposed overlapping
first-run prompts, fixed separately in `5640ebf6`. No push or merge has been performed.

## Execution rules

- Work in the existing authorized worktree; do not switch the primary checkout or create another
  branch silently. Read AGENTS.md and relevant pitfalls before changing each area.
- Live behavior/components are the baseline. Do not change Live defaults or enable location
  tracking there as a side effect. Reuse the existing numerical DSP and shared presentation.
- This is a sequential dependency plan. No subagents or new chats are required by this document.
- Use focused, meaningful behavior tests while implementing. Keep commits coherent with scoped
  Conventional Commit messages and normal pre-commit checks; do not rerun the full gate per commit.
- Update relevant current documentation and contract coverage as each behavior lands. Do not leave
  user docs/Agent Control synchronization until an unrelated final documentation sweep.
- New module names below are suggested seams, not requirements to introduce extra abstractions.
  Retain current runtime/persistence ownership and the src/ipc audio boundary.
- The implementer chooses technical structures, field names, migrations, encoding, identity
  mechanisms and test-derived budgets. Escalate material product changes, not routine details.

## Baseline and completed prerequisite

- [x] `7bbb03c1`: whole-file per-channel Sample/True Peak Max and real all-channel Sample Peak Max.
- [x] `e5a312ac`: File-opt-in first maximum locations, M/S window ends, native/frontend/CLI reports.
- [x] Source audit: 114 existing related tests plus five temporary current-behavior diagnostics.
- [ ] Carry outstanding exact-candidate hardware acceptance and four-hour soak through final
      validation. Do not interpret the completed code commits or local microbenchmarks as a pass.

Read [location validation](../notes/2026-11-10-file-maxima-locations-validation.md) before touching
these paths. Preserve location coordinates, ties, negative boundary positions, and numerical tests.

## Dependency order

```text
1 Safety isolation
  -> 2 Successful results and attempts
  -> 3 Accepted run conditions and task identity
  -> 4 File/track/source identity
  -> 5 History accounting and restore

3 + 4 -> 6 Complete normalized results, reports and evaluation
2 + 3 + 4 + 5 + 6 -> 7 Pill, file region and summary settings
4 + 6 + 7 -> 8 Statistics CSV and selection flow
1..8 -> 9 End-to-end acceptance and publication readiness
```

Tasks 4 and 6 can be developed in smaller coherent slices, but do not expose the final UI against
temporary result ownership or path-only event identity. Keep each intermediate commit runnable.

## 1. Isolate File from Live-only automatic resets

Primary files: `src/runtime/SourceActionsContext.jsx`, `src/hooks/useDialogueEngineRestart.js`,
`src/runtime/AnalysisSessionContext.jsx`, and their existing tests.

- [ ] Add regression coverage for detector changes with completed and running File entries:
      selection/results survive, no implicit Clear/stop/remove; existing Live reset still occurs.
- [ ] Scope the automatic restart policy to Live without changing explicit Clear semantics.
- [ ] Decouple File Snapshot/viewport effects from Live History Length. Preserve Live's own reset
      behavior and apply the changed preference normally on return to Live.
- [ ] Test File zoom, scroll and Snapshot preservation after Live retention changes, including
      known/unknown duration and source switches.
- [ ] Correct Settings help claiming Stats visibility enables detection; current runtime always
      enables detection. Add no new toggle. Update matching user documentation.

Focused checks: `SourceActionsContext`, `useDialogueEngineRestart`, `AnalysisSessionContext`,
and affected `SettingsContent` tests. Use behavior tests through the providers for the destructive
case; the existing hook-only test did not expose the File clear binding.

Exit: changing a Live-oriented setting cannot implicitly delete or reset File results/view state;
Live regression behavior remains tested. Suitable commit scope: `fix(file)`.

## 2. Separate successful result, current attempt, and history availability

Primary files: `src/lib/fileAnalysisSessionRegistry.js`, `src/hooks/useFileSessionLedger.js`,
`src/runtime/MeterRuntimeContext.jsx`, `src/hooks/useIntakeRouting.js`,
`src/hooks/useFileAnalysisEngine.js`, `src/runtime/DisplaySnapshotContext.jsx`.

- [ ] Define an entry with stable file/track identity, immutable successful-result provenance,
      optional resident history, and a separate transient attempt/outcome. Keep wire/public
      projections explicit instead of exposing internal stores.
- [ ] Stage rerun frames in a new intake. Keep old summary/history attached to the displayed result
      until the new successful completion is ready, then replace coherently.
- [ ] Preserve export eligibility during running/failed/cancelled attempts with a previous success.
      First-run partial data never becomes exportable success.
- [ ] Represent first-run cancellation distinctly from empty/failed/ready, while preserving any
      compatible public CLI lifecycle mapping intentionally.
- [ ] Keep per-file selection and other-file background pumping isolated. Completion/failure must
      not change the active selection.
- [ ] Update Agent Control transport projections, action settlement predicates, report eligibility,
      and tests alongside model changes. Do not leave its existing state matching on old assumptions.

Focused checks: registry/ledger/runtime/routing/engine hook tests and Agent Control transport/report
tests. Cover cancel and fail after success, first-run cancel, late tail frames, switching active
entries, selected Snapshot during rerun, and exports referencing the retained result.

Exit: no path destroys a successful result merely because a replacement attempt started or failed.
Suitable commit scope: `refactor(file)` followed by behavior-sized `fix(file)` commits as needed.

## 3. Bind accepted conditions and isolate asynchronous attempts

Primary files: `src/runtime/SourceActionsContext.jsx`, `src/runtime/useRuntimeBackendSync.js`,
`src/runtime/MeterRuntimeEngines.jsx`, `src/hooks/useFileAnalysisEngine.js`, `src/ipc/commands.js`,
`src/ipc/events.js`, `src/ipc/types.js`, `src-tauri/src/ipc/commands.rs`,
`src-tauri/src/ipc/types.rs`, `src-tauri/src/file_analysis/session.rs` and `types.rs`.

- [ ] Inventory actual inputs that affect whole-file metrics and computed visual request keys:
      track, detector/configuration, roles/layout and analysis requests. Separate presentation-only
      changes and export-time Profile evaluation. Reuse Live's normalization/resolution logic.
- [ ] Send/acknowledge one accepted File run specification; persisted provenance must describe the
      conditions actually used, including changes made while probing. Do not change Live's global
      configuration synchronization merely to add a File shortcut.
- [ ] Carry attempt identity through progress, frames, completion and errors. Path/track alone is
      insufficient. Reject late or duplicate terminal events and define final-frame settlement.
- [ ] Guard the shared task slot synchronously through probe/start/stop. Cancel during deferred
      probing must prevent later startup; a new task cannot start before stop acknowledgement.
- [ ] Distinguish missing computed-view evidence from altered whole-file conditions and from
      memory-released history. Derive warnings from actual accepted conditions/available keys.
- [ ] Update IPC/Agent Control schemas, mappings, capability declaration, CLI contracts, handlers
      and relevant generated discovery using the documented generators when their surfaces change.

Tests: deferred promises for probe/start/stop, rapid cancel/retry of one path, different tracks on
one path, out-of-order progress/final frames, duplicate completion, stop failure, settings changed
mid-probe/mid-run, settings reverted, and display/Profile changes that require no new calculation.
Retain native File versus Live numerical/conformance checks.

Exit: one truthful provenance record per successful run; stale messages cannot publish another
run's result, and no cancellation reports success before task retirement. Scope: `fix(file)`.

## 4. Implement track import, source versions, layout and actual duration

Primary files: `src-tauri/src/file_analysis/ffmpeg/probe.rs`, `probe.rs`, `types.rs`, `session.rs`,
`summary.rs`, `src-tauri/src/cli_analyze.rs`, frontend File IPC/actions/runtime/ledger,
`src/lib/fileAnalysisDisplay.js`, and shared Dialog/row components.

- [ ] Preserve track name, language, default disposition, source layout, and meaningful source
      depth/sample format. Keep source metadata distinct from inferred/calculation layout.
- [ ] Add Select Audio Track only for multi-track Open/drop: existing Source-style single-select
      rows, shared Dialog/footer, default-first selection, confirmation and cancellation semantics.
      No extra track button or all-track batch action.
- [ ] Reanalyze/Retry retain the selected track. Unchanged file+track reimport selects an existing
      entry; another track creates an independent entry with legible list identity.
- [ ] Implement robust source/version identity. Do not equate same basenames or treat path equality
      as proof of unchanged content. Measure fingerprinting overhead and document the strategy.
      Detect change during import/analysis/restoration before committing incompatible evidence.
- [ ] Modified/replaced sources create new entries even via Reanalyze. Missing sources explain
      inability to read without losing old results, exports or resident history. No relink wizard.
- [ ] Reuse Live's channel resolver; snapshot the effective roles/labels/layout for each success.
      Remove independent File count-only labels; explain inference/unknown fallback.
- [ ] Derive final duration from decoded frames/sample rate in both GUI and headless paths.
      Keep declared duration only as progress/range estimate; unknown estimates are indeterminate.
      Define/test a sensible discrepancy threshold, including ordinary container/audio differences.
- [ ] Synchronize explicit track/source behavior with CLI/Agent Control rather than forcing native
      pickers into headless commands. Document deliberate compatibility changes.

Tests/fixtures: single-track WAV/FLAC/lossy sources, multi-audio media with defaults/languages/names,
unknown/custom layouts, 1/2/6/8+ channels, missing metadata, wrong/unknown declared duration, exact
tail sample counts, same path replaced, alias/canonical paths, source removed/changed while running,
same/different track reuse, and picker cancellation leaving the previous result untouched.
Run the relevant native tests and `npm run smoke:file-analysis` as applicable.

Exit: every entry identifies one source version/track and reports its actual calculation conditions
and duration. Scope: `feat(file)` / `fix(file)` by coherent slice.

## 5. Measure history storage and implement retention/restore

Primary files: `src/lib/FrameIntake.js`, scalar/visual history stores and indexes, ledger/runtime/
routing, `src/hooks/useFileAnalysisEngine.js`, and shared panel empty-state components. Add focused
accounting/policy helpers rather than scattering eviction into panels.

- [ ] Measure actual allocated history buffers, visual families and query indexes, including
      capacity slack, shared ownership and old/new staging. Avoid double-counting views or claiming
      exact process RSS from retained-array estimates. Release references used by caches/snapshots.
- [ ] Record fixtures/configuration, retained estimates, process/WebView observations and peak
      memory in a new validation note. Cover many short files, several long files, multichannel,
      multiple request keys, unknown duration, retained Live history and reanalysis.
- [ ] Choose an internal budget from that evidence, preserving current-file and active-task
      history. Test deterministic eligible least-recently-viewed eviction, target exceedance by
      protected data, and no eviction due solely to background completion becoming most recent.
- [ ] Remove the five-entry result limit only when statistics/history separation and accounting
      are ready. Eviction removes browsing history, never complete statistics/provenance.
- [ ] Add released-history state and instrument explanation/Restore History action. Selection alone
      must not start work. Keep report/CSV access independent of resident history.
- [ ] Restore using the original source version/track/conditions, publishing history only on valid
      completion. Preserve result and released status after fail/cancel; changed sources cannot
      restore old history. Use the same task-slot/identity machinery rather than a parallel worker.
- [ ] Test unknown-duration histories and shared request-key retention; do not silently truncate
      file coverage or substitute Live History Length for the new policy.
- [ ] Update transport inspection/navigation/restore contracts and user guide with actual behavior.

Exit: selected/protected history never disappears unexpectedly, evicted results remain exportable,
and the budget has reproducible measurements. Scope: `feat(file)` with measured validation record.

## 6. Normalize complete results, evaluation, and five-chapter reports

Primary files: `src/lib/fileAnalysisReport.js`, `fileAnalysisReportMarkdown.js`,
`src/hooks/useFileAnalysisReportExport.js`, `src/lib/loudnessProfileEvaluate.js`,
`src/lib/activeLoudnessProfile.js`, `src-tauri/src/cli_report.rs`, `cli_analyze.rs`, and
`src/agentControl/handlers/transport.js`.

- [ ] Establish shared complete-result and unavailable-reason mapping for summaries/reports/CSV.
      Derive reasons from evidence, not null alone; preserve no-dialogue/detector-failure/silence/
      insufficient-data distinctions and unsupported whole-file rule evaluation.
- [ ] Aggregate Profile result/counts per metric with the spec's precedence. Keep effective rules,
      saved/preview/off state and thresholds sufficient to reproduce interpretation. Reuse the
      evaluator without changing Live's established status semantics.
- [ ] Render the five chapters and stable off/empty Profile case. Group repeated Markdown causes;
      JSON retains per-metric reasons and precise technical provenance.
- [ ] Omit full local paths in all export routes. Review/report schema and CLI compatibility,
      migrate/version intentional breaking changes, and keep GUI/copy/CLI renderer parity.
- [ ] Bind exports to the chosen successful result and export-time Profile, even during reruns.
      No current-setting-difference or cancelled-task noise in the exported report.
- [ ] Incorporate existing channel peaks/locations and actual duration/source specs; render source
      identities and untrusted names/metadata correctly in Markdown/table contexts.
- [ ] Keep the three direct report menu actions; no new format/settings panel, path toggle or PDF.
- [ ] Update File/report/CLI documentation and contract tests in the same implementation slice.

Tests: all evaluation precedence/count combinations, multiple rules on one metric, no-rule/off/
preview cases, unavailable/unsupported metrics, raw precision versus display rounding, names with
Markdown delimiters, path omission across formats, result selection during reruns, known/unknown
layouts, dialogue failure and empty evidence. Verify native/headless/Agent Control parity.

Exit: a report is self-contained, complete, provenance-correct and independent of UI metric choices.
Scope: `feat(file)` with compatibility changes explicit in durable docs.

## 7. Build the agreed pill, file region, menu and summary preferences

Primary files: `src/components/AppHeader.jsx`, `SourceTransportCluster.jsx`,
`FileAnalysisSummary.jsx`, `FileAnalysisHistoryMenu.jsx`, `src/lib/sourceTransportState.js`,
`src/hooks/useSourceTransportActions.js`, `src/lib/fileAnalysisDisplay.js`, settings/persistence/
configuration owners, and UI Navigation/Agent Control surface catalogs.

- [ ] Capture before screenshots through Agent Control for existing states before rendering changes.
- [ ] Implement the final pill matrix, Snapshot Result priority, disabled task starts while busy,
      active-file/background routing, Retry and first-cancel outcomes. Preserve Live geometry/actions.
- [ ] Keep Source disabled in its toolbar slot; remove separate Open File. Confirm all picker/drop
      paths use business guards and preserve previous selection on import cancellation.
- [ ] Merge filename/history trigger, two-line metadata + info icon, per-row action icons/report
      submenu, header Clear All/statistics entry, and stable previous-result/activity/warning details.
- [ ] Extract/reuse the existing HelpPopover preview/pin primitive if necessary; retain Live help
      behavior. Provide Escape/outside/keyboard access, copy/select and bounded scrolling.
- [ ] Add the ten-metric catalogue with default three, global settings persistence, normal config
      export/import/reset and multi-instance notification paths. Exclude it from Presets/Stats state.
      Test zero selection, normalization of unknown/duplicate IDs, order/reset and old configurations.
- [ ] Reuse SortableStatsList and settings header/reset components. Implement intact columns and
      deterministic +N overflow without shrinking numbers. Expose unavailable/maximum details and
      the two per-channel Peak tables with result-bound labels/locations and accurate ties.
- [ ] Register new navigable/transient surfaces and methods through existing UI/Agent Control
      contracts. Preserve existing blocking-editor guards; do not invent a Save/Cancel editor for
      immediately applied summary preferences or a plain selection dialog.
- [ ] Update glossary and affected user docs; use established Title Case labels and aria conventions.

Tests: pure state matrix plus provider/component integration, row-target identity, failed reruns,
background cancellation, hover/pin focus/dismissal, Restore versus Reanalyze, missing new view versus
released history, preferences/Preset independence, and desktop restart persistence.

Exit: screenshots at narrow/normal widths across Interface Sizes and appearances show intact values,
reachable actions and stable rows; pointer hover/scroll/focus behavior works using actual input
where Agent Control cannot test it. Scope: `feat(file)` by complete user-visible surface.

## 8. Add the unified statistics CSV flow

Primary files: file-menu header, shared item-picker primitives, `src/ipc/fileDialog.js`,
`src/hooks/useFileAnalysisReportExport.js` or a dedicated export owner, shared result/evaluation
helpers, and proposed `src/lib/fileAnalysisStatisticsCsv.js` with co-located tests.

- [ ] Open one selection dialog directly from Export Statistics. Default-select eligible successes,
      allow one/many, disable zero, keep unavailable attempts ineligible and retained successes
      eligible. Do not add a row CSV action or extra type-choice dialog.
- [ ] Capture selected successful-result identities and effective Profile coherently for one export,
      so concurrent completion/selection changes cannot mix versions or Profile states across rows.
- [ ] Implement the wide table: file/track/version metadata, complete whole-file values/locations,
      channel groups through the selected maximum channel count, per-row labels, and explicit
      unavailable reasons distinct from nonexistent channels.
- [ ] Include Profile name/mode, overall verdict/counts, full per-metric rules and verdicts on every
      row. Reuse step 6 evaluation; do not make CSV depend on a companion report.
- [ ] Use numeric values/seconds with units in stable headers, empty unavailable value cells,
      deliberate timestamp/precision conventions, path omission, and tested CSV quoting/encoding.
      Verify spreadsheet treatment of nonnumeric metadata, including formula-like names, without
      corrupting measurement numbers or losing source identity.
- [ ] Save through existing native dialog/write operations and report failures consistently.
      Decide and synchronize the Agent Control statistics-export surface through the standard
      contract workflow, reusing the same business exporter rather than a second implementation.
- [ ] Update File/CLI docs, glossary if needed, PRD's general-export boundary and privacy review
      required by docs/website-and-sharesets.md. Avoid release-only README/website summary churn.

Tests: mixed 1/2/6/8+ channel counts/layouts, repeated file names/different tracks or source versions,
single selection, unsaved Profile, off/no rules, multiple rules and unsupported metrics, unavailable
dialogue, held results during rerun, rows extracted independently, Unicode/commas/quotes/newlines,
cancelled save and write errors. Parse exports with an independent CSV reader and inspect a small
fixture in a spreadsheet application when available; do not require a connector for unit tests.

Exit: one entry point yields a self-contained comparable table for one or many successful results.
Scope: `feat(file)`.

## 9. Final integration, hardware and delivery checks

- [ ] Run end-to-end scenarios: Open/drop -> track choice -> analyze -> scrub/Result -> rerun ->
      cancel/fail/retry -> source change -> eviction/restore -> reports/CSV. Include background
      selection, settings changed during probe/run, and unchanged-file/track reuse.
- [ ] Compare Live before/after behavior: start/stop, Snapshot, detector reset, retention, labels,
      preferences/Preset behavior, measurement API and untracked location path. Confirm no accidental
      Live memory-budget setting or new high-rate API fields were introduced.
- [ ] Use Agent Control capabilities -> inspect/ui inspect -> owning command -> screenshots for
      desktop state and visual checks. Diagnose identity/version/availability before fallback.
      Use actual input only for hover/drag/scroll/focus or a confirmed capability gap, stating why.
- [ ] Verify themes/Interface Sizes, high channel counts, long names, zero/all summary choices,
      overflow, warnings, dialogs and no-history views. Verify persistence after full app restart.
- [ ] Re-run applicable file smoke, EBU/numerical suites, Rust checks and frontend/contract suites
      after final changes. Select tests by complete scope; do not weaken tolerances or stale-event
      assertions to obtain green results.
- [ ] Run exact-candidate leased capture validation through the repository scripts for DSP/engine
      changes. Wait for a busy lease. Fix harness/rig failures; never bypass red capture smoke.
      A clean-source prerequisite must be satisfied normally, without hiding pending changes.
- [ ] Run/recommend `npm run soak:capture` (four hours); review drift against complete same-platform
      runs rather than only the absolute limit. Record platform/SHA/fixtures and unverified limits.
      This project is not a release dispatch; full stable-release rules apply if one is later requested.
- [ ] Record memory measurements, budget justification and source-fingerprint/restore costs. Compare
      default Live performance to baseline; investigate regressions rather than claiming zero overhead.
- [ ] Reconcile living docs and generated discovery through supported tools, plus any architectural
      ADR needed for result/history separation or source identity. Historical records are not living
      documentation references.
- [ ] After the final intended commit, run `npm run check:changes` once before push/merge and run its
      selected gates. Changes/rebase/amendments invalidate that result. Do not push/merge as an
      implicit consequence of completing this plan.

Deliver: coherent implementation commits, updated current docs/contracts, before/after screenshots,
memory/performance evidence, export fixtures and checks, and a concise statement of any remaining
hardware or cross-platform acceptance. Time-series/Live API scope stays deferred.

## Planning validation

For this documentation-only preparation, run Prettier on the spec/plan and repository documentation
structure tests. No full frontend/native gate is needed merely to write this plan. Preserve the
audit as a dated baseline record; do not rewrite its historical findings to pretend fixes landed.
