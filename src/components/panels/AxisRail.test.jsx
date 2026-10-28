/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { AxisRail, tickPosition } from "./AxisRail.jsx";

const TICKS = [
  { key: "top", label: "0", frac: 0 },
  { key: "mid", label: "-6", frac: 0.5 },
  { key: "bottom", label: "-12", frac: 1 },
];

function labels(container) {
  return [...container.querySelectorAll("span")];
}

describe("AxisRail", () => {
  it("pins the extreme ticks and positions the rest by fraction", () => {
    const { container } = render(<AxisRail axis="y" ticks={TICKS} />);
    const [top, mid] = labels(container);

    expect(top.style.top).toBe("");

    expect(mid.style.top).toBe("50%");
  });

  it("pins the first and last tick even when their value sits inside the plot", () => {
    // The spectrum's dB scale insets its extremes; the labels still tuck against the edges.
    const { container } = render(
      <AxisRail
        axis="y"
        ticks={[
          { key: "hi", label: "-12", frac: 0.04 },
          { key: "mid", label: "-54", frac: 0.5 },
          { key: "lo", label: "-96", frac: 0.96 },
        ]}
      />
    );
    const [hi] = labels(container);

    expect(hi.style.top).toBe("");
  });

  it("chooses a pinned tick's edge from its fraction rather than its list position", () => {
    expect(tickPosition(0, 1, 2)).toBe("end");
    expect(tickPosition(1, 0, 2)).toBe("start");
  });

  it("places x ticks along the horizontal", () => {
    const { container } = render(
      <AxisRail
        axis="x"
        ticks={[
          { key: "lo", label: "20", frac: 0 },
          { key: "m", label: "1k", frac: 0.25 },
          { key: "hi", label: "20k", frac: 1 },
        ]}
      />
    );

    expect(labels(container)[1].style.left).toBe("25%");
    expect(labels(container)[1].style.top).toBe("");
  });

  it("stays inert without an interaction, and wires one up when given", () => {
    const { container: passive } = render(<AxisRail axis="y" ticks={TICKS} />);
    expect(/** @type {HTMLElement} */ (passive.firstChild).style.cursor).toBe("");

    const onWheel = vi.fn();
    const { container: live } = render(
      <AxisRail
        axis="y"
        ticks={TICKS}
        interaction={{
          axisRef: { current: null },
          axisHandlers: { onWheel },
          cursorStyle: "ns-resize",
          isActive: false,
        }}
      />
    );
    expect(/** @type {HTMLElement} */ (live.firstChild).style.cursor).toBe("ns-resize");
  });

  it("reports highlights driven by either the rail gesture or the plot area", () => {
    const base = { axisRef: { current: null }, axisHandlers: {}, cursorStyle: "ns-resize" };
    const { container: fromRail } = render(
      <AxisRail axis="y" ticks={TICKS} interaction={{ ...base, isActive: true }} />
    );
    const { container: fromPlot } = render(
      <AxisRail axis="y" ticks={TICKS} interaction={{ ...base, isActive: false }} active />
    );
    const { container: idle } = render(
      <AxisRail axis="y" ticks={TICKS} interaction={{ ...base, isActive: false }} />
    );

    expect(/** @type {HTMLElement} */ (fromRail.firstChild).dataset.active).toBe("true");
    expect(/** @type {HTMLElement} */ (fromPlot.firstChild).dataset.active).toBe("true");
    expect(/** @type {HTMLElement} */ (idle.firstChild).dataset.active).toBe("false");
  });

  it("updates a tick's text in place when its key stays put", () => {
    // A time axis relabels almost every update ("5.0s ago" -> "4.9s ago"). Keying a tick by its
    // text made React unmount and remount the element for each relabel -- 77 node mutations a
    // second per panel, measured in three panels at once. Keying by slot writes text instead, so
    // this asserts the node identity survives a relabel.
    const ticks = (labels) => labels.map((label, i) => ({ key: i, label, frac: i / 2 }));
    const { container, rerender } = render(<AxisRail axis="x" ticks={ticks(["5.0s", "2.5s"])} />);
    const before = [...container.querySelectorAll("span")];
    expect(before.map((el) => el.textContent)).toEqual(["5.0s", "2.5s"]);

    rerender(<AxisRail axis="x" ticks={ticks(["4.9s", "2.4s"])} />);
    const after = [...container.querySelectorAll("span")];
    expect(after.map((el) => el.textContent)).toEqual(["4.9s", "2.4s"]);
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);
  });
});

it("refits measured labels on resize and text-size changes without moving ticks or caller refs", () => {
  let extent = 126;
  let fontSize = 12;
  let resize;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback) {
        resize = callback;
      }
      observe() {}
      disconnect() {}
    }
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    () => new DOMRect(0, 0, 200, extent)
  );
  const realStyle = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
    const style = realStyle(element);
    style.fontSize = `${fontSize}px`;
    style.lineHeight = `${fontSize}px`;
    return style;
  });
  const ref = vi.fn();
  const { container } = render(
    <AxisRail
      axis="y"
      referenceKey={0}
      scaleProps={{ ref }}
      ticks={[
        { key: 3, label: "+3", frac: 0 },
        { key: 0, label: "0", frac: 3 / 63 },
        { key: -60, label: "-60", frac: 1 },
      ]}
    />
  );
  const [top, zero] = labels(container);
  expect(top.style.visibility).toBe("hidden");
  expect(top.getAttribute("aria-hidden")).toBe("true");
  expect(zero.style.top).toBe(`${(3 / 63) * 100}%`);
  const position = zero.style.top;
  extent = 630;
  act(() => resize());
  expect(top.style.visibility).toBe("");
  fontSize = 40;
  act(() => resize());
  expect(top.style.visibility).toBe("hidden");
  expect(zero.style.top).toBe(position);
  expect(ref).toHaveBeenCalledWith(container.firstChild.firstChild);
  vi.unstubAllGlobals();
});
