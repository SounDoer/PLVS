import { buildDeviceList, planDeviceSelection } from "../deviceControl.js";
import { deviceInspection } from "./shared.js";
import { semanticFailure } from "../bridge/failures.js";

/** @param {import("../bridge/types.js").BridgeContext} ctx */
async function deviceControl(ctx) {
  const { request, requestId, clock, settlement, live } = ctx;
  const currentDevice = live().device;
  if (!currentDevice?.snapshot) {
    throw semanticFailure(
      "deviceControlUnavailable",
      "$.method",
      "Device Control is unavailable in the current app state.",
      -32064
    );
  }
  if (request.method === "device.list") {
    return {
      requestId,
      result: {
        revision: clock.current(),
        ...buildDeviceList(currentDevice.snapshot),
      },
    };
  }
  if (request.method === "device.inspect") {
    return {
      requestId,
      result: {
        revision: clock.current(),
        ...deviceInspection(currentDevice),
      },
    };
  }

  const currentRevision = clock.current();
  if (request.params.expectedRevision !== currentRevision) {
    throw semanticFailure(
      "revisionConflict",
      "$.params.expectedRevision",
      `Device selection changed after revision ${request.params.expectedRevision}.`,
      -32004,
      { expectedRevision: request.params.expectedRevision, currentRevision }
    );
  }
  if (currentDevice.runtimeUnavailable === true) {
    throw semanticFailure(
      "transitionInProgress",
      "$.params",
      "Runtime changes are unavailable while an update is being applied.",
      -32081,
      { state: "update" }
    );
  }

  const planOrThrow = (controller) => {
    const planned = planDeviceSelection(controller.snapshot, request.params, controller.live);
    if (planned.issues.length > 0) {
      const problem = planned.issues[0];
      const codes = {
        deviceNotFound: -32060,
        deviceInventoryChanged: -32061,
        deviceUnavailable: -32062,
      };
      throw semanticFailure(
        problem.code,
        problem.path,
        problem.message,
        codes[problem.code] ?? -32602,
        problem.details
      );
    }
    if (planned.refusal) {
      throw semanticFailure(
        planned.refusal.code,
        "$.params",
        "Device selection is unavailable during a Live transition.",
        -32081,
        planned.refusal
      );
    }
    if (
      request.params.dryRun !== true &&
      planned.confirmationsRequired.includes("allowMeasurementRestart")
    ) {
      throw semanticFailure(
        "confirmationRequired",
        "$.params.allowMeasurementRestart",
        "Changing the running Live device requires measurement-restart confirmation.",
        -32041,
        { requiredFlag: "allowMeasurementRestart" }
      );
    }
    return planned;
  };

  const previewOrThrow = async (controller, planned) => {
    if (!planned.changed) return planned;
    try {
      await controller.previewSelection(request.params.deviceId);
      return planned;
    } catch (error) {
      if (request.params.deviceId === "default" && controller.live?.state !== "running") {
        return {
          ...planned,
          warnings: Array.from(new Set([...planned.warnings, "automaticCurrentlyUnavailable"])),
        };
      }
      throw semanticFailure(
        "deviceUnavailable",
        "$.params.deviceId",
        `The requested device is unavailable: ${error?.message || String(error)}`,
        -32062
      );
    }
  };

  let planned = planOrThrow(currentDevice);
  planned = await previewOrThrow(currentDevice, planned);
  const predicted = deviceInspection(
    currentDevice,
    planned.changed ? request.params.deviceId : currentDevice.snapshot.requestedId
  );
  const result = {
    dryRun: request.params.dryRun === true,
    revision: currentRevision,
    generation: currentDevice.snapshot.generation,
    changed: planned.changed,
    effects: planned.effects,
    warnings: planned.warnings,
    ...(request.params.dryRun === true
      ? { confirmationsRequired: planned.confirmationsRequired }
      : {}),
    plan: planned.plan,
    state: {
      selection: predicted.selection,
      live: predicted.live,
    },
  };
  if (request.params.dryRun === true || !planned.changed) {
    return { requestId, result };
  }

  const finalDevice = live().device;
  await previewOrThrow(finalDevice, planOrThrow(finalDevice));
  const commitDevice = live().device;
  planned = planOrThrow(commitDevice);
  if (request.params.expectedRevision !== clock.current()) {
    throw semanticFailure(
      "revisionConflict",
      "$.params.expectedRevision",
      `Device selection changed after revision ${request.params.expectedRevision}.`,
      -32004,
      {
        expectedRevision: request.params.expectedRevision,
        currentRevision: clock.current(),
      }
    );
  }
  if (commitDevice.runtimeUnavailable === true) {
    throw semanticFailure(
      "transitionInProgress",
      "$.params",
      "Runtime changes became unavailable while an update was being applied.",
      -32081,
      { state: "update" }
    );
  }
  result.effects = planned.effects;
  result.warnings = planned.warnings;
  result.plan = planned.plan;

  const committed = settlement.arm("device", { requestedId: request.params.deviceId });
  let restart;
  try {
    restart = planned.plan.restartLive ? commitDevice.beginRestart() : null;
  } catch (error) {
    settlement.clear("device");
    throw semanticFailure(
      error?.code === "transitionInProgress" ? "transitionInProgress" : "commandFailed",
      "$.params",
      `Device restart could not begin: ${error?.message || String(error)}`,
      error?.code === "transitionInProgress" ? -32081 : -32050
    );
  }
  const restartSettlement = restart
    ? restart.then(
        () => null,
        (error) => error
      )
    : null;

  let persistenceError = null;
  try {
    await commitDevice.commitSelection(request.params.deviceId);
  } catch (error) {
    persistenceError = error;
  }

  let committedRevision = clock.current();
  if (persistenceError?.stateCommitted === true) {
    committedRevision = await settlement.observed("device", committed, "The Device selection");
  } else if (persistenceError) {
    settlement.clear("device");
  } else {
    committedRevision = await settlement.observed("device", committed, "The Device selection");
  }

  const restartError = restartSettlement ? await restartSettlement : null;
  const resultingDevice = live().device;
  const inspection = deviceInspection(resultingDevice);
  if (persistenceError) {
    throw semanticFailure(
      "persistenceFailed",
      "$.params.deviceId",
      `Device selection committed but persistence failed: ${persistenceError?.message || String(persistenceError)}`,
      -32030,
      {
        stateCommitted: persistenceError.stateCommitted === true,
        revision: committedRevision,
        generation: resultingDevice.snapshot.generation,
        state: { selection: inspection.selection, live: inspection.live },
      }
    );
  }
  if (restartError) {
    throw semanticFailure(
      "deviceStartFailed",
      "$.params.deviceId",
      `Device selection committed but Live restart failed: ${restartError?.message || String(restartError)}`,
      -32063,
      {
        stateCommitted: true,
        revision: committedRevision,
        generation: resultingDevice.snapshot.generation,
        state: { selection: inspection.selection, live: inspection.live },
      }
    );
  }
  result.revision = committedRevision;
  result.generation = resultingDevice.snapshot.generation;
  result.state = { selection: inspection.selection, live: inspection.live };
  return { requestId, result };
}

/** @type {Record<string, import("../bridge/types.js").HandlerEntry>} */
export const deviceHandlers = {
  "device.list": { run: deviceControl },
  "device.inspect": { run: deviceControl },
  "device.select": { run: deviceControl },
};
