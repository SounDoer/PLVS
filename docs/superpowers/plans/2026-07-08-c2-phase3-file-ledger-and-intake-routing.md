# C2 Phase 3: File Session Ledger + Intake Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the file-analysis session ledger (fileHistory/fileRunRequest/run-id counter and their derived selectors) and the live-vs-file intake routing their own owner hooks, following the phase-2 pattern: pure state verbs in the hook, cross-domain orchestration (status lines, engine stop, source switching) stays in App.

**Architecture:** Same seam style as `useCaptureTransport` (spec: `docs/superpowers/specs/2026-07-08-c2-app-state-ownership-design.md`). Two hooks: `useIntakeRouting` (owns the empty-file fallback intake and the `intakeRef` switch, ~small) and `useFileSessionLedger` (owns the history/run-request state plus primitive verbs; App keeps guards + status text + engine calls). Behavior invariant; gate `npm run check` per commit; verify with real exit codes (`echo exit=$?`, never `| tail`).

---

### Task 1: `useIntakeRouting`

**Files:** Create `src/hooks/useIntakeRouting.js` + `.test.jsx`; Modify `src/App.jsx` (lines ~467–505 region)

Hook (moves App's emptyFileIntakeRef / fileDisplayIntake / fileAnalysisIntake / fileDisplayActiveRef / intakeRef / frequencyMarkerRef / getSpectrogramSnapsForKey verbatim, params replacing closure reads):

```js
import { useCallback, useMemo, useRef } from "react";
import { FrameIntake } from "../lib/FrameIntake.js";

/**
 * Owner of live-vs-file intake routing. Live and File keep separate history
 * rings so a source switch never bleeds one into the other; `intakeRef` always
 * points at the active source's ring and is what display / channel-metadata
 * reads use. The file frame pump drives the shared display only while the
 * analyzing session is also the displayed one (fileDisplayActiveRef).
 */
export function useIntakeRouting({ sourceMode, fileHistory, activeFileSession, analyzingFileSession, liveIntake }) {
  const emptyFileIntakeRef = useRef(null);
  if (emptyFileIntakeRef.current === null) emptyFileIntakeRef.current = new FrameIntake();
  const fileDisplayIntake = activeFileSession?.intake ?? emptyFileIntakeRef.current;
  const fileAnalysisIntake = analyzingFileSession?.intake ?? emptyFileIntakeRef.current;
  const fileDisplayActiveRef = useRef(false);
  fileDisplayActiveRef.current =
    sourceMode === "file" &&
    fileHistory.analyzingFileId != null &&
    fileHistory.analyzingFileId === fileHistory.activeFileId;
  const intakeRef = useRef(liveIntake);
  intakeRef.current = sourceMode === "file" ? fileDisplayIntake : liveIntake;
  const frequencyMarkerRef = useMemo(
    () => ({
      get current() {
        return intakeRef.current.getFrequencyChannelMarkers();
      },
    }),
    []
  );
  const getSpectrogramSnapsForKey = useCallback(
    (key) => intakeRef.current.getSpectrogramSnapsForKey(key),
    []
  );
  return { intakeRef, fileDisplayIntake, fileAnalysisIntake, fileDisplayActiveRef, frequencyMarkerRef, getSpectrogramSnapsForKey };
}
```

- [ ] Move + swap in App (destructure with the same local names); delete moved lines; keep `liveIntakeRef` in App (transport also needs it), pass `liveIntake: liveIntakeRef.current`.
- [ ] Tests: routing flips `intakeRef.current` between live intake and active file intake by sourceMode; falls back to the empty intake without sessions; fileDisplayActiveRef true only when analyzing==active in file mode.
- [ ] `npm test` (real exit code) → commit `refactor(app): own intake routing in useIntakeRouting`.

### Task 2: `useFileSessionLedger`

**Files:** Create `src/hooks/useFileSessionLedger.js` + `.test.jsx`; Modify `src/App.jsx`

Owns `fileHistory`, `fileRunRequest`, `fileEntrySeqRef` and exposes derived (`fileSessions`, `activeFileSession`, `analyzingFileSession`, `analyzingFileId`, `validRunRequest`) plus primitive verbs (each is today's `setFileHistory(...)`/`setFileRunRequest(...)` composition moved verbatim):

- `updateSession(sessionId, updater)` — updateFileEntry wrapper (today's `updateFileSession`)
- `setAnalyzingFileId(nextOrUpdater)` — moved verbatim
- `beginRun(path, analysisSettings)` — seq++, sessionId mint, `new FrameIntake()`, addFileEntry+startFileAnalysisEntry, setFileRunRequest; returns sessionId
- `rerun(entryId, path, analysisSettings)` — startFileAnalysisEntry + setFileRunRequest
- `markStopped(sessionId)` — the history block from `stopCurrentFileAnalysis` (entry→ready, analyzingFileId→null) + `setFileRunRequest(null)`
- `select(id)` / `remove(id)` / `clearAll()` — selectFileEntry / removeFileEntry / clearFileHistory wrappers (+ run-request clearing where today's code does it)

App keeps: busy guards + status strings, `setSelectedOffset(-1)`/`selectedOffsetRef` resets, `fileAnalysis.stop()` engine calls, sourceMode changes — composing ledger verbs exactly where the inline blocks were.

- [ ] Write hook by relocating the verbatim blocks; write renderHook tests (beginRun mints ids and marks analyzing; markStopped clears; select/remove/clearAll behave; validRunRequest gates on analyzing id).
- [ ] Swap App; grep `setFileHistory|setFileRunRequest|fileEntrySeqRef` in App → zero.
- [ ] `npm run check` (real exit code) → commit `refactor(app): own file sessions in useFileSessionLedger`.

### Task 3: Gate, push, CI watch; update spec phase table row 3 to done.
