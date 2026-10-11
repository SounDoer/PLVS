import {
  buildSettingsInspection,
  buildSettingsSchema,
  planSettingsUpdate,
} from "../settingsControl.js";
import { semanticFailure } from "../bridge/failures.js";
import { settingsStateSignature } from "../bridge/signatures.js";

/** @param {import("../bridge/types.js").BridgeContext} ctx */
async function describeOrInspect(ctx) {
  const { request, requestId, clock } = ctx;
  const { settings, settingsContext } = ctx.snap;
  const inspection = buildSettingsInspection(settings, settingsContext);
  return {
    requestId,
    result: {
      revision: clock.current(),
      ...inspection,
      ...(request.method === "settings.describe"
        ? { schema: buildSettingsSchema(settings, settingsContext) }
        : {}),
    },
  };
}

/** @param {import("../bridge/types.js").BridgeContext} ctx */
async function update(ctx) {
  const { request, requestId, clock, settlement, flush } = ctx;
  const { settings, settingsContext, applySettings } = ctx.snap;
  const currentRevision = clock.current();
  if (
    request.params.expectedRevision !== undefined &&
    request.params.expectedRevision !== currentRevision
  ) {
    throw semanticFailure(
      "revisionConflict",
      "$.params.expectedRevision",
      `Settings changed after revision ${request.params.expectedRevision}.`,
      -32004,
      {
        expectedRevision: request.params.expectedRevision,
        currentRevision,
      }
    );
  }
  const planned = planSettingsUpdate(settings, request.params.patch, settingsContext, {
    allowMeasurementRestart: request.params.allowMeasurementRestart === true,
  });
  if (planned.issues.length > 0) {
    throw semanticFailure(
      "invalidSettings",
      "$.params.patch",
      "The Settings patch is invalid.",
      -32602,
      { issues: planned.issues }
    );
  }
  if (planned.refusal) {
    const editorActive = planned.refusal.code === "editorActive";
    throw semanticFailure(
      planned.refusal.code,
      "$.params.patch",
      editorActive
        ? "Finish or cancel the active editor first."
        : "A Settings control is unavailable.",
      editorActive ? -32040 : -32012,
      planned.refusal
    );
  }
  if (planned.confirmation && request.params.dryRun !== true) {
    throw semanticFailure(
      "confirmationRequired",
      "$.params.allowMeasurementRestart",
      "This change requires a measurement restart.",
      -32041,
      planned.confirmation
    );
  }
  const inspection = buildSettingsInspection(planned.settings, settingsContext);
  const result = {
    dryRun: request.params.dryRun === true,
    revision: currentRevision,
    changed: planned.changed.length > 0,
    effects: planned.effects,
    warnings: planned.warnings,
    ...(planned.confirmation ? { confirmation: planned.confirmation } : {}),
    state: inspection,
  };
  if (request.params.dryRun === true || planned.changed.length === 0) {
    return { requestId, result };
  }

  const committed = settlement.arm("settings", {
    signature: settingsStateSignature(planned.settings),
  });
  try {
    await applySettings(planned.settings, {
      changed: planned.changed,
      effects: planned.effects,
    });
  } catch (error) {
    settlement.clear("settings");
    throw semanticFailure(
      "applicationFailed",
      "$",
      `Settings application failed: ${error?.message || String(error)}`,
      -32050,
      {
        partial: error?.partial === true,
        rollback: error?.rollback ?? "completed",
        changed: error?.changed ?? [],
        effects: error?.effects ?? [],
        revision: clock.current(),
      }
    );
  }
  result.revision = await settlement.observed("settings", committed, "The Settings change");
  try {
    await flush();
  } catch (error) {
    throw semanticFailure(
      "persistenceFailed",
      "$",
      `Settings committed but persistence failed: ${error?.message || String(error)}`,
      -32030,
      { stateCommitted: true, revision: result.revision }
    );
  }
  return { requestId, result };
}

/** @type {Record<string, import("../bridge/types.js").HandlerEntry>} */
export const settingsHandlers = {
  "settings.describe": { run: describeOrInspect },
  "settings.inspect": { run: describeOrInspect },
  "settings.update": { run: update },
};
