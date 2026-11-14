import { semanticFailure } from "../bridge/failures.js";
import { assertExpectedRevision } from "./shared.js";

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
    installationSupported: updateControl.installationSupported === true,
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

const INSTALL_BUSY = new Set(["installing", "restarting"]);

/**
 * About's Install: opens the update details for the newest known version and confirms them, through
 * the same controller path as the dialog's button. The caller names the version it inspected, so a
 * newer candidate that replaced it is refused instead of installed. The response is delivered
 * before installation starts; downloading, the all-workbench save barrier and the relaunch follow.
 *
 * @param {import("../bridge/types.js").BridgeContext} ctx
 */
async function install(ctx) {
  const { request, requestId, live } = ctx;
  const revision = assertExpectedRevision(ctx, "The app", { required: true });
  const updateControl = live().updateControl;
  const inspection = buildUpdateInspection(updateControl);
  if (!inspection.enabled) {
    throw semanticFailure(
      "updateUnavailable",
      "$.method",
      "This workbench does not install updates.",
      -32012,
      { status: updateControl.info.status }
    );
  }
  if (INSTALL_BUSY.has(updateControl.installStatus)) {
    throw semanticFailure("busy", "$.method", "An update is already installing.", -32012);
  }
  const target = updateControl.info.update;
  if (!target) {
    throw semanticFailure(
      "updateNotFound",
      "$.params.version",
      "No update is known. Run update check first.",
      -32010
    );
  }
  if (target.version !== request.params.version) {
    throw semanticFailure(
      "updateVersionMismatch",
      "$.params.version",
      `The update available is ${target.version}, not ${request.params.version}.`,
      -32012,
      { requestedVersion: request.params.version, availableVersion: target.version }
    );
  }
  if (!updateControl.installationSupported) {
    throw semanticFailure(
      "updateInstallationUnsupported",
      "$.method",
      "This copy cannot install updates itself; download the release instead.",
      -32012,
      { releaseUrl: updateControl.info.releaseUrl ?? null }
    );
  }
  const editors = live().uiNavigation?.inspectUi?.()?.activeBlockingEditors ?? [];
  if (editors.length > 0) {
    throw semanticFailure(
      "editorActive",
      "$.method",
      "Close the open editor before installing an update.",
      -32042,
      { editors }
    );
  }
  updateControl.openDetails(target);
  return {
    requestId,
    result: { revision, accepted: true, version: target.version },
    awaitDelivery: true,
    afterResponse: () => updateControl.confirmInstall(target.id),
  };
}

/** @type {Record<string, import("../bridge/types.js").HandlerEntry>} */
export const updateHandlers = {
  "update.inspect": { run: inspect },
  "update.check": { run: check },
  "update.install": { run: install },
};
