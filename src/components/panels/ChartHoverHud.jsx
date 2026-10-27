import { Children, isValidElement, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { chartHudSide, fitChartHud } from "./chartHudLayout.js";

function fieldText(child) {
  if (typeof child === "string" || typeof child === "number") return String(child);
  if (isValidElement(child)) return Children.toArray(child.props.children).map(fieldText).join("");
  return "";
}

/**
 * Shared panel-local overlay: axes cannot paint over it, and pointer input passes through. It sits
 * in the plot's top-left corner and moves to the top-right one while the cursor is near it.
 */
export function ChartHoverHud({ children, channelOverflow = false }) {
  const anchor = useRef(null);
  const boxRef = useRef(null);
  const [geometry, setGeometry] = useState(null);
  const [side, setSide] = useState("left");
  const fields = Children.toArray(children);
  useLayoutEffect(() => {
    const node = anchor.current;
    const root = node?.closest("[data-chart-hud-boundary]");
    const plot = node?.parentElement;
    if (!root || !plot) return;
    const measure = () => {
      const bounds = root.getBoundingClientRect();
      const origin = plot.getBoundingClientRect();
      const font = parseFloat(getComputedStyle(node).fontSize) || 12;
      const left = Math.max(4, origin.left - bounds.left + 4);
      const top = Math.max(4, origin.top - bounds.top + 4);
      setGeometry({
        root,
        left,
        right: Math.max(4, bounds.right - origin.right + 4),
        top,
        width: bounds.width - left - 4,
        height: bounds.height - top - 4,
        font,
      });
    };
    measure();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    observer?.observe(root);
    observer?.observe(plot);
    observer?.observe(node);
    return () => observer?.disconnect();
  }, []);
  useLayoutEffect(() => {
    const root = geometry?.root;
    if (!root) return;
    const follow = (event) => {
      const box = boxRef.current;
      if (!box) return;
      const bounds = root.getBoundingClientRect();
      const cursor = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
      setSide(
        chartHudSide(cursor, {
          left: geometry.left,
          right: geometry.right,
          top: geometry.top,
          width: box.offsetWidth,
          height: box.offsetHeight,
          boundaryWidth: bounds.width,
        })
      );
    };
    root.addEventListener("pointermove", follow);
    return () => root.removeEventListener("pointermove", follow);
  }, [geometry]);
  // Fit each field to the longest text it has shown during this hover, so live digits never
  // shrink the box or move fields between rows. The fitter can omit a field, but never split its
  // number/unit.
  const lengths = fields.map((field) => fieldText(field).length);
  const [reserved, setReserved] = useState(lengths);
  const grown = lengths.map((length, index) => Math.max(length, reserved[index] ?? 0));
  if (grown.some((length, index) => length !== reserved[index])) setReserved(grown);
  const widths = grown.map((length) => Math.max(8, length) * (geometry?.font ?? 12) * 0.6);
  const layout =
    geometry?.width > 0
      ? fitChartHud(widths, geometry.width, geometry.height, geometry.font * 1.5, channelOverflow)
      : { horizontal: false, count: fields.length, overflow: null };
  const box = (
    <div
      ref={boxRef}
      data-chart-hover-hud
      data-layout={layout.horizontal ? "horizontal" : "vertical"}
      data-side={side}
      className="pointer-events-none absolute z-40 rounded-xs border border-border bg-secondary/50 backdrop-blur-[2px] px-2 py-1 font-[family-name:var(--ui-font-mono)] tabular-nums text-[length:var(--ui-fs-axis)] text-[color:var(--ui-text-annotation)]"
      style={{
        ...(side === "right" ? { right: geometry?.right ?? 4 } : { left: geometry?.left ?? 4 }),
        top: geometry?.top ?? 4,
        maxWidth: geometry ? Math.max(0, geometry.width) : undefined,
        maxHeight: geometry ? Math.max(0, geometry.height) : undefined,
        overflow: "hidden",
        display: "flex",
        flexDirection: layout.horizontal ? "row" : "column",
        flexWrap: layout.horizontal ? "wrap" : "nowrap",
        columnGap: 8,
        lineHeight: layout.horizontal ? 1.25 : 1.5,
        paddingBlock: layout.horizontal ? 2 : 4,
      }}
    >
      {fields.slice(0, layout.count).map((field, index) => (
        <div
          key={index}
          style={{
            width: widths[index],
            flexShrink: 0,
            whiteSpace: "nowrap",
          }}
        >
          {field}
        </div>
      ))}
      {layout.overflow && <span className="whitespace-nowrap">{layout.overflow}</span>}
    </div>
  );
  return (
    <>
      <span
        ref={anchor}
        className="pointer-events-none absolute h-[1em] w-[1em] text-[length:var(--ui-fs-axis)]"
      />
      {geometry?.root ? createPortal(box, geometry.root) : box}
    </>
  );
}
