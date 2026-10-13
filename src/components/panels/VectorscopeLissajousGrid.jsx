import { cn } from "../../lib/utils.js";

/**
 * The Lissajous guides: the two channel axes as dashed diagonals, with the pair labels in the top
 * corners those axes point at. The diagonals stop short of the corners by the label size plus a
 * gap, so a guide never runs through a label; all four ends are inset alike to keep the cross
 * centred.
 *
 * @param {{
 *   labelSize?: string | null,
 *   labelGap?: string,
 *   labelClassName?: string,
 *   firstLabel?: string,
 *   secondLabel?: string,
 *   gridProps?: Record<string, any>,
 *   labelProps?: Record<string, any>,
 * }} props `labelSize` is the labels' CSS font size and `labelGap` the CSS distance kept between
 *   a label and its guide; leave `labelSize` out to show no labels and run the guides corner to
 *   corner.
 */
export function VectorscopeLissajousGrid({
  labelSize = null,
  labelGap,
  labelClassName,
  firstLabel,
  secondLabel,
  gridProps,
  labelProps,
}) {
  return (
    <>
      <div
        className="pointer-events-none absolute"
        style={{ inset: labelSize ? `calc(${labelSize} + ${labelGap})` : 0 }}
      >
        <svg
          {...gridProps}
          className="block h-full w-full"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden
        >
          <line
            x1="0"
            y1="0"
            x2="100"
            y2="100"
            stroke="var(--ui-vectorscope-guides-stroke)"
            strokeWidth="1"
            strokeDasharray="var(--ui-vectorscope-grid-dash)"
            vectorEffect="non-scaling-stroke"
          />
          <line
            x1="100"
            y1="0"
            x2="0"
            y2="100"
            stroke="var(--ui-vectorscope-guides-stroke)"
            strokeWidth="1"
            strokeDasharray="var(--ui-vectorscope-grid-dash)"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>
      {labelSize ? (
        <div
          {...labelProps}
          className={cn(
            "pointer-events-none absolute inset-x-0 top-0 z-[2] flex justify-between leading-none",
            labelClassName
          )}
          style={{ fontSize: labelSize }}
        >
          <span className="max-w-[45%] truncate">{firstLabel}</span>
          <span className="max-w-[45%] truncate text-right">{secondLabel}</span>
        </div>
      ) : null}
    </>
  );
}
