# File Analysis Session History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add session-scoped multi-file history to File mode so users can analyze multiple files, retain their results/history in memory, and switch the displayed file without re-decoding.

**Architecture:** Keep the backend single-worker model. Add a frontend file-session registry where each file entry owns its own `FrameIntake`, and make File mode panels read from the active entry's intake. Separate `activeFileId` (displayed entry) from `analyzingFileId` (entry receiving worker frames/events) so completed entries can remain inspectable while one file is analyzing.

**Tech Stack:** React 19, existing `FrameIntake`, existing `useFileAnalysisEngine`, Vitest + @testing-library/react, Tauri IPC wrappers in `src/ipc/`, existing `Popover` and toolbar UI patterns.

**Spec:** `docs/superpowers/specs/2026-06-23-file-analysis-session-history-design.md`

---

## File Structure

Create:

- `src/lib/fileAnalysisSessionRegistry.js` — pure functions for creating, selecting, updating, removing, and evicting in-memory file analysis entries.
- `src/lib/fileAnalysisSessionRegistry.test.js` — unit tests for registry behavior and retention policy.
- `src/components/FileAnalysisHistoryMenu.jsx` — File banner history selector/dropdown.
- `src/components/FileAnalysisHistoryMenu.test.jsx` — component tests for rendering, selection, remove, reanalyze, and clear-all actions.

Modify:

- `src/App.jsx` — replace single `fileSession` / `fileIntakeRef` with registry state, active/analyzing ids, per-entry `FrameIntake`, lifecycle actions, and banner props.
- `src/hooks/useFileAnalysisEngine.js` — accept `sessionId`, `runId`, per-entry `intake`, and session updater callbacks; update the analyzing entry even when another entry is displayed.
- `src/hooks/useFileAnalysisEngine.test.jsx` — update hook tests for session identity, stale event filtering, and per-entry completion updates.
- `src/components/FileAnalysisSummary.jsx` — accept history menu props and render the selector at the right side of the banner.
- `src/components/FileAnalysisSummary.test.jsx` — update banner tests for history selector integration.
- `src/lib/sourceTransportState.js` — derive File pill from active/analyzing entry state without filenames.
- `src/lib/sourceTransportState.test.js` — cover active/analyzing split and File pill labels.

Do not modify in this plan:

- Rust `file_analysis` decode/session internals.
- `EngineSource` single-active-source invariant.
- Panel layout persistence or `SplitLayout`.
- Cross-restart persistence stores.

---

### Task 1: Add Pure File Session Registry

**Files:**
- Create: `src/lib/fileAnalysisSessionRegistry.js`
- Create: `src/lib/fileAnalysisSessionRegistry.test.js`

- [ ] **Step 1: Write registry tests**

Create `src/lib/fileAnalysisSessionRegistry.test.js`:

```js
import { describe, expect, it } from "vitest";
import { FrameIntake } from "./FrameIntake.js";
import {
  FILE_ANALYSIS_HISTORY_LIMIT,
  addFileEntry,
  clearFileHistory,
  createInitialFileHistory,
  getActiveFileSession,
  getAnalyzingFileSession,
  markFileAnalysisComplete,
  removeFileEntry,
  selectFileEntry,
  startFileAnalysisEntry,
  updateFileEntry,
} from "./fileAnalysisSessionRegistry.js";

function makeIntake() {
  return new FrameIntake();
}

describe("fileAnalysisSessionRegistry", () => {
  it("creates a new active ready entry for every imported path, including duplicate paths", () => {
    let history = createInitialFileHistory();

    history = addFileEntry(history, {
      path: "C:/mix/final.wav",
      intake: makeIntake(),
      id: "file-1",
      now: 100,
    });
    history = addFileEntry(history, {
      path: "C:/mix/final.wav",
      intake: makeIntake(),
      id: "file-2",
      now: 200,
    });

    expect(history.order).toEqual(["file-1", "file-2"]);
    expect(history.activeFileId).toBe("file-2");
    expect(history.sessionsById["file-1"].path).toBe("C:/mix/final.wav");
    expect(history.sessionsById["file-2"].path).toBe("C:/mix/final.wav");
    expect(history.sessionsById["file-1"].intake).not.toBe(history.sessionsById["file-2"].intake);
  });

  it("separates displayed active entry from the analyzing worker entry", () => {
    let history = createInitialFileHistory();
    history = addFileEntry(history, {
      path: "C:/mix/a.wav",
      intake: makeIntake(),
      id: "a",
      now: 100,
    });
    history = markFileAnalysisComplete(history, "a", {
      summary: { durationMs: 10_000 },
      decodedFrames: 100,
      now: 150,
    });
    history = addFileEntry(history, {
      path: "C:/mix/b.wav",
      intake: makeIntake(),
      id: "b",
      now: 200,
    });
    history = startFileAnalysisEntry(history, "b");
    history = selectFileEntry(history, "a");

    expect(history.activeFileId).toBe("a");
    expect(history.analyzingFileId).toBe("b");
    expect(getActiveFileSession(history).path).toBe("C:/mix/a.wav");
    expect(getAnalyzingFileSession(history).path).toBe("C:/mix/b.wav");
  });

  it("updates only the targeted entry", () => {
    let history = createInitialFileHistory();
    history = addFileEntry(history, { path: "C:/a.wav", intake: makeIntake(), id: "a", now: 1 });
    history = addFileEntry(history, { path: "C:/b.wav", intake: makeIntake(), id: "b", now: 2 });

    history = updateFileEntry(history, "a", (entry) => ({
      ...entry,
      state: "error",
      error: "Unsupported codec",
    }));

    expect(history.sessionsById.a.state).toBe("error");
    expect(history.sessionsById.b.state).toBe("ready");
  });

  it("removes the active entry and selects the most recent remaining entry", () => {
    let history = createInitialFileHistory();
    history = addFileEntry(history, { path: "C:/a.wav", intake: makeIntake(), id: "a", now: 1 });
    history = addFileEntry(history, { path: "C:/b.wav", intake: makeIntake(), id: "b", now: 2 });
    history = addFileEntry(history, { path: "C:/c.wav", intake: makeIntake(), id: "c", now: 3 });

    history = removeFileEntry(history, "c");

    expect(history.order).toEqual(["a", "b"]);
    expect(history.activeFileId).toBe("b");
    expect(history.sessionsById.c).toBeUndefined();
  });

  it("clears analyzing identity when removing the analyzing entry", () => {
    let history = createInitialFileHistory();
    history = addFileEntry(history, { path: "C:/a.wav", intake: makeIntake(), id: "a", now: 1 });
    history = startFileAnalysisEntry(history, "a");

    history = removeFileEntry(history, "a");

    expect(history.activeFileId).toBeNull();
    expect(history.analyzingFileId).toBeNull();
    expect(history.order).toEqual([]);
  });

  it("keeps at most five entries by evicting the oldest non-active completed/error entry", () => {
    let history = createInitialFileHistory();
    for (let i = 1; i <= FILE_ANALYSIS_HISTORY_LIMIT + 1; i += 1) {
      history = addFileEntry(history, {
        path: `C:/mix/${i}.wav`,
        intake: makeIntake(),
        id: `file-${i}`,
        now: i,
      });
      history = markFileAnalysisComplete(history, `file-${i}`, {
        summary: { durationMs: i * 1000 },
        decodedFrames: i,
        now: i + 0.5,
      });
    }

    expect(history.order).toHaveLength(FILE_ANALYSIS_HISTORY_LIMIT);
    expect(history.sessionsById["file-1"]).toBeUndefined();
    expect(history.sessionsById["file-6"]).toBeDefined();
    expect(history.activeFileId).toBe("file-6");
  });

  it("clears the whole registry", () => {
    let history = createInitialFileHistory();
    history = addFileEntry(history, { path: "C:/a.wav", intake: makeIntake(), id: "a", now: 1 });
    history = startFileAnalysisEntry(history, "a");

    history = clearFileHistory(history);

    expect(history.sessionsById).toEqual({});
    expect(history.order).toEqual([]);
    expect(history.activeFileId).toBeNull();
    expect(history.analyzingFileId).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npx vitest run src/lib/fileAnalysisSessionRegistry.test.js
```

Expected: FAIL because `src/lib/fileAnalysisSessionRegistry.js` does not exist.

- [ ] **Step 3: Implement registry helpers**

Create `src/lib/fileAnalysisSessionRegistry.js`:

```js
export const FILE_ANALYSIS_HISTORY_LIMIT = 5;

function basenameFromPath(path) {
  if (!path) return "Untitled file";
  const normalized = String(path).replaceAll("\\", "/");
  return normalized.split("/").filter(Boolean).at(-1) || normalized;
}

export function createInitialFileHistory() {
  return {
    sessionsById: {},
    order: [],
    activeFileId: null,
    analyzingFileId: null,
  };
}

export function getActiveFileSession(history) {
  return history?.activeFileId ? (history.sessionsById[history.activeFileId] ?? null) : null;
}

export function getAnalyzingFileSession(history) {
  return history?.analyzingFileId ? (history.sessionsById[history.analyzingFileId] ?? null) : null;
}

function withEviction(history) {
  if (history.order.length <= FILE_ANALYSIS_HISTORY_LIMIT) return history;
  const removeId = history.order.find((id) => {
    if (id === history.activeFileId || id === history.analyzingFileId) return false;
    const state = history.sessionsById[id]?.state;
    return state === "complete" || state === "error" || state === "ready";
  });
  return removeId ? removeFileEntry(history, removeId) : history;
}

export function addFileEntry(history, { path, intake, id, now = Date.now(), fileName }) {
  const entry = {
    id,
    path,
    fileName: fileName || basenameFromPath(path),
    state: "ready",
    metadata: undefined,
    summary: undefined,
    progress: undefined,
    error: undefined,
    intake,
    historyTruncated: false,
    historyCoveredMs: undefined,
    createdAt: now,
    analyzedAt: undefined,
    decodedFrames: undefined,
    runId: 0,
  };
  return withEviction({
    ...history,
    sessionsById: { ...history.sessionsById, [id]: entry },
    order: [...history.order, id],
    activeFileId: id,
  });
}

export function selectFileEntry(history, id) {
  if (!id || !history.sessionsById[id]) return history;
  return { ...history, activeFileId: id };
}

export function updateFileEntry(history, id, updater) {
  const current = history.sessionsById[id];
  if (!current) return history;
  const next = typeof updater === "function" ? updater(current) : { ...current, ...updater };
  return {
    ...history,
    sessionsById: { ...history.sessionsById, [id]: next },
  };
}

export function startFileAnalysisEntry(history, id) {
  return updateFileEntry(
    {
      ...history,
      analyzingFileId: id,
      activeFileId: id,
    },
    id,
    (entry) => ({
      ...entry,
      state: "analyzing",
      progress: 0,
      error: undefined,
      summary: undefined,
      historyTruncated: false,
      historyCoveredMs: undefined,
      decodedFrames: undefined,
      runId: (entry.runId ?? 0) + 1,
    })
  );
}

export function markFileAnalysisComplete(
  history,
  id,
  { summary, decodedFrames, historyTruncated = false, historyCoveredMs, now = Date.now() }
) {
  const next = updateFileEntry(history, id, (entry) => ({
    ...entry,
    state: "complete",
    progress: 1,
    summary,
    decodedFrames,
    historyTruncated,
    historyCoveredMs,
    analyzedAt: now,
  }));
  return next.analyzingFileId === id ? { ...next, analyzingFileId: null } : next;
}

export function markFileAnalysisError(history, id, { error, now = Date.now() }) {
  const next = updateFileEntry(history, id, (entry) => ({
    ...entry,
    state: "error",
    error,
    analyzedAt: now,
  }));
  return next.analyzingFileId === id ? { ...next, analyzingFileId: null } : next;
}

export function removeFileEntry(history, id) {
  if (!history.sessionsById[id]) return history;
  const { [id]: _removed, ...sessionsById } = history.sessionsById;
  const order = history.order.filter((entryId) => entryId !== id);
  const activeFileId =
    history.activeFileId === id ? (order.length ? order[order.length - 1] : null) : history.activeFileId;
  const analyzingFileId = history.analyzingFileId === id ? null : history.analyzingFileId;
  return { sessionsById, order, activeFileId, analyzingFileId };
}

export function clearFileHistory() {
  return createInitialFileHistory();
}
```

- [ ] **Step 4: Run registry tests**

Run:

```bash
npx vitest run src/lib/fileAnalysisSessionRegistry.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/fileAnalysisSessionRegistry.js src/lib/fileAnalysisSessionRegistry.test.js
git commit -m "feat(file-analysis): add in-memory session registry"
```

---

### Task 2: Adapt File Analysis Hook to Session Identity

**Files:**
- Modify: `src/hooks/useFileAnalysisEngine.js`
- Modify: `src/hooks/useFileAnalysisEngine.test.jsx`

- [ ] **Step 1: Add hook tests for session-scoped updates**

In `src/hooks/useFileAnalysisEngine.test.jsx`, update the harness so the hook is called with:

```js
useFileAnalysisEngine({
  enabled,
  sessionId: "entry-1",
  filePath,
  runId,
  histMaxSamples: 100,
  visualMaxSamples: 100,
  audioRef,
  frameRef,
  selectedOffsetRef,
  defaultSampleRateRef,
  intake,
  updateFileSession,
  setAnalyzingFileId,
  setAudio,
  setHistoryPathM: () => {},
  setHistoryPathST: () => {},
  setSelectedOffset,
  setStatus,
});
```

Add these tests:

```js
it("updates the targeted session during progress and completion", async () => {
  const updates = [];
  const updateFileSession = vi.fn((sessionId, updater) => {
    updates.push({ sessionId, updater });
  });
  const setAnalyzingFileId = vi.fn();

  render(
    <Harness
      enabled
      sessionId="entry-1"
      filePath="C:/mix/a.wav"
      runId={1}
      updateFileSession={updateFileSession}
      setAnalyzingFileId={setAnalyzingFileId}
    />
  );

  await waitFor(() => expect(probeFileAnalysis).toHaveBeenCalledWith("C:/mix/a.wav"));
  expect(updateFileSession).toHaveBeenCalledWith("entry-1", expect.any(Function));
  expect(setAnalyzingFileId).toHaveBeenCalledWith("entry-1");
});

it("ignores stale completion events for a previous run tuple", async () => {
  const updateFileSession = vi.fn();
  const setAnalyzingFileId = vi.fn();

  render(
    <Harness
      enabled
      sessionId="entry-1"
      filePath="C:/mix/a.wav"
      runId={1}
      updateFileSession={updateFileSession}
      setAnalyzingFileId={setAnalyzingFileId}
    />
  );

  await waitFor(() => expect(onFileAnalysisCompleted).toHaveBeenCalled());
  const completedHandler = onFileAnalysisCompleted.mock.calls[0][0];

  act(() => {
    completedHandler({
      path: "C:/mix/other.wav",
      summary: { durationMs: 1000 },
      decodedFrames: 10,
    });
  });

  expect(updateFileSession).not.toHaveBeenCalledWith(
    "entry-1",
    expect.objectContaining({ state: "complete" })
  );
});
```

Adjust imports in the test file:

```js
import { act, render, waitFor } from "@testing-library/react";
import {
  onFileAnalysisCompleted,
  onFileAnalysisError,
  onFileAnalysisProgress,
} from "../ipc/events.js";
```

- [ ] **Step 2: Run hook tests to verify they fail**

Run:

```bash
npx vitest run src/hooks/useFileAnalysisEngine.test.jsx
```

Expected: FAIL because the hook does not accept `sessionId`, `updateFileSession`, or `setAnalyzingFileId`.

- [ ] **Step 3: Update hook signature and lifecycle**

In `src/hooks/useFileAnalysisEngine.js`, change the function parameters to include:

```js
export function useFileAnalysisEngine({
  enabled,
  sessionId,
  filePath,
  runId,
  histMaxSamples,
  visualMaxSamples,
  audioRef,
  frameRef,
  selectedOffsetRef,
  defaultSampleRateRef,
  intake,
  updateFileSession,
  setAnalyzingFileId,
  setAudio,
  setHistoryPathM,
  setHistoryPathST,
  setSelectedOffset,
  setStatus,
}) {
```

At the top of the effect, require `sessionId`:

```js
useEffect(() => {
  if (!enabled || !sessionId || !filePath || runId <= 0) return;
```

Inside `run`, replace `setFileSession(...)` calls with targeted updates:

```js
const runTuple = { sessionId, filePath, runId };

activePathRef.current = filePath;
intake.reset();
frameRef.current = 0;
selectedOffsetRef.current = -1;
setSelectedOffset(-1);
setHistoryPathM("");
setHistoryPathST("");
setAnalyzingFileId(sessionId);
setStatus("Probing file...");

const metadata = await probeFileAnalysis(filePath);
if (!mounted) return;

defaultSampleRateRef.current = metadata.selectedTrack?.sampleRateHz || 48000;
updateFileSession(sessionId, (current) => ({
  ...current,
  state: "analyzing",
  path: filePath,
  fileName: metadata.fileName,
  metadata,
  progress: 0,
  error: undefined,
  summary: undefined,
}));
setStatus(`Analyzing ${metadata.fileName}`);
```

For progress events:

```js
await onFileAnalysisProgress((payload) => {
  if (payload?.path !== runTuple.filePath) return;
  updateFileSession(runTuple.sessionId, (current) => ({
    ...current,
    state: "analyzing",
    progress: Number.isFinite(payload.progress) ? payload.progress : current.progress,
  }));
});
```

For completion:

```js
await onFileAnalysisCompleted((payload) => {
  if (payload?.path !== runTuple.filePath) return;
  const { historyTruncated, historyCoveredMs } = detectHistoryTruncation(
    intake,
    histMaxSamples,
    payload.summary?.durationMs
  );
  updateFileSession(runTuple.sessionId, (current) => ({
    ...current,
    state: "complete",
    progress: 1,
    decodedFrames: payload.decodedFrames,
    summary: payload.summary,
    historyTruncated,
    historyCoveredMs,
    analyzedAt: Date.now(),
  }));
  setAnalyzingFileId((current) => (current === runTuple.sessionId ? null : current));
  setStatus("File analysis complete");
});
```

For errors:

```js
await onFileAnalysisError((payload) => {
  if (payload?.path !== runTuple.filePath) return;
  updateFileSession(runTuple.sessionId, (current) => ({
    ...current,
    state: "error",
    error: payload.message,
    analyzedAt: Date.now(),
  }));
  setAnalyzingFileId((current) => (current === runTuple.sessionId ? null : current));
  setStatus(`Error: ${payload.message}`);
});
```

In the catch block:

```js
const message = err?.message || "File analysis unavailable";
updateFileSession(sessionId, (current) => ({
  ...current,
  state: "error",
  path: filePath,
  error: message,
  analyzedAt: Date.now(),
}));
setAnalyzingFileId((current) => (current === sessionId ? null : current));
setStatus(`Error: ${message}`);
```

Keep `stop` calling `stopFileAnalysis()`, but remove single-session `setFileSession` assumptions from the hook. Return:

```js
return { stop };
```

- [ ] **Step 4: Run hook tests**

Run:

```bash
npx vitest run src/hooks/useFileAnalysisEngine.test.jsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useFileAnalysisEngine.js src/hooks/useFileAnalysisEngine.test.jsx
git commit -m "refactor(file-analysis): scope engine updates to file sessions"
```

---

### Task 3: Wire Registry Into App Display and File Lifecycle

**Files:**
- Modify: `src/App.jsx`
- Modify: `src/lib/sourceTransportState.js`
- Modify: `src/lib/sourceTransportState.test.js`

- [ ] **Step 1: Update transport state tests for active/analyzing split**

In `src/lib/sourceTransportState.test.js`, add:

```js
it("shows analyzing progress when a file worker is running", () => {
  expect(
    deriveSourceTransportState({
      sourceMode: "file",
      fileSession: { state: "complete", summary: { durationMs: 120_000 } },
      analyzingFileSession: { state: "analyzing", progress: 0.42 },
    })
  ).toMatchObject({
    sourceLabel: "File",
    statusLabel: "42%",
    actionLabel: "STOP",
    chromeState: "live",
    actionKind: "stopFileAnalysis",
  });
});

it("keeps completed active file time when no file worker is running", () => {
  expect(
    deriveSourceTransportState({
      sourceMode: "file",
      fileSession: { state: "complete", summary: { durationMs: 120_000 } },
      analyzingFileSession: null,
    })
  ).toMatchObject({
    statusLabel: "00:02:00",
    actionLabel: "REANALYZE",
    actionKind: "reanalyzeFile",
  });
});
```

- [ ] **Step 2: Run transport tests to verify they fail**

Run:

```bash
npx vitest run src/lib/sourceTransportState.test.js
```

Expected: FAIL because `deriveSourceTransportState` ignores `analyzingFileSession`.

- [ ] **Step 3: Update source transport derivation**

In `src/lib/sourceTransportState.js`, change `deriveFileState` signature:

```js
function deriveFileState({
  selectedOffset = -1,
  selectedMediaTimeMs,
  fileSession = {},
  analyzingFileSession = null,
}) {
```

Before the active `state` checks, add:

```js
if (analyzingFileSession?.state === "analyzing") {
  return {
    sourceLabel: "File",
    statusLabel: formatProgress(analyzingFileSession.progress),
    actionLabel: "STOP",
    chromeState: "live",
    actionKind: "stopFileAnalysis",
  };
}
```

Keep scrub mode first so selected media time still shows when the user is scrubbed:

```js
if (selectedOffset >= 0 && Number.isFinite(selectedMediaTimeMs)) {
  return {
    sourceLabel: "File",
    statusLabel: formatClock(selectedMediaTimeMs),
    actionLabel: "RESULT",
    chromeState: "snapshot",
    actionKind: "returnToFileResult",
  };
}
```

- [ ] **Step 4: Replace App single-file state with registry state**

In `src/App.jsx`, import registry helpers:

```js
import {
  addFileEntry,
  clearFileHistory,
  createInitialFileHistory,
  getActiveFileSession,
  getAnalyzingFileSession,
  removeFileEntry,
  selectFileEntry,
  startFileAnalysisEntry,
  updateFileEntry,
} from "./lib/fileAnalysisSessionRegistry.js";
```

Replace:

```js
const [fileSession, setFileSession] = useState({ state: "empty" });
const [pendingFilePath, setPendingFilePath] = useState("");
const [fileRunId, setFileRunId] = useState(0);
```

with:

```js
const [fileHistory, setFileHistory] = useState(() => createInitialFileHistory());
const [fileRunRequest, setFileRunRequest] = useState(null);
const fileEntrySeqRef = useRef(0);
const activeFileSession = getActiveFileSession(fileHistory);
const analyzingFileSession = getAnalyzingFileSession(fileHistory);
const fileSession = activeFileSession ?? { state: "empty" };
```

Replace the file intake selection:

```js
intakeRef.current =
  sourceMode === "file" && activeFileSession?.intake
    ? activeFileSession.intake
    : liveIntakeRef.current;
```

Add stable registry callbacks:

```js
const updateFileSession = useCallback((sessionId, updater) => {
  setFileHistory((current) => updateFileEntry(current, sessionId, updater));
}, []);

const setAnalyzingFileId = useCallback((next) => {
  setFileHistory((current) => ({
    ...current,
    analyzingFileId: typeof next === "function" ? next(current.analyzingFileId) : next,
  }));
}, []);
```

Replace `beginFileAnalysis(path)` with:

```js
const beginFileAnalysis = useCallback((path) => {
  if (!path) return;
  const id = `file-${Date.now()}-${++fileEntrySeqRef.current}`;
  const intake = new FrameIntake();

  setSelectedOffset(-1);
  setFileHistory((current) => {
    const withEntry = addFileEntry(current, { path, intake, id, now: Date.now() });
    return startFileAnalysisEntry(withEntry, id);
  });
  setFileRunRequest({ sessionId: id, filePath: path, runId: Date.now() });
}, []);
```

Pass registry data to `deriveSourceTransportState`:

```js
const sourceTransportState = deriveSourceTransportState({
  sourceMode,
  running,
  selectedOffset,
  latestTimestampMs,
  elapsedMs: elapsedMsRef.current,
  selectedMediaTimeMs,
  fileSession,
  analyzingFileSession,
});
```

Pass the analyzing entry to `useFileAnalysisEngine`:

```js
const fileAnalysis = useFileAnalysisEngine({
  enabled:
    sourceMode === "file" &&
    Boolean(fileRunRequest?.sessionId) &&
    Boolean(fileRunRequest?.filePath),
  sessionId: fileRunRequest?.sessionId,
  filePath: fileRunRequest?.filePath,
  runId: fileRunRequest?.runId ?? 0,
  histMaxSamples: HIST_MAX_SAMPLES,
  visualMaxSamples: VISUAL_MAX_SAMPLES,
  audioRef,
  frameRef,
  selectedOffsetRef,
  defaultSampleRateRef,
  intake: analyzingFileSession?.intake ?? activeFileSession?.intake ?? new FrameIntake(),
  updateFileSession,
  setAnalyzingFileId,
  setAudio,
  setHistoryPathM: () => {},
  setHistoryPathST: () => {},
  setSelectedOffset,
  setStatus,
});
```

If a fresh `new FrameIntake()` in render causes identity churn, replace it with:

```js
const emptyFileIntakeRef = useRef(new FrameIntake());
```

and use `emptyFileIntakeRef.current` as the fallback.

- [ ] **Step 5: Run focused tests**

Run:

```bash
npx vitest run src/lib/fileAnalysisSessionRegistry.test.js src/lib/sourceTransportState.test.js src/hooks/useFileAnalysisEngine.test.jsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/App.jsx src/lib/sourceTransportState.js src/lib/sourceTransportState.test.js
git commit -m "feat(file-analysis): wire file session registry into app state"
```

---

### Task 4: Implement File Actions, Clear Semantics, and Source Switching

**Files:**
- Modify: `src/App.jsx`
- Modify: `src/lib/fileAnalysisSessionRegistry.js`
- Modify: `src/lib/fileAnalysisSessionRegistry.test.js`

- [ ] **Step 1: Add registry tests for reanalysis and current-entry clear**

Append to `src/lib/fileAnalysisSessionRegistry.test.js`:

```js
it("starts reanalysis on the active entry without creating a new entry", () => {
  let history = createInitialFileHistory();
  history = addFileEntry(history, { path: "C:/a.wav", intake: makeIntake(), id: "a", now: 1 });
  history = markFileAnalysisComplete(history, "a", {
    summary: { durationMs: 1000 },
    decodedFrames: 12,
    now: 2,
  });

  history = startFileAnalysisEntry(history, "a");

  expect(history.order).toEqual(["a"]);
  expect(history.activeFileId).toBe("a");
  expect(history.analyzingFileId).toBe("a");
  expect(history.sessionsById.a.state).toBe("analyzing");
  expect(history.sessionsById.a.summary).toBeUndefined();
});

it("does not evict the active entry when enforcing the retention limit", () => {
  let history = createInitialFileHistory();
  for (let i = 1; i <= 5; i += 1) {
    history = addFileEntry(history, { path: `C:/${i}.wav`, intake: makeIntake(), id: `${i}`, now: i });
    history = markFileAnalysisComplete(history, `${i}`, {
      summary: { durationMs: i * 1000 },
      decodedFrames: i,
      now: i + 0.1,
    });
  }
  history = selectFileEntry(history, "1");
  history = addFileEntry(history, { path: "C:/6.wav", intake: makeIntake(), id: "6", now: 6 });
  history = markFileAnalysisComplete(history, "6", {
    summary: { durationMs: 6000 },
    decodedFrames: 6,
    now: 6.1,
  });

  expect(history.sessionsById["1"]).toBeDefined();
  expect(history.order).toHaveLength(5);
});
```

- [ ] **Step 2: Run registry tests**

Run:

```bash
npx vitest run src/lib/fileAnalysisSessionRegistry.test.js
```

Expected: PASS after adjusting helper behavior if needed.

- [ ] **Step 3: Update `onSourceTransportAction`**

In `src/App.jsx`, make actions use active/analyzing entries:

```js
if (actionKind === "chooseFile" || actionKind === "analyzeFile") {
  const path = await pickMediaFile();
  if (path) beginFileAnalysis(path);
  return;
}

if (actionKind === "reanalyzeFile") {
  const entry = activeFileSession;
  if (!entry?.path) {
    setStatus("Choose a file to analyze");
    return;
  }
  setSelectedOffset(-1);
  setFileHistory((current) => startFileAnalysisEntry(current, entry.id));
  setFileRunRequest({ sessionId: entry.id, filePath: entry.path, runId: Date.now() });
  return;
}

if (actionKind === "stopFileAnalysis") {
  void fileAnalysis.stop();
  setAnalyzingFileId(null);
  setFileHistory((current) => {
    const id = current.analyzingFileId;
    return id
      ? updateFileEntry(current, id, (entry) => ({
          ...entry,
          state: entry.fileName ? "ready" : "empty",
          progress: undefined,
        }))
      : current;
  });
  return;
}
```

- [ ] **Step 4: Update toolbar Clear in File mode**

In `clearAll`, replace the single-file branch with:

```js
if (sourceMode === "file") {
  const activeId = fileHistory.activeFileId;
  if (activeId && fileHistory.analyzingFileId === activeId) {
    void fileAnalysis.stop();
  }
  setFileHistory((current) => removeFileEntry(current, activeId));
  setFileRunRequest((current) => (current?.sessionId === activeId ? null : current));
  setStatus("File mode - drop a file or click Analyze");
  resetTimer({ restart: false });
  setShowClock(false);
  return;
}
```

Update the Clear disabled condition:

```js
disabled={
  sourceMode === "file"
    ? !activeFileSession
    : !running && !showClock
}
```

- [ ] **Step 5: Update source switching**

In `onSourceModeChange`, keep file registry when leaving File mode, but stop a worker:

```js
if (fileHistory.analyzingFileId) {
  void fileAnalysis.stop();
  setAnalyzingFileId(null);
}
```

Do not call `clearFileHistory()` during Live/File source switching.

- [ ] **Step 6: Run focused tests and lint**

Run:

```bash
npx vitest run src/lib/fileAnalysisSessionRegistry.test.js src/lib/sourceTransportState.test.js
npm run lint
```

Expected: tests PASS; lint has no errors. Existing warnings in unrelated hooks may remain.

- [ ] **Step 7: Commit**

```bash
git add src/App.jsx src/lib/fileAnalysisSessionRegistry.js src/lib/fileAnalysisSessionRegistry.test.js
git commit -m "feat(file-analysis): define multi-file action semantics"
```

---

### Task 5: Add File History Selector UI

**Files:**
- Create: `src/components/FileAnalysisHistoryMenu.jsx`
- Create: `src/components/FileAnalysisHistoryMenu.test.jsx`
- Modify: `src/components/FileAnalysisSummary.jsx`
- Modify: `src/components/FileAnalysisSummary.test.jsx`
- Modify: `src/App.jsx`

- [ ] **Step 1: Write history menu component tests**

Create `src/components/FileAnalysisHistoryMenu.test.jsx`:

```js
/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FileAnalysisHistoryMenu } from "./FileAnalysisHistoryMenu.jsx";

const sessions = [
  {
    id: "a",
    fileName: "mix-a.wav",
    state: "complete",
    summary: { durationMs: 120_000 },
  },
  {
    id: "b",
    fileName: "mix-b.wav",
    state: "analyzing",
    progress: 0.42,
  },
  {
    id: "c",
    fileName: "broken.wav",
    state: "error",
    error: "Unsupported codec",
  },
];

describe("FileAnalysisHistoryMenu", () => {
  it("renders file count and session rows", async () => {
    render(
      <FileAnalysisHistoryMenu
        sessions={sessions}
        activeFileId="a"
        analyzingFileId="b"
        onSelect={() => {}}
        onReanalyze={() => {}}
        onRemove={() => {}}
        onClearAll={() => {}}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: /3 files/i }));

    expect(screen.getByText("mix-a.wav")).toBeTruthy();
    expect(screen.getByText("00:02:00")).toBeTruthy();
    expect(screen.getByText("mix-b.wav")).toBeTruthy();
    expect(screen.getByText("42%")).toBeTruthy();
    expect(screen.getByText("broken.wav")).toBeTruthy();
    expect(screen.getByText("Error")).toBeTruthy();
  });

  it("calls actions for select, reanalyze, remove, and clear all", async () => {
    const onSelect = vi.fn();
    const onReanalyze = vi.fn();
    const onRemove = vi.fn();
    const onClearAll = vi.fn();

    render(
      <FileAnalysisHistoryMenu
        sessions={sessions}
        activeFileId="a"
        analyzingFileId="b"
        onSelect={onSelect}
        onReanalyze={onReanalyze}
        onRemove={onRemove}
        onClearAll={onClearAll}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: /3 files/i }));
    await userEvent.click(screen.getByRole("button", { name: /show mix-b.wav/i }));
    await userEvent.click(screen.getByRole("button", { name: /reanalyze mix-a.wav/i }));
    await userEvent.click(screen.getByRole("button", { name: /remove broken.wav/i }));
    await userEvent.click(screen.getByRole("button", { name: /clear all file history/i }));

    expect(onSelect).toHaveBeenCalledWith("b");
    expect(onReanalyze).toHaveBeenCalledWith("a");
    expect(onRemove).toHaveBeenCalledWith("c");
    expect(onClearAll).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run menu tests to verify they fail**

Run:

```bash
npx vitest run src/components/FileAnalysisHistoryMenu.test.jsx
```

Expected: FAIL because component does not exist.

- [ ] **Step 3: Implement `FileAnalysisHistoryMenu`**

Create `src/components/FileAnalysisHistoryMenu.jsx`:

```jsx
import { MoreHorizontal, RefreshCw, Trash2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatClock } from "../hooks/useSessionTimer.js";
import { cn } from "@/lib/utils";

function entryStatus(entry) {
  if (entry.state === "analyzing") {
    const progress = Number.isFinite(entry.progress) ? Math.round(entry.progress * 100) : 0;
    return `${progress}%`;
  }
  if (entry.state === "complete") {
    const durationMs = entry.summary?.durationMs ?? entry.metadata?.durationMs;
    return Number.isFinite(durationMs) ? formatClock(durationMs) : "Done";
  }
  if (entry.state === "error") return "Error";
  return "Ready";
}

export function FileAnalysisHistoryMenu({
  sessions,
  activeFileId,
  analyzingFileId,
  onSelect,
  onReanalyze,
  onRemove,
  onClearAll,
}) {
  if (!sessions.length) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex h-8 shrink-0 items-center gap-2 rounded-md border border-border/80 bg-background/35 px-3 text-xs font-semibold text-foreground transition-colors hover:bg-muted/45"
          aria-label={`${sessions.length} files`}
        >
          <MoreHorizontal className="size-3.5" />
          {sessions.length} {sessions.length === 1 ? "file" : "files"}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-80 p-1">
        <div className="flex items-center justify-between px-2 py-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            File history
          </p>
          <button
            type="button"
            className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
            onClick={onClearAll}
            aria-label="Clear all file history"
          >
            Clear all
          </button>
        </div>
        <div className="max-h-72 overflow-y-auto">
          {sessions.map((entry) => {
            const active = entry.id === activeFileId;
            const analyzing = entry.id === analyzingFileId;
            return (
              <div
                key={entry.id}
                className={cn(
                  "grid grid-cols-[1fr_auto] gap-2 rounded px-2 py-1.5",
                  active ? "bg-muted/55" : "hover:bg-muted/35"
                )}
              >
                <button
                  type="button"
                  className="min-w-0 text-left"
                  onClick={() => onSelect(entry.id)}
                  aria-label={`Show ${entry.fileName}`}
                >
                  <span className="block truncate text-xs font-semibold text-foreground">
                    {entry.fileName}
                  </span>
                  <span className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span>{entryStatus(entry)}</span>
                    {analyzing ? <span className="text-[color:var(--ui-signal-bad)]">Analyzing</span> : null}
                    {active ? <span>Active</span> : null}
                  </span>
                </button>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    className="rounded p-1 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                    onClick={() => onReanalyze(entry.id)}
                    aria-label={`Reanalyze ${entry.fileName}`}
                  >
                    <RefreshCw className="size-3" />
                  </button>
                  <button
                    type="button"
                    className="rounded p-1 text-muted-foreground hover:bg-muted/50 hover:text-[color:var(--ui-signal-bad)]"
                    onClick={() => onRemove(entry.id)}
                    aria-label={`Remove ${entry.fileName}`}
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 4: Wire menu into summary banner**

In `src/components/FileAnalysisSummary.jsx`, import:

```js
import { FileAnalysisHistoryMenu } from "./FileAnalysisHistoryMenu.jsx";
```

Change signature:

```js
export function FileAnalysisSummary({
  fileSession,
  fileSessions = [],
  activeFileId,
  analyzingFileId,
  onSelectFile,
  onReanalyzeFile,
  onRemoveFile,
  onClearAllFiles,
}) {
```

At the end of the main banner row, before closing `</section>`, render:

```jsx
<FileAnalysisHistoryMenu
  sessions={fileSessions}
  activeFileId={activeFileId}
  analyzingFileId={analyzingFileId}
  onSelect={onSelectFile}
  onReanalyze={onReanalyzeFile}
  onRemove={onRemoveFile}
  onClearAll={onClearAllFiles}
/>
```

For the error state, render the same menu after the error text so history remains accessible.

- [ ] **Step 5: Wire menu props from App**

In `src/App.jsx`, derive ordered sessions:

```js
const fileSessions = fileHistory.order.map((id) => fileHistory.sessionsById[id]).filter(Boolean);
```

Add handlers:

```js
const selectFileSession = useCallback((id) => {
  setSelectedOffset(-1);
  clearMeterDisplayState();
  setFileHistory((current) => selectFileEntry(current, id));
}, []);

const reanalyzeFileSession = useCallback((id) => {
  const entry = fileHistory.sessionsById[id];
  if (!entry?.path || fileHistory.analyzingFileId) return;
  setSelectedOffset(-1);
  setFileHistory((current) => startFileAnalysisEntry(selectFileEntry(current, id), id));
  setFileRunRequest({ sessionId: id, filePath: entry.path, runId: Date.now() });
}, [fileHistory]);

const removeFileSession = useCallback((id) => {
  if (!id) return;
  if (fileHistory.analyzingFileId === id) void fileAnalysis.stop();
  setFileHistory((current) => removeFileEntry(current, id));
  setFileRunRequest((current) => (current?.sessionId === id ? null : current));
}, [fileAnalysis, fileHistory.analyzingFileId]);

const clearAllFileSessions = useCallback(() => {
  if (fileHistory.analyzingFileId) void fileAnalysis.stop();
  setFileHistory(clearFileHistory());
  setFileRunRequest(null);
  clearMeterDisplayState();
  setStatus("File mode - drop a file or click Analyze");
}, [fileAnalysis, fileHistory.analyzingFileId]);
```

Pass props:

```jsx
<FileAnalysisSummary
  fileSession={fileSession}
  fileSessions={fileSessions}
  activeFileId={fileHistory.activeFileId}
  analyzingFileId={fileHistory.analyzingFileId}
  onSelectFile={selectFileSession}
  onReanalyzeFile={reanalyzeFileSession}
  onRemoveFile={removeFileSession}
  onClearAllFiles={clearAllFileSessions}
/>
```

- [ ] **Step 6: Run component tests**

Run:

```bash
npx vitest run src/components/FileAnalysisHistoryMenu.test.jsx src/components/FileAnalysisSummary.test.jsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/FileAnalysisHistoryMenu.jsx src/components/FileAnalysisHistoryMenu.test.jsx src/components/FileAnalysisSummary.jsx src/components/FileAnalysisSummary.test.jsx src/App.jsx
git commit -m "feat(file-analysis): add file history selector"
```

---

### Task 6: End-to-End Verification and Cleanup

**Files:**
- Modify only files touched by earlier tasks if verification exposes issues.

- [ ] **Step 1: Run full frontend tests**

Run:

```bash
npm test
```

Expected: all Vitest tests PASS.

- [ ] **Step 2: Run lint**

Run:

```bash
npm run lint
```

Expected: no lint errors. Existing unrelated warnings in `useSettings.js` and `useThemeEditor.js` may remain.

- [ ] **Step 3: Run frontend build**

Run:

```bash
npm run build
```

Expected: build succeeds. Existing Vite large chunk warning may remain.

- [ ] **Step 4: Run desktop build for manual testing**

Run:

```bash
npm run desktop:build
```

Expected:

```txt
Built application at:
src-tauri/target/release/plvs.exe
Finished 2 bundles at:
src-tauri/target/release/bundle/msi/PLVS_0.4.0_x64_en-US.msi
src-tauri/target/release/bundle/nsis/PLVS_0.4.0_x64-setup.exe
```

- [ ] **Step 5: Manual test checklist**

Use the built app and verify:

```txt
1. Switch to File mode.
2. Open file A and wait for completion.
3. Open file B and wait for completion.
4. Use the banner history menu to switch back to file A.
5. Confirm file A summary and scrub history return without a progress bar.
6. Switch to file B and confirm file B summary/history return.
7. Open the same path as file A again and confirm a third entry appears.
8. Click REANALYZE on the active entry and confirm it overwrites only that entry.
9. Click toolbar Clear and confirm only the active entry is removed.
10. Use Clear all and confirm File mode returns to empty state.
11. Switch File -> Live -> File and confirm retained file entries remain.
12. Close and reopen the app and confirm no file history persists.
```

- [ ] **Step 6: Commit verification fixes**

If any cleanup was needed:

```bash
git add <changed-files>
git commit -m "fix(file-analysis): stabilize file history interactions"
```

If no cleanup was needed, do not create an empty commit.

---

## Self-Review

### Spec Coverage

- Session-only retention is implemented by in-memory registry state and no persistence changes.
- Maximum 5 entries is implemented by `FILE_ANALYSIS_HISTORY_LIMIT`.
- Same-path imports create distinct entries in `addFileEntry`.
- `REANALYZE` updates the active entry in place through `startFileAnalysisEntry`.
- `activeFileId` and `analyzingFileId` are separate in the registry and hook wiring.
- File history selector lives in the banner, not in panels.
- Backend remains single-worker and unchanged.
- Clear current vs Clear all semantics are covered by App actions and menu actions.

### Placeholder Scan

This plan uses concrete paths, functions, test commands, and expected outcomes. It intentionally does not include cross-restart persistence, parallel decode, batch import, or side-by-side comparison work.

### Type Consistency

The plan consistently uses:

- `fileHistory.sessionsById`
- `fileHistory.order`
- `fileHistory.activeFileId`
- `fileHistory.analyzingFileId`
- `activeFileSession`
- `analyzingFileSession`
- `fileRunRequest: { sessionId, filePath, runId }`
- `FileSessionEntry.intake`
