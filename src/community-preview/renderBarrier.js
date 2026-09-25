function nextFrame(requestFrame) {
  return new Promise((resolve) => requestFrame(resolve));
}

export async function settleCommunityPreviewRender({ document, requestFrame }) {
  await (document.fonts?.ready ?? Promise.resolve());
  await nextFrame(requestFrame);
  await nextFrame(requestFrame);
  const canvases = [...document.querySelectorAll("canvas")];
  for (const canvas of canvases) {
    if (canvas.width < 1 || canvas.height < 1) {
      throw new Error("A Community preview canvas did not settle to a drawable size.");
    }
  }
  return { canvasCount: canvases.length };
}
