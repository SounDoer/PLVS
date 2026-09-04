import { useEffect, useRef } from "react";
import {
  announceAgentControlFrontendNotReady,
  announceAgentControlFrontendReady,
  listenForAgentControlRequests,
  respondToAgentControlRequest,
} from "../ipc/agentControlEvents.js";
import { flushPersistence } from "../persistence/index.js";
import { agentControlRpcError, normalizeAgentControlRequest } from "./protocol.js";
import {
  buildAxisInspection,
  buildAxisSchema,
  planPanelAxisReset,
  planPanelAxisUpdate,
  planSharedAxisReset,
  planSharedAxisUpdate,
} from "./axisControl.js";
import {
  buildAgentControlCapabilities,
  buildAgentControlPanelSnapshot,
  buildAgentControlSnapshot,
} from "./appSnapshot.js";
import { planPublicPanelControlPatch, planPublicPanelReset } from "./panelControlPatch.js";
import { buildPublicPanelControlSchema } from "./panelControlSchema.js";
import { buildPublicPresetSnapshot } from "./presetSnapshot.js";
import {
  compileWorkspaceLayout,
  serializeWorkspaceLayout,
  WorkspaceLayoutError,
} from "./workspaceLayout.js";

function semanticFailure(reason, path, message, code, details) {
  return { reason, path, message, code, ...(details ? { details } : {}) };
}

function workspaceMatches(workspace, view) {
  return (
    workspace.tree === view.tree &&
    workspace.panelsById === view.panelsById &&
    workspace.panelOrder === view.panelOrder
  );
}

function panelControlsMatch(workspace, view, panelId) {
  return (
    JSON.stringify(workspace.panelControlsById?.[panelId]) ===
    JSON.stringify(view.panelControlsById?.[panelId])
  );
}

function axisStateMatches(workspace, view) {
  return (
    JSON.stringify(workspace.axisViewports) === JSON.stringify(view.axisViewports) &&
    JSON.stringify(workspace.panelControlsById) === JSON.stringify(view.panelControlsById)
  );
}

function panelResultPreset(presets, changed) {
  const activeId = typeof presets?.activeId === "string" ? presets.activeId : null;
  return {
    activeId,
    dirty: presets?.dirty === true || (activeId !== null && changed.length > 0),
  };
}

function controllableWorkspaceMatches(left, right) {
  return (
    left.tree === right.tree &&
    left.panelsById === right.panelsById &&
    left.panelOrder === right.panelOrder &&
    left.panelControlsById === right.panelControlsById &&
    left.pinnedPanelsById === right.pinnedPanelsById &&
    left.axisViewports === right.axisViewports
  );
}

function presetStateSignature(presets) {
  return JSON.stringify({
    list: Array.isArray(presets?.list) ? presets.list : [],
    activeId: typeof presets?.activeId === "string" ? presets.activeId : null,
    dirty: presets?.dirty === true,
  });
}

export function useAgentControlBridge({
  enabled,
  runtime,
  workspace,
  replaceWorkspace,
  setPanelControlsForPanel,
  waitForWorkspacePersistenceEnqueue,
  presets,
  loudnessProfiles = [],
  hasLoudnessReference = false,
  analysisContext = {},
  flush = flushPersistence,
}) {
  const aliveRef = useRef(false);
  const previousWorkspaceRef = useRef(workspace);
  const revisionRef = useRef(0);
  const previousPresetsSignatureRef = useRef(presetStateSignature(presets));
  const presetsRevisionRef = useRef(0);
  const settlementRef = useRef(null);
  const processRef = useRef(null);
  const queueRef = useRef(Promise.resolve());

  useEffect(() => {
    if (!controllableWorkspaceMatches(previousWorkspaceRef.current, workspace)) {
      previousWorkspaceRef.current = workspace;
      revisionRef.current += 1;
    } else {
      previousWorkspaceRef.current = workspace;
    }
    const settlement = settlementRef.current;
    if (settlement && settlement.matches(workspace)) {
      settlementRef.current = null;
      settlement.resolve(revisionRef.current);
    }
  }, [workspace]);

  useEffect(() => {
    const signature = presetStateSignature(presets);
    if (signature !== previousPresetsSignatureRef.current) {
      previousPresetsSignatureRef.current = signature;
      presetsRevisionRef.current += 1;
    }
  }, [presets]);

  useEffect(() => {
    processRef.current = async (rawRequest) => {
      const normalized = normalizeAgentControlRequest(rawRequest);
      const requestId =
        normalized.ok && normalized.request.id
          ? normalized.request.id
          : typeof rawRequest?.id === "string"
            ? rawRequest.id
            : "";

      if (!normalized.ok) {
        return { requestId, error: agentControlRpcError(normalized.error) };
      }

      const { request } = normalized;
      try {
        if (request.method === "app.capabilities") {
          return {
            requestId,
            result: buildAgentControlCapabilities(runtime),
          };
        }
        if (request.method === "app.inspect") {
          return {
            requestId,
            result: buildAgentControlSnapshot({
              runtime,
              revision: revisionRef.current,
              presetsRevision: presetsRevisionRef.current,
              workspace,
              presets,
              hasLoudnessReference,
              analysisContext,
            }),
          };
        }

        if (request.method === "preset.list") {
          return {
            requestId,
            result: {
              revision: presetsRevisionRef.current,
              presets: (presets?.list ?? []).map(({ id, name }) => ({ id, name })),
              activeId: typeof presets?.activeId === "string" ? presets.activeId : null,
              dirty: presets?.dirty === true,
            },
          };
        }

        if (request.method === "preset.describe") {
          const currentRevision = presetsRevisionRef.current;
          if (
            request.params.expectedPresetsRevision !== undefined &&
            request.params.expectedPresetsRevision !== currentRevision
          ) {
            throw semanticFailure(
              "revisionConflict",
              "$.params.expectedPresetsRevision",
              `Presets changed after revision ${request.params.expectedPresetsRevision}.`,
              -32004,
              {
                expectedRevision: request.params.expectedPresetsRevision,
                currentRevision,
              }
            );
          }
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

        if (request.method === "axis.describe" || request.method === "axis.inspect") {
          const inspection = buildAxisInspection(workspace);
          return {
            requestId,
            result: {
              revision: revisionRef.current,
              ...(request.method === "axis.describe"
                ? { schema: buildAxisSchema(analysisContext) }
                : {}),
              ...inspection,
            },
          };
        }

        if (
          request.method === "axis.shared.update" ||
          request.method === "axis.shared.reset" ||
          request.method === "axis.panel.update" ||
          request.method === "axis.panel.reset"
        ) {
          const currentRevision = revisionRef.current;
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
              ? planSharedAxisUpdate(
                  workspace,
                  request.params.kind,
                  request.params.range,
                  analysisContext
                )
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
            changed: planned.changed,
            warnings: planned.warnings,
            axis: buildAxisInspection(planned.workspace),
            preset: panelResultPreset(presets, planned.changed),
          };
          if (request.params.dryRun === true || planned.changed.length === 0) {
            return { requestId, result };
          }

          const committed = new Promise((resolve, reject) => {
            settlementRef.current = {
              view: planned.workspace,
              matches: (currentWorkspace) => axisStateMatches(currentWorkspace, planned.workspace),
              resolve,
              reject,
            };
          });
          replaceWorkspace(planned.workspace);
          result.revision = await committed;
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

        if (request.method === "panel.describe") {
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
              revision: revisionRef.current,
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

        if (request.method === "panel.update" || request.method === "panel.reset") {
          const currentRevision = revisionRef.current;
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
              ? planPublicPanelReset(
                  panel.moduleId,
                  workspace.panelControlsById?.[panelId],
                  context
                )
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
            changed: planned.changed,
            warnings: planned.warnings,
            panel: buildAgentControlPanelSnapshot({
              workspace: nextWorkspace,
              panelId,
              hasLoudnessReference,
              analysisContext,
            }),
            preset: panelResultPreset(presets, planned.changed),
          };
          if (request.params.dryRun === true || planned.changed.length === 0) {
            return { requestId, result };
          }

          const committed = new Promise((resolve, reject) => {
            settlementRef.current = {
              view: nextWorkspace,
              matches: (currentWorkspace) =>
                panelControlsMatch(currentWorkspace, nextWorkspace, panelId),
              resolve,
              reject,
            };
          });
          setPanelControlsForPanel(panelId, planned.panelControls);
          result.revision = await committed;
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

        const currentRevision = revisionRef.current;
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
        if (request.params.dryRun === true) {
          return {
            requestId,
            result: {
              revision: currentRevision,
              dryRun: true,
              changed: [],
              layout: compiled.layout,
              createdPanels: compiled.createdPanels,
              persisted: false,
            },
          };
        }
        const layoutIsUnchanged =
          Object.keys(compiled.createdPanels).length === 0 &&
          JSON.stringify(compiled.layout) === JSON.stringify(serializeWorkspaceLayout(workspace));
        if (layoutIsUnchanged) {
          return {
            requestId,
            result: {
              revision: currentRevision,
              dryRun: false,
              changed: [],
              layout: compiled.layout,
              createdPanels: {},
              persisted: false,
            },
          };
        }

        const committed = new Promise((resolve, reject) => {
          settlementRef.current = {
            view: compiled.view,
            matches: (currentWorkspace) => workspaceMatches(currentWorkspace, compiled.view),
            resolve,
            reject,
          };
        });
        replaceWorkspace(compiled.view);
        const committedRevision = await committed;
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

        return {
          requestId,
          result: {
            revision: committedRevision,
            dryRun: false,
            changed: ["workspace"],
            layout: compiled.layout,
            createdPanels: compiled.createdPanels,
            persisted: true,
          },
        };
      } catch (error) {
        const semantic =
          error instanceof WorkspaceLayoutError
            ? semanticFailure(error.reason, error.path, error.message, -32602)
            : error;
        return { requestId, error: agentControlRpcError(semantic) };
      }
    };
  }, [
    flush,
    hasLoudnessReference,
    loudnessProfiles,
    analysisContext,
    presets,
    replaceWorkspace,
    runtime,
    setPanelControlsForPanel,
    waitForWorkspacePersistenceEnqueue,
    workspace,
  ]);

  useEffect(() => {
    if (!enabled) return undefined;
    aliveRef.current = true;
    let unlisten = null;
    let ready = false;

    const install = async () => {
      unlisten = await listenForAgentControlRequests((request) => {
        queueRef.current = queueRef.current
          .then(() => processRef.current(request))
          .then((response) => {
            if (aliveRef.current) return respondToAgentControlRequest(response);
            return undefined;
          })
          .catch(() => undefined);
      });
      if (!aliveRef.current) {
        unlisten();
        unlisten = null;
        return;
      }
      await announceAgentControlFrontendReady();
      ready = true;
    };
    void install().catch(() => {
      if (unlisten) unlisten();
      unlisten = null;
    });

    return () => {
      aliveRef.current = false;
      const settlement = settlementRef.current;
      settlementRef.current = null;
      settlement?.reject(new Error("Agent-control bridge unmounted."));
      if (unlisten) unlisten();
      if (ready) void announceAgentControlFrontendNotReady();
    };
  }, [enabled]);
}
