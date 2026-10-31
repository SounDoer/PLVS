import { buildWindowInspection, planWindowResize, windowSizeSettled } from "../windowControl.js";
import { semanticFailure } from "../bridge/failures.js";

const SETTLE_TIMEOUT_MS = 3000;

function requireWindow(windowControl) {
  if (!windowControl?.available) {
    throw semanticFailure(
      "controlUnavailable",
      "$.method",
      "Window Control is unavailable in this app.",
      -32012
    );
  }
  return windowControl;
}

function requireRevision(request, clock) {
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
}

async function settle(check, reason) {
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  while (!(await check())) {
    if (Date.now() >= deadline) {
      throw semanticFailure(reason, "$.params", "The window did not settle in time.", -32042);
    }
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
}

/** @param {import("../bridge/types.js").BridgeContext} ctx */
async function inspect(ctx) {
  const { requestId, clock, live } = ctx;
  const windowControl = requireWindow(live().windowControl);
  const geometry = await windowControl.readGeometry();
  return {
    requestId,
    result: { revision: clock.current(), ...buildWindowInspection(windowControl, geometry) },
  };
}

/** @param {import("../bridge/types.js").BridgeContext} ctx */
async function resize(ctx) {
  const { request, requestId, clock, live } = ctx;
  requireRevision(request, clock);
  const windowControl = requireWindow(live().windowControl);
  const size = { width: request.params.width, height: request.params.height };
  const geometry = await windowControl.readGeometry();
  let changed = false;
  if (geometry.maximized || !windowSizeSettled(geometry.viewport, size)) {
    const planned = planWindowResize(windowControl, geometry, size);
    if (planned.refusal === "dockActive") {
      throw semanticFailure(
        "dockActive",
        "$.method",
        "Window size applies to the normal window, not Dock.",
        -32012
      );
    }
    if (planned.refusal) {
      throw semanticFailure(
        planned.refusal,
        "$.params",
        "The requested window does not fit the current monitor's work area.",
        -32012,
        { width: size.width, height: size.height }
      );
    }
    await windowControl.applyBounds(planned.bounds);
    await settle(
      async () => windowSizeSettled((await windowControl.readGeometry()).viewport, size),
      "uiNotSettled"
    );
    changed = true;
  }
  const after = await live().windowControl.readGeometry();
  return {
    requestId,
    result: {
      revision: clock.current(),
      changed,
      ...buildWindowInspection(live().windowControl, after),
    },
  };
}

/** @param {import("../bridge/types.js").BridgeContext} ctx */
async function setVisibility(ctx) {
  const { request, requestId, clock, live } = ctx;
  requireRevision(request, clock);
  const windowControl = requireWindow(live().windowControl);
  const visible = request.method === "window.show";
  const wasVisible = windowControl.visible;
  // Show always runs: it also raises a visible but minimized or covered window.
  if (wasVisible !== visible || visible) {
    const accepted = visible ? await windowControl.show() : await windowControl.hide();
    if (accepted === false) {
      throw semanticFailure(
        "busy",
        "$.method",
        "The window cannot be hidden while PLVS is busy.",
        -32012
      );
    }
    await settle(async () => live().windowControl.visible === visible, "uiNotSettled");
  }
  return {
    requestId,
    result: {
      revision: clock.current(),
      changed: wasVisible !== visible,
      form: live().windowControl.form,
      visible: live().windowControl.visible,
    },
  };
}

/** @type {Record<string, import("../bridge/types.js").HandlerEntry>} */
export const windowHandlers = {
  "window.inspect": { run: inspect },
  "window.resize": { run: resize },
  "window.hide": { run: setVisibility },
  "window.show": { run: setVisibility },
};
