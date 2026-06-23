const AXIS_LABEL_BASE = {
  x: "absolute top-0 whitespace-nowrap",
  y: "absolute right-0 leading-none",
};

const AXIS_LABEL_POSITION = {
  x: {
    start: "left-0 text-left",
    middle: "-translate-x-1/2 text-center",
    end: "right-0 text-right",
  },
  y: {
    start: "top-0",
    middle: "-translate-y-1/2",
    end: "bottom-0",
  },
};

export function axisLabelClass(axis, position, extra = "") {
  const base = AXIS_LABEL_BASE[axis];
  const placement = AXIS_LABEL_POSITION[axis]?.[position];
  const suffix = extra ? ` ${extra}` : "";
  return `${base} ${placement}${suffix}`;
}
