import { semanticFailure } from "../bridge/failures.js";

function updateSurface(ui, phase = null) {
  return ui.surfaces.find(
    (surface) => surface.kind === "update" && (phase === null || surface.target?.phase === phase)
  );
}

/** @param {import("../bridge/types.js").BridgeContext} ctx */
async function act(ctx) {
  const { request, requestId, clock } = ctx;
  const { developmentUpdate, uiNavigation } = ctx.snap;
  const ui = uiNavigation?.inspectUi?.();
  if (!developmentUpdate?.enabled || !ui) {
    throw semanticFailure(
      "controlUnavailable",
      "$.method",
      "Packaged update acceptance controls are unavailable.",
      -32040
    );
  }
  if (request.params.expectedRevision !== clock.current()) {
    throw semanticFailure(
      "revisionConflict",
      "$.params.expectedRevision",
      "The Agent Control revision changed.",
      -32004,
      { expectedRevision: request.params.expectedRevision, currentRevision: clock.current() }
    );
  }
  if (request.params.expectedUiGeneration !== ui.uiGeneration) {
    throw semanticFailure(
      "uiGenerationConflict",
      "$.params.expectedUiGeneration",
      "The visible UI changed before the update action.",
      -32042,
      {
        expectedUiGeneration: request.params.expectedUiGeneration,
        currentUiGeneration: ui.uiGeneration,
      }
    );
  }

  if (request.method === "dev.update.preferences") {
    const surface = updateSurface(ui, "preferences");
    if (!surface || surface.surfaceId !== request.params.surfaceId) {
      throw semanticFailure(
        "uiSurfaceNotFound",
        "$.params.surfaceId",
        "The exact update-preferences surface is not open.",
        -32042
      );
    }
    await developmentUpdate.setPreferences({
      autoCheck: request.params.autoCheck,
      autoDownload: request.params.autoDownload,
    });
  } else if (request.method === "dev.update.open") {
    developmentUpdate.open();
  } else if (request.method === "dev.update.confirm") {
    const surface = updateSurface(ui);
    if (!surface || surface.surfaceId !== request.params.surfaceId) {
      throw semanticFailure(
        "uiSurfaceNotFound",
        "$.params.surfaceId",
        "The exact update surface is not open.",
        -32042
      );
    }
    return {
      requestId,
      result: { action: request.method, accepted: true, revision: clock.current() },
      afterResponse: developmentUpdate.confirm,
    };
  } else {
    return {
      requestId,
      result: { action: request.method, accepted: true, revision: clock.current() },
      afterResponse: developmentUpdate.quit,
    };
  }

  return {
    requestId,
    result: { action: request.method, accepted: true, revision: clock.current() },
  };
}

export const developmentUpdateHandlers = {
  "dev.update.preferences": { run: act },
  "dev.update.open": { run: act },
  "dev.update.confirm": { run: act },
  "dev.update.quit": { run: act },
};
