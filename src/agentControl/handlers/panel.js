import { buildAgentControlPanelSnapshot } from "../appSnapshot.js";
import { planPublicPanelControlPatch, planPublicPanelReset } from "../panelControlPatch.js";
import { buildPublicPanelControlSchema } from "../panelControlSchema.js";
import { assertExpectedRevision, panelResultPreset } from "./shared.js";
import { semanticFailure } from "../bridge/failures.js";
import { paced } from "./paced.js";
import { panelControlsMatch } from "../bridge/signatures.js";

/** @param {import("../bridge/types.js").BridgeContext} ctx */
async function describe(ctx) {
  const { request, requestId, clock } = ctx;
  const { workspace, hasLoudnessReference, analysisContext } = ctx.snap;
  const panelId = request.params.panelId;
  const panel = workspace.panelsById?.[panelId];
  if (!panel) {
    throw semanticFailure(
      "panelNotFound",
      "$.params.panelId",
      `Panel ${panelId} was not found.`,
      -32010
    );
  }
  const context = { ...analysisContext, hasLoudnessReference };
  return {
    requestId,
    result: {
      revision: clock.current(),
      panel: buildAgentControlPanelSnapshot({
        workspace,
        panelId,
        hasLoudnessReference,
        analysisContext,
      }),
      schema: buildPublicPanelControlSchema(
        panel.moduleId,
        workspace.panelControlsById?.[panelId],
        context
      ),
    },
  };
}

/** @param {import("../bridge/types.js").BridgeContext} ctx */
async function updateOrReset(ctx) {
  const { request, requestId, clock, settlement, flush } = ctx;
  const {
    workspace,
    setPanelControlsForPanel,
    waitForWorkspacePersistenceEnqueue,
    presets,
    hasLoudnessReference,
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
  const panelId = request.params.panelId;
  const panel = workspace.panelsById?.[panelId];
  if (!panel) {
    throw semanticFailure(
      "panelNotFound",
      "$.params.panelId",
      `Panel ${panelId} was not found.`,
      -32010
    );
  }
  const context = { ...analysisContext, hasLoudnessReference };
  const planned =
    request.method === "panel.reset"
      ? planPublicPanelReset(panel.moduleId, workspace.panelControlsById?.[panelId], context)
      : planPublicPanelControlPatch(
          panel.moduleId,
          workspace.panelControlsById?.[panelId],
          request.params.patch,
          context
        );
  if (planned.issues.length > 0) {
    throw semanticFailure(
      "invalidControls",
      request.method === "panel.update" ? "$.params.patch" : "$.params",
      "The panel controls are invalid.",
      -32602,
      { issues: planned.issues }
    );
  }
  const nextWorkspace = {
    ...workspace,
    panelControlsById: {
      ...workspace.panelControlsById,
      [panelId]: planned.panelControls,
    },
  };
  const result = {
    dryRun: request.params.dryRun === true,
    revision: currentRevision,
    changed: planned.changed.length > 0,
    warnings: planned.warnings,
    state: {
      panel: buildAgentControlPanelSnapshot({
        workspace: nextWorkspace,
        panelId,
        hasLoudnessReference,
        analysisContext,
      }),
      preset: panelResultPreset(presets, planned.changed),
    },
  };
  if (request.params.dryRun === true || planned.changed.length === 0) {
    return { requestId, result };
  }

  const committed = settlement.arm("workspace", {
    view: nextWorkspace,
    matches: (currentWorkspace) => panelControlsMatch(currentWorkspace, nextWorkspace, panelId),
  });
  setPanelControlsForPanel(panelId, planned.panelControls);
  result.revision = await settlement.observed("workspace", committed, "The panel controls change");
  await waitForWorkspacePersistenceEnqueue(nextWorkspace);
  try {
    await flush();
  } catch (error) {
    throw semanticFailure(
      "persistenceFailed",
      "$",
      `Panel controls committed but persistence failed: ${error?.message || String(error)}`,
      -32030,
      { stateCommitted: true, revision: result.revision }
    );
  }
  return { requestId, result };
}

/**
 * The panel header's Pin button: it locks the size the panel is rendered at when pressed, so the
 * command takes no size. A panel can be pinned only while it is the rendered tab of its slot.
 *
 * @param {import("../bridge/types.js").BridgeContext} ctx
 */
async function pinOrUnpin(ctx) {
  const { request, requestId, settlement, flush, live } = ctx;
  const { workspace, waitForWorkspacePersistenceEnqueue } = ctx.snap;
  const currentRevision = assertExpectedRevision(ctx, "Workspace", { required: true });
  const { panelId } = request.params;
  if (!workspace.panelsById?.[panelId]) {
    throw semanticFailure(
      "panelNotFound",
      "$.params.panelId",
      `Panel ${panelId} was not found.`,
      -32010
    );
  }
  const control = live().uiNavigation?.getPanelPin?.(panelId);
  const pinned = request.method === "panel.pin";
  if (control?.pinned === pinned) {
    return { requestId, result: { revision: currentRevision, changed: false, panelId, pinned } };
  }
  if (!control?.toggle) {
    throw semanticFailure(
      "controlUnavailable",
      "$.params.panelId",
      control?.fullscreen
        ? "While Fullscreen is shown only its own panel can be unpinned; exit Fullscreen to pin."
        : "Pin applies to the rendered tab of a Workspace panel.",
      -32012,
      { panelId }
    );
  }
  let settled = workspace;
  const committed = settlement.arm("workspace", {
    matches: (current) => {
      if (Boolean(current.pinnedPanelsById?.[panelId]) !== pinned) return false;
      settled = current;
      return true;
    },
  });
  control.toggle();
  const revision = await settlement.observed(
    "workspace",
    committed,
    pinned ? "The panel pin" : "The panel unpin"
  );
  await waitForWorkspacePersistenceEnqueue(settled);
  try {
    await flush();
  } catch (error) {
    throw semanticFailure(
      "persistenceFailed",
      "$",
      `Panel pin committed but persistence failed: ${error?.message || String(error)}`,
      -32030,
      { stateCommitted: true, revision }
    );
  }
  return { requestId, result: { revision, changed: true, panelId, pinned } };
}

/** @type {Record<string, import("../bridge/types.js").HandlerEntry>} */
export const panelHandlers = {
  "panel.describe": { run: describe },
  "panel.update": { run: paced(updateOrReset) },
  "panel.reset": { run: updateOrReset },
  "panel.pin": { run: pinOrUnpin },
  "panel.unpin": { run: pinOrUnpin },
};
