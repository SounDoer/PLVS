# C2 Phase 2: Capture Transport Owner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the live-capture transport (the `running` flag and its start/stop orchestration) an owner hook, internalize `rafRef` into the engine, and delete two freshly-audited dead spots — without behavior change.

**Architecture:** Audit finding (2026-07-08): `running` has consumers from App.jsx ~line 570 onward while the engine call sits at ~1490 with params built in between, so *the engine cannot own `running` yet* (that needs the Phase-4 provider split). The honest Phase-2 seam is a `useCaptureTransport` hook called early (after `display`/`liveIntakeRef`), owning `running` plus the orchestrated verbs; the engine consumes `transport` instead of `running`+`setRunning`. `rafRef` has no consumer outside the engine → moves inside. Spec: `docs/superpowers/specs/2026-07-08-c2-app-state-ownership-design.md`.

**Tech Stack:** React 19, Vitest + @testing-library/react (jsdom).

**Gate per commit:** `npm run check`. **Invariant:** no user-visible change.

---

### Task 1: Delete dead wklt block and dead audioData setRunning key

**Files:** Modify `src/App.jsx`

- [ ] **Step 1:** Confirm deadness: `grep -rn "wklt" src/` → only the App block; `grep -rn "setRunning" src/components/ src/workspace/` (excl. tests) → no hits.
- [ ] **Step 2:** In App.jsx delete the block (browser AudioWorklet capture was removed long ago; `wklt` is never assigned):

```jsx
    if (audioRef.current?.wklt) {
      try {
        audioRef.current.wklt.port.postMessage("reset");
      } catch (_) {}
    }
```

(Correction during execution: the audit misread — `audioData` never exposed `setRunning`; the only object-key occurrence is the engine call site, which must stay until Task 3 replaces it with `transport`. Task 1 is the wklt block only.)
- [ ] **Step 3:** `npm test` → green. Commit:

```bash
git add src/App.jsx
git commit -m "refactor(app): drop dead worklet reset and unused audioData setRunning" -m "audioRef.current.wklt is never assigned (leftover from the removed browser AudioWorklet capture) and no panel consumes setRunning from AudioDataContext. C2 phase 2 audit cleanup." -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 2: `useCaptureTransport` owner hook

**Files:** Create `src/hooks/useCaptureTransport.js`, `src/hooks/useCaptureTransport.test.jsx`; Modify `src/App.jsx`

- [ ] **Step 1:** Hook (plain functions, no useCallback — today's inline handlers are recreated per render too, and nothing memoizes on them):

```js
import { useState } from "react";

/**
 * Owner of the live-capture transport: the `running` flag and the verbs that
 * change it. startLive/stopLive carry the full user-facing orchestration
 * (intake session, clock, status lines); halt() is state-only for callers that
 * write their own status (the engine's error/browser paths, source switching).
 * See docs/superpowers/specs/2026-07-08-c2-app-state-ownership-design.md.
 */
export function useCaptureTransport({ display, getLiveIntake }) {
  const [running, setRunning] = useState(false);

  const halt = () => setRunning(false);

  const startLive = () => {
    getLiveIntake().beginCaptureSession();
    setRunning(true);
    display.clock.startTimer();
    display.setShowClock(true);
  };

  const stopLive = () => {
    setRunning(false);
    display.setSelectedOffset(-1);
    display.setStatus("Stopped - click Start to resume");
    display.setStatus2("Device: Not connected");
    display.clock.stopTimer();
  };

  return { running, halt, startLive, stopLive };
}
```

- [ ] **Step 2:** Tests (renderHook with a fake display: `{ clock: { startTimer: vi.fn(), stopTimer: vi.fn() }, setShowClock: vi.fn(), setSelectedOffset: vi.fn(), setStatus: vi.fn(), setStatus2: vi.fn() }` and `getLiveIntake: () => ({ beginCaptureSession: vi.fn() })` — assert startLive flips running + begins session + starts clock; stopLive flips back + writes both statuses + stops clock; halt only flips). Run them.
- [ ] **Step 3:** App swap: call after `liveIntakeRef` init:

```jsx
const transport = useCaptureTransport({
  display,
  getLiveIntake: () => liveIntakeRef.current,
});
const { running } = transport;
```

Delete `const [running, setRunning] = useState(false);`. Replace the two orchestration sites: the live toggle's stop branch body with `transport.stopLive();` (it is line-for-line the same sequence) and its start branch tail (`intakeRef.current.beginCaptureSession(); setRunning(true); startTimer(); setShowClock(true);`) with `transport.startLive();` — NOTE: verify `intakeRef.current` === live intake in that branch (it is: the toggle's start branch only runs in live mode where `intakeRef.current` is `liveIntakeRef.current`). The mode-switch stop keeps its bespoke status text: replace its `setRunning(false); stopTimer();` with `transport.halt(); stopTimer();` and leave its status lines.
Any other `setRunning(` site found by grep must be converted to the matching verb (halt for state-only) — grep must end at zero.
- [ ] **Step 4:** `npm test` (smoke test guards the mount) → green.

### Task 3: Engine consumes transport; rafRef internalized

**Files:** Modify `src/hooks/useAudioEngine.js`, `src/hooks/useAudioEngine.test.js`, `src/App.jsx`

- [ ] **Step 1:** Engine signature: remove `running`, `setRunning`, `rafRef` params; add `transport`; destructure `const { running, halt } = transport;` at the top; add `const rafRef = useRef(0);` inside. Replace both `setRunning(false)` calls (browser + error path) with `halt()`. Effect deps stay `[running, captureDeviceId, captureFormatSignature]`.
- [ ] **Step 2:** App call site: drop `running`, `setRunning`, `rafRef` keys; add `transport`. Delete `const rafRef = useRef(0);` from App (audit: no other consumer).
- [ ] **Step 3:** Test harness: replace `setRunning` prop with `transport: { running: true, halt: vi.fn() }` (merge `running: true` into it; drop harness rafRef).
- [ ] **Step 4:** `npm test` → green. Commit Tasks 2+3 together:

```bash
git add src/hooks/useCaptureTransport.js src/hooks/useCaptureTransport.test.jsx src/hooks/useAudioEngine.js src/hooks/useAudioEngine.test.js src/App.jsx
git commit -m "refactor(app): own live transport in useCaptureTransport" -m "running and its start/stop orchestration move behind a transport owner; the engine takes transport (halt for its error paths) instead of running+setRunning, and rafRef becomes engine-internal. Full running ownership by the engine stays blocked on the phase-4 provider split (call-order topology). C2 phase 2." -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 4: Gate and push

- [ ] `npm run check` → green; `git push`; watch CI to completion.
