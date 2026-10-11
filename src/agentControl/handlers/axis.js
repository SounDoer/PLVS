import {
  buildAxisInspection,
  buildAxisSchema,
  planPanelAxisReset,
  planPanelAxisUpdate,
  planSharedAxisReset,
  planSharedAxisUpdate,
} from "../axisControl.js";
import { panelResultPreset } from "./shared.js";
import { semanticFailure } from "../bridge/failures.js";
import { axisStateMatches } from "../bridge/signatures.js";

/** @param {import("../bridge/types.js").BridgeContext} ctx */
async function describeOrInspect(ctx) {
  const { request, requestId, clock } = ctx;
  const { workspace, analysisContext } = ctx.snap;
  const inspection = buildAxisInspection(workspace);
  return {
    requestId,
    result: {
      revision: clock.current(),
      ...(request.method === "axis.describe" ? { schema: buildAxisSchema(analysisContext) } : {}),
      ...inspection,
    },
  };
}

/** @param {import("../bridge/types.js").BridgeContext} ctx */
async function updateOrReset(ctx) {
  const { request, requestId, clock, settlement, flush } = ctx;
  const {
    workspace,
    replaceWorkspace,
    waitForWorkspacePersistenceEnqueue,
    presets,
    analysisContext,
  } = ctx.snap;
  const currentRevision = clock.current();
  if (
    request.params.expectedRevision !== undefined &&
    request.params.expectedRevision !== currentRevision
  ) {
    throw semanticFailure(
      "revisionConflict",
      "$.params.expectedRevision",
      `Workspace changed after revision ${request.params.expectedRevision}.`,
      -32004,
      {
        expectedRevision: request.params.expectedRevision,
        currentRevision,
      }
    );
  }
  const planned =
    request.method === "axis.shared.update"
      ? planSharedAxisUpdate(workspace, request.params.kind, request.params.range, analysisContext)
      : request.method === "axis.shared.reset"
        ? planSharedAxisReset(workspace, request.params.kind)
        : request.method === "axis.panel.update"
          ? planPanelAxisUpdate(
              workspace,
              request.params.panelId,
              request.params.kind,
              request.params.patch,
              analysisContext
            )
          : planPanelAxisReset(workspace, request.params.panelId, request.params.kind);
  if (planned.issues.length > 0) {
    const target = planned.issues.find(({ code }) =>
      ["panelNotFound", "axisNotFound", "axisUnavailable"].includes(code)
    );
    if (target) {
      const codes = {
        panelNotFound: -32010,
        axisNotFound: -32011,
        axisUnavailable: -32012,
      };
      throw semanticFailure(
        target.code,
        target.path === "$.panelId" ? "$.params.panelId" : "$.params.kind",
        target.message,
        codes[target.code]
      );
    }
    throw semanticFailure(
      "invalidAxis",
      request.method.includes(".update") ? "$.params" : "$.params.kind",
      "The axis request is invalid.",
      -32602,
      { issues: planned.issues }
    );
  }
  const result = {
    dryRun: request.params.dryRun === true,
    revision: currentRevision,
    changed: planned.changed.length > 0,
    warnings: planned.warnings,
    state: {
      axis: buildAxisInspection(planned.workspace),
      preset: panelResultPreset(presets, planned.changed),
    },
  };
  if (request.params.dryRun === true || planned.changed.length === 0) {
    return { requestId, result };
  }

  const committed = settlement.arm("workspace", {
    view: planned.workspace,
    matches: (currentWorkspace) => axisStateMatches(currentWorkspace, planned.workspace),
  });
  replaceWorkspace(planned.workspace);
  result.revision = await settlement.observed("workspace", committed, "The axis change");
  await waitForWorkspacePersistenceEnqueue(planned.workspace);
  try {
    await flush();
  } catch (error) {
    throw semanticFailure(
      "persistenceFailed",
      "$",
      `Axis state committed but persistence failed: ${error?.message || String(error)}`,
      -32030,
      { stateCommitted: true, revision: result.revision }
    );
  }
  return { requestId, result };
}

/** @type {Record<string, import("../bridge/types.js").HandlerEntry>} */
export const axisHandlers = {
  "axis.describe": { run: describeOrInspect },
  "axis.inspect": { run: describeOrInspect },
  "axis.shared.update": { run: updateOrReset },
  "axis.shared.reset": { run: updateOrReset },
  "axis.panel.update": { run: updateOrReset },
  "axis.panel.reset": { run: updateOrReset },
};
