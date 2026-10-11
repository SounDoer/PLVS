import { presetWorkspaceView } from "../../lib/presetWorkspaceView.js";
import { isSceneOperationRefused } from "../../lib/sceneOperations.js";
import { buildPublicPresetSnapshot } from "../presetSnapshot.js";
import { planPresetDelete, planPresetRename, planPresetReorder } from "../presetLibrary.js";
import {
  planPresetApply,
  planPresetApplyResources,
  planPresetSave,
  planPresetUpdate,
} from "../presetScene.js";
import { awaitSettlement } from "../bridge/settlement.js";
import { semanticFailure } from "../bridge/failures.js";
import { presetStateSignature, workspaceMatchesPresetView } from "../bridge/signatures.js";

/** @param {import("../bridge/types.js").BridgeContext} ctx */
async function list(ctx) {
  const { requestId, clock } = ctx;
  const { presets } = ctx.snap;
  return {
    requestId,
    result: {
      revision: clock.current(),
      presets: (presets?.list ?? []).map(({ id, name }) => ({ id, name })),
      activeId: typeof presets?.activeId === "string" ? presets.activeId : null,
      dirty: presets?.dirty === true,
    },
  };
}

/** @param {import("../bridge/types.js").BridgeContext} ctx */
async function describe(ctx) {
  const { request, requestId, clock } = ctx;
  const { presets, loudnessProfiles } = ctx.snap;
  const currentRevision = clock.current();
  const preset = (presets?.list ?? []).find(({ id }) => id === request.params.presetId);
  if (!preset) {
    throw semanticFailure(
      "presetNotFound",
      "$.params.presetId",
      `Preset ${request.params.presetId} was not found.`,
      -32020
    );
  }
  return {
    requestId,
    result: {
      revision: currentRevision,
      preset: buildPublicPresetSnapshot(preset, { loudnessProfiles }),
    },
  };
}

/** @param {import("../bridge/types.js").BridgeContext} ctx */
async function saveOrUpdate(ctx) {
  const { request, requestId, clock, settlement, flush } = ctx;
  const { presets } = ctx.snap;
  const assertRevisions = () => {
    if (request.params.expectedRevision !== clock.current()) {
      throw semanticFailure(
        "revisionConflict",
        "$.params.expectedRevision",
        `App state changed after revision ${request.params.expectedRevision}.`,
        -32004,
        {
          expectedRevision: request.params.expectedRevision,
          currentRevision: clock.current(),
        }
      );
    }
  };
  assertRevisions();
  presets.assertSceneOperationAllowed(request.method);
  const state = {
    list: presets?.list ?? [],
    activeId: typeof presets?.activeId === "string" ? presets.activeId : null,
    dirty: presets?.dirty === true,
  };
  if (
    request.method === "preset.update" &&
    !state.list.some(({ id }) => id === request.params.presetId)
  ) {
    throw semanticFailure(
      "presetNotFound",
      "$.params.presetId",
      `Preset ${request.params.presetId} was not found.`,
      -32020
    );
  }
  const snapshot = await presets.captureSnapshot();
  assertRevisions();
  presets.assertSceneOperationAllowed(request.method);
  let planned =
    request.method === "preset.save"
      ? planPresetSave(state, request.params.name, snapshot)
      : planPresetUpdate(state, request.params.presetId, snapshot);
  if (planned.issues.length > 0) {
    throw semanticFailure("invalidPreset", "$.params", "The Preset request is invalid.", -32602, {
      issues: planned.issues,
    });
  }
  const result = {
    dryRun: request.params.dryRun === true,
    changed: planned.changed.length > 0,
    state: {
      preset: planned.preset,
      presets: planned.presetState,
    },
    revision: clock.current(),
    warnings: planned.warnings,
  };
  if (request.params.dryRun === true || planned.changed.length === 0) {
    return { requestId, result };
  }

  if (request.method === "preset.save") {
    const saved = presets.saveSnapshot(planned.preset.name, snapshot);
    if (!saved) {
      throw semanticFailure("commandFailed", "$", "Preset could not be saved.", -32050);
    }
    planned = planPresetSave(state, planned.preset.name, snapshot, saved.id);
  }
  const committed = settlement.arm("presets", {
    signature: presetStateSignature(planned.presets),
  });
  if (request.method === "preset.update") {
    const updated = presets.updateSnapshot(request.params.presetId, snapshot);
    if (!updated) {
      settlement.clear("presets");
      throw semanticFailure("presetNotFound", "$.params.presetId", "Preset was not found.", -32020);
    }
  }
  result.state.preset = planned.preset;
  result.state.presets = planned.presetState;
  result.revision = await settlement.observed("presets", committed, "The Preset change");
  try {
    await flush();
  } catch (error) {
    throw semanticFailure(
      "persistenceFailed",
      "$",
      `Preset state committed but persistence failed: ${error?.message || String(error)}`,
      -32030,
      { stateCommitted: true, revision: result.revision }
    );
  }
  return { requestId, result };
}

/** @param {import("../bridge/types.js").BridgeContext} ctx */
async function apply(ctx) {
  const { request, requestId, clock, settlement, flush, dockRequestContext } = ctx;
  const {
    waitForWorkspacePersistenceEnqueue,
    presets,
    dock,
    dockContext,
    loudnessProfiles,
    analysisContext,
    viewContext,
  } = ctx.snap;
  const assertRevisions = () => {
    if (request.params.expectedRevision !== clock.current()) {
      throw semanticFailure(
        "revisionConflict",
        "$.params.expectedRevision",
        `App state changed after revision ${request.params.expectedRevision}.`,
        -32004,
        {
          expectedRevision: request.params.expectedRevision,
          currentRevision: clock.current(),
        }
      );
    }
  };
  assertRevisions();
  presets.assertSceneOperationAllowed(request.method);
  const state = {
    list: presets?.list ?? [],
    activeId: typeof presets?.activeId === "string" ? presets.activeId : null,
    dirty: presets?.dirty === true,
  };
  const target = state.list.find(({ id }) => id === request.params.presetId);
  if (!target) {
    throw semanticFailure(
      "presetNotFound",
      "$.params.presetId",
      `Preset ${request.params.presetId} was not found.`,
      -32020
    );
  }
  const resources = planPresetApplyResources(target, {
    loudnessProfiles,
    dockSupported: dock.supported === true,
    reserveSpaceSupported:
      dock.supported === true && ["windows", "macos"].includes(dockContext.platform),
    glassSupported: viewContext.platform === "macos",
    channelCount: analysisContext.channelCount,
    channelLabels: analysisContext.channelLabels,
    monitors: dockRequestContext.monitors,
    fallbackMonitor: dockRequestContext.fallbackMonitor,
    monitorInventoryReady: dockRequestContext.monitorInventoryReady,
    monitorRects: dockRequestContext.monitorRects,
  });
  if (resources.issues.length > 0) {
    throw semanticFailure(
      "controlUnavailable",
      "$.params.presetId",
      "A saved Preset resource is unavailable.",
      -32012,
      { issues: resources.issues }
    );
  }
  presets.preflightApplySnapshot(request.params.presetId, {
    presetOverride: resources.preset,
  });
  const currentSnapshot = await presets.captureSnapshot();
  assertRevisions();
  presets.assertSceneOperationAllowed(request.method);
  const scenePlan = planPresetApply(state, request.params.presetId, currentSnapshot, {
    targetPreset: resources.preset,
  });
  const planned = {
    ...scenePlan,
    warnings: [...resources.warnings, ...scenePlan.warnings],
  };
  const result = {
    dryRun: request.params.dryRun === true,
    changed: planned.changed.length > 0,
    state: {
      preset: planned.preset,
      presets: planned.presetState,
    },
    revision: clock.current(),
    warnings: planned.warnings,
  };
  if (request.params.dryRun === true || planned.changed.length === 0) {
    return { requestId, result };
  }

  const presetStateChanged = planned.changed.some((path) => path.startsWith("presets."));
  const presetCommitted = presetStateChanged
    ? settlement.arm("presets", { signature: presetStateSignature(planned.presets) })
    : null;
  let workspaceCommitted = null;
  // What applying this Preset actually installs. Both the settlement below and the
  // persistence wait further down must compare against this, never against `target`. Built
  // only when the Workspace is really being replaced: a Preset that merely gets associated
  // need not carry a complete Workspace record.
  let targetView = null;
  if (planned.changed.includes("workspace")) {
    targetView = presetWorkspaceView(resources.preset);
    workspaceCommitted = settlement.arm("workspace", {
      matches: (currentWorkspace) => workspaceMatchesPresetView(currentWorkspace, targetView),
    });
  }
  try {
    if (planned.applyScene) {
      const applied = await presets.applySnapshot(request.params.presetId, {
        applyWorkspace: planned.changed.includes("workspace"),
        presetOverride: resources.preset,
      });
      if (!applied) throw new Error("Preset target disappeared before application.");
    } else if (!presets.activateSnapshot(request.params.presetId)) {
      throw new Error("Preset target disappeared before activation.");
    }
  } catch (error) {
    settlement.clear("workspace");
    settlement.clear("presets");
    if (isSceneOperationRefused(error)) throw error;
    throw semanticFailure(
      "applicationFailed",
      "$",
      `Preset application failed: ${error?.message || String(error)}`,
      -32050,
      {
        stage: typeof error?.stage === "string" ? error.stage : "scene",
        partial: planned.applyScene,
        changed: planned.changed,
        revision: clock.current(),
        presetState: { activeId: null, dirty: false },
      }
    );
  }
  await awaitSettlement(
    Promise.all([
      ...(presetCommitted ? [presetCommitted] : []),
      ...(workspaceCommitted ? [workspaceCommitted] : []),
    ]),
    () => {
      settlement.clear("presets");
      settlement.clear("workspace");
    },
    "The Preset application"
  );
  result.revision = clock.current();
  if (workspaceCommitted) {
    await awaitSettlement(
      waitForWorkspacePersistenceEnqueue(targetView),
      () => {},
      "The Preset Workspace"
    );
  }
  try {
    await flush();
  } catch (error) {
    throw semanticFailure(
      "persistenceFailed",
      "$",
      `Preset state committed but persistence failed: ${error?.message || String(error)}`,
      -32030,
      { stateCommitted: true, revision: result.revision }
    );
  }
  return { requestId, result };
}

/** @param {import("../bridge/types.js").BridgeContext} ctx */
async function renameDeleteOrReorder(ctx) {
  const { request, requestId, clock, settlement, flush } = ctx;
  const { presets } = ctx.snap;
  const currentRevision = clock.current();
  if (
    request.params.expectedRevision !== undefined &&
    request.params.expectedRevision !== currentRevision
  ) {
    throw semanticFailure(
      "revisionConflict",
      "$.params.expectedRevision",
      `Presets changed after revision ${request.params.expectedRevision}.`,
      -32004,
      {
        expectedRevision: request.params.expectedRevision,
        currentRevision,
      }
    );
  }
  const state = {
    list: presets?.list ?? [],
    activeId: typeof presets?.activeId === "string" ? presets.activeId : null,
    dirty: presets?.dirty === true,
  };
  const planned =
    request.method === "preset.rename"
      ? planPresetRename(state, request.params.presetId, request.params.name)
      : request.method === "preset.delete"
        ? planPresetDelete(state, request.params.presetId)
        : planPresetReorder(state, request.params.presetIds);
  if (planned.issues.length > 0) {
    const missing = planned.issues.find(({ code }) => code === "presetNotFound");
    if (missing) {
      throw semanticFailure("presetNotFound", "$.params.presetId", missing.message, -32020);
    }
    throw semanticFailure("invalidPreset", "$.params", "The Preset request is invalid.", -32602, {
      issues: planned.issues,
    });
  }
  const result = {
    dryRun: request.params.dryRun === true,
    changed: planned.changed.length > 0,
    ...(planned.deletedPreset ? { deletedPreset: planned.deletedPreset } : {}),
    state: {
      ...(planned.preset ? { preset: planned.preset } : {}),
      presets: {
        activeId: planned.presets.activeId,
        dirty: planned.presets.dirty === true,
        ...(planned.presetIds ? { presetIds: planned.presetIds } : {}),
      },
    },
    revision: currentRevision,
    warnings: planned.warnings,
  };
  if (request.params.dryRun === true || planned.changed.length === 0) {
    return { requestId, result };
  }

  const committed = settlement.arm("presets", {
    signature: presetStateSignature(planned.presets),
  });
  if (request.method === "preset.rename") {
    presets.rename(request.params.presetId, planned.preset.name);
  } else if (request.method === "preset.delete") {
    presets.remove(request.params.presetId);
  } else {
    presets.reorder(planned.presetIds);
  }
  result.revision = await settlement.observed("presets", committed, "The Preset order");
  try {
    await flush();
  } catch (error) {
    throw semanticFailure(
      "persistenceFailed",
      "$",
      `Preset state committed but persistence failed: ${error?.message || String(error)}`,
      -32030,
      { stateCommitted: true, revision: result.revision }
    );
  }
  return { requestId, result };
}

/** @type {Record<string, import("../bridge/types.js").HandlerEntry>} */
export const presetHandlers = {
  "preset.list": { run: list },
  "preset.describe": { run: describe },
  "preset.save": { run: saveOrUpdate },
  "preset.update": { run: saveOrUpdate },
  "preset.apply": { run: apply, monitorInventory: true },
  "preset.rename": { run: renameDeleteOrReorder },
  "preset.delete": { run: renameDeleteOrReorder },
  "preset.reorder": { run: renameDeleteOrReorder },
};
