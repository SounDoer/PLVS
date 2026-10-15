/** Keep edge labels and omit interior ticks whose measured text boxes would collide. */
export function fitHorizontalTicks(ticks, width, labelWidth, gap) {
  if (ticks.length <= 2 || !(width > 0 && labelWidth > 0)) return ticks;
  const ordered = [...ticks].sort((a, b) => a.frac - b.frac);
  const first = ordered[0];
  const last = ordered.at(-1);
  const kept = [first];
  let right = labelWidth;
  for (const tick of ordered.slice(1, -1)) {
    const center = tick.frac * width;
    if (center - labelWidth / 2 < right + gap) continue;
    if (center + labelWidth / 2 + gap > width - labelWidth) continue;
    kept.push(tick);
    right = center + labelWidth / 2;
  }
  kept.push(last);
  const keys = new Set(kept.map((tick) => tick.key));
  return ticks.filter((tick) => keys.has(tick.key));
}
