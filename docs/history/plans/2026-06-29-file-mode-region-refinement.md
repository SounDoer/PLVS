# File Mode Pill/Region Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make File-mode status live in one place — the top-left pill follows the active file, the header region drops duplicated status and shows only the three delivery metrics, and background-analysis progress/stop moves into the file-list popover.

**Architecture:** Pure frontend refactor of existing components. `deriveFileState` (the pure function feeding the pill) switches from "prioritise the analyzing session" to "reflect the active file" and exposes a `primaryActionDisabled` flag. `SourceTransportCluster` honours that flag. `FileAnalysisSummary` is trimmed. `FileAnalysisHistoryMenu` gains a Stop control and a trigger-button progress indicator. `App.jsx` wires a stop callback through. No Rust/DSP/stats-panel changes; no export/import.

**Tech Stack:** React 19, Vitest + @testing-library/react, Tailwind, lucide-react icons.

**Spec:** `docs/superpowers/specs/2026-06-29-file-mode-region-refinement-design.md`

---

## File Structure

- `src/lib/sourceTransportState.js` — `deriveFileState` follows the active file; adds `primaryActionDisabled`. Pure function, fully unit-tested.
- `src/components/SourceTransportCluster.jsx` — disables the primary action button when `state.primaryActionDisabled`.
- `src/components/FileAnalysisSummary.jsx` — removes the status label + active-file progress line; chips become Integrated / LRA / True Peak Max; the file-list popover trigger moves to the left; forwards a new `onStopFile` prop to the menu.
- `src/components/FileAnalysisHistoryMenu.jsx` — adds a Stop button on the analyzing entry and a progress indicator on the trigger button; stable accessible name via explicit `aria-label`.
- `src/App.jsx` — adds an `onStopFile` handler and passes it to `FileAnalysisSummary`.
- Co-located `*.test.{js,jsx}` for each.

---

## Task 1: `deriveFileState` follows the active file

**Files:**
- Modify: `src/lib/sourceTransportState.js:49-107`
- Test: `src/lib/sourceTransportState.test.js`

- [ ] **Step 1: Update the two existing "separate analyzing session" tests to the new behavior**

In `src/lib/sourceTransportState.test.js`, replace the test named
`"shows analyzing progress from a separate analyzing file session"` (currently
asserting the background file's `37%`/`STOP`) with this — the pill must now
reflect the active (completed) file and disable REANALYZE:

```js
  it("reflects the active file (not the background analysis) and disables reanalyze", () => {
    expect(
      deriveSourceTransportState({
        sourceMode: "file",
        fileSession: {
          state: "complete",
          fileName: "displayed.wav",
          summary: { durationMs: 120_000 },
        },
        analyzingFileSession: {
          state: "analyzing",
          fileName: "background.wav",
          progress: 0.37,
        },
      })
    ).toMatchObject({
      sourceLabel: "File",
      statusLabel: "00:02:00",
      actionLabel: "REANALYZE",
      chromeState: "ready",
      actionKind: "reanalyzeFile",
      primaryActionDisabled: true,
    });
  });

  it("disables analyze for a ready active file while another file analyzes", () => {
    expect(
      deriveSourceTransportState({
        sourceMode: "file",
        fileSession: { state: "ready", fileName: "queued.wav" },
        analyzingFileSession: {
          state: "analyzing",
          fileName: "background.wav",
          progress: 0.5,
        },
      })
    ).toMatchObject({
      actionLabel: "ANALYZE",
      actionKind: "analyzeFile",
      primaryActionDisabled: true,
    });
  });
```

The test `"keeps selected media time ahead of analyzing progress"` stays as-is
(scrub still wins). The `"derives the analyzing file state"` test stays as-is
(active file is itself analyzing → STOP).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/sourceTransportState.test.js`
Expected: FAIL — the old code returns `statusLabel: "37%"` / `actionLabel: "STOP"` and has no `primaryActionDisabled`.

- [ ] **Step 3: Rewrite `deriveFileState`**

Replace the whole `deriveFileState` function (`src/lib/sourceTransportState.js:49-107`) with:

```js
function deriveFileState({
  selectedOffset = -1,
  selectedMediaTimeMs,
  fileSession = {},
  analyzingFileSession = null,
}) {
  const state = fileSession.state ?? "empty";
  // A background analysis is one running on a file other than the active one.
  // When the active file is itself analyzing, `state === "analyzing"` covers it below.
  const backgroundAnalysisActive =
    analyzingFileSession?.state === "analyzing" && state !== "analyzing";

  if (selectedOffset >= 0 && Number.isFinite(selectedMediaTimeMs)) {
    return {
      sourceLabel: "File",
      statusLabel: formatClock(selectedMediaTimeMs),
      actionLabel: "RESULT",
      chromeState: "snapshot",
      actionKind: "returnToFileResult",
      primaryActionDisabled: false,
    };
  }

  if (state === "analyzing") {
    return {
      sourceLabel: "File",
      statusLabel: formatProgress(fileSession.progress),
      actionLabel: "STOP",
      chromeState: "live",
      actionKind: "stopFileAnalysis",
      primaryActionDisabled: false,
    };
  }

  if (state === "complete") {
    const durationMs = fileSession.summary?.durationMs ?? fileSession.metadata?.durationMs;
    return {
      sourceLabel: "File",
      statusLabel: Number.isFinite(durationMs) ? formatClock(durationMs) : "Done",
      actionLabel: "REANALYZE",
      chromeState: "ready",
      actionKind: "reanalyzeFile",
      primaryActionDisabled: backgroundAnalysisActive,
    };
  }

  if (state === "ready") {
    return {
      sourceLabel: "File",
      statusLabel: "Ready",
      actionLabel: "ANALYZE",
      chromeState: "ready",
      actionKind: "analyzeFile",
      primaryActionDisabled: backgroundAnalysisActive,
    };
  }

  return {
    sourceLabel: "File",
    statusLabel: "No file",
    actionLabel: "ANALYZE",
    chromeState: "ready",
    actionKind: "chooseFile",
    primaryActionDisabled: backgroundAnalysisActive,
  };
}
```

Note: the old `analyzingSession`/`analyzingState` branch that surfaced the
background file's progress is intentionally gone.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/sourceTransportState.test.js`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Commit**

```bash
git add src/lib/sourceTransportState.js src/lib/sourceTransportState.test.js
git commit -m "feat(file-mode): pill follows the active file and disables analyze during background work"
```

---

## Task 2: `SourceTransportCluster` honours the disabled flag

**Files:**
- Modify: `src/components/SourceTransportCluster.jsx:112-122`
- Test: `src/components/SourceTransportCluster.test.jsx`

- [ ] **Step 1: Add a failing test**

Append inside the `describe("SourceTransportCluster", ...)` block in
`src/components/SourceTransportCluster.test.jsx`:

```js
  it("disables the primary action when primaryActionDisabled is set", () => {
    const onPrimaryAction = vi.fn();
    render(
      <SourceTransportCluster
        state={{
          sourceLabel: "File",
          statusLabel: "00:02:00",
          actionLabel: "REANALYZE",
          chromeState: "ready",
          actionKind: "reanalyzeFile",
          primaryActionDisabled: true,
        }}
        sourceMode="file"
        onSourceModeChange={vi.fn()}
        onPrimaryAction={onPrimaryAction}
      />
    );

    const action = screen.getByRole("button", { name: "REANALYZE" });
    expect(action.disabled).toBe(true);
    fireEvent.click(action);
    expect(onPrimaryAction).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/SourceTransportCluster.test.jsx -t "disables the primary action"`
Expected: FAIL — `action.disabled` is `false` (no `disabled` attribute yet).

- [ ] **Step 3: Add the disabled wiring**

In `src/components/SourceTransportCluster.jsx`, replace the primary action button
(`src/components/SourceTransportCluster.jsx:112-122`) with:

```jsx
      <button
        type="button"
        disabled={state.primaryActionDisabled}
        onClick={() => onPrimaryAction(state.actionKind)}
        className={cn(
          "ml-1 flex h-full items-center gap-1.5 rounded-full px-3 text-[length:var(--ui-fs-status)] font-bold tracking-[0.06em] transition-all duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40",
          chrome.action
        )}
      >
        <ActionIcon className="size-[10px]" />
        {state.actionLabel}
      </button>
```

(`disabled` short-circuits the click in the DOM, so `onPrimaryAction` is not
called when disabled. The existing string-snapshot tests still pass — no removed
token is reintroduced and `text-xs` is still absent.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/SourceTransportCluster.test.jsx`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Commit**

```bash
git add src/components/SourceTransportCluster.jsx src/components/SourceTransportCluster.test.jsx
git commit -m "feat(file-mode): grey out the transport action when it cannot run"
```

---

## Task 3: Trim `FileAnalysisSummary`

**Files:**
- Modify: `src/components/FileAnalysisSummary.jsx`
- Test: `src/components/FileAnalysisSummary.test.jsx`

- [ ] **Step 1: Update tests to the new region content**

In `src/components/FileAnalysisSummary.test.jsx`:

In `"renders completed file metadata and authoritative delivery metrics"`, remove
the line `expect(screen.getByText("Analyzed file")).toBeTruthy();` and add LRA
assertions next to the existing Integrated/True Peak ones:

```js
    expect(screen.getByText("Integrated")).toBeTruthy();
    expect(screen.getByText("-16.2 LUFS")).toBeTruthy();
    expect(screen.getByText("LRA")).toBeTruthy();
    expect(screen.getByText("4.1 LU")).toBeTruthy();
    expect(screen.getByText("True Peak Max")).toBeTruthy();
    expect(screen.getByText("-1.0 dBTP")).toBeTruthy();
    expect(screen.queryByText("Sample Peak Max")).toBeNull();
```

In `"renders a lightweight analyzing banner with selectable history entries"`,
remove these two lines (the pill owns status now):

```js
    expect(screen.getByText("Analyzing file")).toBeTruthy();
    expect(screen.getByText("25%")).toBeTruthy();
```

Keep the remaining assertions in that test (filename present, `Integrated`
absent, the 2-files popover select flow).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/FileAnalysisSummary.test.jsx`
Expected: FAIL — `LRA`/`4.1 LU` not found (chip order/contents not changed yet), and the removed-text expectations are not yet satisfied by the still-present "Analyzed file"/"Analyzing file" labels.

- [ ] **Step 3: Remove the status helpers and the unused import**

In `src/components/FileAnalysisSummary.jsx`, delete the `fileStateLine` function
(`src/components/FileAnalysisSummary.jsx:11-18`) and the `statusLabel` function
(`src/components/FileAnalysisSummary.jsx:20-25`). They become unused after this
task.

- [ ] **Step 4: Rewrite the main (non-error) return block**

Replace the body from `const summary = fileSession?.summary ?? {};`
(`src/components/FileAnalysisSummary.jsx:76`) down to the end of the returned
`</section>` (`:122`) with:

```jsx
  const summary = fileSession?.summary ?? {};
  const fileName = fileSession?.fileName || "No file";
  const isComplete = fileSession?.state === "complete";

  return (
    <section
      className={cn(
        "flex w-full min-w-0 flex-wrap items-center gap-x-4 gap-y-2 border-border bg-card/55 py-2 text-sm text-popover-foreground",
        SHELL_SURFACE_BASE,
        SHELL_SURFACE_SOFT_SHADOW
      )}
    >
      {historyMenu}
      <div className="min-w-[14rem] flex-1">
        <p className="truncate text-sm font-semibold text-foreground">{fileName}</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {formatSessionMetadataLine(fileSession)}
        </p>
      </div>
      {isComplete ? (
        <dl className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs">
          <MetricChip label="Integrated" value={formatMetric(summary.integratedLufs, "LUFS")} />
          <MetricChip label="LRA" value={formatMetric(summary.lra, "LU")} />
          <MetricChip label="True Peak Max" value={formatMetric(summary.truePeakMaxDbtp, "dBTP")} />
        </dl>
      ) : null}
      {isComplete && fileSession?.historyTruncated ? (
        <p className="min-w-0 text-xs text-[color:var(--ui-signal-warn)]">
          Delivery metrics cover the whole file. Scrub history is limited to the last{" "}
          {formatClock(fileSession.historyCoveredMs ?? 0)}.
        </p>
      ) : null}
    </section>
  );
```

Then move `{historyMenu}` to the front of the **error** branch too, for
consistency: in the error `<section>` (`src/components/FileAnalysisSummary.jsx:56-73`),
move the `{historyMenu}` line so it is the first child (right after the opening
`<section ...>`), before the `<div className="min-w-[14rem] flex-1">` block.

The now-unused locals `stateLine` and `samplePeakMax` are removed by the rewrite
above; confirm no other reference to them remains.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/components/FileAnalysisSummary.test.jsx`
Expected: PASS (all tests in the file).

- [ ] **Step 6: Commit**

```bash
git add src/components/FileAnalysisSummary.jsx src/components/FileAnalysisSummary.test.jsx
git commit -m "feat(file-mode): trim summary region to filename, metadata, and three delivery chips"
```

---

## Task 4: Stop control + progress indicator in the file-list popover

**Files:**
- Modify: `src/components/FileAnalysisHistoryMenu.jsx`
- Modify: `src/components/FileAnalysisSummary.jsx` (forward the new `onStopFile` prop)
- Test: `src/components/FileAnalysisHistoryMenu.test.jsx`

- [ ] **Step 1: Add failing tests**

In `src/components/FileAnalysisHistoryMenu.test.jsx`, add `onStopFile` to the
`handlers` object inside `renderMenu` (so it is passed in):

```js
  const handlers = {
    onSelectFile: vi.fn(),
    onReanalyzeFile: vi.fn(),
    onRemoveFile: vi.fn(),
    onClearAllFiles: vi.fn(),
    onStopFile: vi.fn(),
  };
```

Then append these tests inside the `describe` block:

```js
  it("shows a progress indicator on the trigger while a file analyzes", () => {
    render(
      <FileAnalysisHistoryMenu
        fileSessions={sessions}
        activeFileId="complete"
        analyzingFileId="analyzing"
      />
    );

    // Accessible name stays the plain count; the percentage is decorative.
    expect(screen.getByRole("button", { name: "4 files" })).toBeTruthy();
    expect(screen.getByText("42%")).toBeTruthy();
  });

  it("stops the analyzing entry without removing it", () => {
    const handlers = renderMenu();

    fireEvent.click(screen.getByRole("button", { name: "Stop analyzing scan.wav" }));
    expect(handlers.onStopFile).toHaveBeenCalledWith("analyzing");
    expect(handlers.onRemoveFile).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/FileAnalysisHistoryMenu.test.jsx`
Expected: FAIL — no `Stop analyzing scan.wav` button; `42%` only appears inside the (closed) popover, not on the trigger.

- [ ] **Step 3: Add the `Square` icon import**

In `src/components/FileAnalysisHistoryMenu.jsx:1`, change the lucide import to:

```jsx
import { RefreshCw, Square, Trash2 } from "lucide-react";
```

- [ ] **Step 4: Compute the analyzing progress and give the trigger a stable name**

In `src/components/FileAnalysisHistoryMenu.jsx`, update the component signature to
accept `onStopFile`, and add the progress computation right after the early
return. Replace:

```jsx
export function FileAnalysisHistoryMenu({
  fileSessions = [],
  activeFileId = null,
  analyzingFileId = null,
  onSelectFile,
  onReanalyzeFile,
  onRemoveFile,
  onClearAllFiles,
}) {
  const count = fileSessions.length;
  if (count === 0) return null;
```

with:

```jsx
export function FileAnalysisHistoryMenu({
  fileSessions = [],
  activeFileId = null,
  analyzingFileId = null,
  onSelectFile,
  onReanalyzeFile,
  onRemoveFile,
  onClearAllFiles,
  onStopFile,
}) {
  const count = fileSessions.length;
  if (count === 0) return null;

  const countLabel = `${count} ${count === 1 ? "file" : "files"}`;
  const analyzingSession = analyzingFileId
    ? fileSessions.find((session) => session.id === analyzingFileId)
    : null;
  const analyzingPct =
    analyzingSession && Number.isFinite(analyzingSession.progress)
      ? Math.max(0, Math.min(100, Math.round(analyzingSession.progress * 100)))
      : null;
```

- [ ] **Step 5: Render the trigger with a stable label and a decorative indicator**

Replace the `PopoverTrigger` button
(`src/components/FileAnalysisHistoryMenu.jsx:43-50`) with:

```jsx
        <button
          type="button"
          aria-label={countLabel}
          className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-border/70 bg-background/35 px-2.5 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-muted/55 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <span>{countLabel}</span>
          {analyzingPct != null ? (
            <span aria-hidden="true" className="text-[10px] tabular-nums text-muted-foreground">
              · {analyzingPct}%
            </span>
          ) : null}
        </button>
```

(The explicit `aria-label={countLabel}` keeps the accessible name as the plain
count, so existing `{ name: "N files" }` queries keep working while the
percentage is shown visually.)

- [ ] **Step 6: Render a Stop button on the analyzing entry**

In the per-session row actions, replace the hover-action span
(`src/components/FileAnalysisHistoryMenu.jsx:115-132`) with:

```jsx
                <span className="flex shrink-0 items-center gap-0.5 pr-1">
                  {isAnalyzing ? (
                    <button
                      type="button"
                      onClick={() => onStopFile?.(session.id)}
                      aria-label={`Stop analyzing ${session.fileName}`}
                      className="rounded p-1 text-[color:var(--ui-signal-bad)] transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <Square className="size-3.5" />
                    </button>
                  ) : (
                    <span className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                      <button
                        type="button"
                        onClick={() => onReanalyzeFile?.(session.id)}
                        aria-label={`Reanalyze ${session.fileName}`}
                        className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      >
                        <RefreshCw className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemoveFile?.(session.id)}
                        aria-label={`Remove ${session.fileName}`}
                        className="rounded p-1 text-muted-foreground transition-colors hover:text-destructive focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </span>
                  )}
                </span>
```

(The analyzing entry shows an always-visible Stop instead of Reanalyze/Remove;
all other entries keep the hover-revealed Reanalyze + Remove.)

- [ ] **Step 7: Forward `onStopFile` from `FileAnalysisSummary`**

In `src/components/FileAnalysisSummary.jsx`, add `onStopFile` to the props
destructure (alongside `onClearAllFiles`) and pass it into the
`<FileAnalysisHistoryMenu .../>` element:

```jsx
export function FileAnalysisSummary({
  fileSession,
  fileSessions,
  activeFileId,
  analyzingFileId,
  onSelectFile,
  onReanalyzeFile,
  onRemoveFile,
  onClearAllFiles,
  onStopFile,
}) {
  const historyMenu = (
    <FileAnalysisHistoryMenu
      fileSessions={fileSessions}
      activeFileId={activeFileId}
      analyzingFileId={analyzingFileId}
      onSelectFile={onSelectFile}
      onReanalyzeFile={onReanalyzeFile}
      onRemoveFile={onRemoveFile}
      onClearAllFiles={onClearAllFiles}
      onStopFile={onStopFile}
    />
  );
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run src/components/FileAnalysisHistoryMenu.test.jsx src/components/FileAnalysisSummary.test.jsx`
Expected: PASS (all tests in both files).

- [ ] **Step 9: Commit**

```bash
git add src/components/FileAnalysisHistoryMenu.jsx src/components/FileAnalysisHistoryMenu.test.jsx src/components/FileAnalysisSummary.jsx
git commit -m "feat(file-mode): add stop control and progress indicator to the file-list popover"
```

---

## Task 5: Wire the stop callback through `App.jsx`

**Files:**
- Modify: `src/App.jsx:1113-1119` (near `onSelectFile`) and `src/App.jsx:1517-1526` (the `<FileAnalysisSummary />` element)

- [ ] **Step 1: Add the `onStopFile` handler**

In `src/App.jsx`, immediately after the `onSelectFile` definition
(`src/App.jsx:1113-1119`), add:

```jsx
  const onStopFile = () => {
    void stopCurrentFileAnalysis();
  };
```

(`stopCurrentFileAnalysis` already targets `fileHistory.analyzingFileId` and
resets that session to `ready` without deleting it, which is exactly the Stop
semantics. Only the analyzing entry shows the Stop button, so no id check is
needed.)

- [ ] **Step 2: Pass it to the region**

In the `<FileAnalysisSummary ... />` element (`src/App.jsx:1517-1526`), add the
prop after `onClearAllFiles={onClearAllFiles}`:

```jsx
                onStopFile={onStopFile}
```

- [ ] **Step 3: Run the full check**

Run: `npm run check`
Expected: PASS — format, lint, all Vitest suites, build, version check, and Rust fmt/clippy/test all green.

- [ ] **Step 4: Manual smoke (desktop app)**

Run the desktop app (`npm run tauri dev`), switch to File mode, and verify:
- Drop file A (analyzes); while it runs, drop/open file B so a second analysis is queued — or analyze A, then select a completed B from the popover.
- While A analyzes and B (complete) is active: the pill shows B's duration + a greyed-out REANALYZE; the panels show B's data.
- The popover trigger shows `· NN%`; opening it shows a Stop button on A; clicking Stop returns A to "Ready" and keeps it in the list.
- No `Analyzing file` / `Analyzed file` text and no per-file progress line appear in the region; chips read Integrated / LRA / True Peak Max in that order.

- [ ] **Step 5: Commit**

```bash
git add src/App.jsx
git commit -m "feat(file-mode): wire the popover stop control to file analysis"
```

---

## Self-Review Notes

- **Spec coverage:** pill-follows-active (Task 1), greyed analyze/reanalyze (Tasks 1–2), free switching (already supported; asserted via Task 1 behavior + Task 5 smoke), region status/progress removal (Task 3), chips Integrated/LRA/TP (Task 3), metadata unchanged (Task 3 keeps `formatSessionMetadataLine`), popover trigger moved left (Task 3), Stop in popover + trigger indicator (Task 4), truncation warning kept (Task 3). Export/import explicitly out of scope — no task. All spec sections map to a task.
- **Naming consistency:** the new prop is `onStopFile` everywhere (menu, summary, App); the new state field is `primaryActionDisabled` in `deriveFileState`, the cluster, and its test; `countLabel`/`analyzingPct` are local to the menu.
- **No placeholders:** every code step shows the full replacement code and exact `npx vitest run` / `npm run check` commands with expected results.
