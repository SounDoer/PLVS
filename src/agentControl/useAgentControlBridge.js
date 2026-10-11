import { useEffect, useMemo, useRef, useState } from "react";
import {
  announceAgentControlFrontendNotReady,
  announceAgentControlFrontendReady,
  listenForAgentControlRequests,
  respondToAgentControlRequest,
} from "../ipc/agentControlEvents.js";
import { flushPersistence } from "../persistence/index.js";
import { exportProfile, importProfile, reloadAfterProfileChange } from "../persistence/profile.js";
import { normalizeImportedProfile } from "../persistence/profileShape.js";
import { isSceneOperationRefused } from "../lib/sceneOperations.js";
import { agentControlRpcError, normalizeAgentControlRequest } from "./protocol.js";
import {
  isDevelopmentFixtureMethod,
  normalizeDevelopmentFixtureRequest,
} from "./developmentFixtureProtocol.js";
import { WorkspaceLayoutError } from "./workspaceLayout.js";
import { createRevisionClock } from "./bridge/revisionClock.js";
import { createWaiters } from "./bridge/waiters.js";
import { createVisualBookkeeping } from "./bridge/visualBookkeeping.js";
import { METHOD_TABLE } from "./handlers/index.js";
import { createDomainRunner } from "./bridge/domains.js";
import { createSettlementRegistry } from "./bridge/settlement.js";
import {
  semanticFailure,
  QUEUED_REQUEST_TIMEOUT_MS,
  isCommitNotObserved,
  persistUnobservedCommit,
  WAIT_CANCELLED,
} from "./bridge/failures.js";
import { themeStateSignature, loudnessProfileStateSignature } from "./bridge/signatures.js";

/**
 * What the app hands the bridge besides the workspace: one record per area Agent Control can
 * inspect or drive. Each is listed as App builds it. The bridge takes them partially, because it
 * defaults every one and a caller that exposes a single area passes only that area's.
 *
 * @typedef {{
 *   available: boolean,
 *   enabled?: boolean,
 *   appName?: any,
 *   appVersion?: any,
 *   identifier?: any,
 *   platform?: any,
 * }} AgentControlRuntime
 *
 * @typedef {{
 *   autostartReady: boolean,
 *   clearShortcutReady: boolean,
 *   clearShortcutCapturing: boolean,
 *   clearShortcutRegistrationError: any,
 *   dialogueDetectionRequested: boolean,
 *   dialogueDetectionActive: any,
 *   hasCompletedFileAnalysis: any,
 *   sourceMode: any,
 *   channelCount: any,
 *   channelLabelMode: string,
 *   channelLabelRoles: any,
 *   channelAutoRoles: string[],
 * }} AgentControlSettingsContext
 *
 * @typedef {{
 *   docked: boolean,
 *   deviceTransitioning: boolean,
 *   historyAvailable: boolean,
 *   historyMaxOffsetSec: number,
 * }} AgentControlTransportContext
 *
 * @typedef {{
 *   snapshot: any,
 *   live: any,
 *   previewSelection: (...args: any[]) => any,
 *   commitSelection: (...args: any[]) => any,
 *   beginRestart: any,
 *   runtimeUnavailable: boolean,
 * }} AgentControlDevice
 *
 * @typedef {{
 *   sourceMode: any,
 *   activeEditors: any,
 *   transitioning: boolean,
 *   monitors: any[],
 *   fallbackMonitor: any,
 *   monitorRects: any[],
 *   monitorInventoryReady: boolean,
 *   readMonitorInventory?: () => Promise<Partial<AgentControlDockContext>>,
 *   channelCount: any,
 *   channelLabels: string[],
 *   dialogueDetectionActive: boolean,
 *   spectralWaveformActive: any,
 *   timeMaxWindowSec: number,
 *   timeMaxOffsetSec: number,
 *   platform: any,
 * }} AgentControlDockContext
 *
 * @typedef {{
 *   control: any,
 *   state: { appearance: any; themes: any[]; },
 * }} AgentControlTheme
 *
 * @typedef {{
 *   getLiveMeasurement: any,
 *   subscribeLiveMeasurement: any,
 *   getChannelLabels: (...args: any[]) => any,
 *   liveState: any,
 *   vectorscopeRequests: any,
 *   dialogueActive: boolean,
 * }} AgentControlMeasurementContext
 *
 * @typedef {{
 *   view: any,
 *   platform: any,
 *   docked: boolean,
 *   applyView: (...args: any[]) => any,
 * }} AgentControlViewContext
 *
 * @typedef {{
 *   platformCapabilities: any,
 *   getRuntime: (...args: any[]) => any,
 *   settle: (...args: any[]) => any,
 *   captureScreenshot: (...args: any[]) => any,
 *   startRecording: (...args: any[]) => any,
 *   inspectRecording: (...args: any[]) => any,
 *   stopRecording: (...args: any[]) => any,
 *   updateRecordingGeometry: (...args: any[]) => any,
 *   updateRecordingAudioState: (...args: any[]) => any,
 *   subscribe: (...args: any[]) => any,
 *   setRecordingState: (...args: any[]) => any,
 * }} AgentControlVisual
 */

/**
 * @param {{
 *   enabled: boolean,
 *   runtime: AgentControlRuntime,
 *   workspace: import("../workspace/types.js").WorkspaceState,
 *   replaceWorkspace: (...args: any[]) => any,
 *   setPanelControlsForPanel: (...args: any[]) => any,
 *   waitForWorkspacePersistenceEnqueue: (...args: any[]) => any,
 *   presets: import("../hooks/usePresets.js").PresetsApi,
 *   settings: ReturnType<typeof import("./settingsControl.js").buildPublicSettings>,
 *   settingsContext?: Partial<AgentControlSettingsContext>,
 *   applySettings?: (...args: any[]) => any,
 *   transport: ReturnType<typeof import("./transportControl.js").buildTransportSnapshot>,
 *   transportContext?: Partial<AgentControlTransportContext>,
 *   executeTransport?: (...args: any[]) => any,
 *   device?: Partial<AgentControlDevice>,
 *   dock: import("../workspace/types.js").AgentControlDock,
 *   dockContext?: Partial<AgentControlDockContext>,
 *   executeDock?: (...args: any[]) => any,
 *   loudnessProfiles?: import("../hooks/LoudnessProfileContext.jsx").LoudnessProfileDocument[],
 *   loudnessProfile?: import("../hooks/LoudnessProfileContext.jsx").LoudnessProfileApi,
 *   customThemes?: ReturnType<typeof import("../hooks/useSettings.js").useSettings>["customThemes"],
 *   theme?: Partial<AgentControlTheme>,
 *   hasLoudnessReference?: boolean,
 *   analysisContext?: Partial<import("./appSnapshot.js").AgentControlAnalysisContext>,
 *   measurementContext?: Partial<AgentControlMeasurementContext>,
 *   viewContext?: Partial<AgentControlViewContext>,
 *   visual?: Partial<AgentControlVisual>,
 *   uiNavigation?: ReturnType<typeof import("../uiNavigation/UiNavigationContext.jsx").useUiNavigation>,
 *   editorDraft?: ReturnType<typeof import("./EditorDraftContext.jsx").useEditorDraftRegistry>,
 *   developmentFixtures?: ReturnType<typeof import("../dev/DevelopmentEventFixturesContext.jsx").useDevelopmentEventFixtures>,
 *   flush?: (...args: any[]) => any,
 *   exportConfiguration?: (...args: any[]) => any,
 *   importConfiguration?: (...args: any[]) => any,
 *   normalizeConfiguration?: (...args: any[]) => any,
 *   relaunchAfterConfigurationChange?: (...args: any[]) => any,
 * }} options
 */
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
  device = null,
  dock,
  dockContext = {},
  executeDock = async () => {},
  loudnessProfiles: loudnessProfilesInput = [],
  loudnessProfile = null,
  customThemes = {},
  theme = null,
  hasLoudnessReference = false,
  analysisContext = {},
  measurementContext = {},
  viewContext = {},
  visual = null,
  uiNavigation = null,
  editorDraft = null,
  developmentFixtures = null,
  flush = flushPersistence,
  exportConfiguration = exportProfile,
  importConfiguration = importProfile,
  normalizeConfiguration = normalizeImportedProfile,
  relaunchAfterConfigurationChange = reloadAfterProfileChange,
}) {
  const loudnessProfiles = loudnessProfile?.profiles ?? loudnessProfilesInput;
  const loudnessActive = loudnessProfile?.active;
  const providedThemeState = theme?.state;
  const themeState = useMemo(
    () =>
      providedThemeState ?? {
        appearance: { mode: "system", selectedThemeId: null, resolvedThemeId: "plvs-dark" },
        themes: Object.values(customThemes ?? {}),
      },
    [customThemes, providedThemeState]
  );
  const themeControl = theme?.control ?? null;
  const themeSignature = themeStateSignature(themeState);
  const aliveRef = useRef(false);
  const loudnessSignature = loudnessProfileStateSignature(loudnessProfiles, loudnessActive);
  const processRef = useRef(null);
  const queueRef = useRef(Promise.resolve());

  /// Everything the bridge was handed, as of the latest commit. A command reads it twice over: once
  /// when it starts, for the state it plans against, and again after an `await`, for the state
  /// React has rendered since.
  const inputs = {
    enabled,
    runtime,
    workspace,
    replaceWorkspace,
    setPanelControlsForPanel,
    waitForWorkspacePersistenceEnqueue,
    presets,
    settings,
    settingsContext,
    applySettings,
    transport,
    transportContext,
    executeTransport,
    device,
    dock,
    dockContext,
    executeDock,
    loudnessProfiles,
    loudnessProfile,
    loudnessActive,
    loudnessSignature,
    themeState,
    themeControl,
    themeSignature,
    hasLoudnessReference,
    analysisContext,
    measurementContext,
    viewContext,
    visual,
    uiNavigation,
    editorDraft,
    developmentFixtures,
    flush,
    exportConfiguration,
    importConfiguration,
    normalizeConfiguration,
    relaunchAfterConfigurationChange,
  };
  const inputsRef = useRef(inputs);
  // Declared before the watchers: the Device watcher reads the Transport of the same commit.
  useEffect(() => {
    inputsRef.current = inputs;
  });

  // Created once per hook instance; state is used only for its lazy initializer.
  const [{ clock, waiters, settlement, visualBook, observeCommit }] = useState(() => {
    const waitRegistry = createWaiters();
    const revisionClock = createRevisionClock({
      onWake: (revision) => waitRegistry.wakeRevision(revision),
    });
    const settlementRegistry = createSettlementRegistry(revisionClock);
    const visualBookkeeping = createVisualBookkeeping();
    return {
      waiters: waitRegistry,
      clock: revisionClock,
      settlement: settlementRegistry,
      visualBook: visualBookkeeping,
      observeCommit: createDomainRunner({
        clock: revisionClock,
        settlement: settlementRegistry,
        recordings: visualBookkeeping.recordings,
        initialInputs: inputs,
      }),
    };
  });

  // One effect for every domain, after the inputs refresh above. The runner compares each domain's
  // own dependencies, so this deliberately has no dependency array.
  useEffect(() => {
    observeCommit(inputs);
  });

  useEffect(() => {
    // Dock panels share the Workspace panel mapping, which offers and keeps the Loudness reference
    // layer only when this is set; the bare Dock context never carried it.

    processRef.current = async (rawRequest) => {
      const snap = inputsRef.current;
      const developmentFixtureRequest =
        developmentFixtures?.enabled && isDevelopmentFixtureMethod(rawRequest?.method);
      const normalized = developmentFixtureRequest
        ? normalizeDevelopmentFixtureRequest(rawRequest)
        : normalizeAgentControlRequest(rawRequest);
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
      const revisionBatch =
        request.method.startsWith("visual.") || request.params.expectedRevision === undefined
          ? null
          : clock.beginBatch();
      try {
        let dockRequestContext = { ...dockContext, hasLoudnessReference };
        if (
          ["dock.describe", "dock.enter", "preset.apply"].includes(request.method) &&
          dockContext.readMonitorInventory
        ) {
          try {
            dockRequestContext = {
              ...dockRequestContext,
              ...(await dockContext.readMonitorInventory()),
            };
          } catch (error) {
            throw semanticFailure(
              "commandFailed",
              "$",
              `Monitor inventory could not be read: ${error?.message || String(error)}`,
              -32603
            );
          }
        }
        const entry = METHOD_TABLE[request.method];
        if (entry) {
          return await entry.run({
            request,
            requestId,
            snap,
            live: () => inputsRef.current,
            clock,
            settlement,
            waiters,
            visual: visualBook,
            dockRequestContext,
            flush: snap.flush,
          });
        }
        if (isDevelopmentFixtureMethod(request.method)) {
          try {
            if (request.params.expectedRevision !== clock.current()) {
              throw Object.assign(new Error("The Agent Control revision changed."), {
                reason: "revisionConflict",
                details: {
                  expectedRevision: request.params.expectedRevision,
                  currentRevision: clock.current(),
                },
              });
            }
            const result =
              request.method === "dev.fixture.establish"
                ? await developmentFixtures.establish(request.params)
                : await developmentFixtures.reset(request.params);
            return {
              requestId,
              result: { ...result, revision: clock.current() },
            };
          } catch (error) {
            if (typeof error?.reason !== "string") throw error;
            throw semanticFailure(
              error.reason,
              error.reason === "uiGenerationConflict"
                ? "$.params.expectedUiGeneration"
                : error.reason === "revisionConflict"
                  ? "$.params.expectedRevision"
                  : "$.params",
              error.message,
              error.reason === "revisionConflict" ? -32004 : -32042,
              error.details
            );
          }
        }
      } catch (error) {
        // One place rather than nine: `isCommitNotObserved` is true only for the settlement
        // timeout, so every pre-commit failure -- validation, `revisionConflict`, `editorActive`,
        // a refused scene operation -- still reaches here without touching the disk.
        if (isCommitNotObserved(error)) {
          return {
            requestId,
            error: agentControlRpcError(await persistUnobservedCommit(error, flush)),
          };
        }
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
      } finally {
        clock.endBatch(revisionBatch);
      }
    };
  }, [
    settlement,
    visualBook,
    clock,
    waiters,
    flush,
    exportConfiguration,
    importConfiguration,
    normalizeConfiguration,
    relaunchAfterConfigurationChange,
    hasLoudnessReference,
    loudnessActive,
    loudnessProfile,
    loudnessProfiles,
    analysisContext,
    measurementContext,
    viewContext,
    visual,
    uiNavigation,
    editorDraft,
    developmentFixtures,
    applySettings,
    executeTransport,
    device,
    dock,
    dockContext,
    executeDock,
    presets,
    replaceWorkspace,
    runtime,
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
    const waiterEntries = waiters.entries;
    const ownedVisualCaptures = visualBook.captures;
    const visualRecordings = visualBook.recordings;
    aliveRef.current = true;
    // Per-run, unlike `aliveRef`: a remount sets that shared ref back to true, so an install left
    // over from the previous run cannot use it to tell that its own run was torn down. Believing
    // it could is what left two listeners attached, and every request then ran twice.
    let cancelled = false;
    let unlisten = null;
    let ready = false;

    const processWithBackstop = (request) => {
      let timer;
      const backstop = new Promise((resolve) => {
        timer = setTimeout(() => {
          // The abandoned command has not reached its own cleanup, so its revision batch would stay
          // installed and swallow every later revision bump. Its cleanup checks identity, so a late
          // finish cannot clear a batch that belongs to a later command.
          clock.abandonBatch();
          resolve({
            requestId: typeof request?.id === "string" ? request.id : "",
            error: agentControlRpcError(
              semanticFailure(
                "requestNotSettled",
                "$",
                `${request?.method} did not finish within ${QUEUED_REQUEST_TIMEOUT_MS} ms. It may still complete; inspect before retrying.`,
                -32032,
                { method: request?.method, timeoutMs: QUEUED_REQUEST_TIMEOUT_MS }
              )
            ),
          });
        }, QUEUED_REQUEST_TIMEOUT_MS);
      });
      return Promise.race([processRef.current(request), backstop]).finally(() =>
        clearTimeout(timer)
      );
    };

    const install = async () => {
      const stop = await listenForAgentControlRequests((request) => {
        if (request?.type === "cancel" && typeof request.requestId === "string") {
          ownedVisualCaptures.get(request.requestId)?.abort();
          const waiter = waiterEntries.get(request.requestId);
          if (waiter) {
            clearTimeout(waiter.timer);
            clearTimeout(waiter.holdTimer);
            waiter.unsubscribe?.();
            waiterEntries.delete(request.requestId);
            waiter.resolve(WAIT_CANCELLED);
          }
          return;
        }
        const respond = (processing) =>
          processing
            .then(async (response) => {
              if (!response || !aliveRef.current) return;
              const { afterResponse, ...wireResponse } = response;
              await respondToAgentControlRequest(wireResponse);
              if (afterResponse && aliveRef.current) await afterResponse();
            })
            .catch(() => undefined);
        if (
          request?.method === "app.wait" ||
          request?.method === "measurement.wait" ||
          request?.method === "measurement.waitUntil" ||
          request?.method === "measurement.describe" ||
          request?.method === "measurement.inspect" ||
          request?.method?.startsWith("visual.")
        ) {
          void respond(processRef.current(request));
          return;
        }
        queueRef.current = queueRef.current.then(() => processWithBackstop(request));
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
      settlement.rejectAll(new Error("Agent-control bridge unmounted."));
      for (const waiter of waiterEntries.values()) {
        clearTimeout(waiter.timer);
        clearTimeout(waiter.holdTimer);
        waiter.unsubscribe?.();
        waiter.reject(new Error("Agent-control bridge unmounted."));
      }
      waiterEntries.clear();
      for (const controller of ownedVisualCaptures.values()) controller.abort();
      ownedVisualCaptures.clear();
      const visualControl = inputsRef.current.visual;
      for (const [recordingId, metadata] of visualRecordings) {
        metadata.unsubscribe?.();
        metadata.unsubscribe = null;
        void visualControl?.stopRecording?.(recordingId).catch(() => undefined);
      }
      if (visualRecordings.size > 0) {
        visualControl?.setRecordingState?.("stopping");
      }
      unlisten?.();
      unlisten = null;
      if (ready) void announceAgentControlFrontendNotReady();
    };
  }, [settlement, visualBook, clock, waiters, enabled]);
}
