# Vectorscope Peak Hold Reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user reset a Polar Level Peak hold during live capture by clicking the plot, per instance, in both the full panel and the Dock.

**Architecture:** Each instance (`VectorscopePanel`, `DockVectorscope`) owns a runtime reset nonce (`useState`) that its plot click increments. The nonce is passed to `VectorscopePolarPlot` as `peakHoldResetKey`; when it changes the plot clears only `peakHoldRef` (the live level envelope and timestamp are untouched), so the hold reseeds from the current envelope on the next draw. Discoverability reuses the existing `useHoverTip` affordance (cursor + "Click to reset Peak hold" tip), mirroring the Level meter's TP Max reset.

**Tech Stack:** React 19, Vitest + @testing-library/react (jsdom), Canvas 2D. Spec: `docs/superpowers/specs/2026-07-21-vectorscope-peak-hold-reset-design.md`.

---

### Task 1: `VectorscopePolarPlot` accepts `peakHoldResetKey`

**Files:**
- Modify: `src/components/panels/VectorscopePolarPlot.jsx`
- Test: `src/components/panels/VectorscopePolarPlot.test.jsx`

- [ ] **Step 1: Write the failing tests**

Append these two tests inside the top-level `describe("VectorscopePolarPlot", ...)` block in `src/components/panels/VectorscopePolarPlot.test.jsx`, just before its closing `});`:

```jsx
  it("resets the live Peak hold when peakHoldResetKey changes", () => {
    const ctx = contextStub();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);
    const heldTop = () =>
      Math.min(
        ...ctx.strokedPaths
          .at(-1)
          .filter((e) => e.command === "moveTo" || e.command === "lineTo")
          .map((e) => e.y)
      );

    const { rerender } = render(
      <VectorscopePolarPlot
        mode="polarLevel"
        rows={[{ pairs: new Float32Array([1, 1]), ageMs: 0, timestampMs: 100 }]}
        firstLabel="L"
        secondLabel="R"
        peakHoldEnabled
      />
    );
    // A loud transient sets a high hold; a later quiet frame does not lower it (peak hold holds).
    rerender(
      <VectorscopePolarPlot
        mode="polarLevel"
        rows={[{ pairs: new Float32Array([0.1, 0.1]), ageMs: 0, timestampMs: 2100 }]}
        firstLabel="L"
        secondLabel="R"
        peakHoldEnabled
      />
    );
    const beforeReset = heldTop();

    // Bumping the reset key drops the hold to the current (quiet) envelope.
    rerender(
      <VectorscopePolarPlot
        mode="polarLevel"
        rows={[{ pairs: new Float32Array([0.1, 0.1]), ageMs: 0, timestampMs: 4100 }]}
        firstLabel="L"
        secondLabel="R"
        peakHoldEnabled
        peakHoldResetKey={1}
      />
    );
    // Higher y = closer to the baseline = smaller radius: reset pulled the hold in to the quiet level.
    expect(heldTop()).toBeGreaterThan(beforeReset);
  });

  it("ignores peakHoldResetKey in snapshot mode", () => {
    const ctx = contextStub();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);
    const held = new Float64Array(64).fill(0.7);
    const { rerender } = render(
      <VectorscopePolarPlot
        mode="polarLevel"
        snapshotPairs={new Float32Array([0.25, 0.25])}
        snapshotPeakHold={held}
        firstLabel="L"
        secondLabel="R"
        peakHoldEnabled
      />
    );
    const before = ctx.strokedPaths.at(-1);
    rerender(
      <VectorscopePolarPlot
        mode="polarLevel"
        snapshotPairs={new Float32Array([0.25, 0.25])}
        snapshotPeakHold={held}
        firstLabel="L"
        secondLabel="R"
        peakHoldEnabled
        peakHoldResetKey={1}
      />
    );
    // Snapshot draws the supplied reconstructed hold regardless of the reset key.
    expect(ctx.strokedPaths.at(-1)).toEqual(before);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/panels/VectorscopePolarPlot.test.jsx`
Expected: FAIL — the first test finds the held outline unchanged after the reset key bump (`heldTop()` not greater than `beforeReset`), because `peakHoldResetKey` is ignored.

- [ ] **Step 3: Add the `peakHoldResetKey` prop and ref**

In `src/components/panels/VectorscopePolarPlot.jsx`, add the prop to the signature. Replace:

```jsx
  showLabels = true,
  peakHoldEnabled = false,
  resetEpoch = 0,
  identityKey = "",
}) {
```

with:

```jsx
  showLabels = true,
  peakHoldEnabled = false,
  peakHoldResetKey = 0,
  resetEpoch = 0,
  identityKey = "",
}) {
```

Add the tracking ref. Replace:

```jsx
  const redrawRef = useRef({ signature: null, snapshotPairs: null, snapshotPeakHold: null });
```

with:

```jsx
  const redrawRef = useRef({ signature: null, snapshotPairs: null, snapshotPeakHold: null });
  const peakHoldResetKeyRef = useRef(peakHoldResetKey);
```

- [ ] **Step 4: Clear `peakHoldRef` when the key changes, and add the key to the redraw signature**

Still in `src/components/panels/VectorscopePolarPlot.jsx`, inside the `useLayoutEffect`, replace:

```jsx
    if (stateIdentityRef.current !== stateIdentity) {
      stateIdentityRef.current = stateIdentity;
      envelopeRef.current = null;
      peakHoldRef.current = null;
      lastTimestampRef.current = null;
    }
```

with:

```jsx
    if (stateIdentityRef.current !== stateIdentity) {
      stateIdentityRef.current = stateIdentity;
      envelopeRef.current = null;
      peakHoldRef.current = null;
      lastTimestampRef.current = null;
    }

    // A per-instance reset nonce clears only the Peak hold — the live envelope and timestamp are
    // left alone so the fan does not jump. The live path's updatePolarPeakHold then reseeds the
    // hold from the current envelope. In snapshot the hold is drawn from snapshotPeakHold, so this
    // has no visible effect there.
    if (peakHoldResetKeyRef.current !== peakHoldResetKey) {
      peakHoldResetKeyRef.current = peakHoldResetKey;
      peakHoldRef.current = null;
    }
```

Then add the key to the redraw signature so the reset forces a redraw. Replace:

```jsx
    const signature = `${stateIdentity}|${peakHoldEnabled}|${snapshot}|${width}x${height}|${dpr}|${newestTimestamp}|${traceColor}|${gridColor}|${lineWidth}|${effectiveRows.length}`;
```

with:

```jsx
    const signature = `${stateIdentity}|${peakHoldEnabled}|${snapshot}|${width}x${height}|${dpr}|${newestTimestamp}|${traceColor}|${gridColor}|${lineWidth}|${effectiveRows.length}|${peakHoldResetKey}`;
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/components/panels/VectorscopePolarPlot.test.jsx`
Expected: PASS (all tests in the file).

- [ ] **Step 6: Commit**

```bash
git add src/components/panels/VectorscopePolarPlot.jsx src/components/panels/VectorscopePolarPlot.test.jsx
git commit -m "feat(vectorscope): add peakHoldResetKey to reset the live Polar Level hold" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Full-panel click-to-reset affordance

**Files:**
- Modify: `src/components/panels/VectorscopePanel.jsx`
- Test: `src/components/panels/VectorscopePanel.test.jsx`

- [ ] **Step 1: Write the failing tests**

Append these tests inside the `describe("VectorscopePanel", ...)` block in `src/components/panels/VectorscopePanel.test.jsx`, before its closing `});`:

```jsx
  it("offers click-to-reset for a live Polar Level panel with Peak hold on", () => {
    mockCanvas();
    const { container } = renderPanel({
      selectedOffset: -1,
      panelControls: {
        vectorscopeMode: "polarLevel",
        vectorscopePolarLevelPeakHold: true,
        vectorscopePair: { x: 0, y: 1 },
      },
      displayAudio: { vectorscopeResultsByKey: {}, peakDb: [-3, -3] },
    });
    const plot = container.querySelector("[data-vectorscope-plot]");
    expect(plot.getAttribute("data-peak-hold-reset")).toBe("true");
    expect(plot.className).toContain("cursor-pointer");
    fireEvent.mouseEnter(plot);
    expect(screen.getByText("Click to reset Peak hold")).toBeTruthy();
    // Clicking is wired and does not throw.
    fireEvent.click(plot);
  });

  it("hides the reset affordance for Lissajous, Peak hold off, and snapshot", () => {
    mockCanvas();
    for (const controls of [
      { vectorscopeMode: "lissajous", vectorscopePolarLevelPeakHold: true },
      { vectorscopeMode: "polarLevel", vectorscopePolarLevelPeakHold: false },
    ]) {
      const { container, unmount } = renderPanel({
        selectedOffset: -1,
        panelControls: { ...controls, vectorscopePair: { x: 0, y: 1 } },
        displayAudio: { vectorscopeResultsByKey: {}, peakDb: [-3, -3] },
      });
      expect(
        container.querySelector("[data-vectorscope-plot]").hasAttribute("data-peak-hold-reset")
      ).toBe(false);
      unmount();
    }
    // Snapshot: even Polar Level + Peak hold on exposes no reset (the hold is read-only history).
    const { container } = renderPanel({
      selectedOffset: 0,
      panelControls: {
        vectorscopeMode: "polarLevel",
        vectorscopePolarLevelPeakHold: true,
        vectorscopePair: { x: 0, y: 1 },
      },
      resolveVectorscopeSnapshotForKey: () => ({
        missing: false,
        path: "",
        pairs: new Float32Array([0.25, 0.25]),
        correlation: 0.5,
        peakHold: new Float64Array(64).fill(0.5),
      }),
      displayAudio: { peakDb: [-3, -3] },
    });
    expect(
      container.querySelector("[data-vectorscope-plot]").hasAttribute("data-peak-hold-reset")
    ).toBe(false);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/panels/VectorscopePanel.test.jsx`
Expected: FAIL — `data-peak-hold-reset` is missing (`getAttribute` returns null, not `"true"`).

- [ ] **Step 3: Import `useHoverTip`**

In `src/components/panels/VectorscopePanel.jsx`, after the existing `import { cn } from "@/lib/utils";` line, add:

```jsx
import { useHoverTip } from "@/components/HoverTip";
```

- [ ] **Step 4: Add reset state, the affordance flag, and the hover tip**

In `src/components/panels/VectorscopePanel.jsx`, find this line:

```jsx
  const snapResolved = isSnapshot
```

Immediately **before** it, insert:

```jsx
  const [peakHoldResetKey, setPeakHoldResetKey] = useState(0);
  const canResetPeakHold =
    !isSnapshot &&
    vectorscopeMode === "polarLevel" &&
    normalizedPanelControls.vectorscopePolarLevelPeakHold;
  const {
    anchorRef: peakHoldResetRef,
    showTip: showPeakHoldResetTip,
    hideTip: hidePeakHoldResetTip,
    tipNode: peakHoldResetTip,
  } = useHoverTip({ tip: "Click to reset Peak hold", side: "top" });
```

- [ ] **Step 5: Wire the affordance onto the plot wrapper**

Replace this element opening:

```jsx
        <div
          data-vectorscope-plot
          className="relative w-full"
          style={{ aspectRatio: "1/1", maxHeight: "100%", maxWidth: "100%" }}
          onPointerDown={onTracePointerDown}
          onPointerMove={onTracePointerMove}
          onPointerUp={onTracePointerUp}
          onPointerCancel={onTracePointerUp}
          onPointerLeave={onTracePointerUp}
        >
```

with:

```jsx
        <div
          data-vectorscope-plot
          data-peak-hold-reset={canResetPeakHold ? "true" : undefined}
          ref={canResetPeakHold ? peakHoldResetRef : undefined}
          className={cn("relative w-full", canResetPeakHold && "cursor-pointer")}
          style={{ aspectRatio: "1/1", maxHeight: "100%", maxWidth: "100%" }}
          onPointerDown={onTracePointerDown}
          onPointerMove={onTracePointerMove}
          onPointerUp={onTracePointerUp}
          onPointerCancel={onTracePointerUp}
          onPointerLeave={onTracePointerUp}
          onClick={canResetPeakHold ? () => setPeakHoldResetKey((k) => k + 1) : undefined}
          onMouseEnter={canResetPeakHold ? showPeakHoldResetTip : undefined}
          onMouseLeave={canResetPeakHold ? hidePeakHoldResetTip : undefined}
        >
          {peakHoldResetTip}
```

- [ ] **Step 6: Pass `peakHoldResetKey` to the plot**

Find the `<VectorscopePolarPlot` element and add the prop after `peakHoldEnabled={...}`. Replace:

```jsx
                peakHoldEnabled={normalizedPanelControls.vectorscopePolarLevelPeakHold}
                resetEpoch={vectorscopeResetEpoch}
                identityKey={`${vectorscopeKey}:${px}:${py}`}
```

with:

```jsx
                peakHoldEnabled={normalizedPanelControls.vectorscopePolarLevelPeakHold}
                peakHoldResetKey={peakHoldResetKey}
                resetEpoch={vectorscopeResetEpoch}
                identityKey={`${vectorscopeKey}:${px}:${py}`}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run src/components/panels/VectorscopePanel.test.jsx`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/components/panels/VectorscopePanel.jsx src/components/panels/VectorscopePanel.test.jsx
git commit -m "feat(vectorscope): click the panel plot to reset Polar Level Peak hold" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Dock click-to-reset affordance

**Files:**
- Modify: `src/dock/modules/DockVectorscope.jsx`
- Test: `src/dock/modules/DockVectorscope.test.jsx`

- [ ] **Step 1: Write the failing tests**

Append these tests inside the `describe("DockVectorscope", ...)` block in `src/dock/modules/DockVectorscope.test.jsx`, before its closing `});`. They reuse the file's existing `renderWith` helper (5th arg is `historyData`, 4th is the module controls):

```jsx
  it("offers click-to-reset for a Polar Level Dock module with Peak hold on", () => {
    const polarControls = { pair: { x: 0, y: 1 }, mode: "polarLevel", polarLevelPeakHold: true };
    renderWith(null, [-12, -10], "standard", polarControls);
    const plot = screen.getByTestId("dock-vectorscope-plot");
    expect(plot.getAttribute("data-peak-hold-reset")).toBe("true");
    expect(plot.className).toContain("cursor-pointer");
    fireEvent.mouseEnter(plot);
    expect(screen.getByText("Click to reset Peak hold")).toBeTruthy();
    fireEvent.click(plot);
  });

  it("hides the Dock reset affordance for Lissajous and Peak hold off", () => {
    for (const polarControls of [
      { pair: { x: 0, y: 1 }, mode: "lissajous", polarLevelPeakHold: true },
      { pair: { x: 0, y: 1 }, mode: "polarLevel", polarLevelPeakHold: false },
    ]) {
      const { unmount } = renderWith(null, [-12, -10], "standard", polarControls);
      expect(
        screen.getByTestId("dock-vectorscope-plot").hasAttribute("data-peak-hold-reset")
      ).toBe(false);
      unmount();
    }
  });
```

Add `fireEvent` to the file's imports. Replace:

```jsx
import { render, screen } from "@testing-library/react";
```

with:

```jsx
import { fireEvent, render, screen } from "@testing-library/react";
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/dock/modules/DockVectorscope.test.jsx`
Expected: FAIL — `data-peak-hold-reset` is missing on the Dock plot.

- [ ] **Step 3: Import `useHoverTip` and add reset state + affordance flag**

In `src/dock/modules/DockVectorscope.jsx`, after the existing import from `"./dockModuleControls.js"`, add:

```jsx
import { useHoverTip } from "@/components/HoverTip";
```

Then, immediately after this existing line:

```jsx
  const isLissajous = mode === "lissajous";
```

insert:

```jsx
  const [peakHoldResetKey, setPeakHoldResetKey] = useState(0);
  const canResetPeakHold = mode === "polarLevel" && normalizedControls.polarLevelPeakHold;
  const {
    anchorRef: peakHoldResetRef,
    showTip: showPeakHoldResetTip,
    hideTip: hidePeakHoldResetTip,
    tipNode: peakHoldResetTip,
  } = useHoverTip({ tip: "Click to reset Peak hold", side: "top" });
```

- [ ] **Step 4: Wire the affordance onto the Dock plot element**

Replace this opening element:

```jsx
        <div
          data-testid="dock-vectorscope-plot"
          className="relative shrink-0 overflow-hidden"
          style={{ width: plotSize, height: plotSize }}
        >
```

with:

```jsx
        <div
          data-testid="dock-vectorscope-plot"
          data-peak-hold-reset={canResetPeakHold ? "true" : undefined}
          ref={canResetPeakHold ? peakHoldResetRef : undefined}
          className={`relative shrink-0 overflow-hidden ${canResetPeakHold ? "cursor-pointer" : ""}`}
          style={{ width: plotSize, height: plotSize }}
          onClick={canResetPeakHold ? () => setPeakHoldResetKey((k) => k + 1) : undefined}
          onMouseEnter={canResetPeakHold ? showPeakHoldResetTip : undefined}
          onMouseLeave={canResetPeakHold ? hidePeakHoldResetTip : undefined}
        >
          {peakHoldResetTip}
```

- [ ] **Step 5: Pass `peakHoldResetKey` to the plot**

Find the `<VectorscopePolarPlot` element in the Dock and add the prop after `peakHoldEnabled={...}`. Replace:

```jsx
              peakHoldEnabled={normalizedControls.polarLevelPeakHold}
              resetEpoch={historyData?.vectorscopeResetEpoch ?? 0}
              identityKey={key}
```

with:

```jsx
              peakHoldEnabled={normalizedControls.polarLevelPeakHold}
              peakHoldResetKey={peakHoldResetKey}
              resetEpoch={historyData?.vectorscopeResetEpoch ?? 0}
              identityKey={key}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/dock/modules/DockVectorscope.test.jsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/dock/modules/DockVectorscope.jsx src/dock/modules/DockVectorscope.test.jsx
git commit -m "feat(vectorscope): click the Dock plot to reset Polar Level Peak hold" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 2: Full frontend suite**

Run: `npx vitest run`
Expected: all files pass (1735 tests + the new ones).

- [ ] **Step 3: Remind about real-app verification**

The click-to-reset gesture cannot be exercised by jsdom (no live capture, no canvas). Tell the user to verify in the real app: `npm run desktop`, feed a signal, switch a Vectorscope panel to Polar Level with Peak hold on, let the hold accumulate, then click the plot and confirm the outline drops to the current level and resumes — and that the fill fan does not jump. Repeat for the Dock Vectorscope.
