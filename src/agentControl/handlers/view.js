import {
  buildViewDescription,
  buildViewInspection,
  planViewReset,
  planViewUpdate,
  viewStateSignature,
} from "../viewControl.js";
import { viewResultPreset } from "./shared.js";
import { semanticFailure } from "../bridge/failures.js";

/** @param {import("../bridge/types.js").BridgeContext} ctx */
async function describeOrInspect(ctx) {
  const { request, requestId, clock, live } = ctx;
  const { presets } = ctx.snap;
  const context = live().viewContext;
  const inspection =
    request.method === "view.describe"
      ? buildViewDescription(context.view, context)
      : buildViewInspection(context.view, context);
  return {
    requestId,
    result: {
      revision: clock.current(),
      preset: viewResultPreset(presets, []),
      ...inspection,
    },
  };
}

/** @param {import("../bridge/types.js").BridgeContext} ctx */
async function updateOrReset(ctx) {
  const { request, requestId, clock, settlement, flush, live } = ctx;
  const { presets } = ctx.snap;
  const currentRevision = clock.current();
  if (request.params.expectedRevision !== currentRevision) {
    throw semanticFailure(
      "revisionConflict",
      "$.params.expectedRevision",
      `View state changed after revision ${request.params.expectedRevision}.`,
      -32004,
      { expectedRevision: request.params.expectedRevision, currentRevision }
    );
  }
  const context = live().viewContext;
  const plan = (candidate) =>
    request.method === "view.reset"
      ? planViewReset(candidate.view, candidate)
      : planViewUpdate(candidate.view, request.params.patch, candidate);
  let planned = plan(context);
  if (planned.issues.length > 0) {
    throw semanticFailure("invalidView", "$.params.patch", "The View patch is invalid.", -32602, {
      issues: planned.issues,
    });
  }
  if (planned.refusal) {
    throw semanticFailure(
      planned.refusal.code,
      "$.params.patch",
      "A View control is unavailable.",
      -32012,
      planned.refusal
    );
  }
  const inspection = buildViewInspection(planned.view, context);
  const result = {
    dryRun: request.params.dryRun === true,
    revision: currentRevision,
    changed: planned.changed.length > 0,
    effects: planned.effects,
    warnings: planned.warnings,
    runtime: inspection.runtime,
    availability: inspection.availability,
    state: {
      view: inspection.view,
      preset: viewResultPreset(presets, planned.changed),
    },
  };
  if (request.params.dryRun === true || planned.changed.length === 0) {
    return { requestId, result };
  }

  const commitContext = live().viewContext;
  planned = plan(commitContext);
  if (planned.issues.length > 0 || planned.refusal) {
    throw semanticFailure(
      planned.refusal?.code ?? "invalidView",
      "$.params.patch",
      planned.refusal ? "A View control is unavailable." : "The View patch is invalid.",
      planned.refusal ? -32012 : -32602,
      planned.refusal ?? { issues: planned.issues }
    );
  }
  if (request.params.expectedRevision !== clock.current()) {
    throw semanticFailure(
      "revisionConflict",
      "$.params.expectedRevision",
      `View state changed after revision ${request.params.expectedRevision}.`,
      -32004,
      {
        expectedRevision: request.params.expectedRevision,
        currentRevision: clock.current(),
      }
    );
  }
  const committed = settlement.arm("view", { signature: viewStateSignature(planned.view) });
  try {
    await commitContext.applyView(planned.view, {
      changed: planned.changed,
      effects: planned.effects,
    });
  } catch (error) {
    settlement.clear("view");
    throw semanticFailure(
      "applicationFailed",
      "$",
      `View application failed: ${error?.message || String(error)}`,
      -32050,
      {
        partial: error?.partial === true,
        rollback: error?.rollback ?? "completed",
        changed: error?.changed ?? [],
        effects: error?.effects ?? planned.effects,
        revision: clock.current(),
      }
    );
  }
  result.revision = await settlement.observed("view", committed, "The View change");
  const resultingContext = live().viewContext;
  const resultingInspection = buildViewInspection(resultingContext.view, resultingContext);
  result.runtime = resultingInspection.runtime;
  result.availability = resultingInspection.availability;
  result.state = {
    view: resultingInspection.view,
    preset: viewResultPreset(presets, planned.changed),
  };
  try {
    await flush();
  } catch (error) {
    throw semanticFailure(
      "persistenceFailed",
      "$",
      `View committed but persistence failed: ${error?.message || String(error)}`,
      -32030,
      { stateCommitted: true, revision: result.revision }
    );
  }
  return { requestId, result };
}

/** @type {Record<string, import("../bridge/types.js").HandlerEntry>} */
export const viewHandlers = {
  "view.describe": { run: describeOrInspect },
  "view.inspect": { run: describeOrInspect },
  "view.update": { run: updateOrReset },
  "view.reset": { run: updateOrReset },
};
