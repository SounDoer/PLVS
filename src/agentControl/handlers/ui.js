import { semanticFailure } from "../bridge/failures.js";
import { isUiTargetId, listUiTargets, resolveUiTarget } from "../../uiNavigation/uiTargets.js";

/** @param {import("../bridge/types.js").BridgeContext} ctx */
async function inspect(ctx) {
  const { requestId, clock } = ctx;
  const { uiNavigation } = ctx.snap;
  if (!uiNavigation?.inspectUi) {
    throw semanticFailure(
      "surfaceUnavailable",
      "$.method",
      "UI Navigation is unavailable in the current app state.",
      -32042
    );
  }
  return {
    requestId,
    result: { revision: clock.current(), ...uiNavigation.inspectUi() },
  };
}

/** @param {import("../bridge/types.js").BridgeContext} ctx */
async function targets(ctx) {
  const { requestId, clock, live } = ctx;
  const accessory = (live().pointerControl?.accessoryTargets?.() ?? []).map(({ id, surface }) => ({
    id,
    kind: id.split(":")[0],
    surface,
  }));
  return {
    requestId,
    result: {
      revision: clock.current(),
      targets: [...listUiTargets().map((target) => ({ ...target, surface: "main" })), ...accessory],
    },
  };
}

/** @param {import("../bridge/types.js").BridgeContext} ctx */
async function locate(ctx) {
  const { request, requestId, clock, live } = ctx;
  const { target } = request.params;
  const located = isUiTargetId(target)
    ? resolveUiTarget(target, live().pointerControl?.accessoryTargets)
    : { found: false };
  if (!located.found) {
    throw semanticFailure(
      "uiTargetNotFound",
      "$.params.target",
      `No mounted control declares the target ${target}.`,
      -32042,
      { target }
    );
  }
  return {
    requestId,
    result: {
      revision: clock.current(),
      target,
      surface: located.surface,
      visible: located.visible,
      rect: located.rect,
      viewport: located.viewport,
      ...("state" in located && located.state ? { state: located.state } : {}),
    },
  };
}

/** @param {import("../bridge/types.js").BridgeContext} ctx */
async function navigate(ctx) {
  const { request, requestId, clock } = ctx;
  const { uiNavigation } = ctx.snap;
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
  if (!uiNavigation?.inspectUi) {
    throw semanticFailure(
      "surfaceUnavailable",
      "$.method",
      "UI Navigation is unavailable in the current app state.",
      -32042
    );
  }
  try {
    const actionResult =
      request.method === "ui.show.settings"
        ? await uiNavigation.showSettings(request.params)
        : request.method === "ui.show.panelSettings"
          ? await uiNavigation.showPanelSettings(request.params)
          : request.method === "ui.show.themeEditor"
            ? await uiNavigation.showThemeEditor(request.params)
            : request.method === "ui.show.loudnessProfileEditor"
              ? await uiNavigation.showLoudnessProfileEditor(request.params)
              : request.method === "ui.show.feedback"
                ? await uiNavigation.showFeedback(request.params)
                : request.method === "ui.show.toolbarMenu"
                  ? await uiNavigation.showToolbarMenu(request.params)
                  : request.method === "ui.show.dockToolbar"
                    ? await uiNavigation.showDockToolbar(request.params)
                    : request.method === "ui.show.panelHelp"
                      ? await uiNavigation.showPanelHelp(request.params)
                      : request.method === "ui.show.addPanel"
                        ? await uiNavigation.showAddPanel(request.params)
                        : request.method === "ui.show.sourceGroup"
                          ? await uiNavigation.showSourceGroup(request.params)
                          : request.method === "ui.show.dropdown"
                            ? await uiNavigation.showDropdown(request.params)
                            : request.method.startsWith("ui.quickTour.")
                              ? await uiNavigation.stepQuickTour({
                                  ...request.params,
                                  action: request.method.slice("ui.quickTour.".length),
                                })
                              : request.method === "ui.close"
                                ? await uiNavigation.closeSurface(request.params)
                                : await uiNavigation.cancelSurface(request.params);
    const ui = uiNavigation.inspectUi();
    return {
      requestId,
      result: {
        ...actionResult,
        changed: actionResult?.changed !== false,
        action: actionResult?.action ?? request.method,
        revision: clock.current(),
        uiGeneration: ui.uiGeneration,
        ui,
      },
    };
  } catch (error) {
    if (typeof error?.reason !== "string") throw error;
    throw semanticFailure(
      error.reason,
      error.reason === "uiGenerationConflict" ? "$.params.expectedUiGeneration" : "$.params",
      error.message,
      error.reason === "revisionConflict" ? -32004 : -32042,
      {
        ...error.details,
        currentRevision: clock.current(),
        currentUiGeneration: uiNavigation.inspectUi().uiGeneration,
      }
    );
  }
}

/** @type {Record<string, import("../bridge/types.js").HandlerEntry>} */
export const uiHandlers = {
  "ui.inspect": { run: inspect },
  "ui.show.settings": { run: navigate },
  "ui.show.panelSettings": { run: navigate },
  "ui.show.themeEditor": { run: navigate },
  "ui.show.loudnessProfileEditor": { run: navigate },
  "ui.show.feedback": { run: navigate },
  "ui.show.toolbarMenu": { run: navigate },
  "ui.show.dockToolbar": { run: navigate },
  "ui.show.panelHelp": { run: navigate },
  "ui.show.addPanel": { run: navigate },
  "ui.show.sourceGroup": { run: navigate },
  "ui.show.dropdown": { run: navigate },
  "ui.quickTour.start": { run: navigate },
  "ui.quickTour.next": { run: navigate },
  "ui.quickTour.back": { run: navigate },
  "ui.targets": { run: targets },
  "ui.locate": { run: locate },
  "ui.close": { run: navigate },
  "ui.cancel": { run: navigate },
};
