/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useFloatingPanelDrag } from "./useFloatingPanelDrag.js";

function setup() {
  const panelRef = {
    current: {
      getBoundingClientRect: () => ({ left: 100, top: 100, width: 200, height: 100 }),
    },
  };
  const onMove = vi.fn();
  const target = { setPointerCapture: vi.fn() };
  const { result } = renderHook(() => useFloatingPanelDrag(panelRef, onMove));
  return { handlers: result.current, onMove, target };
}

describe("useFloatingPanelDrag", () => {
  it("starts only for the primary pointer", () => {
    const { handlers, onMove, target } = setup();

    act(() => handlers.onPointerDown({ button: 2, currentTarget: target, pointerId: 1 }));
    act(() => handlers.onPointerMove({ clientX: 300, clientY: 250 }));

    expect(target.setPointerCapture).not.toHaveBeenCalled();
    expect(onMove).not.toHaveBeenCalled();
  });

  it.each(["onPointerCancel", "onLostPointerCapture"])("stops moving after %s", (endHandler) => {
    const { handlers, onMove, target } = setup();
    act(() =>
      handlers.onPointerDown({
        button: 0,
        clientX: 125,
        clientY: 120,
        currentTarget: target,
        pointerId: 1,
      })
    );
    act(() => handlers.onPointerMove({ clientX: 300, clientY: 250 }));
    expect(onMove).toHaveBeenCalledOnce();

    act(() => handlers[endHandler]());
    act(() => handlers.onPointerMove({ clientX: 400, clientY: 350 }));

    expect(onMove).toHaveBeenCalledOnce();
  });
});
