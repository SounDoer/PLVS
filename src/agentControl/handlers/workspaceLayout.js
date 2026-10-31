import { compileWorkspaceLayout, serializeWorkspaceLayout } from "../workspaceLayout.js";
import { semanticFailure } from "../bridge/failures.js";
import { workspaceMatches } from "../bridge/signatures.js";
import { DEFAULT_WORKSPACE_STATE, workspaceUsesDefaults } from "../../workspace/constants.js";

/** @param {import("../bridge/types.js").BridgeContext} ctx */
async function applyLayout(ctx) {
  const { request, requestId, clock, settlement, flush } = ctx;
  const { workspace, replaceWorkspace, waitForWorkspacePersistenceEnqueue } = ctx.snap;
  const currentRevision = clock.current();
  if (
    request.params.expectedRevision !== undefined &&
    request.params.expectedRevision !== currentRevision
  ) {
    throw semanticFailure(
      "revisionConflict",
      "$.params.expectedRevision",
      `Workspace changed after revision ${request.params.expectedRevision}.`,
      -32004
    );
  }

  const compiled = compileWorkspaceLayout(request.params.layout, workspace);
  const layoutIsUnchanged =
    Object.keys(compiled.createdPanels).length === 0 &&
    JSON.stringify(compiled.layout) === JSON.stringify(serializeWorkspaceLayout(workspace));
  const result = {
    revision: currentRevision,
    dryRun: request.params.dryRun === true,
    changed: !layoutIsUnchanged,
    state: { workspace: { layout: compiled.layout } },
    createdPanels: compiled.createdPanels,
  };
  if (request.params.dryRun === true || layoutIsUnchanged) return { requestId, result };

  const committed = settlement.arm("workspace", {
    view: compiled.view,
    matches: (currentWorkspace) => workspaceMatches(currentWorkspace, compiled.view),
  });
  replaceWorkspace(compiled.view);
  const committedRevision = await settlement.observed(
    "workspace",
    committed,
    "The Workspace layout"
  );
  await waitForWorkspacePersistenceEnqueue(compiled.view);
  try {
    await flush();
  } catch (error) {
    throw semanticFailure(
      "persistenceFailed",
      "$",
      `Workspace committed but persistence failed: ${error?.message || String(error)}`,
      -32030,
      { stateCommitted: true, revision: committedRevision }
    );
  }

  result.revision = committedRevision;
  return { requestId, result };
}

/**
 * The Panels menu's Reset Layout: the same reducer action, so the result is exactly what the
 * button produces, including the panel controls, pins and axis ranges it restores.
 *
 * @param {import("../bridge/types.js").BridgeContext} ctx
 */
async function reset(ctx) {
  const { request, requestId, clock, settlement, flush } = ctx;
  const { workspace, resetWorkspace, waitForWorkspacePersistenceEnqueue } = ctx.snap;
  const currentRevision = clock.current();
  if (request.params.expectedRevision !== currentRevision) {
    throw semanticFailure(
      "revisionConflict",
      "$.params.expectedRevision",
      `Workspace changed after revision ${request.params.expectedRevision}.`,
      -32004
    );
  }
  const changed = !workspaceUsesDefaults(workspace);
  const result = {
    revision: currentRevision,
    dryRun: request.params.dryRun === true,
    changed,
    state: { workspace: { layout: serializeWorkspaceLayout(DEFAULT_WORKSPACE_STATE) } },
  };
  if (request.params.dryRun === true || !changed) return { requestId, result };

  const committed = settlement.arm("workspace", {
    view: DEFAULT_WORKSPACE_STATE,
    matches: (currentWorkspace) => workspaceUsesDefaults(currentWorkspace),
  });
  resetWorkspace();
  const committedRevision = await settlement.observed(
    "workspace",
    committed,
    "The Workspace reset"
  );
  await waitForWorkspacePersistenceEnqueue(DEFAULT_WORKSPACE_STATE);
  try {
    await flush();
  } catch (error) {
    throw semanticFailure(
      "persistenceFailed",
      "$",
      `Workspace committed but persistence failed: ${error?.message || String(error)}`,
      -32030,
      { stateCommitted: true, revision: committedRevision }
    );
  }
  result.revision = committedRevision;
  return { requestId, result };
}

/** @type {Record<string, import("../bridge/types.js").HandlerEntry>} */
export const workspaceLayoutHandlers = {
  "workspace.applyLayout": { run: applyLayout },
  "workspace.reset": { run: reset },
};
