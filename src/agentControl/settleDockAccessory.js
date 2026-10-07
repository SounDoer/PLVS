function nextPaint(signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Visual settlement was cancelled.", "AbortError"));
      return;
    }
    const onAbort = () => {
      cancelAnimationFrame(frame);
      reject(new DOMException("Visual settlement was cancelled.", "AbortError"));
    };
    const frame = requestAnimationFrame(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    });
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function settleDockAccessory(target, runtime, options) {
  const geometry = runtime?.accessoryGeometry?.[target.kind];
  if (!geometry?.visible || !(geometry.width > 0 && geometry.height > 0)) {
    throw Object.assign(new Error("The requested Dock accessory is unavailable."), {
      reason: "targetUnavailable",
    });
  }
  await document.fonts?.ready;
  await nextPaint(options.signal);
  await nextPaint(options.signal);
  const revision = options.getRevision();
  if (options.expectedRevision !== undefined && revision !== options.expectedRevision) {
    throw Object.assign(new Error("The Agent Control revision changed before capture."), {
      reason: "revisionConflict",
      details: { expectedRevision: options.expectedRevision, currentRevision: revision },
    });
  }
  const uiGeneration = options.getUiGeneration?.() ?? 0;
  if (options.expectedUiGeneration !== undefined && uiGeneration !== options.expectedUiGeneration) {
    throw Object.assign(new Error("The visible UI changed before capture."), {
      reason: "uiGenerationConflict",
      details: {
        expectedUiGeneration: options.expectedUiGeneration,
        currentUiGeneration: uiGeneration,
      },
    });
  }
  const viewport = { width: geometry.width, height: geometry.height };
  return {
    target,
    windowLabel: target.kind === "dockHeader" ? "dock-header" : "dock-editor",
    rect: { x: 0, y: 0, ...viewport },
    viewport,
    devicePixelRatio: window.devicePixelRatio || 1,
    revision,
    uiGeneration,
  };
}
