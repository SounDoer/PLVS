# File Analysis UI Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the separate live status pill and transport button with a source-aware header transport cluster that can express both current Live behavior and the first File-mode shell states.

**Architecture:** Keep this slice frontend-only and independently shippable. Add pure state derivation helpers for source/action/status labels, add a reusable `SourceTransportCluster` component, then wire `App.jsx` to render it in place of `StatusPill` + `TransportButton`. File mode is a UI shell only in this plan: it can be selected and displays `Drop file` / `ANALYZE`, but real file picking, decoding, progress, and summary data are handled by later plans.

**Tech Stack:** React 19, Vite, Vitest + @testing-library/react (jsdom), lucide-react, Tailwind, existing PLVS shell components.

**Spec:** `docs/superpowers/specs/2026-06-22-file-analysis-mode-design.md`

---

## File Structure

Create:

- `src/components/SourceTransportCluster.jsx` — header cluster UI replacing `StatusPill` + `TransportButton` at the left side of the header.
- `src/components/SourceTransportCluster.test.jsx` — component interaction/accessibility tests.
- `src/lib/sourceTransportState.js` — pure derivation for source mode, status label, action label, and visual state.
- `src/lib/sourceTransportState.test.js` — unit tests for all agreed Live/File display states.

Modify:

- `src/hooks/useSessionTimer.js` — export the existing `formatClock(ms)` helper so scrub/file media times use the same display format as the live timer.
- `src/App.jsx` — add `sourceMode`, derive transport state, and render `SourceTransportCluster`.
- `src/App.toolbar.test.js` — guard that the app renders the new source-aware cluster and removes direct `StatusPill`/`TransportButton` usage from the header.

Do not modify in this plan:

- `src/ipc/commands.js`
- Rust files under `src-tauri/`
- file picker or drag/drop infrastructure
- right-side toolbar icon placement

---

### Task 1: Export And Test Shared Time Formatting

**Files:**
- Modify: `src/hooks/useSessionTimer.js`
- Test: `src/hooks/useSessionTimer.test.js`

- [ ] **Step 1: Write the failing test**

Append these tests to `src/hooks/useSessionTimer.test.js`:

```js
import { describe, expect, it } from "vitest";
import { formatClock } from "./useSessionTimer.js";

describe("formatClock", () => {
  it("formats sub-hour durations as HH:MM:SS", () => {
    expect(formatClock(0)).toBe("00:00:00");
    expect(formatClock(8_000)).toBe("00:00:08");
    expect(formatClock(12_345)).toBe("00:00:12");
    expect(formatClock(12 * 60_000 + 3_000)).toBe("00:12:03");
  });

  it("formats hour-long durations without changing shape", () => {
    expect(formatClock(3_661_000)).toBe("01:01:01");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/hooks/useSessionTimer.test.js`

Expected: FAIL with an import error because `formatClock` is not exported.

- [ ] **Step 3: Export the helper without changing behavior**

Change the function declaration in `src/hooks/useSessionTimer.js` from:

```js
function formatClock(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
```

to:

```js
export function formatClock(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/hooks/useSessionTimer.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useSessionTimer.js src/hooks/useSessionTimer.test.js
git commit -m "test(ui): cover shared session time formatting"
```

---

### Task 2: Add Pure Source Transport State Derivation

**Files:**
- Create: `src/lib/sourceTransportState.js`
- Test: `src/lib/sourceTransportState.test.js`

- [ ] **Step 1: Write the failing test**

Create `src/lib/sourceTransportState.test.js`:

```js
import { describe, expect, it } from "vitest";
import { deriveSourceTransportState } from "./sourceTransportState.js";

describe("deriveSourceTransportState", () => {
  it("derives the live ready state", () => {
    expect(
      deriveSourceTransportState({
        sourceMode: "live",
        running: false,
        selectedOffset: -1,
        elapsedMs: 0,
      })
    ).toMatchObject({
      sourceLabel: "Live",
      statusLabel: "Ready",
      actionLabel: "START",
      chromeState: "ready",
      actionKind: "startLive",
    });
  });

  it("derives the live running state from elapsed session time", () => {
    expect(
      deriveSourceTransportState({
        sourceMode: "live",
        running: true,
        selectedOffset: -1,
        elapsedMs: 12_000,
      })
    ).toMatchObject({
      sourceLabel: "Live",
      statusLabel: "00:00:12",
      actionLabel: "STOP",
      chromeState: "live",
      actionKind: "stopLive",
    });
  });

  it("derives the live scrub state from selected history time", () => {
    expect(
      deriveSourceTransportState({
        sourceMode: "live",
        running: true,
        selectedOffset: 8,
        latestTimestampMs: 20_000,
        elapsedMs: 99_000,
      })
    ).toMatchObject({
      sourceLabel: "Live",
      statusLabel: "00:00:12",
      actionLabel: "LIVE",
      chromeState: "snapshot",
      actionKind: "returnToLive",
    });
  });

  it("falls back to selected offset when no live timestamp exists", () => {
    expect(
      deriveSourceTransportState({
        sourceMode: "live",
        running: true,
        selectedOffset: 8,
        elapsedMs: 99_000,
      }).statusLabel
    ).toBe("00:00:08");
  });

  it("derives the empty file state", () => {
    expect(
      deriveSourceTransportState({
        sourceMode: "file",
        fileSession: { state: "empty" },
      })
    ).toMatchObject({
      sourceLabel: "File",
      statusLabel: "No file",
      actionLabel: "ANALYZE",
      chromeState: "ready",
      actionKind: "chooseFile",
    });
  });

  it("derives the selected file state", () => {
    expect(
      deriveSourceTransportState({
        sourceMode: "file",
        fileSession: { state: "ready", fileName: "final_mix.wav" },
      })
    ).toMatchObject({
      statusLabel: "final_mix.wav",
      actionLabel: "ANALYZE",
      actionKind: "analyzeFile",
    });
  });

  it("derives the analyzing file state", () => {
    expect(
      deriveSourceTransportState({
        sourceMode: "file",
        fileSession: { state: "analyzing", fileName: "final_mix.wav", progress: 0.42 },
      })
    ).toMatchObject({
      statusLabel: "final_mix.wav 42%",
      actionLabel: "STOP",
      chromeState: "live",
      actionKind: "stopFileAnalysis",
    });
  });

  it("derives the completed file state", () => {
    expect(
      deriveSourceTransportState({
        sourceMode: "file",
        fileSession: { state: "complete", fileName: "final_mix.wav" },
      })
    ).toMatchObject({
      statusLabel: "final_mix.wav Done",
      actionLabel: "REANALYZE",
      actionKind: "reanalyzeFile",
    });
  });

  it("derives the file scrub state from media time", () => {
    expect(
      deriveSourceTransportState({
        sourceMode: "file",
        selectedOffset: 0,
        selectedMediaTimeMs: 84_000,
        fileSession: {
          state: "complete",
          fileName: "final_mix.wav",
        },
      })
    ).toMatchObject({
      statusLabel: "00:01:24",
      actionLabel: "RESULT",
      chromeState: "snapshot",
      actionKind: "returnToFileResult",
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/sourceTransportState.test.js`

Expected: FAIL because `src/lib/sourceTransportState.js` does not exist.

- [ ] **Step 3: Implement the helper**

Create `src/lib/sourceTransportState.js`:

```js
import { formatClock } from "../hooks/useSessionTimer.js";

function clampProgress(progress) {
  if (!Number.isFinite(progress)) return 0;
  return Math.max(0, Math.min(1, progress));
}

function formatProgress(progress) {
  return `${Math.round(clampProgress(progress) * 100)}%`;
}

function scrubTimeFromLatest({ latestTimestampMs, selectedOffset }) {
  if (Number.isFinite(latestTimestampMs)) {
    return Math.max(0, latestTimestampMs - selectedOffset * 1000);
  }
  return Math.max(0, selectedOffset * 1000);
}

function deriveLiveState({ running, selectedOffset = -1, latestTimestampMs, elapsedMs = 0 }) {
  if (selectedOffset >= 0) {
    return {
      sourceLabel: "Live",
      statusLabel: formatClock(scrubTimeFromLatest({ latestTimestampMs, selectedOffset })),
      actionLabel: "LIVE",
      chromeState: "snapshot",
      actionKind: "returnToLive",
    };
  }

  if (running) {
    return {
      sourceLabel: "Live",
      statusLabel: formatClock(elapsedMs),
      actionLabel: "STOP",
      chromeState: "live",
      actionKind: "stopLive",
    };
  }

  return {
    sourceLabel: "Live",
    statusLabel: "Ready",
    actionLabel: "START",
    chromeState: "ready",
    actionKind: "startLive",
  };
}

function deriveFileState({ selectedOffset = -1, selectedMediaTimeMs, fileSession = {} }) {
  const state = fileSession.state ?? "empty";

  if (selectedOffset >= 0 && Number.isFinite(selectedMediaTimeMs)) {
    return {
      sourceLabel: "File",
      statusLabel: formatClock(selectedMediaTimeMs),
      actionLabel: "RESULT",
      chromeState: "snapshot",
      actionKind: "returnToFileResult",
    };
  }

  if (state === "analyzing") {
    const fileName = fileSession.fileName || "Analyzing";
    return {
      sourceLabel: "File",
      statusLabel: `${fileName} ${formatProgress(fileSession.progress)}`,
      actionLabel: "STOP",
      chromeState: "live",
      actionKind: "stopFileAnalysis",
    };
  }

  if (state === "complete") {
    const fileName = fileSession.fileName || "File";
    return {
      sourceLabel: "File",
      statusLabel: `${fileName} Done`,
      actionLabel: "REANALYZE",
      chromeState: "ready",
      actionKind: "reanalyzeFile",
    };
  }

  if (state === "ready") {
    return {
      sourceLabel: "File",
      statusLabel: fileSession.fileName || "File ready",
      actionLabel: "ANALYZE",
      chromeState: "ready",
      actionKind: "analyzeFile",
    };
  }

  return {
    sourceLabel: "File",
    statusLabel: "No file",
    actionLabel: "ANALYZE",
    chromeState: "ready",
    actionKind: "chooseFile",
  };
}

export function deriveSourceTransportState(input) {
  return input.sourceMode === "file" ? deriveFileState(input) : deriveLiveState(input);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/sourceTransportState.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sourceTransportState.js src/lib/sourceTransportState.test.js
git commit -m "feat(ui): derive source transport state"
```

---

### Task 3: Add `SourceTransportCluster`

**Files:**
- Create: `src/components/SourceTransportCluster.jsx`
- Test: `src/components/SourceTransportCluster.test.jsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/SourceTransportCluster.test.jsx`:

```jsx
/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SourceTransportCluster } from "./SourceTransportCluster.jsx";

const baseState = {
  sourceLabel: "Live",
  statusLabel: "Ready",
  actionLabel: "START",
  chromeState: "ready",
  actionKind: "startLive",
};

describe("SourceTransportCluster", () => {
  it("renders source, status, and primary action", () => {
    render(
      <SourceTransportCluster
        state={baseState}
        sourceMode="live"
        onSourceModeChange={vi.fn()}
        onPrimaryAction={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "Source: Live" })).toBeTruthy();
    expect(screen.getByText("Ready")).toBeTruthy();
    expect(screen.getByRole("button", { name: "START" })).toBeTruthy();
  });

  it("fires the primary action with the derived action kind", () => {
    const onPrimaryAction = vi.fn();
    render(
      <SourceTransportCluster
        state={baseState}
        sourceMode="live"
        onSourceModeChange={vi.fn()}
        onPrimaryAction={onPrimaryAction}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "START" }));
    expect(onPrimaryAction).toHaveBeenCalledWith("startLive");
  });

  it("opens a source menu and switches to File", () => {
    const onSourceModeChange = vi.fn();
    render(
      <SourceTransportCluster
        state={baseState}
        sourceMode="live"
        onSourceModeChange={onSourceModeChange}
        onPrimaryAction={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Source: Live" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /File/ }));
    expect(onSourceModeChange).toHaveBeenCalledWith("file");
  });

  it("marks the current source in the menu", () => {
    render(
      <SourceTransportCluster
        state={{ ...baseState, sourceLabel: "File", statusLabel: "No file", actionLabel: "ANALYZE" }}
        sourceMode="file"
        onSourceModeChange={vi.fn()}
        onPrimaryAction={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Source: File" }));
    expect(screen.getByRole("menuitemradio", { name: /File/, checked: true })).toBeTruthy();
    expect(screen.getByRole("menuitemradio", { name: /Live/, checked: false })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/SourceTransportCluster.test.jsx`

Expected: FAIL because `SourceTransportCluster.jsx` does not exist.

- [ ] **Step 3: Implement the component**

Create `src/components/SourceTransportCluster.jsx`:

```jsx
import { useState } from "react";
import { ChevronDown, Play, Radio, Square } from "lucide-react";
import { cn } from "@/lib/utils";

const CHROME = {
  ready: {
    shell:
      "bg-secondary text-muted-foreground border border-white/10",
    action: "bg-primary text-primary-foreground hover:brightness-[1.08]",
    Icon: Play,
  },
  live: {
    shell:
      "bg-[color:color-mix(in_srgb,var(--ui-signal-bad)_8%,transparent)] text-[color:var(--ui-signal-bad)] border border-[color:color-mix(in_srgb,var(--ui-signal-bad)_30%,transparent)]",
    action:
      "bg-transparent text-[color:var(--ui-signal-bad)] border border-[color:color-mix(in_srgb,var(--ui-signal-bad)_40%,transparent)] hover:bg-[color:color-mix(in_srgb,var(--ui-signal-bad)_8%,transparent)]",
    Icon: Square,
  },
  snapshot: {
    shell:
      "bg-[color:color-mix(in_srgb,var(--ui-signal-warn)_8%,transparent)] text-[color:var(--ui-signal-warn)] border border-[color:color-mix(in_srgb,var(--ui-signal-warn)_30%,transparent)]",
    action:
      "bg-transparent text-[color:var(--ui-signal-warn)] border border-[color:color-mix(in_srgb,var(--ui-signal-warn)_40%,transparent)] hover:bg-[color:color-mix(in_srgb,var(--ui-signal-warn)_8%,transparent)]",
    Icon: Radio,
  },
};

const SOURCE_OPTIONS = [
  {
    id: "live",
    label: "Live",
    description: "System playback / input monitoring",
  },
  {
    id: "file",
    label: "File",
    description: "Analyze a local audio or video file",
  },
];

export function SourceTransportCluster({
  state,
  sourceMode,
  onSourceModeChange,
  onPrimaryAction,
}) {
  const [open, setOpen] = useState(false);
  const chrome = CHROME[state.chromeState] ?? CHROME.ready;
  const ActionIcon = chrome.Icon;

  return (
    <div className="relative inline-flex items-center gap-1.5">
      <div
        className={cn(
          "inline-flex h-8 max-w-[340px] items-center overflow-hidden rounded-full transition-all duration-200",
          chrome.shell
        )}
      >
        <button
          type="button"
          aria-label={`Source: ${state.sourceLabel}`}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="flex h-full items-center gap-1.5 px-3 text-[11px] font-bold uppercase tracking-[0.08em] transition-colors hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {state.sourceLabel}
          <ChevronDown className="size-3" />
        </button>
        <span className="h-[1em] w-px bg-current opacity-30" />
        <span className="min-w-0 truncate px-3 text-[11.5px] font-semibold tabular-nums">
          {state.statusLabel}
        </span>
      </div>

      <button
        type="button"
        onClick={() => onPrimaryAction(state.actionKind)}
        className={cn(
          "flex h-8 items-center gap-1.5 rounded-md px-3.5 text-[11.5px] font-bold tracking-[0.06em] transition-all duration-150",
          chrome.action
        )}
      >
        <ActionIcon className="size-[10px]" />
        {state.actionLabel}
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="Source"
          className="absolute left-0 top-[calc(100%+6px)] z-50 w-72 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
        >
          <p className="px-2 py-1 text-[10px] font-semibold tracking-wide text-muted-foreground">
            Source
          </p>
          {SOURCE_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              role="menuitemradio"
              aria-checked={sourceMode === option.id}
              onClick={() => {
                setOpen(false);
                if (option.id !== sourceMode) onSourceModeChange(option.id);
              }}
              className="flex w-full items-start gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <span
                aria-hidden="true"
                className={cn(
                  "mt-1 size-1.5 shrink-0 rounded-full",
                  sourceMode === option.id ? "bg-primary" : "bg-muted-foreground/20"
                )}
              />
              <span className="min-w-0">
                <span className="block font-medium text-foreground">{option.label}</span>
                <span className="mt-0.5 block text-muted-foreground/70">{option.description}</span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/SourceTransportCluster.test.jsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/SourceTransportCluster.jsx src/components/SourceTransportCluster.test.jsx
git commit -m "feat(ui): add source transport cluster"
```

---

### Task 4: Wire The Cluster Into `App.jsx`

**Files:**
- Modify: `src/App.jsx`
- Modify: `src/App.toolbar.test.js`

- [ ] **Step 1: Add source-mode integration assertions**

Append these tests to `src/App.toolbar.test.js`:

```js
  it("renders the source-aware transport cluster instead of separate status and transport controls", () => {
    expect(appSource).toContain('import { SourceTransportCluster } from "./components/SourceTransportCluster.jsx";');
    expect(appSource).toContain("<SourceTransportCluster");
    expect(appSource).not.toContain("<StatusPill");
    expect(appSource).not.toContain("<TransportButton");
  });

  it("derives transport state from source mode and session state", () => {
    expect(appSource).toContain('const [sourceMode, setSourceMode] = useState("live");');
    expect(appSource).toContain("deriveSourceTransportState({");
    expect(appSource).toContain("sourceMode,");
    expect(appSource).toContain("latestTimestampMs");
    expect(appSource).toContain("elapsedMs: elapsedMsRef.current");
  });

  it("keeps File mode as an explicit UI shell until the file engine plan wires it", () => {
    expect(appSource).toContain('state: "empty"');
    expect(appSource).toContain("File analysis engine is not connected yet");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/App.toolbar.test.js`

Expected: FAIL because `App.jsx` still imports and renders `StatusPill` and `TransportButton`.

- [ ] **Step 3: Update imports in `App.jsx`**

Replace:

```js
import { StatusPill } from "./components/StatusPill.jsx";
import { TransportButton } from "./components/TransportButton.jsx";
```

with:

```js
import { SourceTransportCluster } from "./components/SourceTransportCluster.jsx";
import { deriveSourceTransportState } from "./lib/sourceTransportState.js";
```

- [ ] **Step 4: Add source-mode and file-shell state**

Near the existing engine state:

```js
const [running, setRunning] = useState(false);
const [selectedOffset, setSelectedOffset] = useState(-1);
const [status, setStatus] = useState("Ready - click Start to begin monitoring");
const [status2, setStatus2] = useState("Device: Not connected");
```

change to:

```js
const [sourceMode, setSourceMode] = useState("live");
const [fileSession, setFileSession] = useState({ state: "empty" });
const [running, setRunning] = useState(false);
const [selectedOffset, setSelectedOffset] = useState(-1);
const [status, setStatus] = useState("Ready - click Start to begin monitoring");
const [status2, setStatus2] = useState("Device: Not connected");
```

- [ ] **Step 5: Derive latest history timestamp and transport state**

Replace the existing `startMode` / `chromeState` block:

```js
const startMode = selectedOffset >= 0 ? "live" : running ? "stop" : "start";
// Maps old startMode values to new 3-state chrome vocabulary
const chromeState = startMode === "stop" ? "live" : startMode === "live" ? "snapshot" : "ready";
```

with:

```js
const latestTimestampMs = useMemo(() => {
  const last = histSourceList.length > 0 ? histSourceList[histSourceList.length - 1] : null;
  return Number.isFinite(last?.timestampMs) ? last.timestampMs : undefined;
}, [histSourceList]);

const sourceTransportState = deriveSourceTransportState({
  sourceMode,
  running,
  selectedOffset,
  latestTimestampMs,
  elapsedMs: elapsedMsRef.current,
  fileSession,
});
const chromeState = sourceTransportState.chromeState;
```

- [ ] **Step 6: Replace `onStartClick` with source-aware action handlers**

Replace:

```js
const onStartClick = () => {
  if (selectedOffset >= 0)
    return void (setSelectedOffset(-1), setStatus("Monitoring live input"));
  if (running) {
    setRunning(false);
    setSelectedOffset(-1);
    setStatus("Stopped - click Start to resume");
    setStatus2("Device: Not connected");
    stopTimer();
    return;
  }
  setRunning(true);
  startTimer();
  setShowClock(true);
};
```

with:

```js
const runLiveStartAction = () => {
  if (selectedOffset >= 0) {
    setSelectedOffset(-1);
    setStatus("Monitoring live input");
    return;
  }
  if (running) {
    setRunning(false);
    setSelectedOffset(-1);
    setStatus("Stopped - click Start to resume");
    setStatus2("Device: Not connected");
    stopTimer();
    return;
  }
  setRunning(true);
  startTimer();
  setShowClock(true);
};

const onSourceTransportAction = (actionKind) => {
  if (actionKind === "returnToLive") {
    setSelectedOffset(-1);
    setStatus("Monitoring live input");
    return;
  }
  if (actionKind === "startLive" || actionKind === "stopLive") {
    runLiveStartAction();
    return;
  }
  if (actionKind === "returnToFileResult") {
    setSelectedOffset(-1);
    setStatus("File analysis result");
    return;
  }
  setStatus("File analysis engine is not connected yet");
};

const onStartClick = runLiveStartAction;
```

Keep `onStartClick` for existing tray and keyboard shortcut wiring in this UI-shell slice. File-mode shortcuts can be specified in a later plan when file analysis exists.

- [ ] **Step 7: Add source switching**

Add this callback near the action handlers:

```js
const onSourceModeChange = (nextMode) => {
  if (nextMode === sourceMode) return;
  if (nextMode === "file") {
    if (running) {
      setRunning(false);
      stopTimer();
      setStatus("Stopped live monitoring - file mode selected");
      setStatus2("Device: Not connected");
    } else {
      setStatus("File mode - drop a file or click Analyze");
    }
    setSelectedOffset(-1);
    setSourceMode("file");
    return;
  }
  setSelectedOffset(-1);
  setSourceMode("live");
  setStatus("Ready - click Start to begin monitoring");
  setStatus2("Device: Not connected");
};
```

This manual source switch is the single entry into File mode and the one place
live capture is stopped for file analysis. OS file drops are never handled in
Live mode, so there is no drop-while-live confirmation dialog (the drag/drop
plan wires drops only while File mode is active). Switching to File while live is
running stops live as shown above; that explicit user action is the confirmation.

- [ ] **Step 8: Render the cluster in the header**

Replace:

```jsx
<StatusPill state={chromeState} showClock={showClock} clockRef={clockRef} />
```

with:

```jsx
<SourceTransportCluster
  state={sourceTransportState}
  sourceMode={sourceMode}
  onSourceModeChange={onSourceModeChange}
  onPrimaryAction={onSourceTransportAction}
/>
```

Leave the rest of the right-side toolbar unchanged.

- [ ] **Step 9: Run focused tests**

Run:

```bash
npx vitest run src/hooks/useSessionTimer.test.js src/lib/sourceTransportState.test.js src/components/SourceTransportCluster.test.jsx src/App.toolbar.test.js
```

Expected: PASS.

- [ ] **Step 10: Run lints for touched files**

Run:

```bash
npx eslint src/App.jsx src/hooks/useSessionTimer.js src/lib/sourceTransportState.js src/components/SourceTransportCluster.jsx src/App.toolbar.test.js src/hooks/useSessionTimer.test.js src/lib/sourceTransportState.test.js src/components/SourceTransportCluster.test.jsx
```

Expected: no errors.

- [ ] **Step 11: Commit**

```bash
git add src/App.jsx src/App.toolbar.test.js src/hooks/useSessionTimer.js src/hooks/useSessionTimer.test.js src/lib/sourceTransportState.js src/lib/sourceTransportState.test.js src/components/SourceTransportCluster.jsx src/components/SourceTransportCluster.test.jsx
git commit -m "feat(ui): add source-aware transport shell"
```

---

### Task 5: Documentation Cross-Check

**Files:**
- Modify: `docs/superpowers/specs/2026-06-22-file-analysis-mode-design.md` only if implementation reveals wording drift.

- [ ] **Step 1: Compare implementation behavior against the UI contract**

Check that the implementation covers these spec states:

```txt
not started: [ Live v | Ready ] [ START ]
capturing:   [ Live v | 00:12 ] [ STOP  ]
scrubbed:    [ Live v | 00:08 ] [ LIVE  ]
empty:       [ File v | Drop file ] [ ANALYZE ]
```

This plan does not implement real file `ready`, `analyzing`, `complete`, or file scrub states in `App.jsx`; it only adds the derivation helper and component support for those states. Backend/session plans will wire real file state into the same helper.

- [ ] **Step 2: Run the full frontend unit test suite**

Run:

```bash
npx vitest run
```

Expected: PASS. If unrelated tests fail, capture the failing test names and output before changing anything.

- [ ] **Step 3: Commit any documentation correction**

If no spec wording changed, skip this commit. If wording changed:

```bash
git add docs/superpowers/specs/2026-06-22-file-analysis-mode-design.md
git commit -m "docs(spec): align file analysis UI shell wording"
```

---

## Self-Review

Spec coverage:

- Covers source-aware left header cluster.
- Covers removing visible `Snapshot` text in scrubbed states by using only time plus `LIVE` / `RESULT` actions.
- Covers File empty shell without changing right-side toolbar icons.
- Covers manual source switch as the single File-mode entry (stops live), with no drop-while-live confirmation.
- Uses a single top-level `selectedMediaTimeMs` input for file scrub display (no `fileSession`-nested copy).
- Leaves actual file picker, `File`-mode-only drag/drop, decode/session IPC, progress events, and summary display for later plans.

Placeholder scan:

- No placeholder markers or unnamed implementation steps.
- The intentionally unwired File engine behavior is explicit and testable as `"File analysis engine is not connected yet"`.

Type consistency:

- `sourceMode` is always `"live" | "file"`.
- `chromeState` remains `"ready" | "live" | "snapshot"` so existing shell color semantics can stay intact.
- `actionKind` values are defined by `deriveSourceTransportState` and consumed by `onSourceTransportAction`.
