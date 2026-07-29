/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { usePointerReorder } from "./usePointerReorder.js";

// Three rows of 40px starting at the viewport top.
const RECT = { top: 0, height: 120 };

function setup(ids) {
  const onReorder = vi.fn();
  const view = renderHook(({ ids: next }) => usePointerReorder(next, onReorder), {
    initialProps: { ids },
  });
  view.result.current.containerRef.current = { getBoundingClientRect: () => RECT };
  return { view, onReorder };
}

// jsdom has no PointerEvent constructor; a MouseEvent carrying a pointerId is what the hook reads.
function pointerEvent(type, init = {}) {
  const { pointerId = 1, ...rest } = init;
  const event = new window.MouseEvent(type, { bubbles: true, ...rest });
  Object.defineProperty(event, "pointerId", { value: pointerId });
  return event;
}

function dispatch(type, init) {
  act(() => {
    window.dispatchEvent(pointerEvent(type, init));
  });
}

describe("usePointerReorder", () => {
  it("commits a drag released away from the drag handle", () => {
    const { view, onReorder } = setup(["a", "b", "c"]);
    act(() => view.result.current.startDrag("c", pointerEvent("pointerdown")));
    dispatch("pointermove", { clientY: 10 });
    // Pointer capture cannot be relied on -- the release lands on whatever sits under the
    // pointer, which is why the gesture is driven from the window and not from the handle.
    dispatch("pointerup", { clientY: 10 });
    expect(onReorder).toHaveBeenCalledWith(["c", "a", "b"]);
    expect(view.result.current.draggingId).toBeNull();
  });

  it("keeps the dragged order when a fresh ids array arrives mid-drag", async () => {
    const { view, onReorder } = setup(["a", "b", "c"]);
    act(() => view.result.current.startDrag("c", pointerEvent("pointerdown")));
    dispatch("pointermove", { clientY: 10 });
    await act(async () => view.rerender({ ids: ["a", "b", "c"] }));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 5)));
    expect(view.result.current.orderedIds).toEqual(["c", "a", "b"]);
    dispatch("pointerup", { clientY: 10 });
    expect(onReorder).toHaveBeenCalledWith(["c", "a", "b"]);
  });

  it("adopts an ids change parked during a drag that moved nothing", async () => {
    const { view, onReorder } = setup(["a", "b", "c"]);
    act(() => view.result.current.startDrag("c", pointerEvent("pointerdown")));
    await act(async () => view.rerender({ ids: ["b", "a", "c"] }));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 5)));
    dispatch("pointerup", { clientY: 110 });
    expect(onReorder).not.toHaveBeenCalled();
    expect(view.result.current.orderedIds).toEqual(["b", "a", "c"]);
  });

  it("ignores pointer events from another pointer", () => {
    const { view, onReorder } = setup(["a", "b", "c"]);
    act(() => view.result.current.startDrag("c", pointerEvent("pointerdown")));
    dispatch("pointermove", { pointerId: 2, clientY: 10 });
    dispatch("pointerup", { pointerId: 2, clientY: 10 });
    expect(onReorder).not.toHaveBeenCalled();
    expect(view.result.current.draggingId).toBe("c");
  });

  it("stops listening once the drag ends", () => {
    const { view, onReorder } = setup(["a", "b", "c"]);
    act(() => view.result.current.startDrag("c", pointerEvent("pointerdown")));
    dispatch("pointermove", { clientY: 10 });
    dispatch("pointerup", { clientY: 10 });
    onReorder.mockClear();
    dispatch("pointermove", { clientY: 110 });
    dispatch("pointerup", { clientY: 110 });
    expect(onReorder).not.toHaveBeenCalled();
  });
});
