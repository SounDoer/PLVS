import {
  buildWindowInspection,
  planWindowMove,
  planWindowResize,
  windowPositionSettled,
  windowSizeSettled,
} from "../windowControl.js";
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
  const [geometry, monitors] = await Promise.all([
    windowControl.readGeometry(),
    windowControl.readMonitors?.() ?? [],
  ]);
  return {
    requestId,
    result: {
      revision: clock.current(),
      ...buildWindowInspection(windowControl, geometry),
      // The choices `window move` accepts, with each work area in that monitor's CSS pixels.
      monitors: monitors.map(({ id, scale, workArea }) => ({
        id,
        workArea: {
          width: Math.floor(workArea.width / scale),
          height: Math.floor(workArea.height / scale),
        },
      })),
    },
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

function refuseDock(windowControl, subject) {
  if (windowControl.form !== "normal") {
    throw semanticFailure(
      "dockActive",
      "$.method",
      `${subject} applies to the normal window, not Dock.`,
      -32012
    );
  }
}

async function inspected(ctx, changed) {
  const { requestId, clock, live } = ctx;
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
async function move(ctx) {
  const { request, clock, live } = ctx;
  requireRevision(request, clock);
  const windowControl = requireWindow(live().windowControl);
  const target = { monitor: request.params.monitor, x: request.params.x, y: request.params.y };
  const geometry = await windowControl.readGeometry();
  if (geometry.minimized) {
    throw semanticFailure(
      "windowMinimized",
      "$.method",
      "Show the window before moving it; a minimized window has no position to set.",
      -32012
    );
  }
  if (!geometry.maximized && windowPositionSettled(geometry, target)) {
    return inspected(ctx, false);
  }
  const planned = planWindowMove(
    windowControl,
    geometry,
    await windowControl.readMonitors(),
    target
  );
  if (planned.refusal === "dockActive") refuseDock(windowControl, "Window position");
  if (planned.refusal === "monitorNotFound") {
    throw semanticFailure(
      "monitorNotFound",
      "$.params.monitor",
      `Monitor ${target.monitor} is not connected.`,
      -32010,
      { monitor: target.monitor }
    );
  }
  if (planned.refusal) {
    throw semanticFailure(
      planned.refusal,
      "$.params",
      "The window would not fit inside that monitor's work area at this position.",
      -32012,
      target
    );
  }
  await windowControl.moveTo(planned.target);
  await settle(
    async () => windowPositionSettled(await windowControl.readGeometry(), target),
    "uiNotSettled"
  );
  return inspected(ctx, true);
}

/**
 * Maximize, Restore and Minimize, as the title bar and the system do. Each is idempotent; showing
 * a minimized window is `window show`.
 *
 * @param {import("../bridge/types.js").BridgeContext} ctx
 */
async function setWindowState(ctx) {
  const { request, clock, live } = ctx;
  requireRevision(request, clock);
  const windowControl = requireWindow(live().windowControl);
  refuseDock(windowControl, "Window state");
  if (!windowControl.visible) {
    throw semanticFailure(
      "windowHidden",
      "$.method",
      "Show the window before changing its state.",
      -32012
    );
  }
  const geometry = await windowControl.readGeometry();
  const action = request.method.slice("window.".length);
  if (action !== "minimize" && geometry.minimized) {
    throw semanticFailure(
      "windowMinimized",
      "$.method",
      "Show the window before maximizing or restoring it.",
      -32012
    );
  }
  const reached = (current) =>
    action === "maximize"
      ? current.maximized
      : action === "unmaximize"
        ? !current.maximized
        : current.minimized === true;
  if (reached(geometry)) return inspected(ctx, false);
  await windowControl[action]();
  await settle(async () => reached(await windowControl.readGeometry()), "uiNotSettled");
  return inspected(ctx, true);
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
  "window.move": { run: move },
  "window.maximize": { run: setWindowState },
  "window.unmaximize": { run: setWindowState },
  "window.minimize": { run: setWindowState },
  "window.hide": { run: setVisibility },
  "window.show": { run: setVisibility },
};
