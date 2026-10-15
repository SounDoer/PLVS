/** @vitest-environment jsdom */
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAxisSize } from "./useAxisSize";

function Probe({ axis, onMeasure, visible = true }) {
  const { axisRef, axisPx } = useAxisSize(axis);
  onMeasure(axisPx);
  return visible ? <div ref={axisRef} /> : null;
}

describe("useAxisSize", () => {
  beforeEach(() => {
    class ResizeObserverStub {
      observe() {}
      disconnect() {}
      unobserve() {}
    }
    window.ResizeObserver = ResizeObserverStub;
    globalThis.ResizeObserver = ResizeObserverStub;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("measures a y axis rail's height", () => {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue(
      /** @type {ReturnType<typeof Element.prototype.getBoundingClientRect>} */ ({
        top: 0,
        left: 0,
        width: 60,
        height: 90,
      })
    );
    const onMeasure = vi.fn();
    render(<Probe axis="y" onMeasure={onMeasure} />);
    expect(onMeasure).toHaveBeenLastCalledWith(90);
  });

  it("measures an x axis rail's width", () => {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue(
      /** @type {ReturnType<typeof Element.prototype.getBoundingClientRect>} */ ({
        top: 0,
        left: 0,
        width: 420,
        height: 24,
      })
    );
    const onMeasure = vi.fn();
    render(<Probe axis="x" onMeasure={onMeasure} />);
    expect(onMeasure).toHaveBeenLastCalledWith(420);
  });

  it("keeps the fallback budget when the rail measures zero", () => {
    // jsdom (and a not-yet-laid-out element) reports 0; a 0px tick budget would collapse the axis
    // to its endpoints, so the seeded default stands until a real measurement arrives.
    const onMeasure = vi.fn();
    render(<Probe axis="y" onMeasure={onMeasure} />);
    expect(onMeasure).toHaveBeenLastCalledWith(300);
  });
});

it("measures rails that are mounted after annotations were hidden", () => {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 100, 24));
  const onMeasure = vi.fn();
  const view = render(<Probe axis="y" onMeasure={onMeasure} visible={false} />);
  view.rerender(<Probe axis="y" onMeasure={onMeasure} visible />);
  expect(onMeasure).toHaveBeenLastCalledWith(24);
  view.rerender(<Probe axis="y" onMeasure={onMeasure} visible={false} />);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 100, 80));
  view.rerender(<Probe axis="y" onMeasure={onMeasure} visible />);
  expect(onMeasure).toHaveBeenLastCalledWith(80);
  vi.restoreAllMocks();
});
