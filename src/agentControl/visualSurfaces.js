import { normalizeVisualTarget } from "./visualControl.js";
import { findVisibleUiTarget } from "../uiNavigation/uiTargets.js";

export const VISUAL_SURFACE_ATTRIBUTE = "data-visual-capture-surface";
export const VISUAL_PANEL_ATTRIBUTE = "data-visual-panel-id";
export const VISUAL_SURFACE_READY_ATTRIBUTE = "data-visual-capture-ready";
export const VISUAL_SETTLEMENT_TIMEOUT_MS = 3000;
/**
 * How long settlement waits for a first animation frame before asking the native side to reveal
 * the window without focus. A hidden, minimized or fully covered WebView produces no frames.
 */
export const VISUAL_REVEAL_GRACE_MS = 150;

const WINDOW_LABELS = Object.freeze({
  main: "main",
  named: "main",
  workspace: "main",
  panel: "main",
  dockHeader: "dock-header",
  dockEditor: "dock-editor",
  dockUpdate: "dock-update",
  dockSettings: "dock-settings",
});

/**
 * @param {string} reason
 * @param {string} message
 */
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
  let readinessElement;
  if (semanticTarget.kind === "panel") {
    element = findPanelElement(documentObject, semanticTarget.panelId, windowObject, viewport);
    if (!element) {
      return failure(
        "panelNotVisible",
        `Panel ${semanticTarget.panelId} is not currently rendered.`
      );
    }
  } else if (semanticTarget.kind === "named") {
    element = findVisibleUiTarget(semanticTarget.targetId, documentObject, windowObject);
    if (!element) return failure("targetUnavailable", "The named UI target is not visible.");
    readinessElement = documentObject.querySelector(`[${VISUAL_SURFACE_ATTRIBUTE}="main"]`);
  } else {
    element = documentObject.querySelector(
      `[${VISUAL_SURFACE_ATTRIBUTE}="${semanticTarget.kind}"]`
    );
    if (!element) return failure("targetUnavailable", "The requested surface is not mounted.");
  }

  const ready =
    (readinessElement ?? element).getAttribute(VISUAL_SURFACE_READY_ATTRIBUTE) === "true";
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

const OCCLUSION_GRID = 4;

/**
 * How much of a Panel or named target something else is drawn over, such as a menu, popover or
 * dialog left open above it, sampled on a grid of points. The screenshot captures those pixels as
 * they are; this lets the result say so. Elements that ignore the pointer, such as tooltips, are not
 * seen.
 */
export function coveredPercentOf(surface, documentObject) {
  const { target, element, rect } = surface;
  if (target.kind !== "panel" && target.kind !== "named") return 0;
  if (typeof documentObject?.elementFromPoint !== "function") return 0;
  if (!(rect.width > 0 && rect.height > 0)) return 0;
  let covered = 0;
  for (let row = 0; row < OCCLUSION_GRID; row += 1) {
    for (let column = 0; column < OCCLUSION_GRID; column += 1) {
      const x = rect.x + ((column + 0.5) * rect.width) / OCCLUSION_GRID;
      const y = rect.y + ((row + 0.5) * rect.height) / OCCLUSION_GRID;
      const hit = documentObject.elementFromPoint(x, y);
      if (hit && hit !== element && !element.contains(hit)) covered += 1;
    }
  }
  return Math.round((covered * 100) / (OCCLUSION_GRID * OCCLUSION_GRID));
}

function sameRect(left, right) {
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  );
}

function findUnsettledCanvas(surface, windowObject) {
  const canvases = Array.from(surface.element.querySelectorAll("canvas"));
  if (surface.element.tagName === "CANVAS") canvases.unshift(surface.element);
  for (const canvas of canvases) {
    const rect = canvas.getBoundingClientRect();
    if (!isRendered(canvas, windowObject, surface.viewport)) continue;
    // Some renderers deliberately cap X and Y backing-store scale independently. The settlement
    // contract therefore checks that the current displayed box is the Canvas client box and that
    // both backing axes have been allocated; it must not assume backing size is CSS size × DPR.
    const clientWidth = Number(canvas.clientWidth) || rect.width;
    const clientHeight = Number(canvas.clientHeight) || rect.height;
    if (
      !(canvas.width > 0 && canvas.height > 0 && rect.width > 0 && rect.height > 0) ||
      Math.abs(clientWidth - rect.width) >= 1 ||
      Math.abs(clientHeight - rect.height) >= 1
    ) {
      return {
        width: rect.width,
        height: rect.height,
        clientWidth,
        clientHeight,
        backingWidth: canvas.width,
        backingHeight: canvas.height,
      };
    }
  }
  return null;
}

function visibleTransitionsSettled({ rect, element }) {
  // Floating surfaces are portalled to the document, outside the target's DOM subtree.
  const transitions = element.ownerDocument.querySelectorAll("[data-visual-capture-transition]");
  return Array.from(transitions).every((overlay) => {
    if (
      !overlay
        .getAnimations?.()
        .some((animation) => animation.pending || animation.playState === "running")
    ) {
      return true;
    }
    const bounds = overlay.getBoundingClientRect();
    return (
      bounds.right <= rect.x ||
      bounds.bottom <= rect.y ||
      bounds.left >= rect.x + rect.width ||
      bounds.top >= rect.y + rect.height
    );
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

/**
 * @param {{
 *   target: any,
 *   workspace: any,
 *   expectedRevision: number,
 *   getRevision: (...args: any[]) => any,
 *   expectedUiGeneration?: number,
 *   getUiGeneration?: () => number,
 *   signal: AbortSignal,
 *   timeoutMs?: number,
 *   documentObject?: Document,
 *   windowObject?: Window & typeof globalThis,
 *   windowLabel?: string,
 *   reveal?: (() => unknown) | null,
 *   revealGraceMs?: number,
 *   revealRequested?: boolean,
 * }} options
 */
export async function settleVisualSurface({
  target,
  workspace,
  expectedRevision,
  getRevision,
  expectedUiGeneration,
  getUiGeneration = () => 0,
  signal,
  timeoutMs = VISUAL_SETTLEMENT_TIMEOUT_MS,
  documentObject = globalThis.document,
  windowObject = globalThis.window,
  windowLabel = "main",
  reveal = null,
  revealGraceMs = VISUAL_REVEAL_GRACE_MS,
  revealRequested = false,
}) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener("abort", cancel, { once: true });
  let stage = "fonts";
  let frames = 0;
  let canvas = null;
  let revealed = revealRequested;
  let timeout;
  // Frames stop while the window cannot be seen. Reveal it once, never taking keyboard focus.
  const requestReveal = () => {
    if (revealed || frames > 0 || typeof reveal !== "function") return;
    revealed = true;
    Promise.resolve()
      .then(reveal)
      .catch(() => {});
  };
  let revealTimer = null;
  if (documentObject.visibilityState !== "visible") requestReveal();
  else revealTimer = setTimeout(requestReveal, revealGraceMs);
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(
      () =>
        reject(
          Object.assign(new Error("The visual surface did not settle in time."), {
            reason: "renderNotSettled",
            details: {
              stage,
              frames,
              visible: documentObject.visibilityState === "visible",
              focused: documentObject.hasFocus?.() === true,
              canvas,
              revealed,
            },
          })
        ),
      timeoutMs
    );
  });

  const settle = async () => {
    await documentObject.fonts?.ready;
    stage = "firstFrame";
    let previous = null;
    for (;;) {
      await nextAnimationFrame(windowObject, controller.signal);
      frames++;
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
          resolved.error.reason === "panelNotVisible" ||
          (target.kind === "named" && resolved.error.reason === "targetUnavailable")
        ) {
          throw Object.assign(new Error(resolved.error.message), resolved.error);
        }
        previous = null;
        stage = "target";
        continue;
      }
      const { surface } = resolved;
      const ready =
        surface.ready && surface.rendered && surface.rect.width > 0 && surface.rect.height > 0;
      const transitionsSettled = ready && visibleTransitionsSettled(surface);
      canvas = transitionsSettled ? findUnsettledCanvas(surface, windowObject) : null;
      const settled = transitionsSettled && canvas === null;
      stage = !ready ? "target" : !transitionsSettled ? "transition" : canvas ? "canvas" : "bounds";
      if (settled && previous && sameRect(previous.rect, surface.rect)) {
        const revision = getRevision();
        if (expectedRevision !== undefined && revision !== expectedRevision) {
          throw Object.assign(new Error("The Agent Control revision changed before capture."), {
            reason: "revisionConflict",
            details: { expectedRevision, currentRevision: revision },
          });
        }
        const uiGeneration = getUiGeneration();
        if (expectedUiGeneration !== undefined && uiGeneration !== expectedUiGeneration) {
          throw Object.assign(new Error("The visible UI changed before capture."), {
            reason: "uiGenerationConflict",
            details: { expectedUiGeneration, currentUiGeneration: uiGeneration },
          });
        }
        const coveredPercent = coveredPercentOf(surface, documentObject);
        return {
          target: surface.target,
          windowLabel: surface.windowLabel,
          rect: surface.rect,
          viewport: surface.viewport,
          devicePixelRatio: surface.devicePixelRatio,
          revision,
          uiGeneration,
          ...(coveredPercent > 0 ? { coveredPercent } : {}),
        };
      }
      previous = settled ? surface : null;
    }
  };

  try {
    return await Promise.race([settle(), timeoutPromise]);
  } finally {
    clearTimeout(timeout);
    clearTimeout(revealTimer);
    controller.abort();
    signal?.removeEventListener("abort", cancel);
  }
}

export function subscribeVisualSurfaceResize({
  target,
  workspace,
  onGeometry,
  dockEdgeListeners = undefined,
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
  const publishGeometry = (edge) => {
    const next = resolveVisualSurface({
      target,
      workspace,
      documentObject,
      windowObject,
      windowLabel,
    });
    if (next.ok) onGeometry(next.surface, edge);
  };
  const onResize = () => publishGeometry(undefined);
  const observer = new ResizeObserver(onResize);
  observer.observe(initial.surface.element);
  // A WebView using macOS full-size content can change its viewport while the observed semantic
  // element briefly retains the same rounded box. The window event keeps native crop geometry in
  // sync across that transition; duplicate updates are harmless and remain bounded.
  windowObject.addEventListener("resize", onResize);
  dockEdgeListeners?.add(publishGeometry);
  return () => {
    observer.disconnect();
    windowObject.removeEventListener("resize", onResize);
    dockEdgeListeners?.delete(publishGeometry);
  };
}
