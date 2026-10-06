/** @vitest-environment jsdom */
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DockPanelResizeHandle } from "./DockPanelResizeHandle.jsx";
import { DockHeightResizeHandle } from "./DockHeightResizeHandle.jsx";

function pointer(element, type, values = {}) {
  const event = new MouseEvent(type, { bubbles: true, button: 0, ...values });
  Object.defineProperty(event, "pointerId", { value: 1 });
  fireEvent(element, event);
}

describe.each(["width", "height"])("Dock %s resize feedback", (kind) => {
  function setup(disabled = false) {
    const commit = vi.fn();
    const view = render(
      kind === "width" ? (
        <DockPanelResizeHandle
          leftPanel={{ id: "left", moduleId: "levelMeter" }}
          rightPanel={{ id: "right", moduleId: "vectorscope" }}
          onResize={commit}
          disabled={disabled}
          leftBasis={undefined}
          rightBasis={undefined}
          onReset={undefined}
        />
      ) : (
        <DockHeightResizeHandle
          edge="top"
          height={82}
          onHeightChange={commit}
          disabled={disabled}
        />
      )
    );
    return { handle: view.getByRole("separator"), commit };
  }

  it.each(["pointerup", "pointercancel", "lostpointercapture"])(
    "keeps drag feedback until %s and commits only once",
    (end) => {
      const { handle, commit } = setup();
      pointer(handle, "pointerdown", { clientX: 100, clientY: 100 });
      expect(handle.dataset.dragging).toBe("true");
      pointer(handle, "pointermove", { clientX: 120, clientY: 120 });
      pointer(handle, "pointerout");
      expect(handle.dataset.dragging).toBe("true");
      commit.mockClear();
      pointer(handle, end);
      expect(handle.dataset.dragging).toBeUndefined();
      expect(commit).toHaveBeenCalledTimes(1);
      pointer(handle, "lostpointercapture");
      expect(commit).toHaveBeenCalledTimes(1);
    }
  );

  it("ignores disabled handles and secondary mouse buttons", () => {
    const { handle, commit } = setup(true);
    pointer(handle, "pointerdown");
    expect(handle.dataset.dragging).toBeUndefined();
    expect(commit).not.toHaveBeenCalled();
  });

  it("does not start a drag from a secondary mouse button", () => {
    const { handle, commit } = setup();
    pointer(handle, "pointerdown", { button: 2 });
    expect(handle.dataset.dragging).toBeUndefined();
    expect(commit).not.toHaveBeenCalled();
  });
});
