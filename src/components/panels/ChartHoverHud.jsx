import { Children, isValidElement, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fitChartHud } from "./chartHudLayout.js";

function fieldText(child) {
  if (typeof child === "string" || typeof child === "number") return String(child);
  if (isValidElement(child)) return Children.toArray(child.props.children).map(fieldText).join("");
  return "";
}

/** Shared panel-local overlay: axes cannot paint over it, and pointer input passes through. */
export function ChartHoverHud({ children, channelOverflow = false }) {
  const anchor = useRef(null);
  const [geometry, setGeometry] = useState(null);
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
  // Reserve the normal reading range so live digits do not move fields between rows. Longer
  // labels get their full width: the fitter can omit a field, but never split its number/unit.
  const widths = fields.map(
    (field, index) =>
      Math.max(index === 0 ? 8 : 13, fieldText(field).length) * (geometry?.font ?? 12) * 0.6
  );
  const layout =
    geometry?.width > 0
      ? fitChartHud(widths, geometry.width, geometry.height, geometry.font * 1.5, channelOverflow)
      : { horizontal: false, count: fields.length, overflow: null };
  const box = (
    <div
      data-chart-hover-hud
      data-layout={layout.horizontal ? "horizontal" : "vertical"}
      className="pointer-events-none absolute z-40 rounded-xs border border-border bg-secondary px-2 py-1 font-[family-name:var(--ui-font-mono)] tabular-nums text-[length:var(--ui-fs-axis)] text-[color:var(--ui-text-annotation)]"
      style={{
        left: geometry?.left ?? 4,
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
