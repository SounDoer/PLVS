/** Fit complete fields, preserving their priority order and reserving an overflow indicator. */
export function fitChartHud(widths, width, height, lineHeight, channelOverflow = false) {
  const gap = 8;
  const available = Math.max(0, width - 18);
  const verticalRows = Math.max(0, Math.floor((height - 10) / lineHeight));
  if (verticalRows >= widths.length && widths.every((w) => w <= available)) {
    return { horizontal: false, count: widths.length, overflow: null };
  }
  // Compact padding and leading recover a second row without reducing the text size.
  const rows = Math.max(0, Math.floor((height - 6) / ((lineHeight * 5) / 6)));
  const fits = (fields) => {
    let row = 1;
    let used = 0;
    for (const field of fields) {
      if (field > available) return false;
      if (used && used + gap + field > available) {
        row++;
        used = 0;
      }
      used += (used ? gap : 0) + field;
    }
    return row <= rows;
  };
  if (fits(widths)) return { horizontal: true, count: widths.length, overflow: null };
  for (let count = widths.length - 1; count >= 0; count--) {
    const omitted = widths.length - Math.max(1, count);
    const overflow = channelOverflow ? `+${omitted} ch` : "…";
    const markerWidth = channelOverflow ? overflow.length * lineHeight * 0.4 : lineHeight;
    if (fits([...widths.slice(0, count), markerWidth])) {
      return { horizontal: true, count, overflow };
    }
  }
  return { horizontal: true, count: 0, overflow: "…" };
}

/** Move the HUD to the right corner while the cursor would read through it in the left one. */
export function chartHudSide(cursor, hud, margin = 12) {
  if (!cursor) return "left";
  const near = (x) =>
    cursor.x >= x - margin &&
    cursor.x <= x + hud.width + margin &&
    cursor.y >= hud.top - margin &&
    cursor.y <= hud.top + hud.height + margin;
  return near(hud.left) && !near(hud.boundaryWidth - hud.right - hud.width) ? "right" : "left";
}
