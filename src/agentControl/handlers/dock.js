import {
  buildDockDescription,
  buildDockPanelDescription,
  buildDockSnapshot,
  compileDockLayout,
  dockStateSignature,
  planDockFormMutation,
  planDockPanelPatch,
  planDockLayoutReset,
  planDockPanelReset,
  reconcileDockExecution,
} from "../dockControl.js";
import { panelResultPreset } from "./shared.js";
import { semanticFailure, isCommitNotObserved } from "../bridge/failures.js";

/** @param {import("../bridge/types.js").BridgeContext} ctx */
async function describeOrInspect(ctx) {
  const { request, requestId, clock, dockRequestContext } = ctx;
  const { presets, dock } = ctx.snap;
  const snapshot = buildDockSnapshot(dock, dockRequestContext);
  return {
    requestId,
    result: {
      revision: clock.current(),
      preset: panelResultPreset(presets, []),
      ...(request.method === "dock.describe"
        ? buildDockDescription(dock, dockRequestContext)
        : snapshot),
    },
  };
}

/** @param {import("../bridge/types.js").BridgeContext} ctx */
async function describePanel(ctx) {
  const { request, requestId, clock, dockRequestContext } = ctx;
  const { dock } = ctx.snap;
  const description = buildDockPanelDescription(dock, request.params.panelId, dockRequestContext);
  if (description.issue) {
    const unavailable = description.issue.code === "controlsUnavailable";
    throw semanticFailure(
      unavailable ? "controlsUnavailable" : "dockPanelNotFound",
      "$.params.panelId",
      description.issue.message,
      unavailable ? -32091 : -32090
    );
  }
  return { requestId, result: { revision: clock.current(), ...description } };
}

/** @param {import("../bridge/types.js").BridgeContext} ctx */
async function mutate(ctx) {
  const { request, requestId, clock, settlement, flush, dockRequestContext, live } = ctx;
  const { presets, dock, executeDock } = ctx.snap;
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
      { expectedRevision: request.params.expectedRevision, currentRevision }
    );
  }
  let planned;
  let createdPanels = {};
  if (request.method === "dock.enter" || request.method === "dock.exit") {
    planned = planDockFormMutation(dock, request.method, request.params, dockRequestContext);
  } else if (request.method === "dock.layout.reset") {
    planned = planDockLayoutReset(dock);
  } else if (request.method === "dock.layout.apply") {
    planned = compileDockLayout(dock, request.params.layout, dockRequestContext);
    createdPanels = planned.createdPanels;
  } else if (request.method === "dock.panel.update") {
    planned = planDockPanelPatch(
      dock,
      request.params.panelId,
      request.params.patch,
      dockRequestContext
    );
  } else {
    planned = planDockPanelReset(dock, request.params.panelId, dockRequestContext);
  }
  if (planned.issues.length) {
    const missing = planned.issues.some(({ code }) => code === "dockPanelNotFound");
    const monitorMissing = planned.issues.some(({ code }) => code === "monitorNotFound");
    const unavailable = planned.issues.some(({ code }) => code === "controlsUnavailable");
    throw semanticFailure(
      missing
        ? "dockPanelNotFound"
        : monitorMissing
          ? "monitorNotFound"
          : unavailable
            ? "controlsUnavailable"
            : request.method === "dock.layout.apply"
              ? "invalidDockLayout"
              : "invalidDockControls",
      "$.params",
      "The Dock request is invalid.",
      missing ? -32090 : monitorMissing ? -32093 : unavailable ? -32091 : -32602,
      { issues: planned.issues }
    );
  }
  if (planned.refusal) {
    const code = planned.refusal.code === "editorActive" ? -32040 : -32092;
    throw semanticFailure(
      planned.refusal.code,
      "$.params",
      "The Dock operation is unavailable in the current state.",
      code,
      planned.refusal
    );
  }
  const result = {
    dryRun: request.params.dryRun === true,
    revision: currentRevision,
    changed: planned.changed.length > 0,
    effects: planned.effects ?? [],
    warnings: planned.warnings,
    createdPanels,
    state: {
      dock: buildDockSnapshot(planned.dock, dockRequestContext),
      preset: panelResultPreset(presets, planned.changed),
    },
  };
  if (request.params.dryRun === true || planned.changed.length === 0) return { requestId, result };
  const plannedSignature = dockStateSignature(planned.dock);
  const matches =
    request.method === "dock.enter"
      ? (candidate) =>
          candidate.enabled === true &&
          candidate.edge === planned.dock.edge &&
          candidate.reserveSpace === planned.dock.reserveSpace &&
          candidate.height === planned.dock.height &&
          (request.params.monitor === undefined || candidate.monitor === planned.dock.monitor)
      : request.method === "dock.exit"
        ? (candidate) => candidate.enabled === false
        : request.method === "dock.layout.reset"
          ? // The height may be fitted to the display, as any Dock height is; the layout is exact.
            (candidate) =>
              dockStateSignature({ ...candidate, height: planned.dock.height }) === plannedSignature
          : (candidate) => dockStateSignature(candidate) === plannedSignature;
  const committed = settlement.arm("dock", { matches });
  try {
    const effectiveDock = await executeDock(request.method, planned.dock);
    if (request.method === "dock.enter") {
      planned = reconcileDockExecution(planned, effectiveDock);
      result.warnings = planned.warnings;
      result.state.dock = buildDockSnapshot(planned.dock, dockRequestContext);
      if (matches(live().dock)) {
        settlement.resolve("dock");
      }
    }
    result.revision = await settlement.observed("dock", committed, "The Dock change");
  } catch (error) {
    settlement.clear("dock");
    // The backstop already states what went wrong and that state was committed; relabelling
    // it as a failed native operation would hide the real cause.
    if (isCommitNotObserved(error)) throw error;
    const observableDock = live().dock;
    const partial = dockStateSignature(observableDock) !== dockStateSignature(dock);
    throw semanticFailure(
      "applicationFailed",
      "$.params",
      `Dock operation failed: ${error?.message || String(error)}`,
      -32050,
      {
        stage: error?.stage ?? "execution",
        partial,
        changed: planned.changed,
        revision: clock.current(),
        dock: buildDockSnapshot(observableDock, dockRequestContext),
      }
    );
  }
  result.state.dock = buildDockSnapshot(live().dock, dockRequestContext);
  result.state.preset = panelResultPreset(presets, planned.changed);
  try {
    await flush();
  } catch (error) {
    throw semanticFailure(
      "persistenceFailed",
      "$.params",
      `Dock state committed but persistence failed: ${error?.message || String(error)}`,
      -32030,
      {
        stage: "persistence",
        partial: true,
        stateCommitted: true,
        changed: planned.changed,
        revision: result.revision,
        dock: result.state.dock,
      }
    );
  }
  return { requestId, result };
}

/** @type {Record<string, import("../bridge/types.js").HandlerEntry>} */
export const dockHandlers = {
  "dock.describe": { run: describeOrInspect, monitorInventory: true },
  "dock.inspect": { run: describeOrInspect },
  "dock.panel.describe": { run: describePanel },
  "dock.enter": { run: mutate, monitorInventory: true },
  "dock.exit": { run: mutate },
  "dock.layout.reset": { run: mutate },
  "dock.layout.apply": { run: mutate },
  "dock.panel.update": { run: mutate },
  "dock.panel.reset": { run: mutate },
};
