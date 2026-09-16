# C2 Phase 0–1: Meter Display Owner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give App.jsx's shared metering display state a single owner (`useMeterDisplay`), delete the dead history-path plumbing, and put a real render smoke test under App — shrinking `useAudioEngine` from 22 to ~13 params and `useFileAnalysisEngine` from 18 to ~13 without any behavior change.

**Architecture:** See `docs/superpowers/specs/2026-07-08-c2-app-state-ownership-design.md`. Two producer engines and all panels share a display layer (audio snapshot, selected offset, status lines, session clock, frame counter) that currently lives loose in App.jsx; this plan moves it behind one hook and passes that hook's return object to the engines.

**Tech Stack:** React 19, Vitest + @testing-library/react (jsdom), no new dependencies.

**Verification gate for every commit:** `npm run check` (repo rule; guard tests cross language sides). During inner loops `npm test` is enough, but the commit steps assume the full gate.

**Behavior invariant:** No user-visible change. Only tests that asserted the deleted dead params may change.

---

### Task 1: App render smoke test (Phase 0 safety net)

**Files:**
- Create: `src/App.smoke.test.jsx`

- [ ] **Step 1: Write the smoke test**

```jsx
/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

// Browser mode (isTauri -> false): the real engine wiring runs its browser branch,
// which is deterministic (no native calls) and still exercises App's full mount path.
vi.mock("./ipc/env.js", () => ({ isTauri: () => false }));

// IPC surface: everything resolves benignly. Add exports here if the mount throws
// "No export named X" — keep resolutions inert, do not weaken assertions instead.
vi.mock("./ipc/commands.js", () => ({
  listAudioDevices: vi.fn().mockResolvedValue([]),
  previewAudioDevice: vi.fn().mockResolvedValue({ sampleRateHz: 48000, label: "Mock" }),
  startAudioCapture: vi.fn().mockResolvedValue(undefined),
  stopAudioCapture: vi.fn().mockResolvedValue(undefined),
  setLoudnessWeights: vi.fn().mockResolvedValue(undefined),
  setDialogueGating: vi.fn().mockResolvedValue(undefined),
  setDialogueVadEngine: vi.fn().mockResolvedValue(undefined),
  ackFrames: vi.fn().mockResolvedValue(undefined),
  setAnalysisRequests: vi.fn().mockResolvedValue(undefined),
  startFileAnalysis: vi.fn().mockResolvedValue(undefined),
  stopFileAnalysis: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  cleanup();
  localStorage.clear();
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }));
  window.ResizeObserver =
    window.ResizeObserver ||
    vi.fn().mockImplementation(() => ({
      observe: vi.fn(),
      unobserve: vi.fn(),
      disconnect: vi.fn(),
    }));
});

describe("App smoke", () => {
  it("mounts the full app shell", async () => {
    const { default: App } = await import("./App.jsx");
    render(<App />);
    // Transport + status line are the app's spine; if they render, the whole
    // provider/workspace/panel tree mounted without throwing.
    expect(await screen.findByText(/Ready - click Start/i)).toBeTruthy();
  });

  it("START click drives the real engine wiring (browser branch)", async () => {
    const { default: App } = await import("./App.jsx");
    render(<App />);
    const start = await screen.findByRole("button", { name: /start/i });
    fireEvent.click(start);
    // Browser mode: useAudioEngine's init() runs, detects non-Tauri, sets this status
    // and flips running back off. This asserts the App->hook->status round trip.
    await waitFor(() => {
      expect(screen.getByText(/Browser preview/i)).toBeTruthy();
    });
  });
});
```

- [ ] **Step 2: Run it; iterate mocks until green**

Run: `npx vitest run src/App.smoke.test.jsx`
Expected first runs may fail with missing mock exports (`ipc/commands.js` re-exports used by `useAudioDevices`, `usePresets`, drag/drop, updater) or missing DOM APIs (`ResizeObserver`, canvas `getContext`). Fix by:
- adding the named export to the `vi.mock("./ipc/commands.js", ...)` factory with an inert resolution;
- if a hook imports from `./ipc/events.js`, add `vi.mock("./ipc/events.js", () => ({ <name>: vi.fn(() => () => {}) }))` (subscriptions return unsubscribe functions);
- if canvas throws, stub `HTMLCanvasElement.prototype.getContext = vi.fn(() => null)` in `beforeEach` (panels already guard null contexts — verify the guard exists before stubbing differently).
Do NOT delete or loosen the two assertions.
Expected end state: 2 passed.

- [ ] **Step 3: Run the full suite to check for cross-test interference**

Run: `npm test`
Expected: all files pass (1237+ tests, +2 new).

- [ ] **Step 4: Commit**

```bash
git add src/App.smoke.test.jsx
git commit -m "test(app): add real render smoke test for App shell" -m "First behavioral test that mounts App: asserts full provider/workspace tree renders and that clicking START drives the engine wiring through its browser branch. Safety net for the C2 state-ownership refactor (docs/superpowers/specs/2026-07-08-c2-app-state-ownership-design.md)." -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Delete dead history-path plumbing (Phase 1a)

Both engine call sites pass `setHistoryPathM: () => {}` / `setHistoryPathST: () => {}`; no real setter exists anywhere. Remove the parameters end to end.

**Files:**
- Modify: `src/lib/tauriFrameApply.js` (params ~line 21–22; calls ~line 100–101)
- Modify: `src/hooks/useAudioEngine.js` (param ~line 60–61; calls at 78–79 and pass-through at 163–164)
- Modify: `src/hooks/useFileAnalysisEngine.js` (param ~line 43–44; calls at 73–74 and pass-through at 146–147)
- Modify: `src/App.jsx` (no-op lines 1111–1112 and 1523–1524)
- Modify: any test constructing these hooks/builders with those keys (`src/hooks/useAudioEngine.test.js`, `src/hooks/useFileAnalysisEngine.test.jsx`, `src/lib/tauriFrameApply.test.js` if present)

- [ ] **Step 1: Grep to confirm the full occurrence list before editing**

Run: `grep -rn "setHistoryPathM\|setHistoryPathST\|HistoryPathST" src/`
Expected: only the files listed above (source + tests). If a *real* (non-noop, non-passthrough) setter appears anywhere, STOP — the premise is wrong; re-audit before deleting.

- [ ] **Step 2: Remove the two params and every use in the four source files**

In `tauriFrameApply.js`: delete `setHistoryPathM,` / `setHistoryPathST,` from the destructured params and delete the block:

```js
    if (selectedOffsetRef.current < 0 && shouldPaintUi) {
      setHistoryPathM?.("");
      setHistoryPathST?.("");
    }
```

In `useAudioEngine.js`: delete the two params, delete `setHistoryPathM("");` / `setHistoryPathST("");` from `clearLocalMeterStateForRestart`, delete the two pass-through lines in the `buildTauriFrameApply({...})` call.
In `useFileAnalysisEngine.js`: same three kinds of deletions.
In `App.jsx`: delete the four no-op lines (two per engine call site).

- [ ] **Step 3: Fix tests that passed those keys**

Search each test file from Step 1's list; delete the `setHistoryPathM`/`setHistoryPathST` keys from fixture param objects and any assertions on them (an assertion that a no-op was called with `""` guards nothing).

- [ ] **Step 4: Full gate, then commit**

Run: `npm run check`
Expected: all green.

```bash
git add -A src
git commit -m "refactor(engine): remove dead history-path setter plumbing" -m "setHistoryPathM/ST were threaded App -> both engines -> tauriFrameApply, but both call sites pass no-ops and no real setter exists. C2 phase 1a (see docs/superpowers/specs/2026-07-08-c2-app-state-ownership-design.md)." -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Introduce `useMeterDisplay` (Phase 1b)

The hook owns the shared display layer. App consumes it by destructuring into the *same local names*, so the ~1800 lines of existing consumers compile unchanged.

**Files:**
- Create: `src/hooks/useMeterDisplay.js`
- Create: `src/hooks/useMeterDisplay.test.jsx`
- Modify: `src/App.jsx` (state block ~lines 406–408, 421–424, 452–478, 488, 523; sync effect ~1490–1492; `clearMeterDisplayState` ~1038)

- [ ] **Step 1: Diff App's initial `audio` object against `clearMeterDisplayState`'s object**

Run: read `src/App.jsx:452-478` and the full body of `clearMeterDisplayState` (~1038). If the two object literals are key-for-key identical, one `INITIAL_METER_AUDIO` constant serves both. If they differ (e.g. clear keeps `spectrumResultsByKey`), keep two constants with the exact literal bodies — do not "fix" the difference.

- [ ] **Step 2: Write the hook**

```js
import { useEffect, useRef, useState } from "react";
import { useSessionTimer } from "./useSessionTimer.js";

/**
 * Owner of the shared metering display layer: the meter frame snapshot, history
 * scrub offset, status lines, session clock, and frame counter. Both engines
 * (live capture, file analysis) write into this layer; panels read it. See
 * docs/superpowers/specs/2026-07-08-c2-app-state-ownership-design.md.
 *
 * All setters/refs returned here are identity-stable; the wrapper object is not.
 * Engine effects must keep reading fields inside the effect body and must not
 * list the wrapper in dependency arrays.
 */
export const INITIAL_METER_AUDIO = {
  // exact literal moved from App.jsx:452-478 (Step 1)
};

export function useMeterDisplay() {
  const [audio, setAudio] = useState({ ...INITIAL_METER_AUDIO });
  const [selectedOffset, setSelectedOffset] = useState(-1);
  const [status, setStatus] = useState("Ready - click Start to begin monitoring");
  const [status2, setStatus2] = useState("Device: Not connected");
  const [showClock, setShowClock] = useState(false);
  const selectedOffsetRef = useRef(-1);
  const frameRef = useRef(0);
  const clock = useSessionTimer();

  useEffect(() => {
    selectedOffsetRef.current = selectedOffset;
  }, [selectedOffset]);

  const clearAudio = () => setAudio({ ...INITIAL_METER_AUDIO });

  return {
    audio,
    setAudio,
    selectedOffset,
    setSelectedOffset,
    selectedOffsetRef,
    frameRef,
    status,
    setStatus,
    status2,
    setStatus2,
    showClock,
    setShowClock,
    clock,
    clearAudio,
  };
}
```

(If Step 1 found differing literals, export both and give `clearAudio` the clear-time literal.)

- [ ] **Step 3: Write the hook test**

```jsx
/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useMeterDisplay, INITIAL_METER_AUDIO } from "./useMeterDisplay.js";

describe("useMeterDisplay", () => {
  it("starts with the initial meter snapshot and idle status", () => {
    const { result } = renderHook(() => useMeterDisplay());
    expect(result.current.audio).toEqual(INITIAL_METER_AUDIO);
    expect(result.current.selectedOffset).toBe(-1);
    expect(result.current.status).toMatch(/Ready/);
  });

  it("mirrors selectedOffset into selectedOffsetRef", () => {
    const { result } = renderHook(() => useMeterDisplay());
    act(() => result.current.setSelectedOffset(42));
    expect(result.current.selectedOffsetRef.current).toBe(42);
  });

  it("clearAudio resets the snapshot after writes", () => {
    const { result } = renderHook(() => useMeterDisplay());
    act(() => result.current.setAudio((a) => ({ ...a, momentary: -12 })));
    act(() => result.current.clearAudio());
    expect(result.current.audio).toEqual(INITIAL_METER_AUDIO);
  });
});
```

Run: `npx vitest run src/hooks/useMeterDisplay.test.jsx` → 3 passed.

- [ ] **Step 4: Swap App.jsx onto the hook, preserving local names**

Replace the owned lines in App.jsx:

```jsx
const display = useMeterDisplay();
const {
  audio,
  setAudio,
  selectedOffset,
  setSelectedOffset,
  selectedOffsetRef,
  frameRef,
  status,
  setStatus,
  status2,
  setStatus2,
  showClock,
  setShowClock,
} = display;
const { clockRef, elapsedMsRef, canClearRef, startTimer, stopTimer, resetTimer } = display.clock;
```

Delete the now-duplicated lines: `useSessionTimer()` call (406–407), `showClock` state (408), `running`-adjacent display states (422–424 — `running` itself STAYS in App for this phase), `audio` useState (452–478), `frameRef` (488), `selectedOffsetRef` (523), the `selectedOffset` sync effect (1490–1492), and rewrite `clearMeterDisplayState` to `display.clearAudio()` (or keep its literal if Step 1 diffs). Import `useMeterDisplay`; drop the `useSessionTimer` import if unused.

- [ ] **Step 5: Full suite, including the smoke test**

Run: `npm test`
Expected: all green — the smoke test proves the mount path survived the move.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useMeterDisplay.js src/hooks/useMeterDisplay.test.jsx src/App.jsx
git commit -m "refactor(app): move shared display state behind useMeterDisplay" -m "The meter snapshot, scrub offset, status lines, session clock and frame counter now have one owner hook; App consumes it by destructuring so all existing consumers are unchanged. C2 phase 1b." -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Engines take the `display` object (Phase 1c)

**Files:**
- Modify: `src/hooks/useAudioEngine.js` (signature + internal reads)
- Modify: `src/hooks/useFileAnalysisEngine.js` (same)
- Modify: `src/App.jsx` (both call sites)
- Modify: `src/hooks/useAudioEngine.test.js`, `src/hooks/useFileAnalysisEngine.test.jsx` (fixture params)

- [ ] **Step 1: Rewrite `useAudioEngine`'s signature**

```js
export function useAudioEngine({
  running,
  captureDeviceId = "default",
  captureFormatSignature = "",
  histMaxSamples,
  visualMaxSamples,
  audioRef,
  rafRef,
  intake,
  loudnessWeightsRef,
  dialogueGatingRef,
  dialogueVadEngineRef,
  setRunning,
  display,
  defaultSampleRateRef: externalDefaultSampleRateRef,
}) {
  const {
    frameRef,
    selectedOffsetRef,
    setAudio,
    setSelectedOffset,
    setStatus,
    setStatus2,
    setShowClock,
    clock: { resetTimer },
  } = display;
```

Body below the destructure is unchanged (it already used exactly these names). The narrow effect deps `[running, captureDeviceId, captureFormatSignature]` stay as-is; `display` must NOT be added (its fields are identity-stable, the wrapper is not — see the hook's doc comment).

- [ ] **Step 2: Same treatment for `useFileAnalysisEngine`**

Replace `frameRef, selectedOffsetRef, setAudio, setSelectedOffset, setStatus` params with `display` and destructure the same five at the top. `updateFileSession`, `setAnalyzingFileId`, `shouldDriveDisplay`, `intake`, ids/paths stay as explicit params (they are file-domain, not display-domain).

- [ ] **Step 3: Update both App.jsx call sites**

```jsx
useAudioEngine({
  running,
  captureDeviceId,
  captureFormatSignature,
  histMaxSamples: HIST_MAX_SAMPLES,
  visualMaxSamples: VISUAL_MAX_SAMPLES,
  audioRef,
  rafRef,
  intake: liveIntakeRef.current,
  loudnessWeightsRef,
  dialogueGatingRef,
  dialogueVadEngineRef,
  setRunning,
  display,
  defaultSampleRateRef,
});
```

(and the equivalent reduction for `useFileAnalysisEngine` — remove the five display params, add `display`).

- [ ] **Step 4: Update hook test fixtures**

In both hook test files, replace the individual display-ish keys in the params fixture with a `display` object built from vi.fn()s and plain refs:

```js
const makeDisplay = () => ({
  frameRef: { current: 0 },
  selectedOffsetRef: { current: -1 },
  setAudio: vi.fn(),
  setSelectedOffset: vi.fn(),
  setStatus: vi.fn(),
  setStatus2: vi.fn(),
  setShowClock: vi.fn(),
  clock: { resetTimer: vi.fn() },
});
```

Existing assertions keep working against `display.setStatus` etc. — update references, not semantics.

- [ ] **Step 5: Full gate**

Run: `npm run check`
Expected: all green (frontend format/lint/test/build + version + Rust).

- [ ] **Step 6: Commit**

```bash
git add src/hooks src/App.jsx
git commit -m "refactor(engine): pass the display owner object to both engines" -m "useAudioEngine 22->14 params, useFileAnalysisEngine 18->14: the shared display layer now arrives as the useMeterDisplay object instead of eight loose setters/refs. Effect dependency arrays unchanged by design. C2 phase 1c." -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Wrap-up

- [ ] **Step 1: Confirm param counts and no stragglers**

Run: `grep -c "," src/hooks/useAudioEngine.js | head -1` is NOT the check — instead visually confirm both signatures match Task 4, and run `grep -rn "setHistoryPath" src/` → no hits.

- [ ] **Step 2: Manual sanity note**

Release binaries are unaffected (frontend-only), but a quick `npm run desktop` visual pass (START/STOP, device switch, file analysis, history scrub) is the human-eyes check before pushing. Record the result in the session log / PR description.

- [ ] **Step 3: Push after the manual pass**

```bash
git push
```
