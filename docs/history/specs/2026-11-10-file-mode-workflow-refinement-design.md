# File Mode Workflow and Summary Refinement

**Date:** 2026-11-10  
**Status:** Final agreed design; implementation and validation remain  
**Discussion baseline:** `main` at `1759b4556`  
**Reviewed implementation:** `e5a312aca944c5497d4ef5588b1b537a4452df52`  
**Worktree branch:** `codex/file-mode-review-20261110`

## 1. Purpose, scope, and governing principle

Live is the design and implementation baseline. File follows Live's components, tokens, gestures,
channel/layout resolution, and measurement capabilities. Introduce only the differences required
by offline analysis, preserving Live behavior, numerical results, performance, and realtime safety.

This spec defines the File toolbar/pill, file region and management menu, result lifecycle,
multi-track imports, source identity, history retention/restoration, reports, and statistics CSV.
It supersedes the earlier File region's fixed-three-metric direction and consolidates the completed
discussion. It describes intended behavior, not a claim that the redesign has shipped.

Supporting records:

- [Implementation audit](../notes/2026-11-10-file-mode-implementation-audit.md).
- [Implementation plan](../plans/2026-11-10-file-mode-workflow-refinement.md).
- [Maximum-location validation](../notes/2026-11-10-file-maxima-locations-validation.md).

Per-channel whole-file peaks and File-only maximum locations are already implemented in
`7bbb03c1` and `e5a312ac`. Reuse that work; its outstanding hardware acceptance remains outstanding.

Time-series export, Live API expansion, Live memory controls, click-to-seek from metric locations,
PDF export, batch analysis/queues, and a dedicated missing-file relocation workflow are out of scope.

## 2. Result and task model

Separate a file/track entry's latest successful result from its current analysis attempt. A
successful result binds measurements, analysis conditions, channel identities, source version,
analysis time, and associated browsing history. Releasing history does not remove the result.

### First analysis and reanalysis

- Opening/dropping a single-track file starts analysis automatically. Multi-track import confirms
  a track first. A first run may display progressively arriving data.
- Freeze track and analysis-affecting conditions at task start and bind the worker's accepted
  conditions to the stored provenance. Do not separately read mutable global settings later and
  describe them as the original conditions.
- Setting changes do not interrupt or alter the current File run. Profile and display-only
  changes can update interpretation/presentation immediately.
- Reanalyze uses the entry's original track and current analysis conditions. Preserve the prior
  successful summary, provenance, and browsing history while the new attempt runs.
- During reanalysis, displayed summary and panels refer to the same preceding successful run;
  do not mix them with new partial data. Existing results remain browsable and exportable.
- Publish a successful replacement coherently across summary, panels, history, and exports.
- Failure/cancellation preserves any preceding successful result. First-run partial data is not
  a complete result and cannot be exported as one. Cancel does not pause; another attempt starts
  from the beginning.
- Retry keeps the entry's track and uses current settings, with the same result-preservation and
  changed-source rules as Reanalyze.

### Task reliability and Live isolation

Use task/session-generation identities, following Live's existing approach, for progress, frames,
completion, and errors. Path equality is insufficient for same-file retries/different tracks.
Reject superseded messages and synchronize final frames with successful publication. Cancellation
covers probing/startup; a delayed probe cannot restart a cancelled task. Keep the task busy until
stop is confirmed; an unconfirmed stop is not reported as successful cancellation.

One analysis/restoration task runs at a time; no queue. Retain existing source-switch safety and
business guards. Live detector changes keep the existing coherent reset policy. File detector
changes never automatically clear/remove entries or stop their tasks. Explicit user Clear remains
an intentional action with its existing semantics.

## 3. Toolbar and pill

Remove the independent toolbar Open File control. Keep Live's capture Source control in its
original position, disabled in File Mode. It is distinct from the pill's Live/File source selector.
Use the established disabled style.

Keep the Live pill's outer shape, height, source selector, middle status area, and right action
area. File changes their contents, principally the right action, rather than adding a new shell.

| Active-file context                      | Middle status                                         | Right action |
| ---------------------------------------- | ----------------------------------------------------- | ------------ |
| No file                                  | No File                                               | Open         |
| Probing/analyzing/restoring              | Progress when known, otherwise indeterminate activity | Cancel       |
| Complete                                 | Actual file duration and completion mark              | Open         |
| First analysis cancelled                 | Canceled                                              | Open         |
| Rerun cancelled with a successful result | Successful-result duration/completion                 | Open         |
| First analysis or rerun failed           | Failed                                                | Retry        |
| Inspecting a time position               | Selected media time                                   | Result       |

Snapshot navigation retains Live's priority: Result exits inspection without reanalysis or history
deletion, preserves timeline zoom/scroll, and restores the underlying state/action. While a task
runs, Cancel remains accessible on its file-menu row if Snapshot navigation occupies the pill.

The pill follows the active file. A different background file shows its progress/Cancel in its own
menu row; success/failure does not switch selection or hijack the active pill. Use existing error
feedback for background failure. Disable Open, Retry, and other task-starting actions while a task
is busy, including stopping; do not disable navigation/Result solely because another task runs.
Apply the same busy guard to drag/drop and other entry paths.

## 4. File region and details

Use a horizontal region with file identity on the left and whole-file metrics on the right.
Keep the normal two-line arrangement stable during analysis/reanalysis and warnings.

### File identity

- First line: file name and dropdown affordance form the file-switching/management entry. Remove
  the separate numeric history trigger. Place warning/activity icons alongside this entry.
- Second line: resolved channel layout, sample rate, meaningful source bit depth, and duration;
  put the always-visible information icon at the end of the metadata.
- Show PCM bit depth when known and explicitly distinguish floating-point formats such as
  `32-bit Float`. Omit unavailable/inapplicable depth; decoded float depth is not MP3/AAC source depth.
- File details expose full path, container, codec, track identity, and available source metadata.
- Follow Live's role/layout resolver using the successful run's conditions. Do not retain a
  separate File-only count-to-speaker-label mapping. Unknown roles use ChN; explain default layout
  inference/fallback in details. Distinguish source-declared and calculation layout when different.
- Changing current role settings does not relabel old results as if they used new conditions.

### Shared preview/pin interaction

Reuse the panel-help preview/pin pattern for file details, warning details, and metric details:
hover previews; entering the content keeps it visible; leaving both closes an unpinned preview;
clicking pins the same surface; clicking again, outside, or Escape closes it. Keyboard activation
can pin it. Permit reading/copying and internal scrolling without requiring hover precision.

During a rerun, an activity icon explains that the preceding successful result remains displayed.
After failure, warning details explain the failed attempt and retained result. Cancellation alone
does not leave a persistent error marker. Aggregate simultaneous warning/activity explanations
using existing icon semantics rather than adding text strips or replacing the metadata line.

### Whole-file metric columns and customization

Each metric has a label above its value/unit. Values describe the complete successful run and do
not change when inspecting a time position. Eligible metrics are exactly:

| Group    | Metrics                                                   |
| -------- | --------------------------------------------------------- |
| Loudness | Integrated, LRA, Momentary Max, Short-Term Max            |
| Peaks    | All-channel Sample Peak Max, All-channel True Peak Max    |
| Dialogue | Dialogue Loudness, LDR, Dialogue Coverage, Dialogue Range |

Defaults, in order: Integrated, LRA, True Peak Max. Labels follow the glossary. Do not add
per-channel picker choices or instantaneous/visual metrics. A missing reading keeps its position
with a placeholder and reason; selecting it does not activate analysis or substitute another metric.

The customization icon at the metrics' end opens Summary Metrics: reset, checkbox rows, and drag
ordering. Reuse Popover, PanelSettingsHeader/ResetAction, SettingsOptionRow, and SortableStatsList.
Apply changes immediately with no draft/Save/Cancel flow. Allow all ten or zero selected metrics.
Keep the customization entry accessible when zero are selected. Persist selection/order globally
across restart and file/source switches, independently of Presets and Stats panel settings.
Reset restores the default three. Use the settings domain and normal configuration transfer/reset
paths; no analysis data becomes persistent as a consequence.

Display complete metric columns in user order while space permits. Remaining metrics go into a
`+N` popover with labels/values; wider windows reveal more. Never compress text or truncate numbers
to increase count. Overflow viewing is distinct from customization. No standalone Export remains
in the region.

Maximum locations appear in hover details, not the permanent two-line layout. Each Peak detail
shows corresponding per-channel maxima and first-occurrence times in original channel order,
with result-bound labels and the contributor to the overall maximum clearly identified. Handle
ties accurately. Long lists scroll. Pinning does not seek to the occurrence.

Use existing design tokens for all sizing, type, spacing, surfaces, colors, and elevation. Determine
the smallest-window fallback through screenshots across Interface Sizes; keep actions accessible
and preserve intact numeric readings. Do not invent a second styling system for File.

## 5. File dropdown and imports

Use one management list: each row has file identity on the left and its own action icons on the
right, following existing management rows. Do not split file selection from current-file actions.

- Clicking a file selects it. Row actions target that file without selecting it first.
- The analysis icon uses Analyze as its hover label without a successful result, Reanalyze with
  one. The running row shows progress and Cancel instead. Other task starts are disabled while busy.
- Each row's Export opens Export Markdown…, Export JSON…, Copy as Markdown. Require a successful
  result, including one retained during/after another attempt.
- Remove deletes that entry/result through guarded business functions. Keep Clear All in the header.
- Add Export Statistics… as a header icon alongside Clear All; it is the sole CSV entry point.
- Identify same-name entries by track language/name/number and, for different source versions,
  analysis time or equivalent version context. Warnings on rows explain their own affected result.

### Multi-track import

For multiple audio tracks, use a Select Audio Track dialog with the file name, Source-style
single-selection dots and two-line rows, and shared Dialog/title/footer tokens. Row content is
track number, available language/name, then codec/sample rate/layout (channel count if unknown).
Extend probing for title/default disposition/source layout; do not invent missing metadata.

Select the default-marked track initially, falling back to the first audio track. Selecting a row
does not start work; confirmation begins analysis or selects an already available matching entry.
Cancel/Escape abandons the pending import without replacing the current selection/result. Open
and drop share this flow. Do not add an extra track button or batch all tracks.

To analyze another track, Open/drop the file again. A different track creates a separate entry,
preserving the previous track's result. An unchanged file/track already in the ledger selects its
entry without automatic reanalysis. Reanalyze/Retry retains that entry's track and skips the picker.

### Source changes

Bind entries to a source version and track, not a basename alone. A modified/replaced source creates
a new entry, including when discovered during Reanalyze. Preserve the old result. Missing/moved
sources do not delete statistics, exports, or resident history; only operations requiring source
access fail with an explanation. A changed source cannot regenerate history for the old result.
Choose and test robust source identity/change detection, including changes during a run, before
claiming successful result or restoration identity. Users Open again to locate another source.

## 6. Settings differences and missing views

Compare current effective analysis conditions with the successful result's actual accepted
conditions. Show the existing warning icon beside the file dropdown and affected list rows only
for differences requiring recomputation. Details explain concrete differences; click pins them.
Reanalyze stays on the row. Reverting conditions or completing a matching run clears the relevant
warning. Cancellation/failure does not clear unresolved differences.

Profile changes and pure presentation changes do not require decoding. Detector selection, roles,
and request-key changes that alter computations must be classified from the actual contract.
The current product keeps detection enabled and exposes detector selection; this redesign does
not add a detection enable/disable setting merely because an earlier example mentioned one.

Newly requested views that were not computed show the established missing-view explanation and
a warning that Reanalyze is required. Existing statistics/exports stay valid. Returning to a
computed view clears that view-specific warning. Restore History regenerates original run requests;
Reanalyze applies new requests. Distinguish never-computed views from resource-released histories.

## 7. Time and history retention

Final analyzed duration equals decoded audio frames divided by sample rate. Use declared duration
only for provisional progress/range; unknown duration uses indeterminate progress. Completed pill,
metadata, reports, and CSV use actual duration. Explain material declared-duration discrepancies
in details; validate the threshold with fixtures.

Live History Length retains its Live meaning but never resets File Snapshot, zoom, scroll, or
history. Shared timeline controls receive File duration and retention independently. Returning to
Live uses the updated Live setting normally.

### Resource management

Retain all lightweight successful statistics/provenance in the current application session,
independent of browsing history. Remove the five-entry policy; no cross-restart result restoration
or literally unlimited process memory is promised.

File browsing histories share a resource budget separate from Live. Estimate retained buffers,
visual families, and indexes by storage, not file count or duration. Release eligible histories
in least-recently-viewed order, based on user inspection rather than task completion, until the
target is met. Preserve statistics and export data.

Protect the currently viewed history and active-task histories, including the old successful
history during reruns. Include staging storage in accounting. Do not remove visible history
abruptly. If protected history exceeds the target, reclaim inactive history and temporarily exceed
it, retaining existing single-file checkpoint-density limits. This is a cache-retention target,
not a hard process cap. Set its internal default after representative memory measurements, with
no user-facing budget setting in this slice.

### Restore History

Selecting an entry without browsing history still shows statistics and permits export. Explain in
the instrument area that history was released and offer Restore History. Never silently recompute
on selection. Regenerate using original track/conditions and an unchanged available source;
failure/cancellation preserves the result. Follow one-task/no-queue guards. Reanalysis instead
uses current conditions. Source mismatch is explained and cannot attach new history to old values.

## 8. Measurement and evaluation contract

Reports and CSV always include complete applicable whole-file results, independently of summary
choices. The ten-metric catalogue is supplemented by per-channel peak detail. Numeric algorithms
and precision remain unchanged; compute maxima from authoritative audio processing, not sparse
display checkpoints.

Record first occurrences for per-channel/global Sample Peak Max and True Peak Max, plus whole-file
M/S maxima. Global peak coordinates identify the channel; exact ties use a deterministic earliest
source position. Positions are relative to track start: Sample Peak identifies a sample, M/S the
window end. True Peak must account for interpolation phase, filter delay, and boundary semantics;
reuse the implemented contract and tests. Integrated/LRA/dialogue aggregate metrics have no single
occurrence time. Shared location support is File-opt-in; Live does not enable new tracking or gain
new location UI/Measurement fields in this work.

Unavailable measurements are not zero. Preserve explicit reasons such as not enabled, no dialogue,
detector failure, insufficient evidence, or below measurement floor according to actual semantics.
Markdown combines repeated explanations; JSON/CSV retain per-metric values and reason codes.
Measurement reasons explain missing evidence; Profile Not Evaluated explains an unevaluable rule.

Evaluate every exported result using the Profile effective at export, including saved/preview
state and full effective rules. Measurement provenance remains tied to its successful run. No
report warning is added merely because current settings differ or another attempt was cancelled.
Only actual limitations affecting that successful result belong in exported analysis notes.

| Overall evaluation  | Condition, in precedence order                                         |
| ------------------- | ---------------------------------------------------------------------- |
| Not Evaluated       | Profile off or no effective rules                                      |
| Fail                | Any configured metric fails                                            |
| Warn                | No failure, at least one warning                                       |
| Not Fully Evaluated | No failure/warning, at least one configured metric cannot be evaluated |
| OK                  | Every configured metric evaluated and passed                           |

Count metrics rather than rules. Each configured metric counts once at its worst status; no-rule
metrics do not enter counts. Analysis errors are separate from Profile failure. Preserve configured
rules on metrics that cannot be evaluated for whole-file results instead of dropping them.

## 9. Report export

Use the simple three-item per-row menu described above. Export immediately opens the native save
dialog; copying uses the same Markdown renderer with existing feedback. No intermediate settings
panel or path option. Omit full local paths from all report formats; they remain in application
file details. Review/migrate JSON/CLI compatibility rather than silently breaking its contract.

A short heading identifies file, PLVS version, and export time. Keep five chapters:

| Chapter          | Contents                                                                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Summary          | Effective Profile, overall verdict, per-metric counts, relevant analysis limitations                                                             |
| File             | File/track identity, container/codec, sample rate, meaningful source bit depth/format, actual duration, channels/layout, available language/name |
| Measurements     | Complete Loudness, Peaks, Dialogue readings; peak/location detail and grouped unavailable reasons                                                |
| Loudness Profile | Name/mode, full rules, measurements/units, per-metric verdicts; explain when off/empty                                                           |
| Analysis Details | Completion time, software/algorithm identity, actual accepted conditions, layout/fallback, detector configuration and relevant failures          |

Markdown is reading-oriented. JSON retains exact identifiers, versions, decoded-frame counts,
precision, stable metric fields and explicit unavailable reasons. Share conceptual content without
forcing a destructive JSON restructure for visual chapter order. Keep chapter structure when
Profile is off. Do not export unrelated debug state or later application setting changes.

## 10. Whole-file statistics CSV

### Selection and entry point

The file-menu header's Export Statistics… opens a selection dialog directly, reusing
ItemPickerDialog's selection pattern/shared components without an extra type step or a selectable
mode inside the normal file list. Default-select all entries with a successful result. Other
entries are unavailable; retained results remain eligible during/after reruns. Zero selections
cannot export. One selected entry is single-file export through the same flow; no row-level CSV
entry exists. Export writes one CSV via the native save dialog.

### Wide table

One successful file/track/version result per row. Include:

| Group                   | Columns                                                                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| File                    | File name, track index/language/name when present, codec, sample rate, meaningful source depth/format, actual duration, channel count/layout, completion time |
| Whole-file measurements | Integrated, LRA, M/S maxima and window-end times, global Sample/True Peak maxima and their channels/times, four dialogue metrics                              |
| Channels                | Each channel's label, Sample Peak Max/time, True Peak Max/time                                                                                                |
| Evaluation              | Effective Profile name/mode, overall verdict and metric counts, complete rules and per-metric verdicts                                                        |

Expand channel groups to the highest channel count selected, using ordinal column identities such
as `ch1_label`, `ch1_sample_peak_max_dbfs`, `ch1_sample_peak_max_time_s`,
`ch1_true_peak_max_dbtp`, `ch1_true_peak_max_time_s`. Each row carries its own labels; unknown roles
use ChN. Nonexistent channels leave that group empty, distinguished from unavailable readings on
existing channels. Do not split the table into joined files.

Numeric cells contain only numbers, units in headers. Locations are numeric seconds, not clocks.
Unavailable value cells are empty with corresponding explicit reason columns. Omit full paths.
Choose stable field names/encoding/escaping and validate Excel and machine-reader compatibility.

Use one export-time effective Profile for every row; repeat full rules and verdicts on each row
so sorting/filtering or extracting a row retains context. Rules include every comparison, threshold,
unit, severity; numeric measurement columns stay numeric. No-rule metrics use Not Applicable;
configured rules without evidence use Not Evaluated with reasons. With Profile off, overall is Not
Evaluated and count cells are empty. The CSV must not require a companion report for interpretation.

## 11. Implementation boundaries and acceptance

Use existing runtime owners, business operations, guards, IPC, and persistence paths. Frontend
audio-engine access stays in `src/ipc/`. No callback allocation, locks, or syscalls. UI uses shared
tokens/components; extract reusable primitives carefully without changing Live semantics. Register
new UI surfaces/navigation and synchronize Agent Control schemas, mapping, docs, capabilities,
handlers, and contracts; never hand-edit generated files. Respect existing blocking editors; a
new draft/preview/save/cancel editor must register through useBlockingEditor.

Summary preferences belong in global settings and normal configuration export/import/reset, not
Presets. Analysis results remain process/session scoped. Update user docs/glossary in implementation
commits. Reconcile the PRD's general-export non-goal for approved statistics CSV and perform the
repository privacy review for data-handling changes. Write an ADR where an architectural tradeoff
reasonably needs durable rationale; this historical spec does not replace living contracts.

Acceptance covers task races and frozen provenance; result/history preservation; source/track
identity; state/action guards; missing views versus released histories; global preference restart
behavior; report/CSV parity and evaluation; layout/time accuracy; memory accounting and eviction.
Use Agent Control screenshots before/after across themes, Interface Sizes and widths, including
long names/many channels. Persistence verification requires app restart, not Vite reload.

Run focused tests during implementation and phase-appropriate repository gates. DSP/audio/engine
changes require the normal leased capture checks; preserve outstanding peak/location hardware
acceptance and run/recommend the four-hour soak with same-platform baseline drift review. Run
check:changes after the final intended commit before push/merge, full gates when selected/required.

## 12. Engineering determinations and deferred work

Product choices above are settled. The implementer owns exact state structures, accepted-run
handshake, event IDs, source identity strategy, metric/reason mapping, machine field names/schema
migrations, CSV encoding, icon aggregation, responsive fallback, discrepancy thresholds, and normal
settings/configuration plumbing. Validate these against code/tests rather than reopening routine
technical choices. Choose the history budget and retention-accounting margins from measurements.
Escalate a material change to agreed behavior/scope or an applicable repository approval boundary.

Time-series export requires separate validation of metric semantics, cadence, CPU/memory/disk costs,
and storage versus on-demand calculation. The explored 100 ms cadence is not an approved requirement.
Do not silently export sparse display checkpoints as a fixed-cadence sequence. Live API expansion
and optional Live adoption of location support remain separate future decisions.
