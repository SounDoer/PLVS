# File Mode Implementation Audit Against the Active Design

Date: 2026-11-10
Design: [File Mode Workflow and Summary Refinement](../specs/2026-11-10-file-mode-workflow-refinement-design.md)
Reviewed checkout: `codex/file-mode-review-20261110` at `e5a312aca944c5497d4ef5588b1b537a4452df52`.
The design spec is an uncommitted active discussion record.

## Review scope and evidence

This is a source and focused-test audit, not implementation of the redesign or a completed desktop
visual/hardware acceptance pass. The original conversation baseline was `1759b4556`. The separate
implementation chat has since added per-channel peaks (`7bbb03c1`) and File-only maximum locations
(`e5a312ac`); those additions are included in this checkout review and are not reported as absent.

Reviewed the frontend ledger/runtime, engine hook and IPC, native File worker/probe/summary paths,
transport state derivation, region/history-menu/header, report generation, settings synchronization,
and request-keyed display history.

Ran 11 relevant Vitest files: 119 tests passed. Of these, 114 are existing tests and five were
temporary diagnostic characterizations. The diagnostic file was removed after execution. Its
assertions confirmed current problematic behavior; passing those assertions is not proof that the
behavior meets the design. No production code was changed by this audit.

## A. Existing behavior problems

### A1. Changing the Dialogue Detection engine removes the active File entry

Priority: high. Reproduced with the actual provider chain in jsdom.

- Complete/select a file in File Mode, then change FireRedVAD to Silero VAD in Settings.
- `SourceActionsContext.jsx:120` assigns the active-source clear action to `onClearRef` and line 127
  invokes `useDialogueEngineRestart` without a Live-only guard.
- `useDialogueEngineRestart.js:14` invokes that ref when the detector changes with detection active.
- `MeterRuntimeContext.jsx:120` handles a File clear by stopping analysis if necessary, resetting
  its intake, and removing the active ledger entry.
- The detector selector in `SettingsContent.jsx:748` is available in File Mode.

The diagnostic created a successful result, changed the detector, and observed the session count
drop from one to zero. This can lose a result without an explicit file-removal action. A running
file follows the stop/remove route too; that variant is inferred from the same business path,
not separately exercised against a desktop worker.

Fix direction: preserve the existing Live restart policy while making File conditions immutable
for the current run and using the agreed settings-difference warning for retained results.

### A2. Reanalysis destroys the prior successful result before success is known

Priority: high for the agreed result-safety model. Reproduced at the ledger level.

`startFileAnalysisEntry` in `fileAnalysisSessionRegistry.js:166` clears summary, analysis time,
decoded count, and replaces analysis settings immediately. `useFileAnalysisEngine.js:81` resets
the same intake and later clears summary again. There is no separate successful-result and
attempt/staging owner. Report export requires state complete, so it is unavailable during reruns.

This is a confirmed existing destructive behavior and a major redesign gap, rather than evidence
that preservation already exists but is broken intermittently. Cancellation returns ready and
failure returns error; neither can recover the destroyed summary/history.

### A3. Failed files are presented as No file

Priority: medium. Reproduced with the pure transport derivation.

`sourceTransportState.js:106` handles ready, but there is no error branch. An existing error entry
falls through to No file / Analyze / chooseFile at line 119. Clicking opens another file rather
than retrying the known failed path. Cancellation is also represented as ready, not a distinct
cancelled outcome (`useFileSessionLedger.js:96`). The latter is an accepted new-state omission.

### A4. Metadata labels infer speaker layout from channel count

Priority: medium. Confirmed by source inspection.

`fileAnalysisDisplay.js:87` maps six channels to 5.1 and eight to 7.1 without source layout evidence.
The metadata line can therefore make a stronger layout claim than justified. Native probing also
does not preserve source channel-layout metadata, so changing frontend text alone is insufficient
to satisfy the new layout-identity requirement. Auto-layout inference and user overrides need to
be distinguished from source metadata and from labels used for the successful run.

### A5. Completed duration still comes from container metadata

Priority: medium for source accuracy. Native behavior confirmed by inspection; report preference
confirmed by a diagnostic with conflicting metadata/completion durations.

Both `file_analysis/session.rs:348` and `file_analysis/summary.rs:118` use probe duration for the
final summary. They already count decoded frames but do not derive final duration from that count.
`fileAnalysisReport.js:171` additionally prioritizes metadata duration over summary duration.
The diagnostic exported 999 seconds from metadata despite a one-second completion duration.

An absent or incorrect container duration can thus remain absent/incorrect even after successful
decoding. Fix the native completion source first, then report precedence and discrepancy handling.
This audit did not claim to have reproduced a malformed-duration container through FFmpeg.

### A6. Live History Length changes reset File inspection state

Priority: medium/low; confirmed by effect dependencies, not a dedicated desktop reproduction.

`AnalysisSessionContext.jsx:84-107` refits File viewport and resets Snapshot on changes to
historyRetentionSec, even with a known file duration; another effect resets Snapshot for every
retention change without a source guard. This couples File viewing to a Live-only preference.
File storage remains independently sized, so this is a view-state issue, not evidence that Live
retention truncates the entire File history.

## B. Required design work that is not an existing bug

| Area                       | Current implementation                                                                      | Missing agreed behavior                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Toolbar/pill               | Source slot becomes Open File; complete pill shows Reanalyze; analyzing shows Stop          | Stable disabled Source slot, Open in pill, Cancel/Retry/Canceled states, completion mark, busy Open guard          |
| File region                | Separate history count trigger, inline fixed three metrics, standalone Export               | File-name dropdown, two-line metric columns, info preview/pin, metadata depth, report actions in each row          |
| Summary controls           | Three hard-coded metrics                                                                    | Ten-metric catalogue, global persisted selection/order, zero selection, overflow, detail tables/locations          |
| Result lifecycle           | One state/summary/intake per entry                                                          | Separate successful result and attempt, coherent replacement, previous-result activity details                     |
| Settings provenance        | Frontend captures dialogue fields only                                                      | Actual immutable run conditions including track/layout/request identity as appropriate, comparison and warning     |
| Report                     | Existing File/Loudness/Dialogue/Profile Markdown layout; raw local path; nulls/placeholders | Agreed five chapters, aggregation/counts, path omission, readable provenance, explicit grouped unavailable reasons |
| Statistics CSV             | No exporter or selection entry                                                              | Unified header entry, one/many picker, wide table, dynamic channel groups, self-contained Profile rules/verdicts   |
| Multi-track GUI            | Desktop probe selects first track; CLI/core have some track support                         | Full metadata picker, default/title/layout metadata, per-entry track identity, rerun preserving track              |
| Reimport/source versioning | Each Open creates a new entry; rerun reads path without version checks                      | Unchanged-file/track reuse, changed-source new entries, unavailable-source handling                                |
| Retention                  | Hard limit five; entire entry is evicted                                                    | Retain statistics separately, File resource accounting, viewed-order eviction, protected/staging histories         |
| Restore History            | No separate history availability state                                                      | Released-history explanation, explicit regeneration using original conditions, source identity checks              |

B-retention is confirmed by the fifth/sixth-entry diagnostic: opening the sixth entry removes the
first entry's statistics as well. It is the current deliberate policy, now superseded by the spec,
not an accidental overflow of an implemented memory-budget manager.

## C. Risks and specification boundaries requiring targeted follow-up

### C1. Frontend provenance and worker config are not one atomic snapshot

Frontend `currentFileAnalysisSettings` in `SourceActionsContext.jsx:75` captures dialogue fields
when initiating the action. `useFileAnalysisEngine.js:86` awaits probing; its start request carries
path/probe/channel, not the saved analysis conditions (`ipc/commands.js:338`). The Rust worker later
calls `snapshot_config` in `file_analysis/session.rs:479` to read separate global locks.

The native worker does freeze its own config for the run. However, its config is not atomically
bound to the frontend provenance recorded before probing, and channel-role/request identities are
not in that provenance. A settings change during probing can create disagreement. This is a
code-supported race risk; the audit did not reproduce it against a running desktop instance.

Use a single acknowledged run specification or equivalent synchronization, then persist actual
accepted conditions. Do not treat a frontend-only dirty flag as sufficient.

### C2. Analysis-affecting settings include more than detector selection

Visual history is request-keyed. `analysis/analysisRequests.js` includes channel/pair and processing
parameters in request identities; the native File worker snapshots requests at start. Changing
those parameters or adding a new panel after a completed run can ask for a key that was never
computed. `snapshotResolve.js` correctly returns missing instead of inventing history.

The agreed distinction between display-only changes and recomputation must be mapped to actual
fields. Pure frontend shaping (for example Spectrum tilt) is different from new backend requests.
The warning/Restore design needs to distinguish a whole history released for memory from a newly
requested view that was never computed. No promise of arbitrary post-analysis panel reconfiguration
should be inferred without addressing that gap.

### C3. Dialogue examples need to match the current product

`deriveDialogueRuntime` currently always returns dialogueGating true; the user-facing setting
selects the detector, not an enable/disable switch. Earlier discussion examples about toggling
detection are illustrative, not authorization to introduce a new switch. The summary picker must
not acquire the side effect of enabling analysis. Existing Settings help text claiming visible
Stats metrics activate detection is stale against this implementation.

### C4. Async event identity and startup/cancellation boundaries

Progress/completion/error events carry only a path. `useFileAnalysisEngine.js:103-128` filters by
path and has no generation/track token. Same-path reimport or future different-track runs need
stronger identity to reject delayed events. Completion and frame channels also need final-history
ordering validation. Existing tests cover different-path stale events but not full same-path
generation isolation or desktop delivery ordering. These are audit risks, not reproduced failures.

The probe-to-start chain and cancellation/rapid restart also need deterministic deferred-promise
tests and native acceptance checks. Do not infer safety from sequential happy-path tests.

### C5. Memory and source identity require evidence

Unknown-duration File analysis intentionally uses effectively unbounded frontend capacities to
avoid losing the beginning of the file (`useFileAnalysisEngine.js:20`). There is no retained-byte
accounting or peak-memory measurement for the new result/attempt model. Current-file protection,
concurrent Live history, staging during reruns, channel counts and keyed visual families all affect
memory. No default MB budget can be justified by this audit alone.

Change detection must cover source modification, replacement, missing files and modifications
during a run. Path equality alone, basename equality, and unqualified size/mtime claims are not
proof of content identity. Pick a practical contract before implementing reuse/Restore.

## D. Already added versus still needing acceptance

Per-channel Sample/True Peak Max, all-channel sample maxima, first occurrence locations, and M/S
window ends now traverse native completion, reports and CLI. Frontend hook tests confirm field
preservation. They are not yet presented in the redesigned hover tables or CSV, which do not exist.

See [maximum-location validation](2026-11-10-file-maxima-locations-validation.md) for the other chat's
recorded focused/conformance tests and local performance measurements. That record reports no
passed hardware capture acceptance or completed four-hour soak. Its implementation-time wording
about an uncommitted change predates the two commits now present; a commit alone does not turn the
outstanding acceptance into a pass. This audit ran no capture, soak, or desktop screenshot checks.

## Suggested discussion/implementation order

1. Prevent implicit File result deletion on detector changes; fix misleading failure state.
2. Separate successful results from attempts and bind accepted analysis conditions/provenance.
3. Introduce source/track identity and the agreed reimport/version behavior.
4. Separate statistics from histories, measure resource use, then implement budget/Restore.
5. Build the agreed toolbar/region/menu/summary surfaces using those stable owners.
6. Finish five-chapter reports and self-contained statistics CSV, sharing evaluation semantics.

Retain focused regression tests for corrected behavior during implementation. The five temporary
characterizations deliberately described broken/current behavior and should not be adopted as
permanent assertions of desired behavior.
