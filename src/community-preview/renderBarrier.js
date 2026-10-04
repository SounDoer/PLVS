const STABLE_FRAMES = 3;

function nextFrame(requestFrame) {
  return new Promise((resolve) => requestFrame(resolve));
}

/**
 * Yields behind everything already posted. React schedules its renders as posted messages, and
 * messages run in posting order, so a render requested during the frame has run by the time this
 * resolves. A timer gives no such ordering.
 */
function postedTasks() {
  return new Promise((resolve) => {
    const { port1, port2 } = new MessageChannel();
    port1.onmessage = () => {
      port1.close();
      resolve();
    };
    port2.postMessage(null);
  });
}

function sceneSignature(document, canvases, readCanvas) {
  return [
    document.body.innerHTML,
    ...canvases.map((canvas) => `${canvas.width}x${canvas.height}:${readCanvas(canvas)}`),
  ].join("\n");
}

/**
 * Resolves once the scene has stopped changing. A fixed number of frames is not enough: a canvas
 * takes its device-pixel size from a ResizeObserver a frame after it mounts, resizing clears it,
 * and the redraw arrives in a later task. A screenshot taken in between shows an empty plot. So the
 * barrier compares the markup and every canvas's size and pixels frame by frame and waits until
 * they repeat.
 */
export async function settleCommunityPreviewRender({
  document,
  requestFrame,
  readCanvas = (canvas) => canvas.toDataURL(),
  maxFrames = 240,
}) {
  await (document.fonts?.ready ?? Promise.resolve());
  let previous = null;
  let stable = 0;
  for (let frame = 0; frame < maxFrames; frame += 1) {
    await nextFrame(requestFrame);
    await postedTasks();
    const canvases = [...document.querySelectorAll("canvas")];
    const signature = sceneSignature(document, canvases, readCanvas);
    stable = signature === previous ? stable + 1 : 1;
    previous = signature;
    if (stable < STABLE_FRAMES) continue;
    for (const canvas of canvases) {
      if (canvas.width < 1 || canvas.height < 1) {
        throw new Error("A Community preview canvas did not settle to a drawable size.");
      }
    }
    return { canvasCount: canvases.length };
  }
  throw new Error("The Community preview scene did not settle.");
}
