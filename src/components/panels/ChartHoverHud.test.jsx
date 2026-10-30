/** @vitest-environment jsdom */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChartHoverHud } from "./ChartHoverHud.jsx";

function rect(left, top, width, height) {
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top };
}

function renderHud() {
  const rects = { boundary: rect(0, 0, 600, 200), plot: rect(36, 0, 560, 180) };
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
    return rects[this.dataset.testid] ?? rect(0, 0, 0, 0);
  });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(120);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(50);
  render(
    <div data-testid="boundary" data-chart-hud-boundary>
      <div data-testid="plot">
        <ChartHoverHud>
          <div>359 Hz</div>
          <div>-47.6 dB</div>
        </ChartHoverHud>
      </div>
    </div>
  );
  return screen.getByTestId("boundary");
}

// A MouseEvent also carries the coordinates consumed by the native pointer listener.
function pointerMove(target, clientX, clientY) {
  act(() => {
    target.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX, clientY }));
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ChartHoverHud", () => {
  it("fits fields to their text and never shrinks them while the hover lasts", () => {
    const hud = (dbLabel) => (
      <div data-chart-hud-boundary style={{ fontSize: "12px" }}>
        <div>
          <ChartHoverHud>
            <div>483 Hz</div>
            <div>{dbLabel}</div>
          </ChartHoverHud>
        </div>
      </div>
    );
    const { rerender } = render(hud("-40.7 dB"));
    const width = (text) => parseFloat(screen.getByText(text).parentElement.style.width).toFixed(1);
    // 12 px fixture font, 0.6 em per monospace character, 8-character floor.
    expect(width("483 Hz")).toBe("57.6");
    expect(width("-40.7 dB")).toBe("57.6");

    rerender(hud("-100.7 dB"));
    expect(width("-100.7 dB")).toBe("64.8");

    rerender(hud("-4.7 dB"));
    expect(width("-4.7 dB")).toBe("64.8");
  });

  it("moves to the right corner while the cursor is near the left one, and back", () => {
    const boundary = renderHud();
    const hud = () =>
      /** @type {HTMLElement} */ (screen.getByText("359 Hz").closest("[data-chart-hover-hud]"));
    expect(hud().dataset.side).toBe("left");

    pointerMove(boundary, 80, 20);
    expect(hud().dataset.side).toBe("right");
    expect(hud().style.right).not.toBe("");
    expect(hud().style.left).toBe("");

    pointerMove(boundary, 400, 120);
    expect(hud().dataset.side).toBe("left");
  });
});
