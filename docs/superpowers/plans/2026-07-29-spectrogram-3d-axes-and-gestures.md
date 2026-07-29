# Spectrogram 3D Axis Rails and Gestures Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the Spectrogram panel's left axis rail from changing meaning when 3D is switched on, and give the two 3D-only capabilities (height scaling, viewpoint reset) gestures that 2D leaves unused.

**Architecture:** All changes are in one component, `src/components/panels/SpectrogramPanel.jsx`, plus its test file and the help catalogue. The Y rail's `is3d` branch is deleted along with the five height-gain drag callbacks it fed. Two gestures are added to the existing chart handlers: `Shift+wheel` in `onSpectrogramChartWheel`, and a right double-click detected in `onSpectrogramChartPointerUp`. No math module, no renderer hook, and no persisted key changes — both new gestures write `spectrogram3dHeightGain`, `spectrogram3dAzimuthDeg` and `spectrogram3dElevationDeg`, which already exist and are already clamped by `normalizePanelControls`.

**Tech Stack:** React 19, Vitest + @testing-library/react (jsdom), Tailwind. Run tests with `npx vitest run <path>`.

**Spec:** `docs/superpowers/specs/2026-07-29-spectrogram-3d-axes-and-gestures-design.md`

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/components/panels/SpectrogramPanel.jsx` | Panel layout, axis rails, chart gestures | Modify |
| `src/components/panels/SpectrogramPanel.test.jsx` | Panel-layer behaviour | Modify |
| `src/components/panels/chartHelp.js` | Per-panel help catalogue | Modify |
| `docs/superpowers/specs/2026-07-28-spectrogram-3d-view-design.md` | Original 3D spec | Modify (gesture table + controls note) |
| `docs/superpowers/specs/2026-07-29-spectrogram-3d-axes-and-gestures-design.md` | This design | Modify (status line only) |

Nothing is created. `useSpectrogram3dCanvas.js`, `spectrogram3dProjection.js`, `spectrogram3dGrid.js`, `useSpectrogramCanvas.js` and `panelControls.js` are not touched.

### Notes for the implementer

- **Line numbers are as of the start of Task 1 and drift as you go.** Task 1 deletes about thirty
  lines, so every reference in Tasks 2 and 3 will have moved up by then. Locate code by the names
  and quoted snippets, not by the line number.
- **`SpectrogramPanel.test.jsx` mocks both canvas hooks.** `useSpectrogramCanvas` and `useSpectrogram3dCanvas` are `vi.fn()` at the top of the file, so nothing paints. Every assertion in this plan is about DOM and callbacks, never pixels.
- **jsdom has no `PointerEvent`.** The suite already installs a `MouseEvent` subclass for it (near the top of the test file). `fireEvent.pointerDown/pointerUp` therefore carry `clientX` / `clientY` / `button`. Do not add another shim.
- **`renderPanel(value, props)` and `spectrogramPanelTree(value, props)`** are existing helpers in the test file. `value.panelControls` and `value.onPanelControlsChange` are what you pass to drive this work. Use `spectrogramPanelTree` when you need `rerender`.
- **`setPointerCapture` does not exist in jsdom** on the elements this suite renders. The right-drag path calls it in `onSpectrogramChartPointerDown`. Existing tests avoid the `button: 2` path entirely, so Task 3 must stub it — the step below shows how.
- **Panel controls are normalised on the way in.** `normalizedPanelControls` in the component is `normalizePanelControls(panelControls)`, so a test passing `{ spectrogram3d: true }` still gets every default filled in (azimuth 135, elevation 60, height gain 1).

---

### Task 1: Give the Y rail back to frequency in 3D

The rail currently renders a `dB` word and drags Height Scale whenever `is3d`. Delete that branch. An existing test pins the old behaviour and must be inverted first — that inversion is the failing test.

**Files:**
- Modify: `src/components/panels/SpectrogramPanel.jsx:70`, `:204-233`, `:535-553`
- Test: `src/components/panels/SpectrogramPanel.test.jsx` (last test in the file)

- [ ] **Step 1: Invert the test that pins the old behaviour**

Find this test at the end of `src/components/panels/SpectrogramPanel.test.jsx`:

```jsx
  it("shows a dB label on the Y rail in 3D instead of frequency ticks", () => {
    const { rerender } = renderPanel();

    expect(screen.getByText("20k")).toBeTruthy();
    expect(screen.queryByText("dB")).toBeNull();

    rerender(spectrogramPanelTree({ panelControls: { spectrogram3d: true } }));

    expect(screen.getByText("dB")).toBeTruthy();
    expect(screen.queryByText("20k")).toBeNull();
  });
```

Replace it wholesale with:

```jsx
  it("keeps the Y rail on frequency in 3D, ticks and all", () => {
    const { rerender } = renderPanel();

    expect(screen.getByText("20k")).toBeTruthy();

    rerender(spectrogramPanelTree({ panelControls: { spectrogram3d: true } }));

    // The rail does not change meaning between modes: same ticks, no "dB" placeholder.
    expect(screen.getByText("20k")).toBeTruthy();
    expect(screen.queryByText("dB")).toBeNull();
  });

  it("drags the Y rail to the frequency range in 3D, not to height scale", () => {
    // The regression this pins is the rebinding itself: the rail used to write
    // spectrogram3dHeightGain here, which silently made the frequency axis unreachable in 3D.
    const onPanelControlsChange = vi.fn();
    renderPanel({
      onPanelControlsChange,
      panelControls: { spectrogram3d: true },
    });

    // Do not assert on the rail's cursor. useAxisInteraction returns "ns-resize" for every y axis,
    // so the old code's `is3d ? "ns-resize" : cursorStyle` had two branches with the same value --
    // a cursor check cannot tell the rebinding from its absence. The three assertions below can:
    // a rail still bound to height gain fails all of them.
    const rail = screen.getByText("20k").closest("div[class*='shrink-0']");
    // useAxisInteraction's onWheel reads the rail's own rect to place the zoom anchor. jsdom
    // reports zeros, which would push the anchor outside 20-20000 and let computeLogZoom clamp
    // straight back to the full range -- a passing-looking no-op. Give it a real rect.
    rail.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      right: 32,
      bottom: 300,
      width: 32,
      height: 300,
    });
    fireEvent.wheel(rail, { deltaY: -100, clientY: 150 });

    expect(onPanelControlsChange).toHaveBeenCalled();
    const next = onPanelControlsChange.mock.calls.at(-1)[0];
    expect(next.spectrogram3dHeightGain).toBe(1);
    expect(next.spectrogramYMinFreq).toBeGreaterThan(20);
    expect(next.spectrogramYMaxFreq).toBeLessThan(20000);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/panels/SpectrogramPanel.test.jsx -t "Y rail"`

Expected: FAIL. The first reports that `20k` is not in the document after the rerender; the second finds the `ns-resize` rail and gets no frequency change.

- [ ] **Step 3: Delete the `is3d` branch on the Y rail**

In `src/components/panels/SpectrogramPanel.jsx`, replace the comment and the rail's opening tags (currently at `:535`) — from `{/* Y-axis: ... */}` down to and including `{is3d ? (` and its `dB` span and `) : (` and the matching `)}`.

Before:

```jsx
          {/* Y-axis: frequency labels in 2D, height-gain drag rail in 3D */}
          <div
            ref={spectrogramYAxis.axisRef}
            {...(is3d
              ? {
                  onPointerDown: onHeightGainPointerDown,
                  onPointerMove: onHeightGainPointerMove,
                  onPointerUp: onHeightGainPointerUp,
                  onPointerCancel: onHeightGainPointerUp,
                }
              : spectrogramYAxis.axisHandlers)}
            style={{ cursor: is3d ? "ns-resize" : spectrogramYAxis.cursorStyle }}
```

After:

```jsx
          {/* Y-axis: frequency, in both view modes. In 3D the ticks state the range on screen and
              not a position -- no screen-vertical line corresponds to a frequency once the floor is
              rotated. That is accepted, not an oversight; see the axes-and-gestures design. */}
          <div
            ref={spectrogramYAxis.axisRef}
            {...spectrogramYAxis.axisHandlers}
            style={{ cursor: spectrogramYAxis.cursorStyle }}
```

Then collapse the ternary in the rail body. Before:

```jsx
            {is3d ? (
              <span className={axisLabelClass("y", "middle")} style={{ top: "50%" }}>
                dB
              </span>
            ) : (
              <div className="absolute inset-x-0 top-[var(--ui-chart-inset-top)] bottom-[var(--ui-chart-inset-bottom)]">
```

After:

```jsx
            <div className="absolute inset-x-0 top-[var(--ui-chart-inset-top)] bottom-[var(--ui-chart-inset-bottom)]">
```

and at the end of that block remove the now-unbalanced `)}` so the `</div>` closes directly. Let Prettier reindent — run `npx prettier --write src/components/panels/SpectrogramPanel.jsx` after the edit.

- [ ] **Step 4: Delete the orphaned height-gain drag callbacks**

Delete `heightGainDragRef` (`:70`):

```jsx
  const heightGainDragRef = useRef(null);
```

and the whole block at `:203-233` — this is the exact text to remove, in full:

```jsx
  // In 3D the vertical screen direction is always the dB axis (frequency and time swap visual
  // direction as azimuth turns), so the Y rail drags height gain instead of the frequency range.
  const onHeightGainDrag = useCallback(
    (deltaPx, axisPx) => {
      const next = normalizedPanelControls.spectrogram3dHeightGain * (1 - deltaPx / axisPx);
      onPanelControlsChange?.(
        normalizePanelControls({
          ...normalizedPanelControls,
          spectrogram3dHeightGain: next,
        })
      );
    },
    [normalizedPanelControls, onPanelControlsChange]
  );
  const onHeightGainPointerDown = useCallback((e) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = e.currentTarget.getBoundingClientRect();
    heightGainDragRef.current = { lastY: e.clientY, axisPx: Math.max(1, rect.height) };
  }, []);
  const onHeightGainPointerMove = useCallback(
    (e) => {
      const drag = heightGainDragRef.current;
      if (!drag) return;
      const deltaPx = e.clientY - drag.lastY;
      drag.lastY = e.clientY;
      onHeightGainDrag(deltaPx, drag.axisPx);
    },
    [onHeightGainDrag]
  );
  const onHeightGainPointerUp = useCallback(() => {
    heightGainDragRef.current = null;
  }, []);
```

These are orphaned by Step 3 and by nothing else. `npm run lint` will fail on them if any are missed.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/components/panels/SpectrogramPanel.test.jsx`

Expected: PASS, whole file.

- [ ] **Step 6: Run lint to confirm no orphans survived**

Run: `npm run lint`

Expected: exit 0, no `no-unused-vars` for anything named `heightGain*`.

- [ ] **Step 7: Commit**

```bash
git add src/components/panels/SpectrogramPanel.jsx src/components/panels/SpectrogramPanel.test.jsx
git commit -m "fix(spectrogram): keep the Y rail on frequency in 3D" -m "Switching to 3D used to take the frequency axis away and hand the rail to Height Scale, labelled dB. That was the one place where an existing control changed meaning between modes, and it left the frequency range reachable only through the settings popover." -m "The ticks do not correspond to screen positions in 3D. They state the range, which is what a rail beside a rotated surface can honestly claim." -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Shift+wheel scales height in 3D

**Files:**
- Modify: `src/components/panels/SpectrogramPanel.jsx:154` (`onSpectrogramChartWheel`)
- Test: `src/components/panels/SpectrogramPanel.test.jsx`

- [ ] **Step 1: Write the failing tests**

Add to `src/components/panels/SpectrogramPanel.test.jsx`, inside the top-level `describe("SpectrogramPanel", ...)`:

```jsx
  it("scales height on Shift+wheel in 3D, from deltaY", () => {
    const onPanelControlsChange = vi.fn();
    const { container } = renderPanel({
      historyChartInteractive: true,
      onPanelControlsChange,
      panelControls: { spectrogram3d: true },
    });

    fireEvent.wheel(container.querySelector("canvas"), { shiftKey: true, deltaY: -100 });

    expect(onPanelControlsChange).toHaveBeenCalledTimes(1);
    const next = onPanelControlsChange.mock.calls.at(-1)[0];
    expect(next.spectrogram3dHeightGain).toBeCloseTo(0.85, 5);
    expect(next.spectrogramYMinFreq).toBe(20);
    expect(next.spectrogramYMaxFreq).toBe(20000);
  });

  it("scales height on Shift+wheel in 3D, from deltaX", () => {
    // Chrome on Windows swaps deltaY into deltaX while Shift is held -- the horizontal-scroll
    // convention. A handler that only reads deltaY is silently dead for the real gesture, and
    // every jsdom test that synthesises deltaY still passes. This is that test.
    const onPanelControlsChange = vi.fn();
    const { container } = renderPanel({
      historyChartInteractive: true,
      onPanelControlsChange,
      panelControls: { spectrogram3d: true },
    });

    fireEvent.wheel(container.querySelector("canvas"), { shiftKey: true, deltaX: 100, deltaY: 0 });

    expect(onPanelControlsChange).toHaveBeenCalledTimes(1);
    expect(onPanelControlsChange.mock.calls.at(-1)[0].spectrogram3dHeightGain).toBeCloseTo(1.18, 5);
  });

  it("clamps Shift+wheel height scaling at the top of its range", () => {
    const onPanelControlsChange = vi.fn();
    const { container } = renderPanel({
      historyChartInteractive: true,
      onPanelControlsChange,
      panelControls: { spectrogram3d: true, spectrogram3dHeightGain: 3 },
    });

    fireEvent.wheel(container.querySelector("canvas"), { shiftKey: true, deltaY: 100 });

    expect(onPanelControlsChange.mock.calls.at(-1)[0].spectrogram3dHeightGain).toBe(3);
  });

  it("ignores Shift+wheel in 2D", () => {
    const onPanelControlsChange = vi.fn();
    const onHistoryWheel = vi.fn();
    const { container } = renderPanel({
      historyChartInteractive: true,
      onPanelControlsChange,
      onHistoryWheel,
      panelControls: {},
    });

    fireEvent.wheel(container.querySelector("canvas"), { shiftKey: true, deltaY: -100 });

    expect(onPanelControlsChange).not.toHaveBeenCalled();
    // Falls through to the ordinary time-zoom path, exactly as an unmodified wheel would.
    expect(onHistoryWheel).toHaveBeenCalledTimes(1);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/panels/SpectrogramPanel.test.jsx -t "Shift+wheel"`

Expected: FAIL on the first three — `onPanelControlsChange` was never called, because Shift currently falls through to `onHistoryWheel`. The 2D one passes already; that is fine, it is a guard against the next step over-reaching.

- [ ] **Step 3: Handle Shift+wheel in the chart wheel handler**

In `src/components/panels/SpectrogramPanel.jsx`, `onSpectrogramChartWheel` currently opens:

```jsx
  const onSpectrogramChartWheel = useCallback(
    (e) => {
      if (!e.ctrlKey) {
        onHistoryWheel?.(e);
        return;
      }
```

Replace that opening with:

```jsx
  const onSpectrogramChartWheel = useCallback(
    (e) => {
      if (is3d && e.shiftKey && !e.ctrlKey) {
        e.preventDefault();
        // Chrome on Windows delivers a shifted wheel as deltaX, not deltaY -- the horizontal-scroll
        // convention. Reading only deltaY leaves this gesture dead in the shipped app while every
        // synthesised test still passes, so take whichever axis actually carries the notch.
        const delta = e.deltaY || e.deltaX;
        if (!delta) return;
        const factor = delta > 0 ? CHART_ZOOM_OUT_FACTOR : CHART_ZOOM_IN_FACTOR;
        onPanelControlsChange?.(
          normalizePanelControls({
            ...normalizedPanelControls,
            // The 0.3-3 clamp lives in normalizeSpectrogram3dHeightGain; do not repeat it here.
            spectrogram3dHeightGain: normalizedPanelControls.spectrogram3dHeightGain * factor,
          })
        );
        return;
      }
      if (!e.ctrlKey) {
        onHistoryWheel?.(e);
        return;
      }
```

Add `is3d` to the dependency array of this `useCallback` — it currently reads
`[cursorToFloor, normalizedPanelControls, onHistoryWheel, onPanelControlsChange, pulseChartYAxis]`,
so it becomes:

```jsx
    [
      cursorToFloor,
      is3d,
      normalizedPanelControls,
      onHistoryWheel,
      onPanelControlsChange,
      pulseChartYAxis,
    ]
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/panels/SpectrogramPanel.test.jsx`

Expected: PASS, whole file.

- [ ] **Step 5: Commit**

```bash
git add src/components/panels/SpectrogramPanel.jsx src/components/panels/SpectrogramPanel.test.jsx
git commit -m "feat(spectrogram): scale 3D height with Shift+wheel" -m "Height Scale lost its rail in the previous commit and needs a place to live that 2D is not using. Shift completes the wheel family: plain zooms time, Ctrl zooms frequency, Shift zooms height, so there is one rule to remember rather than three bindings." -m "The handler reads deltaX as well as deltaY. Chrome on Windows swaps a shifted wheel onto the horizontal axis, which would leave this dead in the shipped app while every synthesised test passed -- so there is a test per delivery path." -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Right double-click resets the viewpoint

`dblclick` fires only for the primary button, so this is assembled by hand in `onSpectrogramChartPointerUp`: a right release counts as a double-click when the press barely moved *and* the previous right release was recent.

**Files:**
- Modify: `src/components/panels/SpectrogramPanel.jsx:36-37` (constants), `:394` (`onSpectrogramChartPointerDown`), `:497` (`onSpectrogramChartPointerUp`)
- Test: `src/components/panels/SpectrogramPanel.test.jsx`

- [ ] **Step 1: Write the failing tests**

Add to `src/components/panels/SpectrogramPanel.test.jsx`:

```jsx
  // The right-drag path calls setPointerCapture, which jsdom does not implement on these elements.
  function stubPointerCapture(canvas) {
    canvas.setPointerCapture = () => {};
    canvas.releasePointerCapture = () => {};
  }

  it("resets the viewpoint on a right double-click in 3D", () => {
    const onPanelControlsChange = vi.fn();
    const { container } = renderPanel({
      historyChartInteractive: true,
      onPanelControlsChange,
      panelControls: {
        spectrogram3d: true,
        spectrogram3dAzimuthDeg: 20,
        spectrogram3dElevationDeg: 10,
      },
    });
    const canvas = container.querySelector("canvas");
    stubPointerCapture(canvas);

    fireEvent.pointerDown(canvas, { button: 2, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(canvas, { button: 2, clientX: 100, clientY: 100 });
    fireEvent.pointerDown(canvas, { button: 2, clientX: 101, clientY: 100 });
    fireEvent.pointerUp(canvas, { button: 2, clientX: 101, clientY: 100 });

    const next = onPanelControlsChange.mock.calls.at(-1)[0];
    expect(next.spectrogram3dAzimuthDeg).toBe(135);
    expect(next.spectrogram3dElevationDeg).toBe(60);
  });

  it("does not reset when the second right press was a rotation drag", () => {
    // Without a movement threshold, rotating out and happening to release near the start reads as
    // a double-click and throws away the viewpoint the user was aiming at.
    const onPanelControlsChange = vi.fn();
    const { container } = renderPanel({
      historyChartInteractive: true,
      onPanelControlsChange,
      panelControls: {
        spectrogram3d: true,
        spectrogram3dAzimuthDeg: 20,
        spectrogram3dElevationDeg: 10,
      },
    });
    const canvas = container.querySelector("canvas");
    stubPointerCapture(canvas);

    fireEvent.pointerDown(canvas, { button: 2, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(canvas, { button: 2, clientX: 100, clientY: 100 });
    fireEvent.pointerDown(canvas, { button: 2, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(canvas, { clientX: 160, clientY: 130 });
    fireEvent.pointerUp(canvas, { button: 2, clientX: 160, clientY: 130 });

    const next = onPanelControlsChange.mock.calls.at(-1)[0];
    expect(next.spectrogram3dAzimuthDeg).not.toBe(135);
  });

  it("ignores a right double-click in 2D", () => {
    const onPanelControlsChange = vi.fn();
    const { container } = renderPanel({
      historyChartInteractive: true,
      onPanelControlsChange,
      panelControls: {},
    });
    const canvas = container.querySelector("canvas");
    stubPointerCapture(canvas);

    fireEvent.pointerDown(canvas, { button: 2, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(canvas, { button: 2, clientX: 100, clientY: 100 });
    fireEvent.pointerDown(canvas, { button: 2, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(canvas, { button: 2, clientX: 100, clientY: 100 });

    expect(onPanelControlsChange).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/panels/SpectrogramPanel.test.jsx -t "right double-click"`

Expected: FAIL on the first — `onPanelControlsChange.mock.calls.at(-1)` is `undefined` because nothing writes the viewpoint on release yet. The other two pass already and are guards.

- [ ] **Step 3: Add the constants and the press-tracking ref**

In `src/components/panels/SpectrogramPanel.jsx`, next to the existing zoom factors at `:36`:

```jsx
const CHART_ZOOM_IN_FACTOR = 0.85;
const CHART_ZOOM_OUT_FACTOR = 1.18;
```

add:

```jsx
// A right press already starts a rotation drag, so a right double-click has to be distinguished
// from "rotated out and came back". Both conditions are required: barely moved, and soon after the
// previous right release.
const RIGHT_DOUBLE_CLICK_MS = 400;
const RIGHT_DOUBLE_CLICK_SLOP_PX = 4;
```

Next to `rotateDragRef` at `:71`, add:

```jsx
  const lastRightUpRef = useRef(null);
```

- [ ] **Step 4: Record the press origin on right pointer-down**

In `onSpectrogramChartPointerDown`, the `button === 2` branch currently reads:

```jsx
      if (is3d && e.button === 2) {
        e.currentTarget.setPointerCapture(e.pointerId);
        rotateDragRef.current = {
          x: e.clientX,
          y: e.clientY,
          azimuthDeg: normalizedPanelControls.spectrogram3dAzimuthDeg,
          elevationDeg: normalizedPanelControls.spectrogram3dElevationDeg,
        };
        return;
      }
```

Add the press origin so the release can measure how far it travelled:

```jsx
      if (is3d && e.button === 2) {
        e.currentTarget.setPointerCapture(e.pointerId);
        rotateDragRef.current = {
          x: e.clientX,
          y: e.clientY,
          downX: e.clientX,
          downY: e.clientY,
          azimuthDeg: normalizedPanelControls.spectrogram3dAzimuthDeg,
          elevationDeg: normalizedPanelControls.spectrogram3dElevationDeg,
        };
        return;
      }
```

`x` and `y` stay as they are — `onSpectrogramChartPointerMove` reads them as the rotation origin and must keep working unchanged.

- [ ] **Step 5: Detect the double-click on right pointer-up**

`onSpectrogramChartPointerUp` currently reads:

```jsx
  const onSpectrogramChartPointerUp = useCallback(
    (e) => {
      rotateDragRef.current = null;
      chartYDragRef.current = null;
      setChartDragging(false);
      setChartYAxisActive(false);
      onHistoryPointerUp?.(e);
    },
    [onHistoryPointerUp]
  );
```

Replace it with:

```jsx
  const onSpectrogramChartPointerUp = useCallback(
    (e) => {
      const rotate = rotateDragRef.current;
      rotateDragRef.current = null;
      chartYDragRef.current = null;
      setChartDragging(false);
      setChartYAxisActive(false);

      if (is3d && e.button === 2) {
        const moved =
          rotate == null ||
          Math.abs(e.clientX - rotate.downX) > RIGHT_DOUBLE_CLICK_SLOP_PX ||
          Math.abs(e.clientY - rotate.downY) > RIGHT_DOUBLE_CLICK_SLOP_PX;
        const now = Date.now();
        const previous = lastRightUpRef.current;
        lastRightUpRef.current = moved ? null : now;
        if (!moved && previous != null && now - previous <= RIGHT_DOUBLE_CLICK_MS) {
          lastRightUpRef.current = null;
          onPanelControlsChange?.(
            normalizePanelControls({
              ...normalizedPanelControls,
              spectrogram3dAzimuthDeg: DEFAULT_PANEL_CONTROLS.spectrogram3dAzimuthDeg,
              spectrogram3dElevationDeg: DEFAULT_PANEL_CONTROLS.spectrogram3dElevationDeg,
            })
          );
        }
        return;
      }

      onHistoryPointerUp?.(e);
    },
    [is3d, normalizedPanelControls, onHistoryPointerUp, onPanelControlsChange]
  );
```

A right release never had anything to say to `onHistoryPointerUp`, so returning early is not a behaviour change — the shared history handlers are driven by the left button.

- [ ] **Step 6: Import `DEFAULT_PANEL_CONTROLS`**

`src/components/panels/SpectrogramPanel.jsx:34` currently reads:

```jsx
import { normalizePanelControls } from "../../lib/panelControls.js";
```

Change it to:

```jsx
import { DEFAULT_PANEL_CONTROLS, normalizePanelControls } from "../../lib/panelControls.js";
```

Keep the `.js` extension — the rest of this file's relative imports carry it.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run src/components/panels/SpectrogramPanel.test.jsx`

Expected: PASS, whole file.

- [ ] **Step 8: Commit**

```bash
git add src/components/panels/SpectrogramPanel.jsx src/components/panels/SpectrogramPanel.test.jsx
git commit -m "feat(spectrogram): reset the 3D viewpoint on a right double-click" -m "Rotation is easy to get lost in and the only way back was two clicks inside the settings popover. Left double-click already means 'return that button's axis to its default' for the timeline; right double-click now means the same for the viewpoint." -m "dblclick fires for the primary button only, so the gesture is assembled from two right releases. Both conditions are load-bearing: a right press already begins a rotation drag, so without the movement threshold, rotating out and back reads as a double-click and discards the viewpoint the user was aiming for." -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Update the help catalogue and both specs

**Files:**
- Modify: `src/components/panels/chartHelp.js:108-114`
- Modify: `docs/superpowers/specs/2026-07-28-spectrogram-3d-view-design.md`
- Modify: `docs/superpowers/specs/2026-07-29-spectrogram-3d-axes-and-gestures-design.md`

- [ ] **Step 1: Rewrite the 3D help section**

In `src/components/panels/chartHelp.js`, the 3D block currently reads:

```js
  {
    title: "3D View",
    items: [
      "Right drag - Rotate the waterfall surface",
      "Height Scale (settings rail) - Exaggerate the surface height, without touching level or colour",
    ],
  },
```

Replace with:

```js
  {
    title: "3D View",
    items: [
      "Right drag - Rotate the waterfall surface",
      "Right double click - Return to the default viewpoint",
      "Shift + wheel - Height Scale: exaggerate the surface height, without touching level or colour",
    ],
  },
```

- [ ] **Step 2: Fix the gesture table in the original spec**

In `docs/superpowers/specs/2026-07-28-spectrogram-3d-view-design.md`, the Gestures table has:

```
| Left axis rail | Frequency range | **Height Scale** |
```

Replace that row with:

```
| Left axis rail | Frequency range | Frequency range — unchanged |
| **Shift+wheel** | none | **Height Scale** |
| **Right double-click** | none | **Reset viewpoint** |
```

- [ ] **Step 3: Mark the new design as implemented**

In `docs/superpowers/specs/2026-07-29-spectrogram-3d-axes-and-gestures-design.md`, change:

```
**Status:** Designed
```

to:

```
**Status:** Implemented
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/components/panels/`

Expected: PASS. `chartHelp.js` is data, but `SpectrogramPanel.test.jsx` renders the help panel in at least one case, so a malformed edit surfaces here.

- [ ] **Step 5: Commit**

```bash
git add src/components/panels/chartHelp.js docs/superpowers/specs/
git commit -m "docs(spectrogram): document the reworked 3D gestures" -m "The help entry still pointed at a rail that no longer carries Height Scale, and the original spec's gesture table still listed the rebinding this work removed." -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Merge gate and real-app verification

- [ ] **Step 1: Run the full gate**

Run: `npm run check`

Expected: exit 0. If the Rust half fails with `could not compile serde_derive`, the worktree is missing its FFmpeg sidecars — run `npm run ffmpeg:fetch` and retry. That error names an unrelated crate; the real cause is buried in the build-script output above it.

- [ ] **Step 2: Verify Shift+wheel in the real app**

Run: `npm run desktop`

Open a Spectrogram panel, switch 3D View on, hold Shift and scroll over the chart. The surface must get taller and shorter.

**This step cannot be skipped or replaced by the test suite.** The `deltaX` swap is WebView2/Chromium behaviour, not something jsdom models — the unit tests pass either way. If the gesture does nothing here, the handler is reading the wrong axis and the tests will not tell you.

While the app is open, also confirm by eye:
- The left rail shows frequency ticks in 3D, same as 2D, and dragging it changes the frequency range.
- Right-drag rotates; right double-click snaps back to the default view.
- Rotating out and releasing near where you started does **not** snap back.

- [ ] **Step 3: Report results and stop**

Report what passed and what did not. Do not commit anything in this task — it is verification only.

---

## Out of scope

Recorded so they are not picked up mid-flight:

- The `Ctrl+drag` frequency pan in 3D is still unverified by eye (open item in the original spec). This plan does not change that code and does not close that item.
- The default `spectrogramDbFloor` of −84 dB is inherited from `SPEC_DB_RANGE` and has never been chosen on its merits. Changing it invalidates a bit-identical 2D pixel test and belongs in its own commit.
- Real-app performance of the 3D renderer is still only modelled in a browser harness.
