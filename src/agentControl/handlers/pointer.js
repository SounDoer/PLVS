import { semanticFailure } from "../bridge/failures.js";
import { isUiTargetId, resolveUiTarget } from "../../uiNavigation/uiTargets.js";

export const POINTER_DURATION_DEFAULT_MS = 600;
export const POINTER_DURATION_MAX_MS = 3000;

/**
 * Moves the system pointer onto a named target for unattended tutorial recording. It never presses,
 * scrolls or types (ADR 0043): the action that follows is a separate Agent Control command.
 *
 * @param {import("../bridge/types.js").BridgeContext} ctx
 */
async function move(ctx) {
  const { request, requestId, clock, live } = ctx;
  const currentRevision = clock.current();
  if (request.params.expectedRevision !== currentRevision) {
    throw semanticFailure(
      "revisionConflict",
      "$.params.expectedRevision",
      `App state changed after revision ${request.params.expectedRevision}.`,
      -32004,
      { expectedRevision: request.params.expectedRevision, currentRevision }
    );
  }
  const pointerControl = live().pointerControl;
  if (!pointerControl?.available) {
    throw semanticFailure(
      "controlUnavailable",
      "$.method",
      "Moving the pointer is unavailable on this platform.",
      -32012
    );
  }
  if (!pointerControl.windowVisible) {
    throw semanticFailure("uiTargetNotVisible", "$.params.target", "The window is hidden.", -32042);
  }
  const { target } = request.params;
  let located = isUiTargetId(target)
    ? resolveUiTarget(target, pointerControl.accessoryTargets)
    : { found: false };
  if (!located.found && target.startsWith("toolbar:") && pointerControl.revealToolbar) {
    // Auto-hide Controls unmounts the toolbar; reveal it as the pointer heading there would.
    pointerControl.revealToolbar();
    const deadline = Date.now() + 1000;
    while (!located.found && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 16));
      located = resolveUiTarget(target, pointerControl.accessoryTargets);
    }
  }
  if (!located.found) {
    throw semanticFailure(
      "uiTargetNotFound",
      "$.params.target",
      `No mounted control declares the target ${target}.`,
      -32042,
      { target }
    );
  }
  if (!located.visible) {
    throw semanticFailure(
      "uiTargetNotVisible",
      "$.params.target",
      `The target ${target} is not on screen.`,
      -32042,
      { target }
    );
  }
  const point = {
    x: located.rect.x + located.rect.width / 2,
    y: located.rect.y + located.rect.height / 2,
  };
  const durationMs = request.params.durationMs ?? POINTER_DURATION_DEFAULT_MS;
  await pointerControl.move({
    ...point,
    durationMs,
    webviewScale: pointerControl.scale(),
    windowLabel: located.surface,
  });
  return {
    requestId,
    result: {
      revision: clock.current(),
      target,
      surface: located.surface,
      point,
      durationMs,
      rect: located.rect,
    },
  };
}

/** @type {Record<string, import("../bridge/types.js").HandlerEntry>} */
export const pointerHandlers = {
  "pointer.move": { run: move },
};
