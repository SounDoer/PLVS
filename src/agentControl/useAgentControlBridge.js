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
import { agentControlRpcError } from "./protocol.js";
import { createRevisionClock } from "./bridge/revisionClock.js";
import { createWaiters } from "./bridge/waiters.js";
import { createVisualBookkeeping } from "./bridge/visualBookkeeping.js";
import { METHOD_TABLE } from "./handlers/index.js";
import { createDomainRunner } from "./bridge/domains.js";
import { createSettlementRegistry } from "./bridge/settlement.js";
import { createLatestInputs, createRequestProcessor, isDirectLane } from "./bridge/pipeline.js";
import { semanticFailure, QUEUED_REQUEST_TIMEOUT_MS, WAIT_CANCELLED } from "./bridge/failures.js";
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

  // The bridge core. Created once per hook instance; state is used only for its lazy initializer.
  const [{ latestInputs, clock, waiters, settlement, visualBook, observeCommit, processRequest }] =
    useState(() => {
      const inputsHolder = createLatestInputs(inputs);
      const waitRegistry = createWaiters();
      const revisionClock = createRevisionClock({
        onWake: (revision) => waitRegistry.wakeRevision(revision),
      });
      const settlementRegistry = createSettlementRegistry(revisionClock);
      const visualBookkeeping = createVisualBookkeeping();
      return {
        latestInputs: inputsHolder,
        waiters: waitRegistry,
        clock: revisionClock,
        settlement: settlementRegistry,
        visualBook: visualBookkeeping,
        processRequest: createRequestProcessor({
          latestInputs: inputsHolder.get,
          clock: revisionClock,
          settlement: settlementRegistry,
          waiters: waitRegistry,
          visual: visualBookkeeping,
          table: METHOD_TABLE,
        }),
        observeCommit: createDomainRunner({
          clock: revisionClock,
          settlement: settlementRegistry,
          recordings: visualBookkeeping.recordings,
          initialInputs: inputs,
        }),
      };
    });

  // After every commit: refresh what commands read as the latest inputs, then let each domain's
  // watcher look at the commit. The refresh comes first because the Device watcher reads the
  // Transport of the same commit. The runner compares each domain's own dependencies, so this
  // deliberately has no dependency array.
  useEffect(() => {
    latestInputs.set(inputs);
    observeCommit(inputs);
  });

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
      return Promise.race([processRequest(request), backstop]).finally(() => clearTimeout(timer));
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
        if (isDirectLane(METHOD_TABLE, request?.method)) {
          void respond(processRequest(request));
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
      const visualControl = latestInputs.get().visual;
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
  }, [latestInputs, processRequest, settlement, visualBook, clock, waiters, enabled]);
}
