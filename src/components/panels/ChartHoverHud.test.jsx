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

// jsdom has no PointerEvent, and its generic fallback drops the coordinates.
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
  it("is a translucent, blurred overlay", () => {
    renderHud();
    const hud = screen.getByText("359 Hz").closest("[data-chart-hover-hud]");
    expect(hud.className).toContain("bg-secondary/70");
    expect(hud.className).toContain("backdrop-blur-sm");
  });

  it("moves to the right corner while the cursor is near the left one, and back", () => {
    const boundary = renderHud();
    const hud = () => screen.getByText("359 Hz").closest("[data-chart-hover-hud]");
    expect(hud().dataset.side).toBe("left");

    pointerMove(boundary, 80, 20);
    expect(hud().dataset.side).toBe("right");
    expect(hud().style.right).not.toBe("");
    expect(hud().style.left).toBe("");

    pointerMove(boundary, 400, 120);
    expect(hud().dataset.side).toBe("left");
  });
});
