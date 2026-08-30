/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { AxisRail } from "./AxisRail.jsx";

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
    const [top, mid, bottom] = labels(container);

    expect(top.className).toContain("top-0");
    expect(top.style.top).toBe("");
    expect(mid.className).toContain("-translate-y-1/2");
    expect(mid.style.top).toBe("50%");
    expect(bottom.className).toContain("bottom-0");
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
    const [hi, , lo] = labels(container);

    expect(hi.className).toContain("top-0");
    expect(hi.className).not.toContain("-translate-y-1/2");
    expect(hi.style.top).toBe("");
    expect(lo.className).toContain("bottom-0");
  });

  it("picks the edge a pinned tick belongs to from its fraction, not its index", () => {
    // Frequency ticks run low to high, so the first entry belongs at the bottom.
    const { container } = render(
      <AxisRail
        axis="y"
        ticks={[
          { key: 20, label: "20", frac: 1 },
          { key: 20000, label: "20k", frac: 0 },
        ]}
      />
    );
    const [first, last] = labels(container);

    expect(first.className).toContain("bottom-0");
    expect(last.className).toContain("top-0");
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
    expect(passive.firstChild.style.cursor).toBe("");
    expect(passive.firstChild.className).not.toContain("hover:bg-");

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
    expect(live.firstChild.style.cursor).toBe("ns-resize");
    expect(live.firstChild.className).toContain("hover:bg-");
  });

  it("highlights from either the rail's own gesture or the plot area's", () => {
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

    expect(fromRail.firstChild.className).toContain("text-foreground");
    expect(fromPlot.firstChild.className).toContain("text-foreground");
    expect(idle.firstChild.className).not.toContain("text-foreground");
  });

  it("applies the chart inset only when the plot it labels does", () => {
    const { container: inset } = render(<AxisRail axis="y" ticks={TICKS} inset />);
    const { container: flush } = render(<AxisRail axis="y" ticks={TICKS} />);

    expect(inset.firstChild.firstChild.className).toContain("ui-chart-inset-top");
    expect(flush.firstChild.firstChild.className).not.toContain("ui-chart-inset-top");
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
