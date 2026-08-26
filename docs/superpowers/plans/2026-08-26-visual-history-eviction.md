# Visual History Eviction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `FrameIntake` from keeping a visual-history slab alive for every analysis request key it has ever seen, by dropping slabs no open panel needs and slabs whose newest row has aged out of the retention window.

**Architecture:** The set of keys worth keeping is computed straight from the open panels — no request cap, no dock merge, no channel-availability gate — and handed to `FrameIntake`. A sweep at the end of `pushVisualHistRow` drops keys that have been unneeded for three seconds and slabs whose newest row is older than the retention window. Because the sweep only runs when a visual frame arrives, eviction pauses by itself while capture is stopped.

**Tech Stack:** Plain ES modules, Vitest, React 19 hooks.

**Spec:** `docs/superpowers/specs/2026-08-26-visual-history-eviction-design.md`

---

## Background an engineer needs before Task 1

- A slab is created lazily, on the first row that arrives under a key (`FrameIntake.js:313-316`). A retained key with no data costs nothing.
- Retention pruning is append-driven: `_dropExpiredChunks` is called only from `appendRow` (`ChunkedHistorySlab.js:77`), and `StereoMapHistorySlab.js:750` mirrors it. A slab that stops receiving rows never ages anything out on its own. That is why Rule 2 exists.
- All three slab types expose `length` and `timestampAt(index)`. `SpectrumHistorySlab.timestampAt` returns `NaN` for a row stored without a usable timestamp, so every comparison must be guarded with `Number.isFinite`.
- Keys are globally distinct across families because each builder prefixes its own family name (`spectrum:…`, `vectorscope:…`, `stereoMap:…`). One shared "unneeded since" map is therefore safe.
- Do **not** import `src/workspace/registry.jsx` from anything in this plan. See the Known pitfalls section of `AGENTS.md`: it pulls in all eight canvas panels and pushes unrelated tests past Vitest's per-test timeout.

---

### Task 1: Retained key set from the workspace

**Files:**

- Modify: `src/analysis/analysisRequests.js`
- Test: `src/analysis/analysisRequests.test.js`

- [ ] **Step 1: Write the failing tests**

Append inside the existing top-level `describe` in `src/analysis/analysisRequests.test.js`. Add `deriveRetainedAnalysisKeys` to the existing import block from `./analysisRequests.js` — and only that, since lint runs in `npm run check` and an unused import fails it.

```js
describe("deriveRetainedAnalysisKeys", () => {
  it("keeps a key per open panel, past the request cap", () => {
    // MAX_SPECTRUM_REQUESTS is 4. Five Spectrum panels with five distinct speeds are five
    // distinct keys; capRequests would drop the fifth, but the panel is still open and still
    // wants its history.
    const panelsById = {};
    const panelControlsById = {};
    for (let i = 0; i < 5; i += 1) {
      panelsById[`spec-${i}`] = { moduleId: "spectrum" };
      panelControlsById[`spec-${i}`] = {
        ...DEFAULT_PANEL_CONTROLS,
        spectrumSpeedPercent: 10 * (i + 1),
      };
    }
    const retained = deriveRetainedAnalysisKeys(state({ panelsById, panelControlsById }));
    expect(retained.spectrum.size).toBe(5);
  });

  it("puts Spectrogram panels in the Spectrum family", () => {
    const retained = deriveRetainedAnalysisKeys(
      state({
        panelsById: { spec: { moduleId: "spectrum" }, gram: { moduleId: "spectrogram" } },
        panelControlsById: {
          spec: { ...DEFAULT_PANEL_CONTROLS, spectrumView: "ms" },
          gram: { ...DEFAULT_PANEL_CONTROLS, spectrumView: "combined" },
        },
      })
    );
    expect(retained.spectrum.size).toBe(2);
    expect(retained.vectorscope.size).toBe(0);
  });

  it("keeps a Stereo Map key even when no channel pair is available", () => {
    // deriveAnalysisRequests gates Stereo Map on channelCount, because Rust cannot compute it
    // without a pair. Retention must not: channelCount comes from the live frame shape, so a
    // device blip would otherwise delete hours of history.
    const workspace = state({
      panelsById: { sm: { moduleId: "stereo-map" } },
      panelControlsById: { sm: DEFAULT_PANEL_CONTROLS },
    });
    expect(deriveAnalysisRequests(workspace, { channelCount: 1 }).stereoMapRequests).toHaveLength(
      0
    );
    expect(deriveRetainedAnalysisKeys(workspace).stereoMap).toContain(
      stereoMapRequestKeyFromControls(DEFAULT_PANEL_CONTROLS)
    );
  });

  it("ignores panels that are not in the tree", () => {
    const retained = deriveRetainedAnalysisKeys({
      tree: leaf(["spec"]),
      panelsById: { spec: { moduleId: "spectrum" }, gone: { moduleId: "vectorscope" } },
      panelOrder: ["spec", "gone"],
      panelControlsById: {},
    });
    expect(retained.spectrum.size).toBe(1);
    expect(retained.vectorscope.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/analysis/analysisRequests.test.js`
Expected: FAIL — `deriveRetainedAnalysisKeys is not a function`.

- [ ] **Step 3: Implement**

Add to `src/analysis/analysisRequests.js`, after `deriveAnalysisRequests`:

```js
/**
 * The analysis keys whose history is worth keeping: one per open panel, with no request cap, no
 * dock merge and no availability gate.
 *
 * This deliberately does not reuse `deriveAnalysisRequests`. That answers "what should Rust
 * compute right now", which is a different question -- a panel that lost the cap, or whose slot
 * the dock took, or whose channel pair is momentarily unavailable, is still open and still wants
 * its history. Deriving retention from the request list would delete it.
 */
export function deriveRetainedAnalysisKeys(state) {
  const panelIdsInTree = collectPanelIdsFromTree(state?.tree, state?.panelsById);
  const orderedPanelIds = (state?.panelOrder ?? []).filter((id) => panelIdsInTree.includes(id));
  const spectrum = new Set();
  const vectorscope = new Set();
  const stereoMap = new Set();

  for (const panelId of orderedPanelIds) {
    const moduleId = resolvePanelModuleId(state, panelId);
    if (moduleId === "spectrum" || moduleId === "spectrogram") {
      spectrum.add(spectrumRequestKeyFromControls(getPanelControls(state, panelId)));
    } else if (moduleId === "vectorscope") {
      vectorscope.add(vectorscopeRequestKeyFromControls(getPanelControls(state, panelId)));
    } else if (moduleId === "stereo-map") {
      stereoMap.add(
        stereoMapRequestKeyFromControls(
          state.panelControlsById?.[panelId] ?? state.panelControls ?? undefined
        )
      );
    }
  }

  return { spectrum, vectorscope, stereoMap };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/analysis/analysisRequests.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/analysis/analysisRequests.js src/analysis/analysisRequests.test.js
git commit -m "feat(analysis): derive the analysis keys whose history is worth keeping"
```

---

### Task 2: Add the dock's keys to the retained set

**Files:**

- Modify: `src/dock/dockAnalysisRequest.js`
- Test: `src/dock/dockAnalysisRequest.test.js`

- [ ] **Step 1: Write the failing tests**

Add to `src/dock/dockAnalysisRequest.test.js`. Extend the existing import from `./dockAnalysisRequest.js` with `mergeDockRetainedKeys`, `dockSpectrumKey`, `dockVectorscopeKey` and `dockStereoMapKey`.

```js
describe("mergeDockRetainedKeys", () => {
  const EMPTY_RETAINED = { spectrum: new Set(), vectorscope: new Set(), stereoMap: new Set() };

  it("is a no-op without dock panels", () => {
    expect(mergeDockRetainedKeys(EMPTY_RETAINED, [])).toBe(EMPTY_RETAINED);
    expect(mergeDockRetainedKeys(EMPTY_RETAINED, undefined)).toBe(EMPTY_RETAINED);
  });

  it("adds a key for each dock module family", () => {
    const merged = mergeDockRetainedKeys(EMPTY_RETAINED, [
      { panelId: "spectrum", moduleId: "spectrum", controls: {} },
      { panelId: "vectorscope", moduleId: "vectorscope", controls: {} },
      { panelId: "stereoMap", moduleId: "stereo-map", controls: {} },
      { panelId: "level", moduleId: "levelMeter", controls: {} },
    ]);
    expect(merged.spectrum).toContain(dockSpectrumKey({}));
    expect(merged.vectorscope).toContain(dockVectorscopeKey({}));
    expect(merged.stereoMap).toContain(dockStereoMapKey({}));
  });

  it("keeps the workspace keys and does not mutate the input", () => {
    const retained = {
      spectrum: new Set(["panel-key"]),
      vectorscope: new Set(),
      stereoMap: new Set(),
    };
    const merged = mergeDockRetainedKeys(retained, [
      { panelId: "spectrum", moduleId: "spectrum", controls: {} },
    ]);
    expect(merged.spectrum).toContain("panel-key");
    expect(merged.spectrum.size).toBe(2);
    expect(retained.spectrum.size).toBe(1);
  });

  it("puts a dock Spectrogram module in the Spectrum family", () => {
    const merged = mergeDockRetainedKeys(EMPTY_RETAINED, [
      { panelId: "spectrogram", moduleId: "spectrogram", controls: {} },
    ]);
    expect(merged.spectrum.size).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/dock/dockAnalysisRequest.test.js`
Expected: FAIL — `mergeDockRetainedKeys is not a function`.

- [ ] **Step 3: Implement**

Add to `src/dock/dockAnalysisRequest.js`, after `mergeDockAnalysisRequests`:

```js
/**
 * Adds the dock modules' keys to the retained set. Layered on top of the analysis half the same
 * way `mergeDockAnalysisRequests` is, so the dock keeps depending on analysis and not the reverse.
 *
 * Dock keys are retained whether or not the dock is currently showing: `AppShell` renders the
 * strip or the panels, never both, so whichever is hidden comes back intact.
 */
export function mergeDockRetainedKeys(retained, dockPanels) {
  if (!Array.isArray(dockPanels) || dockPanels.length === 0) return retained;
  const spectrum = new Set(retained.spectrum);
  const vectorscope = new Set(retained.vectorscope);
  const stereoMap = new Set(retained.stereoMap);

  for (const panel of dockPanels) {
    const dockModuleId = dockModuleIdForPanelModuleId(panel.moduleId) ?? panel.moduleId;
    if (dockModuleId === "spectrum" || dockModuleId === "spectrogram") {
      spectrum.add(dockSpectrumKey(panel.controls));
    } else if (dockModuleId === "correlation") {
      vectorscope.add(dockVectorscopeKey(panel.controls));
    } else if (dockModuleId === "stereoMap") {
      stereoMap.add(dockStereoMapKey(panel.controls));
    }
  }

  return { spectrum, vectorscope, stereoMap };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/dock/dockAnalysisRequest.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/dock/dockAnalysisRequest.js src/dock/dockAnalysisRequest.test.js
git commit -m "feat(dock): add the dock modules' keys to the retained set"
```

---

### Task 3: The sweep in FrameIntake

**Files:**

- Modify: `src/lib/FrameIntake.js`
- Test: `src/lib/FrameIntake.test.js`

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/FrameIntake.test.js`. `EVICTION_GRACE_MS` joins the existing import from `./FrameIntake.js`.

```js
describe("visual history eviction", () => {
  const SPEC_KEY = "spectrum:pair:0:1:combined:sp25:tilt300:smoff";
  const OTHER_KEY = "spectrum:pair:0:1:combined:sp40:tilt300:smoff";

  function spectrumRow(timestampMs, key) {
    return {
      timestampMs,
      waveformMin: [0],
      waveformMax: [0],
      spectrumByKey: { [key]: { bandCentersHz: [100, 200], smoothDb: [-20, -30] } },
    };
  }

  // A window far longer than any timestamp these tests use, so the age rule never fires unless a
  // test is specifically exercising it.
  const WIDE_WINDOW_MS = 60 * 60 * 1000;

  function retain(keys) {
    return { spectrum: new Set(keys), vectorscope: new Set(), stereoMap: new Set() };
  }

  it("keeps a key that a panel still needs", () => {
    const intake = new FrameIntake();
    intake.setRetainedVisualKeys(retain([SPEC_KEY]), WIDE_WINDOW_MS);
    intake.pushVisualHistRow(spectrumRow(1000, SPEC_KEY), 10);
    intake.pushVisualHistRow(spectrumRow(1000 + EVICTION_GRACE_MS * 10, SPEC_KEY), 10);
    expect(intake.getVisualSpectrumHistByKey(SPEC_KEY)).not.toBeNull();
  });

  it("keeps an unneeded key inside the grace window and drops it after", () => {
    const intake = new FrameIntake();
    intake.setRetainedVisualKeys(retain([SPEC_KEY]), WIDE_WINDOW_MS);
    intake.pushVisualHistRow(spectrumRow(1000, SPEC_KEY), 10);

    // The panel moves to a new setting: SPEC_KEY is no longer needed, OTHER_KEY is.
    intake.setRetainedVisualKeys(retain([OTHER_KEY]), WIDE_WINDOW_MS);
    intake.pushVisualHistRow(spectrumRow(2000, OTHER_KEY), 10);
    expect(intake.getVisualSpectrumHistByKey(SPEC_KEY)).not.toBeNull();

    intake.pushVisualHistRow(spectrumRow(2000 + EVICTION_GRACE_MS - 1, OTHER_KEY), 10);
    expect(intake.getVisualSpectrumHistByKey(SPEC_KEY)).not.toBeNull();

    intake.pushVisualHistRow(spectrumRow(2000 + EVICTION_GRACE_MS, OTHER_KEY), 10);
    expect(intake.getVisualSpectrumHistByKey(SPEC_KEY)).toBeNull();
    expect(intake.getVisualSpectrumHistByKey(OTHER_KEY)).not.toBeNull();
  });

  it("restarts the grace window when an unneeded key is needed again", () => {
    const intake = new FrameIntake();
    intake.setRetainedVisualKeys(retain([SPEC_KEY]), WIDE_WINDOW_MS);
    intake.pushVisualHistRow(spectrumRow(1000, SPEC_KEY), 10);

    intake.setRetainedVisualKeys(retain([OTHER_KEY]), WIDE_WINDOW_MS);
    intake.pushVisualHistRow(spectrumRow(2000, OTHER_KEY), 10);

    intake.setRetainedVisualKeys(retain([SPEC_KEY, OTHER_KEY]), WIDE_WINDOW_MS);
    intake.pushVisualHistRow(spectrumRow(2000 + EVICTION_GRACE_MS * 2, OTHER_KEY), 10);
    expect(intake.getVisualSpectrumHistByKey(SPEC_KEY)).not.toBeNull();
  });

  it("drops a needed slab whose newest row has left the retention window", () => {
    // A panel can be open -- so its key is retained -- and still receive nothing, because it lost
    // the request cap or the dock took its slot. Expiry is append-driven, so such a slab freezes
    // and holds rows from outside the window forever unless the age rule drops it.
    const intake = new FrameIntake();
    const windowMs = 5000;
    intake.setRetainedVisualKeys(retain([SPEC_KEY, OTHER_KEY]), windowMs);
    intake.pushVisualHistRow(spectrumRow(1000, SPEC_KEY), 10);

    intake.pushVisualHistRow(spectrumRow(1000 + windowMs, OTHER_KEY), 10);
    expect(intake.getVisualSpectrumHistByKey(SPEC_KEY)).not.toBeNull();

    intake.pushVisualHistRow(spectrumRow(1000 + windowMs + 1, OTHER_KEY), 10);
    expect(intake.getVisualSpectrumHistByKey(SPEC_KEY)).toBeNull();
  });

  it("does not sweep without a frame, which is what pauses eviction while stopped", () => {
    const intake = new FrameIntake();
    intake.setRetainedVisualKeys(retain([SPEC_KEY]), WIDE_WINDOW_MS);
    intake.pushVisualHistRow(spectrumRow(1000, SPEC_KEY), 10);
    intake.setRetainedVisualKeys(retain([]), WIDE_WINDOW_MS);
    expect(intake.getVisualSpectrumHistByKey(SPEC_KEY)).not.toBeNull();
  });

  it("sweeps nothing until a retained set has been supplied", () => {
    const intake = new FrameIntake();
    intake.pushVisualHistRow(spectrumRow(1000, SPEC_KEY), 10);
    intake.pushVisualHistRow(spectrumRow(1000 + EVICTION_GRACE_MS * 10, SPEC_KEY), 10);
    expect(intake.getVisualSpectrumHistByKey(SPEC_KEY)).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/FrameIntake.test.js`
Expected: FAIL — `setRetainedVisualKeys is not a function`.

- [ ] **Step 3: Implement**

In `src/lib/FrameIntake.js`, add the constant near the top, beside the other module-level constants:

```js
/**
 * How long a key must go unneeded before its slab is dropped. This is a safety margin, not a
 * feature: it exists so a sweep never acts on a state that is mid-transition. It is deliberately
 * short, and nothing user-facing should describe it -- "change back within three seconds and your
 * history returns" is not a promise this app makes.
 */
export const EVICTION_GRACE_MS = 3000;
```

Add to the constructor, beside the three keyed maps:

```js
this._retainedVisualKeys = null;
this._visualRetentionWindowMs = null;
// Key -> the timestamp it was first seen unneeded. One map across all three families is safe:
// every key builder prefixes its own family name, so keys never collide.
this._unneededVisualKeysSince = new Map();
```

Add the setter beside the other public methods:

```js
  /**
   * The keys whose history is worth keeping, and the retention window in milliseconds. Supplied by
   * the app from the open panels; see `deriveRetainedAnalysisKeys`.
   */
  setRetainedVisualKeys(keysByFamily, windowMs) {
    this._retainedVisualKeys = keysByFamily ?? null;
    this._visualRetentionWindowMs = Number.isFinite(windowMs) ? windowMs : null;
  }
```

Add the sweep as private methods:

```js
  /**
   * Drops slabs no open panel needs, and slabs whose newest row has aged out of the retention
   * window. Runs on frame arrival rather than on a timer, which is what makes eviction pause while
   * capture is stopped: no frames, no sweep, and the recording in memory stays whole.
   */
  _sweepVisualHistories(nowMs) {
    const retained = this._retainedVisualKeys;
    if (!retained || !Number.isFinite(nowMs)) return;
    this._sweepVisualFamily(this._visualSpectrumHistByKey, retained.spectrum, nowMs);
    this._sweepVisualFamily(this._visualVectorscopeHistByKey, retained.vectorscope, nowMs);
    this._sweepVisualFamily(this._visualStereoMapHistByKey, retained.stereoMap, nowMs);
  }

  _sweepVisualFamily(slabsByKey, retainedKeys, nowMs) {
    const windowMs = this._visualRetentionWindowMs;
    for (const [key, slab] of slabsByKey) {
      if (retainedKeys?.has(key)) {
        this._unneededVisualKeysSince.delete(key);
      } else {
        const since = this._unneededVisualKeysSince.get(key);
        if (since === undefined) {
          this._unneededVisualKeysSince.set(key, nowMs);
        } else if (nowMs - since >= EVICTION_GRACE_MS) {
          slabsByKey.delete(key);
          this._unneededVisualKeysSince.delete(key);
          continue;
        }
      }

      // A retained key can still hold a slab nothing feeds any more -- expiry is append-driven, so
      // it would otherwise keep rows from outside the window for the rest of the session.
      if (!Number.isFinite(windowMs) || slab.length === 0) continue;
      const newestMs = slab.timestampAt(slab.length - 1);
      if (Number.isFinite(newestMs) && nowMs - newestMs > windowMs) {
        slabsByKey.delete(key);
        this._unneededVisualKeysSince.delete(key);
      }
    }
  }
```

Call it at the very end of `pushVisualHistRow`, after the `stereoMapByKey` loop closes:

```js
this._sweepVisualHistories(timestampMs);
```

Clear the bookkeeping wherever the keyed maps are already dropped wholesale — in `pushVisualHistRow`'s capacity-change branch, beside the three `new Map()` assignments, and in `reset()` beside its three:

```js
this._unneededVisualKeysSince = new Map();
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/FrameIntake.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/FrameIntake.js src/lib/FrameIntake.test.js
git commit -m "feat(history): drop visual history slabs no panel needs or that have aged out"
```

---

### Task 4: Wire the retained set into the app

**Files:**

- Modify: `src/App.jsx`

There is no unit test for this task: `App.jsx` is wiring, and every piece it composes is covered by Tasks 1-3. Verification is the full gate plus the manual check below.

- [ ] **Step 1: Add the imports**

Extend the existing import from `./analysis/analysisRequests.js` with `deriveRetainedAnalysisKeys`, and the existing import from `./dock/dockAnalysisRequest.js` with `mergeDockRetainedKeys`.

- [ ] **Step 2: Derive the set and hand it to the intake**

Immediately after the `analysisRequests` memo (`App.jsx:706`), add:

```js
const dockPanelInstances = useMemo(
  () =>
    dockLayout.panels.map((panel) => ({
      panelId: panel.id,
      moduleId: panel.moduleId,
      controls: dockLayout.controlsByPanelId[panel.id],
    })),
  [dockLayout.panels, dockLayout.controlsByPanelId]
);
// Which histories survive is a different question from what Rust computes, so this is derived
// from the open panels rather than from `analysisRequests` -- and deliberately without `docked`,
// because AppShell renders the strip or the panels and whichever is hidden comes back intact.
const retainedAnalysisKeys = useMemo(
  () => mergeDockRetainedKeys(deriveRetainedAnalysisKeys(workspaceState), dockPanelInstances),
  [workspaceState, dockPanelInstances]
);
useEffect(() => {
  intakeRef.current?.setRetainedVisualKeys(retainedAnalysisKeys, historyRetentionSec * 1000);
}, [retainedAnalysisKeys, historyRetentionSec]);
```

If `derivedAnalysisRequests` can be switched to reuse `dockPanelInstances` for its own `dockLayout.panels.map(...)` without changing behaviour, do so and drop the duplicate; otherwise leave it alone rather than restructuring it.

- [ ] **Step 3: Run the full gate**

Run: `npm run check`
Expected: exit 0.

- [ ] **Step 4: Verify in the real app**

Run: `npm run desktop`

1. Start capture with a Spectrum panel and a Stereo Map panel open. Let it run a minute.
2. Drag Spectrum speed to a new value and release.
3. Wait five seconds, then scrub back before the change: the panel shows the empty state, exactly as it did before this change.
4. Stop capture, close the Stereo Map panel, wait ten seconds, reopen it, and scrub: its history is still there, because eviction does not run while stopped.

- [ ] **Step 5: Commit**

```bash
git add src/App.jsx
git commit -m "feat(app): hand the retained analysis keys to the frame intake"
```

---

### Task 5: Make the dock merge record what it drops

**Files:**

- Modify: `src/dock/dockAnalysisRequest.js`
- Test: `src/dock/dockAnalysisRequest.test.js`

This is an internal invariant, not a user-visible fix: squeezed workspace panels are not rendered while docked, and no dock module reads `analysisStatus`. It is worth doing so the request set stops lying about what happened.

- [ ] **Step 1: Write the failing tests**

Add to `src/dock/dockAnalysisRequest.test.js`:

```js
describe("dock merge over-cap bookkeeping", () => {
  it("records the panel requests the dock squeezed out", () => {
    const full = Array.from({ length: MAX_SPECTRUM_REQUESTS }, (_, i) => ({
      key: `panel-key-${i}`,
      panelIds: [`panel-${i}`],
    }));
    const derived = { ...EMPTY_DERIVED, spectrumRequests: full };
    const merged = mergeDockSpectrumRequest(derived, true);

    const squeezedKey = `panel-key-${MAX_SPECTRUM_REQUESTS - 1}`;
    expect(merged.overCapSpectrumRequests.map((r) => r.key)).toContain(squeezedKey);
    expect(merged.statusByPanelId[`panel-${MAX_SPECTRUM_REQUESTS - 1}`]).toBe("overCap");
    // The survivors are untouched.
    expect(merged.statusByPanelId["panel-0"]).toBeUndefined();
  });

  it("records a dock request that did not fit either", () => {
    // Five dock Spectrum modules with five distinct speeds are five distinct keys; one cannot fit.
    const dockPanels = Array.from({ length: MAX_SPECTRUM_REQUESTS + 1 }, (_, i) => ({
      panelId: `spectrum-${i}`,
      moduleId: "spectrum",
      controls: { spectrumSpeedPercent: 10 * (i + 1) },
    }));
    const merged = mergeDockSpectrumRequest(EMPTY_DERIVED, dockPanels);

    expect(merged.spectrumRequests).toHaveLength(MAX_SPECTRUM_REQUESTS);
    expect(merged.overCapSpectrumRequests).toHaveLength(1);
    const droppedPanelId = merged.overCapSpectrumRequests[0].panelIds[0];
    expect(merged.statusByPanelId[droppedPanelId]).toBe("overCap");
  });

  it("leaves the status map alone when nothing is dropped", () => {
    const merged = mergeDockSpectrumRequest(EMPTY_DERIVED, true);
    expect(merged.overCapSpectrumRequests).toHaveLength(0);
    expect(merged.statusByPanelId).toBe(EMPTY_DERIVED.statusByPanelId);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/dock/dockAnalysisRequest.test.js`
Expected: FAIL — `overCapSpectrumRequests` is empty and the status is still `undefined`/`"active"`.

- [ ] **Step 3: Implement**

Add the shared helper to `src/dock/dockAnalysisRequest.js`, above `mergeDockSpectrumRequest`:

```js
/**
 * Every request that does not reach the merged set is recorded, so the request set stops claiming
 * a panel is active while nothing computes it. Both halves matter: panel requests the dock
 * squeezed out, and dock requests the final cap could not fit.
 */
function recordDropped(derived, before, merged, overCapField) {
  const mergedKeys = new Set(merged.map((request) => request.key));
  const dropped = before.filter((request) => !mergedKeys.has(request.key));
  if (dropped.length === 0) return { [overCapField]: derived[overCapField] };
  const statusByPanelId = { ...derived.statusByPanelId };
  for (const request of dropped) {
    for (const panelId of request.panelIds) statusByPanelId[panelId] = "overCap";
  }
  return { [overCapField]: [...derived[overCapField], ...dropped], statusByPanelId };
}
```

Replace the tail of `mergeDockSpectrumRequest` (its current `return { ...derived, spectrumRequests: ... }`) with:

```js
const mergedRequests = [...kept, ...requests].slice(0, MAX_SPECTRUM_REQUESTS);
return {
  ...derived,
  spectrumRequests: mergedRequests,
  ...recordDropped(
    derived,
    [...derived.spectrumRequests, ...requests],
    mergedRequests,
    "overCapSpectrumRequests"
  ),
};
```

Replace the tail of `mergeDockVectorscopeRequest` with:

```js
const mergedRequests = [...kept, ...requests].slice(0, MAX_VECTORSCOPE_REQUESTS);
return {
  ...derived,
  vectorscopeRequests: mergedRequests,
  ...recordDropped(
    derived,
    [...derived.vectorscopeRequests, ...requests],
    mergedRequests,
    "overCapVectorscopeRequests"
  ),
};
```

Replace the tail of `mergeDockStereoMapRequest` with:

```js
const mergedRequests = [...kept, ...requests].slice(0, MAX_STEREO_MAP_REQUESTS);
return {
  ...derived,
  stereoMapRequests: mergedRequests,
  ...recordDropped(
    derived,
    [...derived.stereoMapRequests, ...requests],
    mergedRequests,
    "overCapStereoMapRequests"
  ),
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/dock/dockAnalysisRequest.test.js`
Expected: PASS.

- [ ] **Step 5: Run the full gate**

Run: `npm run check`
Expected: exit 0. `src/runtime/appRuntimeDerivations.test.js` and the dock module tests both read these shapes, so a regression shows up there.

- [ ] **Step 6: Commit**

```bash
git add src/dock/dockAnalysisRequest.js src/dock/dockAnalysisRequest.test.js
git commit -m "fix(dock): record the requests the dock merge drops instead of silently losing them"
```

---

### Task 6: Record the trap

**Files:**

- Modify: `AGENTS.md`

- [ ] **Step 1: Add a Known pitfalls entry**

Append to the Known pitfalls list in `AGENTS.md`:

```markdown
- **A control value that is part of an analysis request key costs memory to change.** Visual
  history is stored one slab per key (`FrameIntake`), so every distinct key mints a slab, and at a
  four-hour retention one Spectrum slab is 1.38 GB and one Stereo Map slab is 4.37 GB. This is why
  the Spectrum speed, Spectrum tilt and Stereo Map speed sliders carry `commitOnRelease` while
  every other slider commits per pointer move: a single two-second drag committing per step
  stranded 754 MB. Slabs are now dropped once no open panel needs the key, but the set of keys
  worth keeping comes from `deriveRetainedAnalysisKeys`, **not** from the request list handed to
  Rust — that list is capped at four, reshuffled by the dock, and gated on a channel count read
  from the live frame shape, so using it would delete history on a device blip or a dock toggle.
```

- [ ] **Step 2: Verify formatting**

Run: `npm run check`
Expected: exit 0 (Prettier covers Markdown here).

- [ ] **Step 3: Commit**

```bash
git add AGENTS.md
git commit -m "docs(agents): record what an analysis request key costs"
```

---

## Known residuals after this plan

- The four-hour retention footprint is unchanged: ~8.8 GB at a full window with all eight panels
  open. Eviction bounds the _stranded_ memory, not the designed one.
- Spectrum tilt is still in the request key, so it still keeps its interim `commitOnRelease`.
- A dock module that loses the cap still renders blank with no explanation. The invariant from
  Task 5 makes an indicator possible; building one is a feature, not part of this work.
