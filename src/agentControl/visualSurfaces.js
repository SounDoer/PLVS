import { normalizeVisualTarget } from "./visualControl.js";

export const VISUAL_SURFACE_ATTRIBUTE = "data-visual-capture-surface";
export const VISUAL_PANEL_ATTRIBUTE = "data-visual-panel-id";
export const VISUAL_SURFACE_READY_ATTRIBUTE = "data-visual-capture-ready";
export const VISUAL_SETTLEMENT_TIMEOUT_MS = 3000;

const WINDOW_LABELS = Object.freeze({
  main: "main",
  workspace: "main",
  panel: "main",
  dockHeader: "dock-header",
  dockEditor: "dock-editor",
});

function failure(reason, message) {
  return { ok: false, error: { reason, message } };
}

function viewportFor(windowObject, documentObject) {
  const root = documentObject?.documentElement;
  return {
    width: Math.max(0, Number(windowObject?.innerWidth) || Number(root?.clientWidth) || 0),
    height: Math.max(0, Number(windowObject?.innerHeight) || Number(root?.clientHeight) || 0),
  };
}

function isRendered(element, windowObject, viewport) {
  if (!element?.isConnected) return false;
  const style = windowObject?.getComputedStyle?.(element);
  if (style?.display === "none" || style?.visibility === "hidden") return false;
  const rect = element.getBoundingClientRect();
  return (
    Number.isFinite(rect.left) &&
    Number.isFinite(rect.top) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    rect.width > 0 &&
    rect.height > 0 &&
    rect.right > 0 &&
    rect.bottom > 0 &&
    rect.left < viewport.width &&
    rect.top < viewport.height
  );
}

function boundedRect(rect, viewport) {
  const left = Math.max(0, Math.min(viewport.width, rect.left));
  const top = Math.max(0, Math.min(viewport.height, rect.top));
  const right = Math.max(left, Math.min(viewport.width, rect.right));
  const bottom = Math.max(top, Math.min(viewport.height, rect.bottom));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function findPanelElement(documentObject, panelId, windowObject, viewport) {
  return Array.from(documentObject.querySelectorAll(`[${VISUAL_PANEL_ATTRIBUTE}]`)).find(
    (element) =>
      element.getAttribute(VISUAL_PANEL_ATTRIBUTE) === panelId &&
      isRendered(element, windowObject, viewport)
  );
}

export function resolveVisualSurface({
  target,
  workspace,
  documentObject = globalThis.document,
  windowObject = globalThis.window,
  windowLabel = "main",
}) {
  const normalized = normalizeVisualTarget(target);
  if (!normalized.ok) return failure("invalidParams", normalized.message);
  const semanticTarget = normalized.target;
  const expectedWindowLabel = WINDOW_LABELS[semanticTarget.kind];
  if (windowLabel !== expectedWindowLabel) {
    return failure("targetUnavailable", "The requested surface belongs to another PLVS WebView.");
  }

  if (semanticTarget.kind === "panel" && !workspace?.panelsById?.[semanticTarget.panelId]) {
    return failure("panelNotFound", `Panel ${semanticTarget.panelId} does not exist.`);
  }

  const viewport = viewportFor(windowObject, documentObject);
  let element;
  if (semanticTarget.kind === "panel") {
    element = findPanelElement(documentObject, semanticTarget.panelId, windowObject, viewport);
    if (!element) {
      return failure(
        "panelNotVisible",
        `Panel ${semanticTarget.panelId} is not currently rendered.`
      );
    }
  } else {
    element = documentObject.querySelector(
      `[${VISUAL_SURFACE_ATTRIBUTE}="${semanticTarget.kind}"]`
    );
    if (!element) return failure("targetUnavailable", "The requested surface is not mounted.");
  }

  const ready = element.getAttribute(VISUAL_SURFACE_READY_ATTRIBUTE) === "true";
  const rendered = isRendered(element, windowObject, viewport);
  const rect =
    semanticTarget.kind === "main"
      ? { x: 0, y: 0, width: viewport.width, height: viewport.height }
      : rendered
        ? boundedRect(element.getBoundingClientRect(), viewport)
        : { x: 0, y: 0, width: 0, height: 0 };

  return {
    ok: true,
    surface: {
      target: semanticTarget,
      element,
      windowLabel,
      ready,
      rendered,
      rect,
      viewport,
      devicePixelRatio: Number(windowObject?.devicePixelRatio) || 1,
    },
  };
}

function sameRect(left, right) {
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  );
}

function visibleCanvasesSettled(surface, windowObject) {
  const canvases = Array.from(surface.element.querySelectorAll("canvas"));
  if (surface.element.tagName === "CANVAS") canvases.unshift(surface.element);
  return canvases.every((canvas) => {
    const rect = canvas.getBoundingClientRect();
    if (!isRendered(canvas, windowObject, surface.viewport)) return true;
    if (!(canvas.width > 0 && canvas.height > 0 && rect.width > 0 && rect.height > 0)) return false;
    // Some renderers deliberately cap X and Y backing-store scale independently. The settlement
    // contract therefore checks that the current displayed box is the Canvas client box and that
    // both backing axes have been allocated; it must not assume backing size is CSS size × DPR.
    const clientWidth = Number(canvas.clientWidth) || rect.width;
    const clientHeight = Number(canvas.clientHeight) || rect.height;
    return Math.abs(clientWidth - rect.width) < 1 && Math.abs(clientHeight - rect.height) < 1;
  });
}

function nextAnimationFrame(windowObject, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Visual settlement was cancelled.", "AbortError"));
      return;
    }
    const onAbort = () => {
      windowObject.cancelAnimationFrame(frame);
      reject(new DOMException("Visual settlement was cancelled.", "AbortError"));
    };
    const frame = windowObject.requestAnimationFrame((timestamp) => {
      signal?.removeEventListener("abort", onAbort);
      resolve(timestamp);
    });
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function settleVisualSurface({
  target,
  workspace,
  expectedRevision,
  getRevision,
  signal,
  timeoutMs = VISUAL_SETTLEMENT_TIMEOUT_MS,
  documentObject = globalThis.document,
  windowObject = globalThis.window,
  windowLabel = "main",
}) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener("abort", cancel, { once: true });
  let timeout;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(
      () =>
        reject(
          Object.assign(new Error("The visual surface did not settle in time."), {
            reason: "renderNotSettled",
          })
        ),
      timeoutMs
    );
  });

  const settle = async () => {
    await documentObject.fonts?.ready;
    let previous = null;
    for (;;) {
      await nextAnimationFrame(windowObject, controller.signal);
      const resolved = resolveVisualSurface({
        target,
        workspace,
        documentObject,
        windowObject,
        windowLabel,
      });
      if (!resolved.ok) {
        if (
          resolved.error.reason === "panelNotFound" ||
          resolved.error.reason === "panelNotVisible"
        ) {
          throw Object.assign(new Error(resolved.error.message), resolved.error);
        }
        previous = null;
        continue;
      }
      const { surface } = resolved;
      const settled =
        surface.ready &&
        surface.rendered &&
        surface.rect.width > 0 &&
        surface.rect.height > 0 &&
        visibleCanvasesSettled(surface, windowObject);
      if (settled && previous && sameRect(previous.rect, surface.rect)) {
        const revision = getRevision();
        if (expectedRevision !== undefined && revision !== expectedRevision) {
          throw Object.assign(new Error("The Agent Control revision changed before capture."), {
            reason: "revisionConflict",
            details: { expectedRevision, currentRevision: revision },
          });
        }
        return {
          target: surface.target,
          windowLabel: surface.windowLabel,
          rect: surface.rect,
          viewport: surface.viewport,
          devicePixelRatio: surface.devicePixelRatio,
          revision,
        };
      }
      previous = settled ? surface : null;
    }
  };

  try {
    return await Promise.race([settle(), timeoutPromise]);
  } finally {
    clearTimeout(timeout);
    controller.abort();
    signal?.removeEventListener("abort", cancel);
  }
}

export function subscribeVisualSurfaceResize({
  target,
  workspace,
  onGeometry,
  documentObject = globalThis.document,
  windowObject = globalThis.window,
  windowLabel = "main",
}) {
  const initial = resolveVisualSurface({
    target,
    workspace,
    documentObject,
    windowObject,
    windowLabel,
  });
  if (!initial.ok) return () => {};
  const observer = new ResizeObserver(() => {
    const next = resolveVisualSurface({
      target,
      workspace,
      documentObject,
      windowObject,
      windowLabel,
    });
    if (next.ok) onGeometry(next.surface);
  });
  observer.observe(initial.surface.element);
  return () => observer.disconnect();
}
