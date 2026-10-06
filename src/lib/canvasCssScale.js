/**
 * Backing-store pixels per CSS pixel, per axis, read from the canvas itself.
 *
 * Visual sizes in PLVS are CSS px (see "Screen-space sizes" in docs/architecture.md). The global
 * devicePixelRatio is the wrong conversion wherever a backing store is capped, and the Waveform caps
 * width only, so the two axes can differ.
 */
/**
 * Backing-store pixels per CSS pixel, per axis, read from the canvas itself.
 *
 * Visual sizes in PLVS are CSS px (see "Screen-space sizes" in docs/architecture.md). The global
 * devicePixelRatio is the wrong conversion wherever a backing store is capped, and the Waveform caps
 * width only, so the two axes can differ.
 */
export function canvasCssScale(canvas) {
  return {
    x: canvas.clientWidth > 0 ? canvas.width / canvas.clientWidth : 1,
    y: canvas.clientHeight > 0 ? canvas.height / canvas.clientHeight : 1,
  };
}

/**
 * Strokes the current path at `ctx.lineWidth` CSS px.
 *
 * The path keeps the backing-store coordinates it was built with -- a transform set after the path
 * only shapes the pen. Scaling the pen per axis keeps it round on screen when the axes differ, where
 * a plain stroke would be N px wide horizontally but N / scaleY px tall. Assumes the identity
 * transform, which every PLVS canvas renderer draws under.
 */
/**
 * Strokes the current path at `ctx.lineWidth` CSS px.
 *
 * The path keeps the backing-store coordinates it was built with -- a transform set after the path
 * only shapes the pen. Scaling the pen per axis keeps it round on screen when the axes differ, where
 * a plain stroke would be N px wide horizontally but N / scaleY px tall. Assumes the identity
 * transform, which every PLVS canvas renderer draws under.
 */
export function strokeCssWidth(ctx, scale) {
  ctx.setTransform(scale.x, 0, 0, scale.y, 0, 0);
  ctx.stroke();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
