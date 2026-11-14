import { ProfileValidationError } from "../../persistence/profileShape.js";
import { semanticFailure } from "../bridge/failures.js";

/** @param {import("../bridge/types.js").BridgeContext} ctx */
async function exportConfig(ctx) {
  const { requestId, clock } = ctx;
  const { exportConfiguration } = ctx.snap;
  const configuration = await exportConfiguration();
  return {
    requestId,
    result: {
      revision: clock.current(),
      configuration,
    },
  };
}

/** @param {import("../bridge/types.js").BridgeContext} ctx */
async function changeConfig(ctx) {
  const { request, requestId, clock } = ctx;
  const {
    presets,
    importConfiguration,
    resetConfiguration,
    normalizeConfiguration,
    relaunchAfterConfigurationChange,
  } = ctx.snap;
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
  presets.assertSceneOperationAllowed(request.method);

  const reset = request.method === "config.reset";
  let configuration;
  try {
    if (!reset) configuration = normalizeConfiguration(request.params.configuration);
  } catch (error) {
    if (!(error instanceof ProfileValidationError)) throw error;
    throw semanticFailure("invalidConfiguration", "$.params.configuration", error.message, -32602);
  }

  if (request.params.dryRun === true) {
    return {
      requestId,
      result: {
        dryRun: true,
        revision: currentRevision,
        changed: true,
        relaunch: false,
        ...(reset ? { wouldRelaunch: true } : { configuration }),
      },
    };
  }

  try {
    if (reset) await resetConfiguration();
    else await importConfiguration(configuration);
  } catch (error) {
    throw semanticFailure(
      "persistenceFailed",
      "$",
      `Configuration ${reset ? "reset" : "import"} failed: ${error?.message || String(error)}`,
      -32030
    );
  }
  return {
    requestId,
    result: {
      dryRun: false,
      revision: currentRevision,
      changed: true,
      relaunch: true,
    },
    awaitDelivery: true,
    afterResponse: relaunchAfterConfigurationChange,
  };
}

/** @type {Record<string, import("../bridge/types.js").HandlerEntry>} */
export const configHandlers = {
  "config.export": { run: exportConfig },
  "config.import": { run: changeConfig },
  "config.reset": { run: changeConfig },
};
