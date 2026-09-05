import { useCallback, useEffect, useRef } from "react";
import {
  announceAgentControlFrontendNotReady,
  announceAgentControlFrontendReady,
  listenForAgentControlRequests,
  respondToAgentControlRequest,
} from "../ipc/agentControlEvents.js";
import { flushPersistence } from "../persistence/index.js";
import { presetWorkspaceView } from "../lib/presetWorkspaceView.js";
import { isSceneOperationRefused } from "../lib/sceneOperations.js";
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
import { planPresetDelete, planPresetRename, planPresetReorder } from "./presetLibrary.js";
import {
  planPresetApply,
  planPresetApplyResources,
  planPresetSave,
  planPresetUpdate,
} from "./presetScene.js";
import {
  buildSettingsInspection,
  buildSettingsSchema,
  planSettingsUpdate,
} from "./settingsControl.js";
import { planTransportMutation, transportLifecycleSignature } from "./transportControl.js";
import {
  buildDockDescription,
  buildDockPanelDescription,
  buildDockSnapshot,
  compileDockLayout,
  dockStateSignature,
  planDockFormMutation,
  planDockPanelPatch,
  planDockPanelReset,
} from "./dockControl.js";
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

/// Compares the live Workspace against the view a Preset becomes once applied.
///
/// Never compare against the stored Preset itself: applying migrates its controls, so a Preset
/// saved before a control was added or removed can never equal the Workspace it produces, and a
/// settlement waiting on that equality would never fire.
function workspaceMatchesPresetView(workspace, view) {
  return [
    "tree",
    "panelsById",
    "panelOrder",
    "panelControlsById",
    "pinnedPanelsById",
    "axisViewports",
  ].every((key) => JSON.stringify(workspace[key]) === JSON.stringify(view[key]));
}

function settingsStateSignature(settings) {
  if (!settings) return "null";
  return JSON.stringify({
    ...settings,
    appearance: {
      mode: settings.appearance?.mode,
      themeId: settings.appearance?.themeId ?? null,
    },
    channelLabels: {
      mode: settings.channelLabels?.mode,
      ...(settings.channelLabels?.mode === "custom" ? { roles: settings.channelLabels.roles } : {}),
    },
  });
}

/// A settlement waits only for React to render a change that has already been applied, so anything
/// near a second means the predicate will never match. Kept well under the broker's own budget so
/// the caller gets this specific failure instead of a transport timeout.
const SETTLEMENT_TIMEOUT_MS = 5000;

/// Bounds a settlement wait.
///
/// Without this a predicate that can never match hangs the request forever - and because commands
/// share one serialized queue, every later command hangs behind it and the whole control channel is
/// dead until the app restarts. A timeout turns that into one failed command with a stated cause.
const COMMIT_NOT_OBSERVED = "commitNotObserved";

function isCommitNotObserved(error) {
  return error?.reason === COMMIT_NOT_OBSERVED;
}

function awaitSettlement(committed, clear, subject) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      clear();
      reject(
        semanticFailure(
          COMMIT_NOT_OBSERVED,
          "$",
          `${subject} was applied but the commit was not observed within ${SETTLEMENT_TIMEOUT_MS} ms.`,
          -32031,
          { stateCommitted: true }
        )
      );
    }, SETTLEMENT_TIMEOUT_MS);
    committed.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

const WAIT_CANCELLED = Symbol("waitCancelled");

function transportMutationMatches(method, params, execution, snapshot) {
  const sessionId = execution?.sessionId ?? params.sessionId;
  if (method === "transport.source.live") {
    return snapshot.source === "live" && snapshot.files.analyzingId === null;
  }
  if (method === "transport.source.file") return snapshot.source === "file";
  if (method === "transport.live.start") {
    return snapshot.source === "live" && snapshot.live.state === "running";
  }
  if (method === "transport.live.stop") return snapshot.live.state === "stopped";
  if (method === "transport.file.analyze" || method === "transport.file.reanalyze") {
    return (
      snapshot.source === "file" &&
      snapshot.files.analyzingId === sessionId &&
      snapshot.files.sessions.some(
        (session) => session.id === sessionId && ["probing", "analyzing"].includes(session.state)
      )
    );
  }
  if (method === "transport.file.stop") {
    return (
      snapshot.files.analyzingId !== sessionId &&
      snapshot.files.sessions.some(
        (session) => session.id === sessionId && session.state === "stopped"
      )
    );
  }
  if (method === "transport.file.select") {
    return snapshot.source === "file" && snapshot.files.activeId === sessionId;
  }
  if (method === "transport.file.remove") {
    return !snapshot.files.sessions.some((session) => session.id === sessionId);
  }
  if (method === "transport.file.clear") return snapshot.files.sessions.length === 0;
  return false;
}

export function useAgentControlBridge({
  enabled,
  runtime,
  workspace,
  replaceWorkspace,
  setPanelControlsForPanel,
  waitForWorkspacePersistenceEnqueue,
  presets,
  settings,
  settingsContext = {},
  applySettings = async () => {},
  transport,
  transportContext = {},
  executeTransport = async () => ({}),
  dock,
  dockContext = {},
  executeDock = async () => {},
  loudnessProfiles = [],
  hasLoudnessReference = false,
  analysisContext = {},
  flush = flushPersistence,
}) {
  const aliveRef = useRef(false);
  const controlRevisionRef = useRef(0);
  const controlRevisionBumpedThisTurnRef = useRef(false);
  const previousWorkspaceRef = useRef(workspace);
  const previousPresetsSignatureRef = useRef(presetStateSignature(presets));
  const previousSettingsSignatureRef = useRef(settingsStateSignature(settings));
  const settingsInitializedRef = useRef(false);
  const settlementRef = useRef(null);
  const presetSettlementRef = useRef(null);
  const settingsSettlementRef = useRef(null);
  const previousTransportSignatureRef = useRef(transportLifecycleSignature(transport));
  const latestTransportRef = useRef(transport);
  const transportSettlementRef = useRef(null);
  const previousDockSignatureRef = useRef(dockStateSignature(dock));
  const latestDockRef = useRef(dock);
  const dockSettlementRef = useRef(null);
  const waitersRef = useRef(new Map());
  const waitWakeScheduledRef = useRef(false);
  const workspaceRevisionBumpedThisTurnRef = useRef(false);
  const processRef = useRef(null);
  const queueRef = useRef(Promise.resolve());

  const scheduleWaitWake = useCallback(() => {
    if (waitWakeScheduledRef.current) return;
    waitWakeScheduledRef.current = true;
    queueMicrotask(() => {
      waitWakeScheduledRef.current = false;
      for (const [id, waiter] of waitersRef.current) {
        if (controlRevisionRef.current === waiter.afterRevision) continue;
        clearTimeout(waiter.timer);
        waitersRef.current.delete(id);
        waiter.resolve({
          outcome: "changed",
          matchedImmediately: false,
          revision: controlRevisionRef.current,
        });
      }
    });
  }, []);
  const bumpControlRevision = useCallback(() => {
    if (controlRevisionBumpedThisTurnRef.current) return;
    controlRevisionBumpedThisTurnRef.current = true;
    controlRevisionRef.current += 1;
    queueMicrotask(() => {
      controlRevisionBumpedThisTurnRef.current = false;
    });
  }, []);
  const bumpWorkspaceRevision = useCallback(() => {
    if (workspaceRevisionBumpedThisTurnRef.current) return;
    workspaceRevisionBumpedThisTurnRef.current = true;
    bumpControlRevision();
    queueMicrotask(() => {
      workspaceRevisionBumpedThisTurnRef.current = false;
    });
    scheduleWaitWake();
  }, [bumpControlRevision, scheduleWaitWake]);

  useEffect(() => {
    if (!controllableWorkspaceMatches(previousWorkspaceRef.current, workspace)) {
      previousWorkspaceRef.current = workspace;
      bumpWorkspaceRevision();
    } else {
      previousWorkspaceRef.current = workspace;
    }
    const settlement = settlementRef.current;
    if (settlement && settlement.matches(workspace)) {
      settlementRef.current = null;
      settlement.resolve(controlRevisionRef.current);
    }
  }, [bumpWorkspaceRevision, workspace]);

  useEffect(() => {
    const signature = presetStateSignature(presets);
    if (signature !== previousPresetsSignatureRef.current) {
      previousPresetsSignatureRef.current = signature;
      bumpControlRevision();
      scheduleWaitWake();
    }
    const settlement = presetSettlementRef.current;
    if (settlement && signature === settlement.signature) {
      presetSettlementRef.current = null;
      settlement.resolve(controlRevisionRef.current);
    }
  }, [bumpControlRevision, presets, scheduleWaitWake]);

  useEffect(() => {
    const signature = settingsStateSignature(settings);
    if (!settingsInitializedRef.current) {
      previousSettingsSignatureRef.current = signature;
      if (settingsContext.autostartReady === true && settingsContext.clearShortcutReady === true) {
        settingsInitializedRef.current = true;
      }
      return;
    }
    if (signature !== previousSettingsSignatureRef.current) {
      previousSettingsSignatureRef.current = signature;
      bumpControlRevision();
      scheduleWaitWake();
    }
    const settlement = settingsSettlementRef.current;
    if (settlement && signature === settlement.signature) {
      settingsSettlementRef.current = null;
      settlement.resolve(controlRevisionRef.current);
    }
  }, [
    bumpControlRevision,
    scheduleWaitWake,
    settings,
    settingsContext.autostartReady,
    settingsContext.clearShortcutReady,
  ]);

  useEffect(() => {
    latestTransportRef.current = transport;
    const signature = transportLifecycleSignature(transport);
    if (signature !== previousTransportSignatureRef.current) {
      previousTransportSignatureRef.current = signature;
      bumpControlRevision();
      scheduleWaitWake();
    }
    const settlement = transportSettlementRef.current;
    if (settlement && settlement.matches(transport)) {
      transportSettlementRef.current = null;
      settlement.resolve(controlRevisionRef.current);
    }
  }, [bumpControlRevision, scheduleWaitWake, transport]);

  useEffect(() => {
    latestDockRef.current = dock;
    const signature = dockStateSignature(dock);
    if (signature !== previousDockSignatureRef.current) {
      previousDockSignatureRef.current = signature;
      bumpWorkspaceRevision();
    }
    const settlement = dockSettlementRef.current;
    if (settlement && settlement.matches(dock)) {
      dockSettlementRef.current = null;
      settlement.resolve(controlRevisionRef.current);
    }
  }, [bumpWorkspaceRevision, dock]);

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
            result: buildAgentControlCapabilities(runtime, controlRevisionRef.current),
          };
        }
        if (request.method === "app.wait") {
          if (controlRevisionRef.current !== request.params.afterRevision) {
            return {
              requestId,
              result: {
                outcome: "changed",
                matchedImmediately: true,
                revision: controlRevisionRef.current,
              },
            };
          }
          if (waitersRef.current.size >= 4) {
            throw semanticFailure("busy", "$", "Too many revision waits are active.", -32070);
          }
          const result = await new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
              waitersRef.current.delete(requestId);
              resolve({
                outcome: "timeout",
                revision: controlRevisionRef.current,
              });
            }, request.params.timeoutMs);
            waitersRef.current.set(requestId, {
              afterRevision: request.params.afterRevision,
              timer,
              resolve,
              reject,
            });
          });
          if (result === WAIT_CANCELLED) return null;
          if (result.outcome === "timeout") {
            throw semanticFailure(
              "timeout",
              "$.params.timeoutMs",
              "The app revision did not change before the timeout.",
              -32071,
              {
                afterRevision: request.params.afterRevision,
                currentRevision: result.revision,
              }
            );
          }
          return { requestId, result };
        }
        if (request.method === "app.inspect") {
          return {
            requestId,
            result: buildAgentControlSnapshot({
              runtime,
              revision: controlRevisionRef.current,
              workspace,
              presets,
              settings,
              transport,
              dock: buildDockSnapshot(dock, dockContext),
              hasLoudnessReference,
              analysisContext,
            }),
          };
        }

        if (request.method === "settings.describe" || request.method === "settings.inspect") {
          const inspection = buildSettingsInspection(settings, settingsContext);
          return {
            requestId,
            result: {
              revision: controlRevisionRef.current,
              ...inspection,
              ...(request.method === "settings.describe"
                ? { schema: buildSettingsSchema(settings, settingsContext) }
                : {}),
            },
          };
        }
        if (request.method === "transport.inspect") {
          return {
            requestId,
            result: { revision: controlRevisionRef.current, ...transport },
          };
        }
        if (request.method === "dock.describe" || request.method === "dock.inspect") {
          const snapshot = buildDockSnapshot(dock, dockContext);
          return {
            requestId,
            result: {
              revision: controlRevisionRef.current,
              preset: panelResultPreset(presets, []),
              ...(request.method === "dock.describe"
                ? buildDockDescription(dock, dockContext)
                : snapshot),
            },
          };
        }
        if (request.method === "dock.panel.describe") {
          const description = buildDockPanelDescription(dock, request.params.panelId, dockContext);
          if (description.issue) {
            const unavailable = description.issue.code === "controlsUnavailable";
            throw semanticFailure(
              unavailable ? "controlsUnavailable" : "dockPanelNotFound",
              "$.params.panelId",
              description.issue.message,
              unavailable ? -32091 : -32090
            );
          }
          return { requestId, result: { revision: controlRevisionRef.current, ...description } };
        }
        if (request.method.startsWith("dock.")) {
          const currentRevision = controlRevisionRef.current;
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
            planned = planDockFormMutation(dock, request.method, request.params, dockContext);
          } else if (request.method === "dock.layout.apply") {
            planned = compileDockLayout(dock, request.params.layout, dockContext);
            createdPanels = planned.createdPanels;
          } else if (request.method === "dock.panel.update") {
            planned = planDockPanelPatch(
              dock,
              request.params.panelId,
              request.params.patch,
              dockContext
            );
          } else {
            planned = planDockPanelReset(dock, request.params.panelId, dockContext);
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
              dock: buildDockSnapshot(planned.dock, dockContext),
              preset: panelResultPreset(presets, planned.changed),
            },
          };
          if (request.params.dryRun === true || planned.changed.length === 0)
            return { requestId, result };
          const plannedSignature = dockStateSignature(planned.dock);
          const matches =
            request.method === "dock.enter"
              ? (candidate) =>
                  candidate.enabled === true &&
                  candidate.edge === planned.dock.edge &&
                  candidate.reserveSpace === planned.dock.reserveSpace &&
                  candidate.height === planned.dock.height &&
                  (request.params.monitor === undefined ||
                    candidate.monitor === planned.dock.monitor)
              : request.method === "dock.exit"
                ? (candidate) => candidate.enabled === false
                : (candidate) => dockStateSignature(candidate) === plannedSignature;
          const committed = new Promise((resolve, reject) => {
            dockSettlementRef.current = { matches, resolve, reject };
          });
          try {
            await executeDock(request.method, planned.dock);
            result.revision = await awaitSettlement(
              committed,
              () => {
                dockSettlementRef.current = null;
              },
              "The Dock change"
            );
          } catch (error) {
            dockSettlementRef.current = null;
            // The backstop already states what went wrong and that state was committed; relabelling
            // it as a failed native operation would hide the real cause.
            if (isCommitNotObserved(error)) throw error;
            const observableDock = latestDockRef.current;
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
                revision: controlRevisionRef.current,
                dock: buildDockSnapshot(observableDock, dockContext),
              }
            );
          }
          result.state.dock = buildDockSnapshot(latestDockRef.current, dockContext);
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

        if (request.method.startsWith("transport.")) {
          const currentRevision = controlRevisionRef.current;
          if (
            request.params.expectedRevision !== undefined &&
            request.params.expectedRevision !== currentRevision
          ) {
            throw semanticFailure(
              "revisionConflict",
              "$.params.expectedRevision",
              `Transport changed after revision ${request.params.expectedRevision}.`,
              -32004,
              {
                expectedRevision: request.params.expectedRevision,
                currentRevision,
              }
            );
          }
          const planned = planTransportMutation(
            latestTransportRef.current,
            request.method,
            request.params,
            transportContext
          );
          if (planned.issues.length > 0) {
            const missing = planned.issues.some(({ code }) => code === "fileSessionNotFound");
            throw semanticFailure(
              missing ? "fileSessionNotFound" : "invalidTransport",
              missing ? "$.params.sessionId" : "$.params",
              missing ? "The FILE session was not found." : "The Transport request is invalid.",
              missing ? -32080 : -32602,
              { issues: planned.issues }
            );
          }
          if (planned.refusal) {
            const refusalCodes = {
              transitionInProgress: -32081,
              analysisInProgress: -32082,
              dockActive: -32083,
              fileAnalysisNotActive: -32084,
            };
            throw semanticFailure(
              planned.refusal.code,
              "$.params",
              "The Transport operation is unavailable in the current state.",
              refusalCodes[planned.refusal.code] ?? -32012,
              planned.refusal
            );
          }
          if (planned.confirmation) {
            throw semanticFailure(
              "confirmationRequired",
              "$.params.allowStopFileAnalysis",
              "Active FILE analysis must be stopped before switching to LIVE.",
              -32041,
              planned.confirmation
            );
          }
          const result = {
            dryRun: request.params.dryRun === true,
            revision: currentRevision,
            changed: planned.changed,
            effects: planned.effects,
            warnings: planned.warnings,
            ...(planned.affectedSessions.length > 0
              ? { affectedSessions: planned.affectedSessions }
              : {}),
            ...(planned.evictedSessions.length > 0
              ? { evictedSessions: planned.evictedSessions }
              : {}),
            ...latestTransportRef.current,
          };
          if (request.params.dryRun === true || planned.changed.length === 0) {
            return { requestId, result };
          }

          let execution;
          try {
            execution = await executeTransport(request.method, request.params);
          } catch (error) {
            throw semanticFailure(
              "applicationFailed",
              "$.params",
              `Transport operation failed: ${error?.message || String(error)}`,
              -32050,
              {
                partial: true,
                stage: error?.stage ?? "execution",
                changed: planned.changed,
                revision: controlRevisionRef.current,
                ...(error?.sessionId ? { sessionId: error.sessionId } : {}),
              }
            );
          }

          if (request.method === "transport.live.clear") {
            bumpControlRevision();
            scheduleWaitWake();
            result.revision = controlRevisionRef.current;
          } else {
            const matches = (candidate) =>
              transportMutationMatches(request.method, request.params, execution, candidate);
            if (matches(latestTransportRef.current)) {
              result.revision = controlRevisionRef.current;
            } else {
              result.revision = await awaitSettlement(
                new Promise((resolve, reject) => {
                  transportSettlementRef.current = { matches, resolve, reject };
                }),
                () => {
                  transportSettlementRef.current = null;
                },
                "The Transport change"
              );
            }
          }
          Object.assign(result, latestTransportRef.current, execution?.result ?? {});
          if (Array.isArray(execution?.affectedSessions)) {
            result.affectedSessions = execution.affectedSessions;
          }
          if (Array.isArray(execution?.evictedSessions)) {
            result.evictedSessions = execution.evictedSessions;
          }
          return { requestId, result };
        }

        if (request.method === "settings.update") {
          const currentRevision = controlRevisionRef.current;
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

          const committed = new Promise((resolve, reject) => {
            settingsSettlementRef.current = {
              signature: settingsStateSignature(planned.settings),
              resolve,
              reject,
            };
          });
          try {
            await applySettings(planned.settings, {
              changed: planned.changed,
              effects: planned.effects,
            });
          } catch (error) {
            settingsSettlementRef.current = null;
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
                revision: controlRevisionRef.current,
              }
            );
          }
          result.revision = await awaitSettlement(
            committed,
            () => {
              settingsSettlementRef.current = null;
            },
            "The Settings change"
          );
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

        if (request.method === "preset.list") {
          return {
            requestId,
            result: {
              revision: controlRevisionRef.current,
              presets: (presets?.list ?? []).map(({ id, name }) => ({ id, name })),
              activeId: typeof presets?.activeId === "string" ? presets.activeId : null,
              dirty: presets?.dirty === true,
            },
          };
        }

        if (request.method === "preset.describe") {
          const currentRevision = controlRevisionRef.current;
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

        if (request.method === "preset.save" || request.method === "preset.update") {
          const assertRevisions = () => {
            if (request.params.expectedRevision !== controlRevisionRef.current) {
              throw semanticFailure(
                "revisionConflict",
                "$.params.expectedRevision",
                `App state changed after revision ${request.params.expectedRevision}.`,
                -32004,
                {
                  expectedRevision: request.params.expectedRevision,
                  currentRevision: controlRevisionRef.current,
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
          let planned =
            request.method === "preset.save"
              ? planPresetSave(state, request.params.name, snapshot)
              : planPresetUpdate(state, request.params.presetId, snapshot);
          if (planned.issues.length > 0) {
            throw semanticFailure(
              "invalidPreset",
              "$.params",
              "The Preset request is invalid.",
              -32602,
              { issues: planned.issues }
            );
          }
          const result = {
            dryRun: request.params.dryRun === true,
            changed: planned.changed,
            preset: planned.preset,
            presetState: planned.presetState,
            revision: controlRevisionRef.current,
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
          const committed = new Promise((resolve, reject) => {
            presetSettlementRef.current = {
              signature: presetStateSignature(planned.presets),
              resolve,
              reject,
            };
          });
          if (request.method === "preset.update") {
            const updated = presets.updateSnapshot(request.params.presetId, snapshot);
            if (!updated) {
              presetSettlementRef.current = null;
              throw semanticFailure(
                "presetNotFound",
                "$.params.presetId",
                "Preset was not found.",
                -32020
              );
            }
          }
          result.preset = planned.preset;
          result.presetState = planned.presetState;
          result.revision = await awaitSettlement(
            committed,
            () => {
              presetSettlementRef.current = null;
            },
            "The Preset change"
          );
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

        if (request.method === "preset.apply") {
          const assertRevisions = () => {
            if (request.params.expectedRevision !== controlRevisionRef.current) {
              throw semanticFailure(
                "revisionConflict",
                "$.params.expectedRevision",
                `App state changed after revision ${request.params.expectedRevision}.`,
                -32004,
                {
                  expectedRevision: request.params.expectedRevision,
                  currentRevision: controlRevisionRef.current,
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
          presets.preflightApplySnapshot(request.params.presetId);
          const resources = planPresetApplyResources(target, {
            loudnessProfiles,
            dockSupported: dock.supported === true,
            monitors: dockContext.monitors,
            fallbackMonitor: dockContext.fallbackMonitor,
            monitorInventoryReady: dockContext.monitorInventoryReady,
            monitorRects: dockContext.monitorRects,
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
          const currentSnapshot = await presets.captureSnapshot();
          assertRevisions();
          const scenePlan = planPresetApply(state, request.params.presetId, currentSnapshot);
          const planned = {
            ...scenePlan,
            warnings: [...resources.warnings, ...scenePlan.warnings],
          };
          const result = {
            dryRun: request.params.dryRun === true,
            changed: planned.changed,
            preset: planned.preset,
            presetState: planned.presetState,
            revision: controlRevisionRef.current,
            warnings: planned.warnings,
          };
          if (request.params.dryRun === true || planned.changed.length === 0) {
            return { requestId, result };
          }

          const presetStateChanged = planned.changed.some((path) => path.startsWith("presets."));
          const presetCommitted = presetStateChanged
            ? new Promise((resolve, reject) => {
                presetSettlementRef.current = {
                  signature: presetStateSignature(planned.presets),
                  resolve,
                  reject,
                };
              })
            : null;
          let workspaceCommitted = null;
          // What applying this Preset actually installs. Both the settlement below and the
          // persistence wait further down must compare against this, never against `target`. Built
          // only when the Workspace is really being replaced: a Preset that merely gets associated
          // need not carry a complete Workspace record.
          let targetView = null;
          if (planned.changed.includes("workspace")) {
            targetView = presetWorkspaceView(target);
            workspaceCommitted = new Promise((resolve, reject) => {
              settlementRef.current = {
                matches: (currentWorkspace) =>
                  workspaceMatchesPresetView(currentWorkspace, targetView),
                resolve,
                reject,
              };
            });
          }
          try {
            if (planned.applyScene) {
              const applied = await presets.applySnapshot(request.params.presetId, {
                applyWorkspace: planned.changed.includes("workspace"),
              });
              if (!applied) throw new Error("Preset target disappeared before application.");
            } else if (!presets.activateSnapshot(request.params.presetId)) {
              throw new Error("Preset target disappeared before activation.");
            }
          } catch (error) {
            settlementRef.current = null;
            presetSettlementRef.current = null;
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
                revision: controlRevisionRef.current,
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
              presetSettlementRef.current = null;
              settlementRef.current = null;
            },
            "The Preset application"
          );
          result.revision = controlRevisionRef.current;
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

        if (
          request.method === "preset.rename" ||
          request.method === "preset.delete" ||
          request.method === "preset.reorder"
        ) {
          const currentRevision = controlRevisionRef.current;
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
            throw semanticFailure(
              "invalidPreset",
              "$.params",
              "The Preset request is invalid.",
              -32602,
              { issues: planned.issues }
            );
          }
          const result = {
            dryRun: request.params.dryRun === true,
            changed: planned.changed,
            ...(planned.preset ? { preset: planned.preset } : {}),
            ...(planned.deletedPreset ? { deletedPreset: planned.deletedPreset } : {}),
            ...(planned.presetIds ? { presetIds: planned.presetIds } : {}),
            presetState: {
              activeId: planned.presets.activeId,
              dirty: planned.presets.dirty === true,
            },
            revision: currentRevision,
            warnings: planned.warnings,
          };
          if (request.params.dryRun === true || planned.changed.length === 0) {
            return { requestId, result };
          }

          const committed = new Promise((resolve, reject) => {
            presetSettlementRef.current = {
              signature: presetStateSignature(planned.presets),
              resolve,
              reject,
            };
          });
          if (request.method === "preset.rename") {
            presets.rename(request.params.presetId, planned.preset.name);
          } else if (request.method === "preset.delete") {
            presets.remove(request.params.presetId);
          } else {
            presets.reorder(planned.presetIds);
          }
          result.revision = await awaitSettlement(
            committed,
            () => {
              presetSettlementRef.current = null;
            },
            "The Preset order"
          );
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

        if (request.method === "axis.describe" || request.method === "axis.inspect") {
          const inspection = buildAxisInspection(workspace);
          return {
            requestId,
            result: {
              revision: controlRevisionRef.current,
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
          const currentRevision = controlRevisionRef.current;
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

          const committed = new Promise((resolve, reject) => {
            settlementRef.current = {
              view: planned.workspace,
              matches: (currentWorkspace) => axisStateMatches(currentWorkspace, planned.workspace),
              resolve,
              reject,
            };
          });
          replaceWorkspace(planned.workspace);
          result.revision = await awaitSettlement(
            committed,
            () => {
              settlementRef.current = null;
            },
            "The axis change"
          );
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
              revision: controlRevisionRef.current,
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
          const currentRevision = controlRevisionRef.current;
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
          result.revision = await awaitSettlement(
            committed,
            () => {
              settlementRef.current = null;
            },
            "The panel controls change"
          );
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

        const currentRevision = controlRevisionRef.current;
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

        const committed = new Promise((resolve, reject) => {
          settlementRef.current = {
            view: compiled.view,
            matches: (currentWorkspace) => workspaceMatches(currentWorkspace, compiled.view),
            resolve,
            reject,
          };
        });
        replaceWorkspace(compiled.view);
        const committedRevision = await awaitSettlement(
          committed,
          () => {
            settlementRef.current = null;
          },
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
      } catch (error) {
        const semantic =
          error instanceof WorkspaceLayoutError
            ? semanticFailure(error.reason, error.path, error.message, -32602)
            : isSceneOperationRefused(error)
              ? semanticFailure(error.code, "$", error.message, -32040, {
                  operation: error.operation,
                  ...(Array.isArray(error.editors) ? { editors: error.editors } : {}),
                  ...(typeof error.reason === "string" ? { reason: error.reason } : {}),
                })
              : error;
        return { requestId, error: agentControlRpcError(semantic) };
      }
    };
  }, [
    flush,
    bumpControlRevision,
    hasLoudnessReference,
    loudnessProfiles,
    analysisContext,
    applySettings,
    executeTransport,
    dock,
    dockContext,
    executeDock,
    presets,
    replaceWorkspace,
    runtime,
    scheduleWaitWake,
    settings,
    settingsContext,
    transport,
    transportContext,
    setPanelControlsForPanel,
    waitForWorkspacePersistenceEnqueue,
    workspace,
  ]);

  useEffect(() => {
    if (!enabled) return undefined;
    const waiters = waitersRef.current;
    aliveRef.current = true;
    // Per-run, unlike `aliveRef`: a remount sets that shared ref back to true, so an install left
    // over from the previous run cannot use it to tell that its own run was torn down. Believing
    // it could is what left two listeners attached, and every request then ran twice.
    let cancelled = false;
    let unlisten = null;
    let ready = false;

    const install = async () => {
      const stop = await listenForAgentControlRequests((request) => {
        if (request?.type === "cancel" && typeof request.requestId === "string") {
          const waiter = waiters.get(request.requestId);
          if (waiter) {
            clearTimeout(waiter.timer);
            waiters.delete(request.requestId);
            waiter.resolve(WAIT_CANCELLED);
          }
          return;
        }
        const respond = (processing) =>
          processing
            .then((response) => {
              if (response && aliveRef.current) return respondToAgentControlRequest(response);
              return undefined;
            })
            .catch(() => undefined);
        if (request?.method === "app.wait") {
          void respond(processRef.current(request));
          return;
        }
        queueRef.current = queueRef.current.then(() => processRef.current(request));
        void respond(queueRef.current);
      });
      if (cancelled) {
        stop();
        return;
      }
      unlisten = stop;
      await announceAgentControlFrontendReady();
      if (cancelled) {
        // Teardown ran during the announce, so it saw `ready` still false and left the broker
        // believing a frontend is listening. Undo both halves here.
        unlisten?.();
        unlisten = null;
        void announceAgentControlFrontendNotReady();
        return;
      }
      ready = true;
    };
    void install().catch(() => {
      unlisten?.();
      unlisten = null;
    });

    return () => {
      cancelled = true;
      aliveRef.current = false;
      const settlement = settlementRef.current;
      settlementRef.current = null;
      settlement?.reject(new Error("Agent-control bridge unmounted."));
      const presetSettlement = presetSettlementRef.current;
      presetSettlementRef.current = null;
      presetSettlement?.reject(new Error("Agent-control bridge unmounted."));
      const settingsSettlement = settingsSettlementRef.current;
      settingsSettlementRef.current = null;
      settingsSettlement?.reject(new Error("Agent-control bridge unmounted."));
      const transportSettlement = transportSettlementRef.current;
      transportSettlementRef.current = null;
      transportSettlement?.reject(new Error("Agent-control bridge unmounted."));
      const dockSettlement = dockSettlementRef.current;
      dockSettlementRef.current = null;
      dockSettlement?.reject(new Error("Agent-control bridge unmounted."));
      for (const waiter of waiters.values()) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error("Agent-control bridge unmounted."));
      }
      waiters.clear();
      unlisten?.();
      unlisten = null;
      if (ready) void announceAgentControlFrontendNotReady();
    };
  }, [enabled]);
}
