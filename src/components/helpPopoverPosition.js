// Keep the trigger reachable for pin/unpin. A long reference can use the full window alongside
// it; in a narrow window, use the larger vertical side and scroll rather than covering the button.
export function helpPopoverPlacement(rect, width, contentHeight, viewport, margin, gap) {
  const fullHeight = Math.max(0, viewport.height - 2 * margin);
  const height = Math.min(contentHeight, fullHeight);
  const above = Math.max(0, rect.top - gap - margin);
  const below = Math.max(0, viewport.height - margin - rect.bottom - gap);
  const left = Math.max(margin, Math.min(rect.right - width, viewport.width - margin - width));
  if (height <= below) return { left, top: rect.bottom + gap, maxHeight: fullHeight };
  if (height <= above) return { left, top: rect.top - gap - height, maxHeight: fullHeight };
  const top = Math.max(margin, Math.min(rect.bottom + gap, viewport.height - margin - height));
  if (rect.left - gap - width >= margin) {
    return { left: rect.left - gap - width, top, maxHeight: fullHeight };
  }
  if (rect.right + gap + width <= viewport.width - margin) {
    return { left: rect.right + gap, top, maxHeight: fullHeight };
  }
  return below >= above
    ? { left, top: rect.bottom + gap, maxHeight: below }
    : { left, top: margin, maxHeight: above };
}
