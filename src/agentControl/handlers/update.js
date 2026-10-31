import { semanticFailure } from "../bridge/failures.js";

/**
 * The update state the About page and the status entry show, without release notes or download
 * locations. `status` is `managed` in a workbench whose updates another workbench owns, `disabled`
 * when this identity does not update itself, and otherwise the last check's outcome.
 */
export function buildUpdateInspection(updateControl) {
  if (!updateControl) {
    throw semanticFailure(
      "controlUnavailable",
      "$.method",
      "Update Control is unavailable in this app.",
      -32012
    );
  }
  const info = updateControl.info;
  return {
    enabled: !["managed", "disabled"].includes(info.status) && updateControl.initialized === true,
    status: info.status,
    latestVersion: info.latestVersion ?? null,
    downloading: info.activity?.downloading === true,
    downloadProgress: Number.isFinite(info.activity?.progress) ? info.activity.progress : null,
    readyVersion: info.activity?.readyVersion ?? null,
    installStatus: updateControl.installStatus,
  };
}

/** @param {import("../bridge/types.js").BridgeContext} ctx */
async function inspect(ctx) {
  const { requestId, clock, live } = ctx;
  return {
    requestId,
    result: { revision: clock.current(), ...buildUpdateInspection(live().updateControl) },
  };
}

/** @param {import("../bridge/types.js").BridgeContext} ctx */
async function check(ctx) {
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
  const updateControl = live().updateControl;
  if (!buildUpdateInspection(updateControl).enabled) {
    throw semanticFailure(
      "updateUnavailable",
      "$.method",
      "This workbench does not check for updates.",
      -32012,
      { status: updateControl.info.status }
    );
  }
  // The About page's Check for Updates: one manual check, which never downloads or installs.
  await updateControl.check();
  return {
    requestId,
    result: { revision: clock.current(), ...buildUpdateInspection(live().updateControl) },
  };
}

/** @type {Record<string, import("../bridge/types.js").HandlerEntry>} */
export const updateHandlers = {
  "update.inspect": { run: inspect },
  "update.check": { run: check },
};
