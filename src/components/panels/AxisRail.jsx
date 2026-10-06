import { cn } from "@/lib/utils";
import { CAPTION_TEXT } from "@/lib/shellLayout";
import { axisLabelClass } from "@/lib/axisLabelClasses.js";

const RAIL_HOVER = "hover:bg-ui-hover";

// The chart display area insets its content at the top; a rail whose plot does that has to match,
// or its labels name positions the plot draws elsewhere. Passing `inset` is how a rail declares it
// is paired with such a plot -- the spectrogram's canvas fills its box edge to edge, so its rail
// leaves this off.
const SCALE_INSET = "top-[var(--ui-chart-inset-top)] bottom-[var(--ui-chart-inset-bottom)]";

// The first and last labels are tucked against their edges instead of being centred on their
// value, so that neither overhangs the plot -- the spectrum's dB scale, whose extreme ticks sit a
// little inside the viewBox, would otherwise put half a label outside the panel. Which edge a
// pinned tick belongs to comes from its fraction, not its index: frequency ticks run low to high,
// so their first entry is the bottom one, while dB ticks run the other way.
/**
 * @param {number} index
 * @param {number} frac
 * @param {number} count
 */
export function tickPosition(index, frac, count) {
  if (index !== 0 && index !== count - 1) return "middle";
  return frac < 0.5 ? "start" : "end";
}

/**
 * One axis rail: the label track beside or beneath a plot, and the surface its zoom/pan gestures
 * land on. Pass `interaction` from useAxisInteraction to make it editable, or leave it out for a
 * rail that only labels a fixed range.
 *
 * @param {object} props
 * @param {"x"|"y"} props.axis
 * @param {Array<{key: string|number, label: import("react").ReactNode, frac: number, className?: string, opacity?: number}>} props.ticks
 *   `frac` runs 0 at the rail's start (top for y, left for x) to 1 at its end. `opacity` fades a
 *   label that something drawn over the rail would otherwise collide with.
 * @param {object} [props.interaction] Result of useAxisInteraction. Omit for a passive rail.
 * @param {boolean} [props.active] Highlight driven from the plot area, ORed with the rail's own.
 * @param {boolean} [props.inset] Apply the chart's vertical inset. Y rails only.
 * @param {object} [props.railRef] Ref for a passive rail that still has to be measured. Ignored
 *   when `interaction` is given, which brings its own.
 * @param {string} [props.className]
 * @param {import("react").ReactNode} [props.children]
 * @param {object} [props.scaleProps] Extra props for the tick track, for panels that hang test or
 *   layout hooks off it.
 */
export function AxisRail({
  axis,
  ticks,
  interaction,
  railRef,
  active = false,
  inset = false,
  className,
  scaleProps,
  children,
  ...rest
}) {
  const isY = axis === "y";
  const interactive = Boolean(interaction);
  return (
    <div
      ref={interaction?.axisRef ?? railRef}
      {...(interaction?.axisHandlers ?? {})}
      style={interactive ? { cursor: interaction.cursorStyle } : undefined}
      className={cn(
        CAPTION_TEXT,
        "relative",
        interactive && RAIL_HOVER,
        className,
        ((interaction?.isActive ?? false) || active) && "text-foreground"
      )}
      {...rest}
    >
      <div
        className={cn(
          "absolute",
          isY ? cn("inset-x-0", inset ? SCALE_INSET : "top-0 bottom-0") : "inset-0"
        )}
        {...scaleProps}
      >
        {ticks.map(({ key, label, frac, className: tickClassName, opacity }, index) => {
          const position = tickPosition(index, frac, ticks.length);
          const style = {
            ...(position === "middle" ? { [isY ? "top" : "left"]: `${frac * 100}%` } : {}),
            ...(opacity !== undefined ? { opacity } : {}),
          };
          return (
            <span
              key={key}
              className={axisLabelClass(axis, position, tickClassName)}
              style={Object.keys(style).length > 0 ? style : undefined}
            >
              {label}
            </span>
          );
        })}
        {children}
      </div>
    </div>
  );
}

// Time axis rails are driven by useHistoryInteraction, which hands back bare handlers rather than a
// useAxisInteraction result. Wrap them into the shape AxisRail expects. Their highlight is passed
// separately as `active`, because a time axis also lights up when something else moves time.
export function timeAxisInteraction(handlers) {
  return handlers ? { axisHandlers: handlers, cursorStyle: "ew-resize" } : undefined;
}
