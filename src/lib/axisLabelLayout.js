const AXIS_LABEL_GAP_PX = 4;

/** Original anchor positions stay attached to the complete tick list, even if labels are hidden. */
export function axisTickPosition(index, frac, count) {
  if (index !== 0 && index !== count - 1) return "middle";
  return frac < 0.5 ? "start" : "end";
}

function anchor(label) {
  if (label.position === "start") return { fraction: 0, offset: 0 };
  if (label.position === "end") return { fraction: 1, offset: -label.size };
  return { fraction: label.frac, offset: -label.size / 2 };
}

/** Minimum extent that fits an entire fixed semantic group, including unequal endpoint text. */
export function minimumAxisLabelExtent(labels, gap = AXIS_LABEL_GAP_PX) {
  const ordered = [...labels].sort((a, b) => a.frac - b.frac);
  let extent = Math.max(0, ...ordered.map((label) => label.size));
  for (let index = 1; index < ordered.length; index += 1) {
    const left = ordered[index - 1];
    const right = ordered[index];
    const a = anchor(left);
    const b = anchor(right);
    const distance = b.fraction - a.fraction;
    if (distance > 0) extent = Math.max(extent, (a.offset + left.size + gap - b.offset) / distance);
  }
  return Math.ceil(extent);
}

/**
 * Fit measured label boxes without moving ticks or changing the grid. References outrank range
 * ends; time axes protect their latest semantic entry irrespective of direction. Stable source
 * order breaks ties. A fixed group reserves its readable minimum instead of dropping a member.
 * @param {Array<{key: string | number, frac: number, position: string, size: number}>} labels
 * @param {number} extent
 * @param {{ policy?: "range" | "time" | "fixed", referenceKey?: string | number, gap?: number }} [options]
 */
export function layoutAxisLabels(
  labels,
  extent,
  { policy = "range", referenceKey, gap = AXIS_LABEL_GAP_PX } = {}
) {
  const hidden = new Set();
  if (!(extent > 0) || labels.some(({ size }) => !(size > 0))) return { hidden, minExtent: 0 };
  if (policy === "fixed") return { hidden, minExtent: minimumAxisLabelExtent(labels, gap) };
  const last = labels.length - 1;
  const candidates = labels
    .map((label, index) => {
      const { fraction, offset } = anchor(label);
      const start = fraction * extent + offset;
      const priority =
        referenceKey !== undefined && label.key === referenceKey
          ? 4
          : policy === "time" && index === last
            ? 4
            : index === 0 || index === last
              ? 2
              : 1;
      return { ...label, start, end: start + label.size, priority, index };
    })
    .sort((a, b) => b.priority - a.priority || a.index - b.index);
  const kept = [];
  for (const candidate of candidates) {
    if (
      kept.some((other) => candidate.start < other.end + gap && candidate.end + gap > other.start)
    )
      hidden.add(candidate.key);
    else kept.push(candidate);
  }
  return { hidden, minExtent: 0 };
}
