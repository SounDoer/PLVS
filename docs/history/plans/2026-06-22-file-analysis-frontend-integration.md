# File Analysis Frontend Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the File source UI shell to desktop file selection (native picker), File-mode-only drag/drop, backend probe/start/stop commands, progress events, completion/error states, and a compact result summary.

**Architecture:** Add a `useFileAnalysisEngine` hook that mirrors `useAudioEngine` at the orchestration layer while reusing `buildTauriFrameApply` and `FrameIntake`. Keep backend command/event calls in `src/ipc/commands.js` / `src/ipc/events.js`.

Key decisions baked into this plan:

- **Entry points.** The primary entry is a native file picker opened via the `@tauri-apps/plugin-dialog` `open()` wrapper. Drag/drop is a secondary convenience wired through the Tauri webview drag-drop event (`onDragDropEvent`), which yields real filesystem `paths`. The HTML5 `dataTransfer.files[...].path` is not used because the webview does not expose absolute paths there.
- **Drag only in File mode.** The drop overlay activates only while `sourceMode === "file"`; OS file drags in Live mode are ignored. There is no drop-while-live confirmation.
- **REANALYZE re-runs.** The hook keys its run on an explicit incrementing run id (not just the path), so re-analyzing the same path re-opens and re-decodes the file.
- **Authoritative summary.** The summary surface reads the completion payload's summary metrics (`fileSession.summary`), not the last displayed UI frame.

**Tech Stack:** React 19, Tauri 2 frontend APIs (`@tauri-apps/plugin-dialog`, `@tauri-apps/api/webview`) through project wrappers, Vitest + @testing-library/react, existing `FrameIntake`, existing shell toolbar patterns.

**Spec:** `docs/superpowers/specs/2026-06-22-file-analysis-mode-design.md`

---

## File Structure

Create:

- `src/hooks/useFileAnalysisEngine.js` — file probe/start/stop orchestration, Channel frame apply, progress/completion/error state.
- `src/hooks/useFileAnalysisEngine.test.js` — hook tests with mocked IPC wrappers.
- `src/components/FileAnalysisSummary.jsx` — compact summary surface/popover content.
- `src/components/FileAnalysisSummary.test.jsx` — summary rendering tests.
- `src/components/FileDropOverlay.jsx` — File-mode-only overlay driven by the Tauri webview drag-drop event.
- `src/components/FileDropOverlay.test.jsx` — overlay interaction tests.
- `src/ipc/fileDialog.js` — wrapper around `@tauri-apps/plugin-dialog` `open()` for picking a media file.

Modify:

- `package.json` — add `@tauri-apps/plugin-dialog`.
- `src-tauri/Cargo.toml` — add `tauri-plugin-dialog`; register it in `lib.rs`; grant the dialog capability.
- `src/ipc/commands.js` — if prior plans did not add `probeFileAnalysis`, `startFileAnalysis`, and `stopFileAnalysis`, add them here first.
- `src/ipc/events.js` — add file-analysis event listeners.
- `src/App.jsx` — wire source mode, file state, picker, File-mode-only drop, hook, summary, and transport actions.
- `src/App.toolbar.test.js` — source-contract tests for file integration.

Do not modify in this plan:

- Rust decoding/session internals;
- `MeterPipeline`;
- panel rendering internals;
- right-side toolbar placement beyond adding a file summary trigger if needed.

---

### Task 1: Add File Analysis Event Wrappers

**Files:**
- Modify: `src/ipc/events.js`
- Modify: `src/App.toolbar.test.js`

- [ ] **Step 1: Add source-contract test**

Append to `src/App.toolbar.test.js`:

```js
  it("exposes file analysis events through frontend event wrappers", () => {
    const eventsSource = readFileSync(join(currentDir, "ipc", "events.js"), "utf8");
    expect(eventsSource).toContain("export function onFileAnalysisProgress(handler)");
    expect(eventsSource).toContain('listen("file-analysis-progress"');
    expect(eventsSource).toContain("export function onFileAnalysisCompleted(handler)");
    expect(eventsSource).toContain('listen("file-analysis-completed"');
    expect(eventsSource).toContain("export function onFileAnalysisError(handler)");
    expect(eventsSource).toContain('listen("file-analysis-error"');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run src/App.toolbar.test.js
```

Expected: FAIL because wrappers do not exist.

- [ ] **Step 3: Add event wrappers**

In `src/ipc/events.js`, add:

```js
import { listen } from "@tauri-apps/api/event";

function unwrapEventPayload(event) {
  return event?.payload ?? event;
}

export function onFileAnalysisProgress(handler) {
  return listen("file-analysis-progress", (event) => handler(unwrapEventPayload(event)));
}

export function onFileAnalysisCompleted(handler) {
  return listen("file-analysis-completed", (event) => handler(unwrapEventPayload(event)));
}

export function onFileAnalysisError(handler) {
  return listen("file-analysis-error", (event) => handler(unwrapEventPayload(event)));
}
```

If `src/ipc/events.js` already imports `listen`, reuse the existing import and add only the wrapper functions.

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npx vitest run src/App.toolbar.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ipc/events.js src/App.toolbar.test.js
git commit -m "feat(ipc): add file analysis event wrappers"
```

---

### Task 2: Add File Analysis Hook

**Files:**
- Create: `src/hooks/useFileAnalysisEngine.js`
- Test: `src/hooks/useFileAnalysisEngine.test.js`

- [ ] **Step 1: Write hook tests**

Create `src/hooks/useFileAnalysisEngine.test.js`:

```js
/** @vitest-environment jsdom */
import React, { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { useFileAnalysisEngine } from "./useFileAnalysisEngine.js";

vi.mock("../ipc/commands.js", () => ({
  probeFileAnalysis: vi.fn(async () => ({
    path: "C:/mix/final.wav",
    fileName: "final.wav",
    container: "wav",
    selectedTrack: { index: 0, codec: "pcm", sampleRateHz: 48000, channels: 2 },
  })),
  startFileAnalysis: vi.fn(async ({ onFrame }) => {
    onFrame({ seq: 1, peakDb: [-12, -12], timestampMs: 100 });
    return { marker: "channel" };
  }),
  stopFileAnalysis: vi.fn(async () => {}),
}));

vi.mock("../ipc/events.js", () => ({
  onFileAnalysisProgress: vi.fn(async () => vi.fn()),
  onFileAnalysisCompleted: vi.fn(async () => vi.fn()),
  onFileAnalysisError: vi.fn(async () => vi.fn()),
}));

vi.mock("../ipc/env.js", () => ({
  isTauri: () => true,
}));

vi.mock("../lib/tauriFrameApply.js", () => ({
  buildTauriFrameApply: () => ({
    applyFrame: vi.fn(),
  }),
}));

import { probeFileAnalysis, startFileAnalysis, stopFileAnalysis } from "../ipc/commands.js";

function Harness({ path }) {
  const [fileSession, setFileSession] = useState({ state: "empty" });
  const audioRef = useRef(null);
  const selectedOffsetRef = useRef(-1);
  const frameRef = useRef(0);
  const defaultSampleRateRef = useRef(48000);

  const api = useFileAnalysisEngine({
    filePath: path,
    enabled: Boolean(path),
    histMaxSamples: 10,
    visualMaxSamples: 10,
    audioRef,
    frameRef,
    selectedOffsetRef,
    defaultSampleRateRef,
    intake: { reset: vi.fn() },
    setFileSession,
    setAudio: vi.fn(),
    setHistoryPathM: vi.fn(),
    setHistoryPathST: vi.fn(),
    setSelectedOffset: vi.fn(),
    setStatus: vi.fn(),
  });

  window.__fileSession = fileSession;
  window.__fileApi = api;
  return null;
}

afterEach(() => {
  vi.clearAllMocks();
  delete window.__fileSession;
  delete window.__fileApi;
});

describe("useFileAnalysisEngine", () => {
  it("probes and starts a file analysis session when enabled", async () => {
    await act(async () => {
      render(<Harness path="C:/mix/final.wav" />);
    });

    expect(probeFileAnalysis).toHaveBeenCalledWith("C:/mix/final.wav");
    expect(startFileAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({ path: "C:/mix/final.wav", onFrame: expect.any(Function) })
    );
    expect(window.__fileSession).toMatchObject({
      state: "analyzing",
      fileName: "final.wav",
    });
  });

  it("stops the active file analysis session", async () => {
    await act(async () => {
      render(<Harness path="C:/mix/final.wav" />);
    });

    await act(async () => {
      await window.__fileApi.stop();
    });

    expect(stopFileAnalysis).toHaveBeenCalled();
    expect(window.__fileSession).toMatchObject({ state: "ready" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run src/hooks/useFileAnalysisEngine.test.js
```

Expected: FAIL because `useFileAnalysisEngine.js` does not exist.

- [ ] **Step 3: Implement hook**

Create `src/hooks/useFileAnalysisEngine.js`:

```js
import { useCallback, useEffect, useRef } from "react";
import { probeFileAnalysis, startFileAnalysis, stopFileAnalysis } from "../ipc/commands.js";
import {
  onFileAnalysisCompleted,
  onFileAnalysisError,
  onFileAnalysisProgress,
} from "../ipc/events.js";
import { isTauri } from "../ipc/env.js";
import { buildTauriFrameApply } from "../lib/tauriFrameApply.js";

export function useFileAnalysisEngine({
  enabled,
  filePath,
  runId,
  histMaxSamples,
  visualMaxSamples,
  audioRef,
  frameRef,
  selectedOffsetRef,
  defaultSampleRateRef,
  intake,
  setFileSession,
  setAudio,
  setHistoryPathM,
  setHistoryPathST,
  setSelectedOffset,
  setStatus,
}) {
  const activePathRef = useRef(null);

  const stop = useCallback(async () => {
    await stopFileAnalysis();
    setFileSession((current) => ({
      state: current.fileName ? "ready" : "empty",
      fileName: current.fileName,
      path: current.path,
      metadata: current.metadata,
    }));
  }, [setFileSession]);

  useEffect(() => {
    if (!enabled || !filePath) return;
    if (!isTauri()) {
      setStatus("File analysis runs in the desktop app");
      setFileSession({ state: "empty" });
      return;
    }

    let mounted = true;
    const unsubs = [];

    const run = async () => {
      try {
        activePathRef.current = filePath;
        intake.reset();
        frameRef.current = 0;
        selectedOffsetRef.current = -1;
        setSelectedOffset(-1);
        setHistoryPathM("");
        setHistoryPathST("");
        setStatus("Probing file...");
        const metadata = await probeFileAnalysis(filePath);
        if (!mounted) return;
        defaultSampleRateRef.current = metadata.selectedTrack?.sampleRateHz || 48000;
        setFileSession({
          state: "analyzing",
          path: filePath,
          fileName: metadata.fileName,
          metadata,
          progress: 0,
        });
        setStatus(`Analyzing ${metadata.fileName}`);

        unsubs.push(await onFileAnalysisProgress((payload) => {
          if (payload?.path !== activePathRef.current) return;
          setFileSession((current) => ({
            ...current,
            state: "analyzing",
            progress: Number.isFinite(payload.progress) ? payload.progress : current.progress,
          }));
        }));
        unsubs.push(await onFileAnalysisCompleted((payload) => {
          if (payload?.path !== activePathRef.current) return;
          setFileSession((current) => ({
            ...current,
            state: "complete",
            decodedFrames: payload.decodedFrames,
            summary: payload.summary,
          }));
          setStatus("File analysis complete");
        }));
        unsubs.push(await onFileAnalysisError((payload) => {
          if (payload?.path !== activePathRef.current) return;
          setFileSession((current) => ({
            ...current,
            state: "error",
            error: payload.message,
          }));
          setStatus(`Error: ${payload.message}`);
        }));

        const { applyFrame } = buildTauriFrameApply({
          histMaxSamples,
          visualMaxSamples,
          intake,
          frameRef,
          selectedOffsetRef,
          defaultSampleRateRef,
          setAudio,
          setHistoryPathM,
          setHistoryPathST,
          ackFrames: () => {},
        });
        const channel = await startFileAnalysis({
          path: filePath,
          onFrame: (frame) => {
            if (mounted) applyFrame(frame);
          },
        });
        audioRef.current = { mode: "file", channel, unsubs };
      } catch (err) {
        if (!mounted) return;
        const message = err?.message || "File analysis unavailable";
        setFileSession({ state: "error", path: filePath, error: message });
        setStatus(`Error: ${message}`);
      }
    };

    run();
    return () => {
      mounted = false;
      for (const unsub of unsubs) {
        try {
          unsub?.();
        } catch (_) {}
      }
    };
    // `runId` is in the dependency list so REANALYZE (same path, incremented runId) re-runs the
    // effect and re-decodes the file from disk.
  }, [enabled, filePath, runId]);

  return { stop };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npx vitest run src/hooks/useFileAnalysisEngine.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useFileAnalysisEngine.js src/hooks/useFileAnalysisEngine.test.js
git commit -m "feat(file): add frontend analysis engine hook"
```

---

### Task 3: Add Summary Component

**Files:**
- Create: `src/components/FileAnalysisSummary.jsx`
- Test: `src/components/FileAnalysisSummary.test.jsx`

- [ ] **Step 1: Write component tests**

Create `src/components/FileAnalysisSummary.test.jsx`:

```jsx
/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { FileAnalysisSummary } from "./FileAnalysisSummary.jsx";

describe("FileAnalysisSummary", () => {
  it("renders completed file metadata and authoritative delivery metrics", () => {
    render(
      <FileAnalysisSummary
        fileSession={{
          state: "complete",
          fileName: "final.wav",
          metadata: {
            container: "wav",
            selectedTrack: {
              index: 0,
              codec: "pcm",
              sampleRateHz: 48000,
              channels: 2,
            },
          },
          summary: {
            durationMs: 180000,
            sampleRateHz: 48000,
            channels: 2,
            integratedLufs: -16.2,
            lra: 4.1,
            truePeakMaxDbtp: -1.0,
            samplePeakMaxLDb: -2.1,
            samplePeakMaxRDb: -2.3,
            dialogueIntegrated: -Infinity,
          },
        }}
      />
    );

    expect(screen.getByText("final.wav")).toBeTruthy();
    expect(screen.getByText("Integrated")).toBeTruthy();
    expect(screen.getByText("-16.2 LUFS")).toBeTruthy();
    expect(screen.getByText("True Peak Max")).toBeTruthy();
    expect(screen.getByText("-1.0 dBTP")).toBeTruthy();
    expect(screen.getByText("Track 0 · pcm · 48 kHz · 2 ch")).toBeTruthy();
  });

  it("renders an error state", () => {
    render(<FileAnalysisSummary fileSession={{ state: "error", error: "Unsupported codec" }} />);
    expect(screen.getByText("Unsupported codec")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run src/components/FileAnalysisSummary.test.jsx
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement component**

Create `src/components/FileAnalysisSummary.jsx`:

```jsx
function fmtNumber(value, suffix) {
  return Number.isFinite(value) ? `${value.toFixed(1)} ${suffix}` : `-- ${suffix}`;
}

function trackLine(track) {
  if (!track) return "No track metadata";
  const sampleRate = Number.isFinite(track.sampleRateHz)
    ? `${Math.round(track.sampleRateHz / 1000)} kHz`
    : "unknown rate";
  const channels = Number.isFinite(track.channels) ? `${track.channels} ch` : "unknown channels";
  return `Track ${track.index ?? 0} · ${track.codec || "unknown codec"} · ${sampleRate} · ${channels}`;
}

// Metrics come from the authoritative completion summary payload (fileSession.summary), not the
// last displayed UI frame, so throttled/batched frames cannot skew the delivery numbers.
export function FileAnalysisSummary({ fileSession }) {
  if (fileSession?.state === "error") {
    return (
      <section className="min-w-72 rounded-md border border-border bg-popover p-3 text-sm text-popover-foreground">
        <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--ui-signal-bad)]">
          File analysis error
        </p>
        <p className="mt-1 text-sm">{fileSession.error}</p>
      </section>
    );
  }

  const metadata = fileSession?.metadata;
  const summary = fileSession?.summary ?? {};
  const fileName = fileSession?.fileName || "No file";
  const track = metadata?.selectedTrack;
  const samplePeakMax = Math.max(
    summary.samplePeakMaxLDb ?? -Infinity,
    summary.samplePeakMaxRDb ?? -Infinity
  );

  return (
    <section className="min-w-72 rounded-md border border-border bg-popover p-3 text-sm text-popover-foreground">
      <p className="truncate text-sm font-semibold text-foreground">{fileName}</p>
      <p className="mt-1 text-xs text-muted-foreground">{trackLine(track)}</p>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        <div>
          <dt className="text-muted-foreground">Integrated</dt>
          <dd className="font-semibold tabular-nums text-foreground">
            {fmtNumber(summary.integratedLufs, "LUFS")}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">LRA</dt>
          <dd className="font-semibold tabular-nums text-foreground">{fmtNumber(summary.lra, "LU")}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">True Peak Max</dt>
          <dd className="font-semibold tabular-nums text-foreground">
            {fmtNumber(summary.truePeakMaxDbtp, "dBTP")}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Sample Peak Max</dt>
          <dd className="font-semibold tabular-nums text-foreground">
            {fmtNumber(samplePeakMax, "dBFS")}
          </dd>
        </div>
      </dl>
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npx vitest run src/components/FileAnalysisSummary.test.jsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/FileAnalysisSummary.jsx src/components/FileAnalysisSummary.test.jsx
git commit -m "feat(file): add analysis summary surface"
```

---

### Task 4: Add File Drop Overlay

**Files:**
- Create: `src/components/FileDropOverlay.jsx`
- Test: `src/components/FileDropOverlay.test.jsx`

- [ ] **Step 1: Write overlay tests**

Create `src/components/FileDropOverlay.test.jsx`:

```jsx
/** @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { FileDropOverlay } from "./FileDropOverlay.jsx";

let dragHandler = null;
const unlisten = vi.fn();

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: (cb) => {
      dragHandler = cb;
      return Promise.resolve(unlisten);
    },
  }),
}));

beforeEach(() => {
  dragHandler = null;
  unlisten.mockClear();
});

async function emit(payload) {
  await act(async () => {
    await Promise.resolve();
    dragHandler?.({ payload });
  });
}

describe("FileDropOverlay", () => {
  it("does not subscribe to drops when inactive (Live mode ignores OS drags)", async () => {
    render(<FileDropOverlay active={false} onDropFile={vi.fn()} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(dragHandler).toBeNull();
  });

  it("shows the overlay on drag enter when active", async () => {
    render(<FileDropOverlay active onDropFile={vi.fn()} />);
    await emit({ type: "enter", paths: ["C:/mix/final.wav"] });
    expect(screen.getByText("Drop file to analyze")).toBeTruthy();
  });

  it("calls onDropFile with the dropped path when active", async () => {
    const onDropFile = vi.fn();
    render(<FileDropOverlay active onDropFile={onDropFile} />);
    await emit({ type: "drop", paths: ["C:/mix/final.wav"] });
    expect(onDropFile).toHaveBeenCalledWith("C:/mix/final.wav");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run src/components/FileDropOverlay.test.jsx
```

Expected: FAIL because component does not exist.

- [ ] **Step 3: Implement overlay**

Create `src/components/FileDropOverlay.jsx`:

```jsx
import { useEffect, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";

// Drag/drop is wired through the Tauri webview drag-drop event, which yields real filesystem
// paths (unlike HTML5 `dataTransfer`). The overlay subscribes only while File mode is active, so
// OS file drags in Live mode are ignored entirely (no drop-while-live confirmation).
export function FileDropOverlay({ active, onDropFile }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!active) {
      setVisible(false);
      return undefined;
    }
    let unlisten = null;
    let cancelled = false;
    getCurrentWebview()
      .onDragDropEvent((event) => {
        const payload = event?.payload;
        if (!payload) return;
        if (payload.type === "enter" || payload.type === "over") {
          setVisible(true);
        } else if (payload.type === "leave") {
          setVisible(false);
        } else if (payload.type === "drop") {
          setVisible(false);
          const path = payload.paths?.[0];
          if (path) onDropFile(path);
        }
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
      setVisible(false);
    };
  }, [active, onDropFile]);

  if (!visible) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-background/70 backdrop-blur-sm">
      <div className="rounded-xl border border-primary/40 bg-popover px-6 py-5 text-center shadow-lg">
        <p className="text-sm font-semibold text-foreground">Drop file to analyze</p>
        <p className="mt-1 text-xs text-muted-foreground">Audio files and videos with audio tracks stay local.</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npx vitest run src/components/FileDropOverlay.test.jsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/FileDropOverlay.jsx src/components/FileDropOverlay.test.jsx
git commit -m "feat(file): add file drop overlay"
```

---

### Task 4b: Add File Picker (Tauri Dialog Plugin)

**Files:**
- Modify: `package.json`, `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`, dialog capability JSON
- Create: `src/ipc/fileDialog.js`
- Modify: `src/App.toolbar.test.js`

- [ ] **Step 1: Install the dialog plugin**

Run:

```bash
npm install @tauri-apps/plugin-dialog
cd src-tauri && cargo add tauri-plugin-dialog
```

Register it in `src-tauri/src/lib.rs` builder chain:

```rust
.plugin(tauri_plugin_dialog::init())
```

Grant the dialog open permission in the app capability file (the same capability
JSON that lists other core permissions), for example `dialog:allow-open`.

- [ ] **Step 2: Add a picker wrapper**

Create `src/ipc/fileDialog.js`:

```js
import { open } from "@tauri-apps/plugin-dialog";

const MEDIA_EXTENSIONS = ["wav", "aiff", "aif", "flac", "mp3", "mp4", "m4v", "mkv", "webm"];

/** @returns {Promise<string | null>} Absolute path, or null if the user cancelled. */
export async function pickMediaFile() {
  const selected = await open({
    multiple: false,
    directory: false,
    filters: [{ name: "Media", extensions: MEDIA_EXTENSIONS }],
  });
  return typeof selected === "string" ? selected : null;
}
```

- [ ] **Step 3: Source-contract test**

Append to `src/App.toolbar.test.js`:

```js
  it("opens files through the dialog plugin wrapper", () => {
    const dialogSource = readFileSync(join(currentDir, "ipc", "fileDialog.js"), "utf8");
    expect(dialogSource).toContain('from "@tauri-apps/plugin-dialog"');
    expect(dialogSource).toContain("export async function pickMediaFile()");
    expect(appSource).toContain("pickMediaFile");
  });
```

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs src/ipc/fileDialog.js src/App.toolbar.test.js
git commit -m "feat(file): add native file picker wrapper"
```

Grant the capability file too if it is a separate tracked file.

---

### Task 5: Wire File Mode In `App.jsx`

**Files:**
- Modify: `src/App.jsx`
- Modify: `src/App.toolbar.test.js`

- [ ] **Step 1: Add source-contract tests**

Append to `src/App.toolbar.test.js`:

```js
  it("wires file analysis hook, drop overlay, and summary into App", () => {
    expect(appSource).toContain("useFileAnalysisEngine({");
    expect(appSource).toContain('<FileDropOverlay active={sourceMode === "file"}');
    expect(appSource).toContain("<FileAnalysisSummary");
    expect(appSource).toContain("setPendingFilePath");
    expect(appSource).toContain("setFileRunId");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run src/App.toolbar.test.js
```

Expected: FAIL because `App.jsx` is not wired.

- [ ] **Step 3: Add imports**

In `src/App.jsx`, add:

```js
import { FileAnalysisSummary } from "./components/FileAnalysisSummary.jsx";
import { FileDropOverlay } from "./components/FileDropOverlay.jsx";
import { useFileAnalysisEngine } from "./hooks/useFileAnalysisEngine.js";
import { pickMediaFile } from "./ipc/fileDialog.js";
```

- [ ] **Step 4: Add pending file and run-id state**

Near `fileSession` state from the UI shell plan:

```js
const [pendingFilePath, setPendingFilePath] = useState("");
// Incremented on every analyze/reanalyze/drop so re-analyzing the SAME path re-runs the engine.
const [fileRunId, setFileRunId] = useState(0);
```

- [ ] **Step 5: Add a single "begin analysis" helper and the drop handler**

The drop overlay is only active in File mode (Step 8), so a drop can never occur
during live capture. The helper just resets scrub, sets the path, and bumps the
run id:

```js
const beginFileAnalysis = useCallback(
  (path) => {
    if (!path) return;
    setSelectedOffset(-1);
    setPendingFilePath(path);
    setFileRunId((id) => id + 1);
  },
  [setSelectedOffset]
);

// `path` already comes from the Tauri drag-drop event (a real filesystem path).
const handleDropFile = useCallback((path) => beginFileAnalysis(path), [beginFileAnalysis]);
```

- [ ] **Step 6: Wire hook**

Call:

```js
const fileAnalysis = useFileAnalysisEngine({
  enabled: sourceMode === "file" && Boolean(pendingFilePath),
  filePath: pendingFilePath,
  runId: fileRunId,
  histMaxSamples: HIST_MAX_SAMPLES,
  visualMaxSamples: VISUAL_MAX_SAMPLES,
  audioRef,
  frameRef,
  selectedOffsetRef,
  defaultSampleRateRef,
  intake: intakeRef.current,
  setFileSession,
  setAudio,
  setHistoryPathM: () => {},
  setHistoryPathST: () => {},
  setSelectedOffset,
  setStatus,
});
```

If `defaultSampleRateRef` is local to `useAudioEngine`, lift it to `App.jsx` as:

```js
const defaultSampleRateRef = useRef(48000);
```

and pass the same ref to both `useAudioEngine` and `useFileAnalysisEngine`.

- [ ] **Step 7: Update source transport action handling**

Make `onSourceTransportAction` async and route file actions through the native
picker / run-id helper:

```js
if (actionKind === "chooseFile" || actionKind === "analyzeFile") {
  const path = await pickMediaFile();
  if (path) beginFileAnalysis(path);
  return;
}
if (actionKind === "reanalyzeFile") {
  // Re-run the same file: keep the path, just bump the run id.
  const path = pendingFilePath || fileSession.path;
  if (path) beginFileAnalysis(path);
  else setStatus("Choose a file to analyze");
  return;
}
if (actionKind === "stopFileAnalysis") {
  void fileAnalysis.stop();
  return;
}
```

`beginFileAnalysis` always bumps `fileRunId`, so `reanalyzeFile` re-decodes even
when the path is unchanged.

- [ ] **Step 8: Render overlay and summary**

Inside the top-level `AudioDataContext.Provider` render tree, add the overlay,
active only in File mode so OS drags in Live mode are ignored:

```jsx
<FileDropOverlay active={sourceMode === "file"} onDropFile={handleDropFile} />
```

Near the header controls or footer status area, render the summary only for file mode when a terminal file state exists. The summary reads the authoritative completion payload from `fileSession.summary` (no `audio` prop):

```jsx
{sourceMode === "file" && (fileSession.state === "complete" || fileSession.state === "error") ? (
  <FileAnalysisSummary fileSession={fileSession} />
) : null}
```

If direct header rendering is visually too large, place this inside the existing popover pattern with an `IconButton` trigger in a follow-up polish commit. The first pass must keep the summary visible and testable.

- [ ] **Step 9: Run focused tests**

Run:

```bash
npx vitest run src/hooks/useFileAnalysisEngine.test.js src/components/FileAnalysisSummary.test.jsx src/components/FileDropOverlay.test.jsx src/App.toolbar.test.js
```

Expected: PASS.

- [ ] **Step 10: Run lint for touched files**

Run:

```bash
npx eslint src/App.jsx src/hooks/useFileAnalysisEngine.js src/components/FileAnalysisSummary.jsx src/components/FileDropOverlay.jsx
```

Expected: no errors.

- [ ] **Step 11: Commit**

```bash
git add src/App.jsx src/App.toolbar.test.js src/hooks/useFileAnalysisEngine.js src/hooks/useFileAnalysisEngine.test.js src/components/FileAnalysisSummary.jsx src/components/FileAnalysisSummary.test.jsx src/components/FileDropOverlay.jsx src/components/FileDropOverlay.test.jsx
git commit -m "feat(file): connect file analysis UI flow"
```

---

### Task 6: Verification

**Files:**
- No planned file edits.

- [ ] **Step 1: Run focused frontend tests**

Run:

```bash
npx vitest run src/hooks/useFileAnalysisEngine.test.js src/components/FileAnalysisSummary.test.jsx src/components/FileDropOverlay.test.jsx src/lib/sourceTransportState.test.js src/App.toolbar.test.js
```

Expected: PASS.

- [ ] **Step 2: Run all frontend tests**

Run:

```bash
npx vitest run
```

Expected: PASS.

- [ ] **Step 3: Check IPC boundary**

Run:

```bash
rg "@tauri-apps/api/core|file_analysis_start|file_analysis_probe|file-analysis-progress" src
```

Expected:

- `@tauri-apps/api/core` appears only in `src/ipc/commands.js`;
- file analysis command names appear only in IPC wrappers and tests;
- components/hooks use wrapper functions.

---

## Self-Review

Spec coverage:

- Covers File source UI integration.
- Covers the native file picker (`pickMediaFile` via `@tauri-apps/plugin-dialog`) as the primary entry.
- Covers drag/drop via the Tauri webview drag-drop event (`onDragDropEvent`, real paths), active only in File mode; Live mode ignores OS drags (no drop-while-live confirmation).
- Covers `REANALYZE` re-running the same path via an incrementing `fileRunId` in the hook's effect deps.
- Covers probe/start/stop frontend flow.
- Covers progress/completion/error state handling.
- Covers a compact summary surface fed by the authoritative `fileSession.summary` payload (not the last UI frame).
- Leaves manual audio-track selection, persistent file history, export, and polished picker UX for future slices.

Placeholder scan:

- No placeholder markers or unnamed implementation steps.

IPC boundary note:

- The audio-engine IPC contract is unchanged: `@tauri-apps/api/core` stays only in `src/ipc/commands.js`. The webview drag-drop event (`@tauri-apps/api/webview`) is a shell API, so per project convention it is called directly from the overlay component rather than funneled through `src/ipc/`. The dialog plugin is wrapped in `src/ipc/fileDialog.js`.

Type consistency:

- Hook is `useFileAnalysisEngine`, taking `runId`.
- Summary state uses `fileSession`; metrics from `fileSession.summary`.
- Pending file path state is `pendingFilePath`; run trigger is `fileRunId`.
- Picker wrapper is `pickMediaFile()`; drop callback is `handleDropFile(path)`.
- Drop overlay takes `active` (true only in File mode) and `onDropFile`.
