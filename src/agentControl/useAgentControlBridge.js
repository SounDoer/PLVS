import { useEffect, useMemo, useRef, useState } from "react";
import {
  announceAgentControlFrontendNotReady,
  announceAgentControlFrontendReady,
  listenForAgentControlRequests,
  respondToAgentControlRequest,
} from "../ipc/agentControlEvents.js";
import { flushPersistence } from "../persistence/index.js";
import { exportProfile, importProfile, reloadAfterProfileChange } from "../persistence/profile.js";
import { normalizeImportedProfile, ProfileValidationError } from "../persistence/profileShape.js";
import { describeActiveLoudnessProfile } from "../lib/activeLoudnessProfile.js";
import { buildFileAnalysisReport } from "../lib/fileAnalysisReport.js";
import { renderFileAnalysisReportMarkdown } from "../lib/fileAnalysisReportMarkdown.js";
import { normalizeRuleDocument } from "../lib/loudnessProfileNormalize.js";
import { presetWorkspaceView } from "../lib/presetWorkspaceView.js";
import { isSceneOperationRefused } from "../lib/sceneOperations.js";
import {
  agentControlRpcError,
  DEVICE_CONTROL_METHODS,
  isTransportAction,
  normalizeAgentControlRequest,
} from "./protocol.js";
import {
  isDevelopmentFixtureMethod,
  normalizeDevelopmentFixtureRequest,
} from "./developmentFixtureProtocol.js";
import { buildDeviceList, planDeviceSelection } from "./deviceControl.js";
import {
  buildAxisInspection,
  buildAxisSchema,
  planPanelAxisReset,
  planPanelAxisUpdate,
  planSharedAxisReset,
  planSharedAxisUpdate,
} from "./axisControl.js";
import { buildAgentControlPanelSnapshot } from "./appSnapshot.js";
import { planPublicPanelControlPatch, planPublicPanelReset } from "./panelControlPatch.js";
import { buildPublicPanelControlSchema } from "./panelControlSchema.js";
import {
  buildModuleDescription,
  buildModuleDescriptionContext,
  buildModuleList,
} from "./moduleControl.js";
import { buildPublicPresetSnapshot } from "./presetSnapshot.js";
import { buildMeasurementDescription, buildMeasurementInspection } from "./measurementControl.js";
import { measurementPredicateMatches } from "./measurementPredicates.js";
import { buildVisualDescription } from "./visualControl.js";
import {
  buildViewDescription,
  buildViewInspection,
  planViewReset,
  planViewUpdate,
  viewStateSignature,
} from "./viewControl.js";
import { planPresetDelete, planPresetRename, planPresetReorder } from "./presetLibrary.js";
import {
  buildLibraryList,
  libraryFamily,
  planLibraryExport,
  planLibraryImport,
} from "./libraryTransfer.js";
import { PackValidationError } from "../transfer/packShape.js";
import { describeEditorDraft, planEditorDraftPatch } from "./editorDraftControl.js";
import { BUILTIN_THEMES_V2 } from "../theme/builtinThemesV2.js";
import { listThemeSummaries } from "../theme/themeLibrary.js";
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
import { planTransportMutation, projectTransportMutation } from "./transportControl.js";
import {
  buildDockDescription,
  buildDockPanelDescription,
  buildDockSnapshot,
  compileDockLayout,
  dockStateSignature,
  planDockFormMutation,
  planDockPanelPatch,
  planDockPanelReset,
  reconcileDockExecution,
} from "./dockControl.js";
import {
  compileWorkspaceLayout,
  serializeWorkspaceLayout,
  WorkspaceLayoutError,
} from "./workspaceLayout.js";
import { createRevisionClock } from "./bridge/revisionClock.js";
import { createWaiters } from "./bridge/waiters.js";
import { METHOD_TABLE } from "./handlers/index.js";
import { deviceInspection, panelResultPreset, viewResultPreset } from "./handlers/shared.js";
import { createDomainRunner } from "./bridge/domains.js";
import { awaitSettlement, createSettlementRegistry } from "./bridge/settlement.js";
import {
  semanticFailure,
  visualSemanticFailure,
  SETTLEMENT_TIMEOUT_MS,
  QUEUED_REQUEST_TIMEOUT_MS,
  COMMIT_NOT_OBSERVED,
  isCommitNotObserved,
  persistUnobservedCommit,
  WAIT_CANCELLED,
} from "./bridge/failures.js";
import {
  measuredAudioState,
  workspaceMatches,
  panelControlsMatch,
  axisStateMatches,
  presetStateSignature,
  themeStateSignature,
  loudnessProfileStateSignature,
  activeLoudnessProfileId,
  workspaceMatchesPresetView,
  settingsStateSignature,
} from "./bridge/signatures.js";

const EDITOR_DRAFT_SETTLEMENT_TIMEOUT_MS = 500;

async function settleEditorDraftObservation({
  editorDraft,
  uiNavigation,
  kind,
  surfaceId,
  decisionSurfaceId = null,
  discarded = false,
}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= EDITOR_DRAFT_SETTLEMENT_TIMEOUT_MS) {
    const ui = uiNavigation.inspectUi();
    if (discarded) {
      const gone = !ui.surfaces.some(
        (surface) => surface.surfaceId === surfaceId || surface.surfaceId === decisionSurfaceId
      );
      if (gone) return { ui, snapshot: null };
    } else {
      const snapshot = editorDraft.inspect(kind, surfaceId);
      const surface = ui.surfaces.find((candidate) => candidate.surfaceId === surfaceId);
      if (
        surface &&
        (surface.dirty === true) === (snapshot.dirty === true) &&
        (surface.stale === true) === (snapshot.stale === true)
      ) {
        return { ui, snapshot };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw semanticFailure(
    "draftNotSettled",
    "$.params.surfaceId",
    "The editor accepted the action but its public UI observation did not settle in time.",
    -32043,
    { surfaceId, stateCommitted: true }
  );
}

function publicRecording(recording) {
  const { audioSource, ...publicValue } = recording ?? {};
  return {
    ...publicValue,
    audio: recording?.audio ?? { source: audioSource === "measuredSource" ? audioSource : "none" },
  };
}

function compactThemeState(state) {
  return {
    appearance: state.appearance,
    themes: listThemeSummaries(state),
  };
}

/**
 * @param {string} method
 */
function themePlanResult(method, planned) {
  if (method === "theme.select" || method === "theme.followSystem") {
    return {
      previousAppearance: planned.previousAppearance,
      appearance: planned.appearance,
    };
  }
  if (method === "theme.create") {
    return {
      document: planned.document,
      selectCreated: true,
      ...(planned.theme ? { theme: planned.theme } : {}),
    };
  }
  if (method === "theme.duplicate") {
    return {
      source: planned.source,
      name: planned.name,
      selectCreated: true,
      ...(planned.theme ? { theme: planned.theme } : {}),
    };
  }
  if (method === "theme.delete") {
    return {
      deletedTheme: planned.deletedTheme,
      ...(planned.fallbackThemeId ? { fallbackThemeId: planned.fallbackThemeId } : {}),
    };
  }
  if (method === "theme.reorder") return { themeIds: planned.themeIds };
  return { theme: planned.theme };
}

function compactLoudnessProfileState(state, previewDocument = null) {
  const profiles = state.profiles.map(({ id, name }) => ({ id, name }));
  if (previewDocument) profiles.push({ id: null, name: previewDocument.name });
  return {
    profiles,
    activeId: previewDocument ? null : activeLoudnessProfileId(state.profiles, state.active),
  };
}

function isDifferentPublishedMeasurement(live, afterGeneration, afterSequence) {
  const sequence = live?.record?.sequence;
  if (!Number.isSafeInteger(sequence)) return false;
  return live.generation !== afterGeneration || sequence !== (afterSequence ?? null);
}

/**
 * @param {string} method
 */
function transportMutationMatches(method, params, execution, snapshot) {
  const sessionId = execution?.sessionId ?? params.sessionId;
  if (method === "transport.snapshot.select") {
    return snapshot.snapshot.active && snapshot.snapshot.offsetSec === params.offsetSec;
  }
  if (method === "transport.snapshot.clear") return !snapshot.snapshot.active;
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
    const visualBookkeeping = {
      captures: new Map(),
      recordings: new Map(),
      captureActive: { current: false },
    };
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
    const ownedVisualCaptures = visualBook.captures;
    const buildCurrentMeasurement = (liveOverride) => {
      const currentMeasurement = inputsRef.current.measurementContext;
      const currentProfile = {
        active: inputsRef.current.loudnessActive,
        profile: inputsRef.current.loudnessProfile,
      };
      const live = liveOverride ??
        currentMeasurement.getLiveMeasurement?.() ?? {
          generation: 0,
          record: null,
        };
      const record = live.record ?? null;
      const labels = currentMeasurement.getChannelLabels?.(record) ?? [];
      const profile = describeActiveLoudnessProfile({
        active: currentProfile.active,
        document: currentProfile.profile?.document,
        draft: currentProfile.profile?.draft,
      });
      return buildMeasurementInspection({
        revision: clock.current(),
        observedAtMs: Date.now(),
        liveState: currentMeasurement.liveState,
        sessionGeneration: live.generation,
        record,
        channelLabels: labels,
        vectorscopeRequest: currentMeasurement.vectorscopeRequests?.[0] ?? null,
        dialogueActive: currentMeasurement.dialogueActive === true,
        profile,
      });
    };
    const buildMeasurementOrFail = (liveOverride) => {
      try {
        return buildCurrentMeasurement(liveOverride);
      } catch (error) {
        throw semanticFailure(
          "measurementSnapshotFailed",
          "$",
          `The LIVE measurement snapshot could not be formed: ${error?.message || String(error)}`,
          -32072
        );
      }
    };

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
        if (request.method === "editorDraft.describe") {
          const kind = request.params.kind === "loudness-profile" ? "loudnessProfile" : "theme";
          return {
            requestId,
            result: {
              revision: clock.current(),
              ...describeEditorDraft(kind),
            },
          };
        }
        if (request.method === "editorDraft.inspect") {
          const kind = request.params.kind === "loudness-profile" ? "loudnessProfile" : "theme";
          if (!editorDraft?.inspect || !uiNavigation?.inspectUi) {
            throw semanticFailure(
              "surfaceUnavailable",
              "$.method",
              "Editor draft control is unavailable in the current app state.",
              -32042
            );
          }
          try {
            const snapshot = editorDraft.inspect(kind, request.params.surfaceId);
            const ui = uiNavigation.inspectUi();
            const surface = ui.surfaces.find(
              ({ surfaceId }) => surfaceId === request.params.surfaceId
            );
            if (!surface) {
              throw semanticFailure(
                "editorDraftNotFound",
                "$.params.surfaceId",
                "The requested editor draft is no longer open.",
                -32042
              );
            }
            const { id: _internalId, ...document } = snapshot.document;
            return {
              requestId,
              result: {
                revision: clock.current(),
                uiGeneration: ui.uiGeneration,
                draftGeneration: snapshot.draftGeneration,
                kind,
                surfaceId: request.params.surfaceId,
                dirty: snapshot.dirty === true,
                stale: snapshot.stale === true,
                history: {
                  canUndo: snapshot.canUndo === true,
                  canRedo: snapshot.canRedo === true,
                },
                target: surface.target,
                document,
              },
            };
          } catch (error) {
            if (typeof error?.reason === "string") throw error;
            if (error?.code === undefined) throw error;
            throw semanticFailure(
              error.code,
              "$.params.surfaceId",
              error.message,
              -32042,
              error.details
            );
          }
        }
        if (
          [
            "editorDraft.patch",
            "editorDraft.undo",
            "editorDraft.redo",
            "editorDraft.discard",
            "editorDraft.save",
          ].includes(request.method)
        ) {
          const kind = request.params.kind === "loudness-profile" ? "loudnessProfile" : "theme";
          const currentRevision = clock.current();
          if (request.params.expectedRevision !== currentRevision) {
            throw semanticFailure(
              "revisionConflict",
              "$.params.expectedRevision",
              `App state changed after revision ${request.params.expectedRevision}.`,
              -32004,
              { expectedRevision: request.params.expectedRevision, currentRevision }
            );
          }
          if (!editorDraft?.inspect || !uiNavigation?.inspectUi) {
            throw semanticFailure(
              "surfaceUnavailable",
              "$.method",
              "Editor draft control is unavailable in the current app state.",
              -32042
            );
          }
          const uiBefore = uiNavigation.inspectUi();
          if (request.params.expectedUiGeneration !== uiBefore.uiGeneration) {
            throw semanticFailure(
              "uiGenerationConflict",
              "$.params.expectedUiGeneration",
              "The visible UI changed after it was inspected.",
              -32042,
              {
                expectedUiGeneration: request.params.expectedUiGeneration,
                currentUiGeneration: uiBefore.uiGeneration,
              }
            );
          }
          const isDiscard = request.method === "editorDraft.discard";
          const expectedTopSurfaceId = isDiscard
            ? request.params.decisionSurfaceId
            : request.params.surfaceId;
          if (uiBefore.topSurfaceId !== expectedTopSurfaceId) {
            throw semanticFailure(
              "uiConflict",
              isDiscard ? "$.params.decisionSurfaceId" : "$.params.surfaceId",
              "Another UI surface is above the requested editor action.",
              -32042,
              { surfaceId: expectedTopSurfaceId }
            );
          }
          try {
            const before = editorDraft.inspect(kind, request.params.surfaceId);
            if (before.draftGeneration !== request.params.expectedDraftGeneration) {
              throw semanticFailure(
                "draftGenerationConflict",
                "$.params.expectedDraftGeneration",
                "The editor draft changed after it was inspected.",
                -32043,
                {
                  expectedDraftGeneration: request.params.expectedDraftGeneration,
                  currentDraftGeneration: before.draftGeneration,
                }
              );
            }
            if (!isDiscard && before.stale) {
              throw semanticFailure(
                "draftStale",
                "$.params.surfaceId",
                "The editor source changed while this draft was open.",
                -32043
              );
            }

            if (request.method === "editorDraft.save") {
              const saved = editorDraft.save(
                kind,
                request.params.surfaceId,
                request.params.expectedDraftGeneration
              );
              const expectedSignature =
                kind === "theme"
                  ? themeStateSignature(saved.state)
                  : loudnessProfileStateSignature(saved.state.profiles, saved.state.active);
              const deadline = Date.now() + SETTLEMENT_TIMEOUT_MS;
              let uiAfter;
              while (true) {
                uiAfter = uiNavigation.inspectUi();
                const observedSignature =
                  kind === "theme"
                    ? inputsRef.current.themeSignature
                    : inputsRef.current.loudnessSignature;
                if (
                  observedSignature === expectedSignature &&
                  !uiAfter.surfaces.some(
                    ({ surfaceId }) => surfaceId === request.params.surfaceId
                  ) &&
                  !uiAfter.activeBlockingEditors?.includes(kind)
                )
                  break;
                if (Date.now() >= deadline) {
                  throw semanticFailure(
                    saved.changed ? COMMIT_NOT_OBSERVED : "draftNotSettled",
                    "$",
                    "The editor Save was accepted but its final state was not observed. Inspect before retrying.",
                    -32031,
                    {
                      stateCommitted: saved.changed,
                      savedId: saved.savedId,
                      revision: clock.current(),
                    }
                  );
                }
                await new Promise((resolve) => setTimeout(resolve, 16));
              }
              if (saved.changed) {
                try {
                  await flush();
                } catch (error) {
                  throw semanticFailure(
                    "persistenceFailed",
                    "$",
                    `Draft saved in memory but persistence failed: ${error?.message || String(error)}`,
                    -32030,
                    {
                      stateCommitted: true,
                      savedId: saved.savedId,
                      revision: clock.current(),
                    }
                  );
                }
              }
              const { id: _savedId, ...document } = saved.document;
              return {
                requestId,
                result: {
                  action: request.method,
                  status: "completed",
                  changed: saved.changed,
                  revision: clock.current(),
                  uiGeneration: uiAfter.uiGeneration,
                  kind,
                  surfaceId: request.params.surfaceId,
                  savedId: saved.savedId,
                  document,
                },
              };
            }

            let changed = true;
            if (request.method === "editorDraft.patch") {
              const planned = planEditorDraftPatch(kind, before.document, request.params.patch);
              if (planned.issues.length > 0) {
                throw semanticFailure(
                  "invalidDraftPatch",
                  "$.params.patch",
                  "The editor draft patch is invalid.",
                  -32602,
                  { issues: planned.issues }
                );
              }
              changed = planned.changed;
              if (changed) editorDraft.commit(kind, request.params.surfaceId, planned.document);
            } else if (request.method === "editorDraft.undo") {
              editorDraft.history(kind, request.params.surfaceId, "undo");
            } else if (request.method === "editorDraft.redo") {
              editorDraft.history(kind, request.params.surfaceId, "redo");
            } else {
              editorDraft.discard(
                kind,
                request.params.surfaceId,
                request.params.decisionSurfaceId,
                request.params.expectedDraftGeneration
              );
            }

            if (isDiscard) {
              const { ui: uiAfter } = await settleEditorDraftObservation({
                editorDraft,
                uiNavigation,
                kind,
                surfaceId: request.params.surfaceId,
                decisionSurfaceId: request.params.decisionSurfaceId,
                discarded: true,
              });
              return {
                requestId,
                result: {
                  changed: true,
                  action: request.method,
                  revision: clock.current(),
                  uiGeneration: uiAfter.uiGeneration,
                  kind,
                  surfaceId: request.params.surfaceId,
                  discarded: true,
                },
              };
            }
            const settled = changed
              ? await settleEditorDraftObservation({
                  editorDraft,
                  uiNavigation,
                  kind,
                  surfaceId: request.params.surfaceId,
                })
              : { ui: uiBefore, snapshot: before };
            const uiAfter = settled.ui;
            const after = settled.snapshot;
            const { id: _internalId, ...document } = after.document;
            return {
              requestId,
              result: {
                changed,
                action: request.method,
                revision: clock.current(),
                uiGeneration: uiAfter.uiGeneration,
                draftGeneration: after.draftGeneration,
                kind,
                surfaceId: request.params.surfaceId,
                dirty: after.dirty === true,
                stale: after.stale === true,
                history: {
                  canUndo: after.canUndo === true,
                  canRedo: after.canRedo === true,
                },
                document,
              },
            };
          } catch (error) {
            if (typeof error?.reason === "string") throw error;
            if (typeof error?.code !== "string") throw error;
            throw semanticFailure(
              error.code,
              "$.params.surfaceId",
              error.message,
              -32043,
              error.details
            );
          }
        }
        if (request.method === "ui.inspect") {
          if (!uiNavigation?.inspectUi) {
            throw semanticFailure(
              "surfaceUnavailable",
              "$.method",
              "UI Navigation is unavailable in the current app state.",
              -32042
            );
          }
          return {
            requestId,
            result: { revision: clock.current(), ...uiNavigation.inspectUi() },
          };
        }
        if (
          [
            "ui.show.settings",
            "ui.show.panelSettings",
            "ui.show.themeEditor",
            "ui.show.loudnessProfileEditor",
            "ui.show.feedback",
            "ui.close",
            "ui.cancel",
          ].includes(request.method)
        ) {
          const currentRevision = clock.current();
          if (request.params.expectedRevision !== currentRevision) {
            throw semanticFailure(
              "revisionConflict",
              "$.params.expectedRevision",
              `App state changed after revision ${request.params.expectedRevision}.`,
              -32004,
              { expectedRevision: request.params.expectedRevision, currentRevision }
            );
          }
          if (!uiNavigation?.inspectUi) {
            throw semanticFailure(
              "surfaceUnavailable",
              "$.method",
              "UI Navigation is unavailable in the current app state.",
              -32042
            );
          }
          try {
            const actionResult =
              request.method === "ui.show.settings"
                ? await uiNavigation.showSettings(request.params)
                : request.method === "ui.show.panelSettings"
                  ? await uiNavigation.showPanelSettings(request.params)
                  : request.method === "ui.show.themeEditor"
                    ? await uiNavigation.showThemeEditor(request.params)
                    : request.method === "ui.show.loudnessProfileEditor"
                      ? await uiNavigation.showLoudnessProfileEditor(request.params)
                      : request.method === "ui.show.feedback"
                        ? await uiNavigation.showFeedback(request.params)
                        : request.method === "ui.close"
                          ? await uiNavigation.closeSurface(request.params)
                          : await uiNavigation.cancelSurface(request.params);
            const ui = uiNavigation.inspectUi();
            return {
              requestId,
              result: {
                ...actionResult,
                changed: actionResult?.changed !== false,
                action: actionResult?.action ?? request.method,
                revision: clock.current(),
                uiGeneration: ui.uiGeneration,
                ui,
              },
            };
          } catch (error) {
            if (typeof error?.reason !== "string") throw error;
            throw semanticFailure(
              error.reason,
              error.reason === "uiGenerationConflict"
                ? "$.params.expectedUiGeneration"
                : "$.params",
              error.message,
              error.reason === "revisionConflict" ? -32004 : -32042,
              {
                ...error.details,
                currentRevision: clock.current(),
                currentUiGeneration: uiNavigation.inspectUi().uiGeneration,
              }
            );
          }
        }
        if (request.method === "visual.describe") {
          const visualControl = inputsRef.current.visual;
          if (!visualControl?.platformCapabilities) {
            throw visualSemanticFailure({ reason: "visualUnavailable" });
          }
          return {
            requestId,
            result: buildVisualDescription({
              revision: clock.current(),
              platform: visualControl.platformCapabilities,
              runtime: visualControl.getRuntime(),
            }),
          };
        }
        if (request.method === "visual.screenshot") {
          const visualControl = inputsRef.current.visual;
          if (visualControl?.platformCapabilities?.screenshot?.available !== true) {
            throw visualSemanticFailure({ reason: "visualUnavailable" });
          }
          const availableTargets = visualControl.getRuntime()?.availableScreenshotTargets ?? [];
          if (!availableTargets.includes(request.params.target.kind)) {
            throw visualSemanticFailure({ reason: "targetUnavailable" });
          }
          if (visualBook.captureActive.current) {
            throw visualSemanticFailure({ reason: "captureBusy" });
          }
          const controller = new AbortController();
          visualBook.captureActive.current = true;
          ownedVisualCaptures.set(requestId, controller);
          try {
            const settled = await visualControl.settle(request.params.target, {
              expectedRevision: request.params.expectedRevision,
              getRevision: () => clock.current(),
              expectedUiGeneration: request.params.expectedUiGeneration,
              getUiGeneration: () => uiNavigation?.inspectUi?.().uiGeneration ?? 0,
              signal: controller.signal,
            });
            const artifact = await visualControl.captureScreenshot({
              windowLabel: settled.windowLabel,
              rect: settled.rect,
              viewport: settled.viewport,
              devicePixelRatio: settled.devicePixelRatio,
            });
            const live = inputsRef.current.measurementContext.getLiveMeasurement?.() ?? {
              generation: 0,
              record: null,
            };
            return {
              requestId,
              result: {
                revision: settled.revision,
                uiGeneration: settled.uiGeneration,
                measurement: {
                  generation: Number.isSafeInteger(live.generation) ? live.generation : 0,
                  sequence: Number.isSafeInteger(live.record?.sequence)
                    ? live.record.sequence
                    : null,
                },
                artifact,
                target: request.params.target,
              },
            };
          } catch (error) {
            throw visualSemanticFailure(error);
          } finally {
            ownedVisualCaptures.delete(requestId);
            visualBook.captureActive.current = false;
          }
        }
        if (request.method === "visual.recording.start") {
          const visualControl = inputsRef.current.visual;
          if (visualControl?.platformCapabilities?.recording?.available !== true) {
            throw visualSemanticFailure({ reason: "visualUnavailable" });
          }
          const availableTargets = visualControl.getRuntime()?.availableScreenshotTargets ?? [];
          if (!availableTargets.includes(request.params.target.kind)) {
            throw visualSemanticFailure({ reason: "targetUnavailable" });
          }
          const runtime = visualControl.getRuntime?.() ?? {};
          if (
            !(visualControl.platformCapabilities.recording.cursorModes ?? []).includes(
              request.params.cursor
            )
          ) {
            throw visualSemanticFailure({ reason: "visualUnavailable" });
          }
          const preferredAudio = runtime.sourceMode === "file" ? "none" : "measuredSource";
          const audio =
            request.params.audio ??
            ((runtime.availableAudioSources ?? []).includes(preferredAudio)
              ? preferredAudio
              : "none");
          if (!(runtime.availableAudioSources ?? []).includes(audio)) {
            throw visualSemanticFailure({ reason: "audioUnavailable" });
          }
          const audioState = measuredAudioState(runtime, inputsRef.current.transport);
          const controller = new AbortController();
          ownedVisualCaptures.set(requestId, controller);
          try {
            const settled = await visualControl.settle(request.params.target, {
              expectedRevision: request.params.expectedRevision,
              getRevision: () => clock.current(),
              signal: controller.signal,
            });
            const recording = await visualControl.startRecording({
              windowLabel: settled.windowLabel,
              rect: settled.rect,
              viewport: settled.viewport,
              devicePixelRatio: settled.devicePixelRatio,
              fps: request.params.fps,
              maxDurationSeconds: request.params.maxDurationSeconds,
              audio,
              cursor: request.params.cursor,
              sourceMode: runtime.sourceMode === "file" ? "file" : "live",
              audioState,
            });
            const metadata = {
              target: request.params.target,
              startedRevision: settled.revision,
              startedAt: new Date().toISOString(),
              unsubscribe: null,
              audio,
            };
            visualBook.recordings.set(recording.recordingId, metadata);
            metadata.unsubscribe = visualControl.subscribe?.(
              request.params.target,
              (geometry) => {
                void visualControl
                  .updateRecordingGeometry({
                    recordingId: recording.recordingId,
                    rect: geometry.rect,
                    viewport: geometry.viewport,
                  })
                  .catch(() => undefined);
              },
              { signal: controller.signal }
            );
            visualControl.setRecordingState?.(recording.state);
            void (async () => {
              while (visualBook.recordings.has(recording.recordingId)) {
                await new Promise((resolve) => setTimeout(resolve, 250));
                try {
                  const latest = await visualControl.inspectRecording(recording.recordingId);
                  if (latest.state === "completed" || latest.state === "failed") {
                    metadata.unsubscribe?.();
                    metadata.unsubscribe = null;
                    visualControl.setRecordingState?.(null);
                    return;
                  }
                  visualControl.setRecordingState?.(latest.state);
                } catch {
                  return;
                }
              }
            })();
            return {
              requestId,
              result: {
                revision: settled.revision,
                recording: {
                  ...publicRecording(recording),
                  target: request.params.target,
                  startedAt: metadata.startedAt,
                  startedRevision: settled.revision,
                },
              },
            };
          } catch (error) {
            throw visualSemanticFailure(error);
          } finally {
            ownedVisualCaptures.delete(requestId);
          }
        }
        if (
          request.method === "visual.recording.inspect" ||
          request.method === "visual.recording.wait" ||
          request.method === "visual.recording.stop"
        ) {
          const visualControl = inputsRef.current.visual;
          if (visualControl?.platformCapabilities?.recording?.available !== true) {
            throw visualSemanticFailure({ reason: "visualUnavailable" });
          }
          const recordingId = request.params.recordingId;
          const metadata = visualBook.recordings.get(recordingId);
          const decorate = (recording) => {
            const terminal = recording.state === "completed" || recording.state === "failed";
            if (terminal) {
              metadata?.unsubscribe?.();
              if (metadata) metadata.unsubscribe = null;
              visualControl.setRecordingState?.(null);
            } else {
              visualControl.setRecordingState?.(recording.state);
            }
            return {
              ...publicRecording(recording),
              ...(metadata?.target ? { target: metadata.target } : {}),
              ...(metadata?.startedAt ? { startedAt: metadata.startedAt } : {}),
              ...(Number.isSafeInteger(metadata?.startedRevision)
                ? { startedRevision: metadata.startedRevision }
                : {}),
              currentRevision: clock.current(),
              ...(terminal ? { endedRevision: clock.current() } : {}),
            };
          };
          try {
            if (request.method === "visual.recording.inspect") {
              return {
                requestId,
                result: {
                  revision: clock.current(),
                  recording: decorate(await visualControl.inspectRecording(recordingId)),
                },
              };
            }
            if (request.method === "visual.recording.stop") {
              await visualControl.stopRecording(recordingId);
            }
            const timeoutMs =
              request.method === "visual.recording.wait" ? request.params.timeoutMs : 9000;
            const deadline = Date.now() + timeoutMs;
            while (true) {
              const recording = await visualControl.inspectRecording(recordingId);
              if (recording.state === "completed" || recording.state === "failed") {
                return {
                  requestId,
                  result: {
                    ...(request.method === "visual.recording.wait" ? { outcome: "terminal" } : {}),
                    revision: clock.current(),
                    recording: decorate(recording),
                  },
                };
              }
              if (Date.now() >= deadline) {
                if (request.method === "visual.recording.stop") {
                  throw {
                    reason: "recordingFailed",
                    details: {
                      finalizationTimedOut: true,
                      recording: decorate(recording),
                    },
                  };
                }
                return {
                  requestId,
                  result: {
                    ...(request.method === "visual.recording.wait" ? { outcome: "timeout" } : {}),
                    revision: clock.current(),
                    recording: decorate(recording),
                  },
                };
              }
              await new Promise((resolve) => setTimeout(resolve, 50));
            }
          } catch (error) {
            throw visualSemanticFailure(error);
          }
        }
        if (request.method === "measurement.describe") {
          return {
            requestId,
            result: buildMeasurementDescription(clock.current()),
          };
        }
        if (request.method === "measurement.inspect") {
          return {
            requestId,
            result: buildMeasurementOrFail(),
          };
        }
        if (request.method === "measurement.wait") {
          const currentMeasurement = inputsRef.current.measurementContext;
          const initialLive = currentMeasurement.getLiveMeasurement?.() ?? {
            generation: 0,
            record: null,
          };
          if (
            isDifferentPublishedMeasurement(
              initialLive,
              request.params.afterGeneration,
              request.params.afterSequence
            )
          ) {
            return {
              requestId,
              result: {
                outcome: "sample",
                matchedImmediately: true,
                measurement: buildMeasurementOrFail(initialLive),
              },
            };
          }
          if (waiters.entries.size >= 4) {
            throw semanticFailure(
              "waitLimitReached",
              "$",
              "Too many long waits are active.",
              -32070
            );
          }
          const result = await new Promise((resolve, reject) => {
            const waiter = {
              kind: "measurement",
              timer: null,
              unsubscribe: () => {},
              resolve,
              reject,
            };
            const finish = (value) => {
              clearTimeout(waiter.timer);
              waiter.unsubscribe();
              waiters.entries.delete(requestId);
              resolve(value);
            };
            const observe = (live) => {
              if (
                !isDifferentPublishedMeasurement(
                  live,
                  request.params.afterGeneration,
                  request.params.afterSequence
                )
              ) {
                return;
              }
              finish({ outcome: "sample", matchedImmediately: false, live });
            };
            waiter.timer = setTimeout(() => {
              const live = inputsRef.current.measurementContext.getLiveMeasurement?.() ?? {
                generation: 0,
                record: null,
              };
              finish({ outcome: "timeout", live });
            }, request.params.timeoutMs);
            waiters.entries.set(requestId, waiter);
            waiter.unsubscribe =
              currentMeasurement.subscribeLiveMeasurement?.(observe) ?? (() => {});
            observe(currentMeasurement.getLiveMeasurement?.() ?? { generation: 0, record: null });
          });
          if (result === WAIT_CANCELLED) return null;
          if (result.outcome === "timeout") {
            throw semanticFailure(
              "timeout",
              "$.params.timeoutMs",
              "No different LIVE measurement sample was published before the timeout.",
              -32071,
              {
                afterGeneration: request.params.afterGeneration,
                afterSequence: request.params.afterSequence ?? null,
                currentGeneration: result.live.generation,
                currentSequence: result.live.record?.sequence ?? null,
                liveState: inputsRef.current.measurementContext.liveState,
              }
            );
          }
          return {
            requestId,
            result: {
              outcome: "sample",
              matchedImmediately: result.matchedImmediately,
              measurement: buildMeasurementOrFail(result.live),
            },
          };
        }
        if (request.method === "measurement.waitUntil") {
          const currentMeasurement = inputsRef.current.measurementContext;
          const predicate = request.params.predicate;
          const holdMs = predicate.holdMs ?? 0;
          const initialLive = currentMeasurement.getLiveMeasurement?.() ?? {
            generation: 0,
            record: null,
          };
          const initialMeasurement = buildMeasurementOrFail(initialLive);
          if (holdMs === 0 && measurementPredicateMatches(initialMeasurement, predicate)) {
            return {
              requestId,
              result: {
                outcome: "condition",
                matchedImmediately: true,
                predicate,
                measurement: initialMeasurement,
              },
            };
          }
          if (waiters.entries.size >= 4) {
            throw semanticFailure(
              "waitLimitReached",
              "$",
              "Too many long waits are active.",
              -32070
            );
          }
          const result = await new Promise((resolve, reject) => {
            const waiter = {
              kind: "measurementPredicate",
              timer: null,
              holdTimer: null,
              unsubscribe: () => {},
              resolve,
              reject,
            };
            const clearHold = () => {
              clearTimeout(waiter.holdTimer);
              waiter.holdTimer = null;
            };
            const finish = (value) => {
              clearTimeout(waiter.timer);
              clearHold();
              waiter.unsubscribe();
              waiters.entries.delete(requestId);
              resolve(value);
            };
            const fail = (error) => {
              clearTimeout(waiter.timer);
              clearHold();
              waiter.unsubscribe();
              waiters.entries.delete(requestId);
              reject(error);
            };
            const observe = (live) => {
              try {
                const measurement = buildMeasurementOrFail(live);
                if (!measurementPredicateMatches(measurement, predicate)) {
                  clearHold();
                  return;
                }
                if (holdMs === 0) {
                  finish({ measurement, matchedImmediately: false });
                  return;
                }
                if (waiter.holdTimer !== null) return;
                waiter.holdTimer = setTimeout(() => {
                  try {
                    const latest = inputsRef.current.measurementContext.getLiveMeasurement?.() ?? {
                      generation: 0,
                      record: null,
                    };
                    const finalMeasurement = buildMeasurementOrFail(latest);
                    if (measurementPredicateMatches(finalMeasurement, predicate)) {
                      finish({ measurement: finalMeasurement, matchedImmediately: false });
                    } else {
                      clearHold();
                    }
                  } catch (error) {
                    fail(error);
                  }
                }, holdMs);
              } catch (error) {
                fail(error);
              }
            };
            waiter.timer = setTimeout(() => {
              const live = inputsRef.current.measurementContext.getLiveMeasurement?.() ?? {
                generation: 0,
                record: null,
              };
              finish({ timeout: true, live });
            }, request.params.timeoutMs);
            waiters.entries.set(requestId, waiter);
            waiter.unsubscribe =
              currentMeasurement.subscribeLiveMeasurement?.(observe) ?? (() => {});
            observe(currentMeasurement.getLiveMeasurement?.() ?? { generation: 0, record: null });
          });
          if (result === WAIT_CANCELLED) return null;
          if (result.timeout) {
            throw semanticFailure(
              "timeout",
              "$.params.timeoutMs",
              "The LIVE measurement condition was not satisfied before the timeout.",
              -32071,
              {
                predicate,
                currentGeneration: result.live.generation,
                currentSequence: result.live.record?.sequence ?? null,
                liveState: inputsRef.current.measurementContext.liveState,
              }
            );
          }
          return {
            requestId,
            result: {
              outcome: "condition",
              matchedImmediately: result.matchedImmediately,
              predicate,
              measurement: result.measurement,
            },
          };
        }

        if (DEVICE_CONTROL_METHODS.includes(request.method)) {
          const currentDevice = inputsRef.current.device;
          if (!currentDevice?.snapshot) {
            throw semanticFailure(
              "deviceControlUnavailable",
              "$.method",
              "Device Control is unavailable in the current app state.",
              -32064
            );
          }
          if (request.method === "device.list") {
            return {
              requestId,
              result: {
                revision: clock.current(),
                ...buildDeviceList(currentDevice.snapshot),
              },
            };
          }
          if (request.method === "device.inspect") {
            return {
              requestId,
              result: {
                revision: clock.current(),
                ...deviceInspection(currentDevice),
              },
            };
          }

          const currentRevision = clock.current();
          if (request.params.expectedRevision !== currentRevision) {
            throw semanticFailure(
              "revisionConflict",
              "$.params.expectedRevision",
              `Device selection changed after revision ${request.params.expectedRevision}.`,
              -32004,
              { expectedRevision: request.params.expectedRevision, currentRevision }
            );
          }
          if (currentDevice.runtimeUnavailable === true) {
            throw semanticFailure(
              "transitionInProgress",
              "$.params",
              "Runtime changes are unavailable while an update is being applied.",
              -32081,
              { state: "update" }
            );
          }

          const planOrThrow = (controller) => {
            const planned = planDeviceSelection(
              controller.snapshot,
              request.params,
              controller.live
            );
            if (planned.issues.length > 0) {
              const problem = planned.issues[0];
              const codes = {
                deviceNotFound: -32060,
                deviceInventoryChanged: -32061,
                deviceUnavailable: -32062,
              };
              throw semanticFailure(
                problem.code,
                problem.path,
                problem.message,
                codes[problem.code] ?? -32602,
                problem.details
              );
            }
            if (planned.refusal) {
              throw semanticFailure(
                planned.refusal.code,
                "$.params",
                "Device selection is unavailable during a Live transition.",
                -32081,
                planned.refusal
              );
            }
            if (
              request.params.dryRun !== true &&
              planned.confirmationsRequired.includes("allowMeasurementRestart")
            ) {
              throw semanticFailure(
                "confirmationRequired",
                "$.params.allowMeasurementRestart",
                "Changing the running Live device requires measurement-restart confirmation.",
                -32041,
                { requiredFlag: "allowMeasurementRestart" }
              );
            }
            return planned;
          };

          const previewOrThrow = async (controller, planned) => {
            if (!planned.changed) return planned;
            try {
              await controller.previewSelection(request.params.deviceId);
              return planned;
            } catch (error) {
              if (request.params.deviceId === "default" && controller.live?.state !== "running") {
                return {
                  ...planned,
                  warnings: Array.from(
                    new Set([...planned.warnings, "automaticCurrentlyUnavailable"])
                  ),
                };
              }
              throw semanticFailure(
                "deviceUnavailable",
                "$.params.deviceId",
                `The requested device is unavailable: ${error?.message || String(error)}`,
                -32062
              );
            }
          };

          let planned = planOrThrow(currentDevice);
          planned = await previewOrThrow(currentDevice, planned);
          const predicted = deviceInspection(
            currentDevice,
            planned.changed ? request.params.deviceId : currentDevice.snapshot.requestedId
          );
          const result = {
            dryRun: request.params.dryRun === true,
            revision: currentRevision,
            generation: currentDevice.snapshot.generation,
            changed: planned.changed,
            effects: planned.effects,
            warnings: planned.warnings,
            ...(request.params.dryRun === true
              ? { confirmationsRequired: planned.confirmationsRequired }
              : {}),
            plan: planned.plan,
            state: {
              selection: predicted.selection,
              live: predicted.live,
            },
          };
          if (request.params.dryRun === true || !planned.changed) {
            return { requestId, result };
          }

          const finalDevice = inputsRef.current.device;
          planned = planOrThrow(finalDevice);
          planned = await previewOrThrow(finalDevice, planned);
          const commitDevice = inputsRef.current.device;
          planned = planOrThrow(commitDevice);
          if (request.params.expectedRevision !== clock.current()) {
            throw semanticFailure(
              "revisionConflict",
              "$.params.expectedRevision",
              `Device selection changed after revision ${request.params.expectedRevision}.`,
              -32004,
              {
                expectedRevision: request.params.expectedRevision,
                currentRevision: clock.current(),
              }
            );
          }
          if (commitDevice.runtimeUnavailable === true) {
            throw semanticFailure(
              "transitionInProgress",
              "$.params",
              "Runtime changes became unavailable while an update was being applied.",
              -32081,
              { state: "update" }
            );
          }
          result.effects = planned.effects;
          result.warnings = planned.warnings;
          result.plan = planned.plan;

          const committed = settlement.arm("device", { requestedId: request.params.deviceId });
          let restart = null;
          try {
            restart = planned.plan.restartLive ? commitDevice.beginRestart() : null;
          } catch (error) {
            settlement.clear("device");
            throw semanticFailure(
              error?.code === "transitionInProgress" ? "transitionInProgress" : "commandFailed",
              "$.params",
              `Device restart could not begin: ${error?.message || String(error)}`,
              error?.code === "transitionInProgress" ? -32081 : -32050
            );
          }
          const restartSettlement = restart
            ? restart.then(
                () => null,
                (error) => error
              )
            : null;

          let persistenceError = null;
          try {
            await commitDevice.commitSelection(request.params.deviceId);
          } catch (error) {
            persistenceError = error;
          }

          let committedRevision = clock.current();
          if (persistenceError?.stateCommitted === true) {
            committedRevision = await settlement.observed(
              "device",
              committed,
              "The Device selection"
            );
          } else if (persistenceError) {
            settlement.clear("device");
          } else {
            committedRevision = await settlement.observed(
              "device",
              committed,
              "The Device selection"
            );
          }

          const restartError = restartSettlement ? await restartSettlement : null;
          const resultingDevice = inputsRef.current.device;
          const inspection = deviceInspection(resultingDevice);
          if (persistenceError) {
            throw semanticFailure(
              "persistenceFailed",
              "$.params.deviceId",
              `Device selection committed but persistence failed: ${persistenceError?.message || String(persistenceError)}`,
              -32030,
              {
                stateCommitted: persistenceError.stateCommitted === true,
                revision: committedRevision,
                generation: resultingDevice.snapshot.generation,
                state: { selection: inspection.selection, live: inspection.live },
              }
            );
          }
          if (restartError) {
            throw semanticFailure(
              "deviceStartFailed",
              "$.params.deviceId",
              `Device selection committed but Live restart failed: ${restartError?.message || String(restartError)}`,
              -32063,
              {
                stateCommitted: true,
                revision: committedRevision,
                generation: resultingDevice.snapshot.generation,
                state: { selection: inspection.selection, live: inspection.live },
              }
            );
          }
          result.revision = committedRevision;
          result.generation = resultingDevice.snapshot.generation;
          result.state = { selection: inspection.selection, live: inspection.live };
          return { requestId, result };
        }

        if (request.method === "settings.describe" || request.method === "settings.inspect") {
          const inspection = buildSettingsInspection(settings, settingsContext);
          return {
            requestId,
            result: {
              revision: clock.current(),
              ...inspection,
              ...(request.method === "settings.describe"
                ? { schema: buildSettingsSchema(settings, settingsContext) }
                : {}),
            },
          };
        }
        if (request.method === "view.describe" || request.method === "view.inspect") {
          const context = inputsRef.current.viewContext;
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
        if (request.method === "transport.inspect") {
          return {
            requestId,
            result: { revision: clock.current(), ...transport },
          };
        }
        if (request.method === "transport.file.report") {
          const session = transport.files.sessions.find(
            ({ id }) => id === request.params.sessionId
          );
          if (!session) {
            throw semanticFailure(
              "fileSessionNotFound",
              "$.params.sessionId",
              "The FILE session was not found.",
              -32080,
              { sessionId: request.params.sessionId }
            );
          }
          if (session.state !== "complete") {
            throw semanticFailure(
              "fileAnalysisNotComplete",
              "$.params.sessionId",
              "Only a completed FILE analysis can be reported.",
              -32085,
              { sessionId: session.id, state: session.state }
            );
          }
          const currentProfile = {
            active: inputsRef.current.loudnessActive,
            profile: inputsRef.current.loudnessProfile,
          };
          // The public snapshot names the probe `probe`; the GUI builder reads `metadata`.
          const report = buildFileAnalysisReport(
            { ...session, metadata: session.probe },
            {
              appVersion: String(runtime.appVersion),
              loudnessProfile: describeActiveLoudnessProfile({
                active: currentProfile.active,
                document: currentProfile.profile?.document,
                draft: currentProfile.profile?.draft,
              }),
            }
          );
          return {
            requestId,
            result: {
              revision: clock.current(),
              sessionId: session.id,
              ...(request.params.reportFormat === "markdown"
                ? { markdown: renderFileAnalysisReportMarkdown(report) }
                : { report }),
            },
          };
        }
        if (request.method === "dock.describe" || request.method === "dock.inspect") {
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
        if (request.method === "dock.panel.describe") {
          const description = buildDockPanelDescription(
            dock,
            request.params.panelId,
            dockRequestContext
          );
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
        if (request.method.startsWith("dock.")) {
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
            planned = planDockFormMutation(
              dock,
              request.method,
              request.params,
              dockRequestContext
            );
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
          const committed = settlement.arm("dock", { matches });
          try {
            const effectiveDock = await executeDock(request.method, planned.dock);
            if (request.method === "dock.enter") {
              planned = reconcileDockExecution(planned, effectiveDock);
              result.warnings = planned.warnings;
              result.state.dock = buildDockSnapshot(planned.dock, dockRequestContext);
              if (matches(inputsRef.current.dock)) {
                settlement.resolve("dock");
              }
            }
            result.revision = await settlement.observed("dock", committed, "The Dock change");
          } catch (error) {
            settlement.clear("dock");
            // The backstop already states what went wrong and that state was committed; relabelling
            // it as a failed native operation would hide the real cause.
            if (isCommitNotObserved(error)) throw error;
            const observableDock = inputsRef.current.dock;
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
          result.state.dock = buildDockSnapshot(inputsRef.current.dock, dockRequestContext);
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
          const currentRevision = clock.current();
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
            inputsRef.current.transport,
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
              historyUnavailable: -32086,
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
          const action = isTransportAction(request.method);
          const result = {
            ...(action
              ? {
                  action: request.method,
                  status:
                    request.method === "transport.file.analyze" ||
                    request.method === "transport.file.reanalyze"
                      ? "accepted"
                      : "completed",
                }
              : {
                  dryRun: request.params.dryRun === true,
                  changed: planned.changed.length > 0,
                }),
            revision: currentRevision,
            effects: planned.effects,
            warnings: planned.warnings,
            ...(planned.affectedSessions.length > 0
              ? { affectedSessions: planned.affectedSessions }
              : {}),
            ...(planned.evictedSessions.length > 0
              ? { evictedSessions: planned.evictedSessions }
              : {}),
            state: {
              transport: action
                ? inputsRef.current.transport
                : projectTransportMutation(
                    inputsRef.current.transport,
                    request.method,
                    request.params
                  ),
            },
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
                revision: clock.current(),
                ...(error?.sessionId ? { sessionId: error.sessionId } : {}),
              }
            );
          }

          if (request.method === "transport.live.clear") {
            clock.bump();
            clock.scheduleWake();
            result.revision = clock.current();
          } else {
            const matches = (candidate) =>
              transportMutationMatches(request.method, request.params, execution, candidate);
            if (matches(inputsRef.current.transport)) {
              result.revision = clock.current();
            } else {
              result.revision = await settlement.observed(
                "transport",
                settlement.arm("transport", { matches }),
                "The Transport change"
              );
            }
          }
          result.state.transport = inputsRef.current.transport;
          Object.assign(result, execution?.result ?? {});
          if (Array.isArray(execution?.affectedSessions)) {
            result.affectedSessions = execution.affectedSessions;
          }
          if (Array.isArray(execution?.evictedSessions)) {
            result.evictedSessions = execution.evictedSessions;
          }
          return { requestId, result };
        }

        if (request.method === "settings.update") {
          const currentRevision = clock.current();
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

          const committed = settlement.arm("settings", {
            signature: settingsStateSignature(planned.settings),
          });
          try {
            await applySettings(planned.settings, {
              changed: planned.changed,
              effects: planned.effects,
            });
          } catch (error) {
            settlement.clear("settings");
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
                revision: clock.current(),
              }
            );
          }
          result.revision = await settlement.observed("settings", committed, "The Settings change");
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

        if (request.method === "view.update" || request.method === "view.reset") {
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
          const context = inputsRef.current.viewContext;
          const plan = (candidate) =>
            request.method === "view.reset"
              ? planViewReset(candidate.view, candidate)
              : planViewUpdate(candidate.view, request.params.patch, candidate);
          let planned = plan(context);
          if (planned.issues.length > 0) {
            throw semanticFailure(
              "invalidView",
              "$.params.patch",
              "The View patch is invalid.",
              -32602,
              { issues: planned.issues }
            );
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

          const commitContext = inputsRef.current.viewContext;
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
          const resultingContext = inputsRef.current.viewContext;
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

        if (request.method === "loudnessProfile.describe") {
          const index = loudnessProfiles.findIndex(({ id }) => id === request.params.profileId);
          if (index < 0) {
            throw semanticFailure(
              "loudnessProfileNotFound",
              "$.params.profileId",
              `Loudness Profile ${request.params.profileId} was not found.`,
              -32020
            );
          }
          const profile = normalizeRuleDocument(loudnessProfiles[index]);
          return {
            requestId,
            result: {
              revision: clock.current(),
              profile,
              active: activeLoudnessProfileId(loudnessProfiles, loudnessActive) === profile.id,
              index,
            },
          };
        }

        if (
          request.method === "loudnessProfile.select" ||
          request.method === "loudnessProfile.create" ||
          request.method === "loudnessProfile.update" ||
          request.method === "loudnessProfile.rename" ||
          request.method === "loudnessProfile.delete" ||
          request.method === "loudnessProfile.reorder"
        ) {
          const currentRevision = clock.current();
          if (request.params.expectedRevision !== currentRevision) {
            throw semanticFailure(
              "revisionConflict",
              "$.params.expectedRevision",
              `Loudness Profiles changed after revision ${request.params.expectedRevision}.`,
              -32004,
              { expectedRevision: request.params.expectedRevision, currentRevision }
            );
          }
          const control = loudnessProfile?.control;
          if (!control) {
            throw semanticFailure(
              "controlUnavailable",
              "$",
              "Loudness Profile Control is unavailable.",
              -32012
            );
          }
          if (request.method !== "loudnessProfile.reorder") {
            control.assertAllowed(request.method);
          }

          let planned =
            request.method === "loudnessProfile.select"
              ? control.planSelect(request.params.profileId)
              : request.method === "loudnessProfile.create"
                ? control.planCreate(request.params.document)
                : request.method === "loudnessProfile.update"
                  ? control.planUpdate(request.params.profileId, request.params.document)
                  : request.method === "loudnessProfile.rename"
                    ? control.planRename(request.params.profileId, request.params.name)
                    : request.method === "loudnessProfile.delete"
                      ? control.planDelete(request.params.profileId)
                      : control.planReorder(request.params.profileIds);
          if (planned.issues.length > 0) {
            const missing = planned.issues.find(({ code }) => code === "loudnessProfileNotFound");
            const permutation = planned.issues.find(({ code }) => code === "invalidPermutation");
            if (missing) {
              throw semanticFailure(
                "loudnessProfileNotFound",
                "$.params.profileId",
                missing.message,
                -32020
              );
            }
            if (permutation) {
              throw semanticFailure(
                "invalidPermutation",
                "$.params.profileIds",
                permutation.message,
                -32602,
                { issues: planned.issues }
              );
            }
            throw semanticFailure(
              "invalidProfile",
              request.method === "loudnessProfile.rename" ? "$.params.name" : "$.params.document",
              "The Loudness Profile document is invalid.",
              -32602,
              { issues: planned.issues }
            );
          }

          const profilePlan = () =>
            request.method === "loudnessProfile.select"
              ? { from: planned.from, to: planned.to }
              : request.method === "loudnessProfile.create"
                ? {
                    document: planned.document,
                    selectCreated: true,
                    ...(planned.profile ? { profile: planned.profile } : {}),
                  }
                : request.method === "loudnessProfile.delete"
                  ? {
                      deletedProfile: planned.deletedProfile,
                      selectionFallsBackToOff: planned.selectionFallsBackToOff,
                      affectedPresetIds: planned.affectedPresetIds,
                    }
                  : request.method === "loudnessProfile.reorder"
                    ? { profileIds: planned.profileIds }
                    : { profile: planned.profile };
          const dryRun = request.params.dryRun === true;
          const result = {
            dryRun,
            revision: currentRevision,
            changed: planned.changed.length > 0,
            warnings: planned.warnings,
            plan: profilePlan(),
            state: compactLoudnessProfileState(
              planned.loudnessProfiles,
              dryRun && request.method === "loudnessProfile.create" ? planned.document : null
            ),
          };
          if (dryRun || planned.changed.length === 0) return { requestId, result };

          const registerSettlement = (commitPlan) => {
            const expected = {
              loudnessProfile: loudnessProfileStateSignature(
                commitPlan.loudnessProfiles.profiles,
                commitPlan.loudnessProfiles.active
              ),
            };
            if (
              commitPlan.presets &&
              presetStateSignature(commitPlan.presets) !== presetStateSignature(presets)
            ) {
              expected.presets = presetStateSignature(commitPlan.presets);
            }
            const committed = settlement.arm("loudnessProfile", { expected, observed: new Set() });
            return committed;
          };

          let committed;
          if (request.method === "loudnessProfile.create") {
            planned = control.create(request.params.document);
            if (planned.issues.length > 0 || !planned.profile) {
              throw semanticFailure(
                "commandFailed",
                "$",
                "Loudness Profile could not be created.",
                -32050
              );
            }
            committed = registerSettlement(planned);
          } else {
            committed = registerSettlement(planned);
            control.commit(planned);
          }
          result.plan = profilePlan();
          result.state = compactLoudnessProfileState(planned.loudnessProfiles);
          result.revision = await settlement.observed(
            "loudnessProfile",
            committed,
            "The Loudness Profile change"
          );
          try {
            await flush();
          } catch (error) {
            throw semanticFailure(
              "persistenceFailed",
              "$",
              `Loudness Profile committed but persistence failed: ${error?.message || String(error)}`,
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
              revision: clock.current(),
              presets: (presets?.list ?? []).map(({ id, name }) => ({ id, name })),
              activeId: typeof presets?.activeId === "string" ? presets.activeId : null,
              dirty: presets?.dirty === true,
            },
          };
        }

        if (request.method === "preset.describe") {
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

        if (request.method === "preset.save" || request.method === "preset.update") {
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
              throw semanticFailure(
                "presetNotFound",
                "$.params.presetId",
                "Preset was not found.",
                -32020
              );
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

        if (request.method === "preset.apply") {
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
              matches: (currentWorkspace) =>
                workspaceMatchesPresetView(currentWorkspace, targetView),
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

        if (
          request.method === "preset.rename" ||
          request.method === "preset.delete" ||
          request.method === "preset.reorder"
        ) {
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

        if (request.method === "theme.inspect" || request.method === "theme.list") {
          const currentTheme = inputsRef.current.themeState;
          return {
            requestId,
            result: {
              revision: clock.current(),
              appearance: currentTheme.appearance,
              ...(request.method === "theme.list"
                ? { themes: listThemeSummaries(currentTheme) }
                : {}),
            },
          };
        }

        if (request.method === "theme.describe") {
          const currentTheme = inputsRef.current.themeState;
          const builtin = BUILTIN_THEMES_V2[request.params.themeId];
          const index = currentTheme.themes.findIndex(({ id }) => id === request.params.themeId);
          const document = builtin ?? (index >= 0 ? currentTheme.themes[index] : null);
          if (!document) {
            throw semanticFailure(
              "themeNotFound",
              "$.params.themeId",
              `Theme ${request.params.themeId} was not found.`,
              -32020
            );
          }
          return {
            requestId,
            result: {
              revision: clock.current(),
              theme: structuredClone(document),
              kind: builtin ? "builtin" : "custom",
              active: currentTheme.appearance.resolvedThemeId === document.id,
              index: builtin ? null : index,
            },
          };
        }

        const themeMutations = new Set([
          "theme.select",
          "theme.followSystem",
          "theme.create",
          "theme.update",
          "theme.rename",
          "theme.duplicate",
          "theme.delete",
          "theme.reorder",
        ]);
        if (themeMutations.has(request.method)) {
          const currentRevision = clock.current();
          if (request.params.expectedRevision !== currentRevision) {
            throw semanticFailure(
              "revisionConflict",
              "$.params.expectedRevision",
              `Themes changed after revision ${request.params.expectedRevision}.`,
              -32004,
              { expectedRevision: request.params.expectedRevision, currentRevision }
            );
          }
          const control = inputsRef.current.themeControl;
          if (!control) {
            throw semanticFailure(
              "controlUnavailable",
              "$",
              "Theme Control is unavailable.",
              -32012
            );
          }
          if (request.method !== "theme.reorder") control.assertAllowed(request.method);

          const dryRun = request.params.dryRun === true;
          const makeId = () => `custom-${crypto.randomUUID()}`;
          const planned =
            request.method === "theme.select"
              ? control.planSelect(request.params.themeId)
              : request.method === "theme.followSystem"
                ? control.planFollowSystem()
                : request.method === "theme.create"
                  ? control.planCreate(request.params.document, dryRun ? undefined : { makeId })
                  : request.method === "theme.update"
                    ? control.planUpdate(request.params.themeId, request.params.document)
                    : request.method === "theme.rename"
                      ? control.planRename(request.params.themeId, request.params.name)
                      : request.method === "theme.duplicate"
                        ? control.planDuplicate(
                            request.params.themeId,
                            request.params.name,
                            dryRun ? undefined : { makeId }
                          )
                        : request.method === "theme.delete"
                          ? control.planDelete(request.params.themeId)
                          : control.planReorder(request.params.themeIds);

          if (planned.issues.length > 0) {
            const first = planned.issues[0];
            const paths = {
              themeNotFound: "$.params.themeId",
              themeNotMutable: "$.params.themeId",
              invalidPermutation: "$.params.themeIds",
              invalidName: "$.params.name",
            };
            const codes = {
              themeNotFound: -32020,
              themeNotMutable: -32602,
              invalidPermutation: -32602,
              invalidName: -32602,
            };
            const reason = paths[first.code] ? first.code : "invalidTheme";
            throw semanticFailure(
              reason,
              paths[first.code] ?? "$.params.document",
              reason === "invalidTheme" ? "The Theme document is invalid." : first.message,
              codes[first.code] ?? -32602,
              { issues: planned.issues }
            );
          }

          const result = {
            dryRun,
            revision: currentRevision,
            changed: planned.changed.length > 0,
            warnings: planned.warnings,
            plan: themePlanResult(request.method, planned),
            state: compactThemeState(planned.state),
          };
          if (dryRun || planned.changed.length === 0) return { requestId, result };

          const committed = settlement.arm("theme", {
            signature: themeStateSignature(planned.state),
          });
          control.commit(planned);
          result.revision = await settlement.observed("theme", committed, "The Theme change");
          result.state = compactThemeState(inputsRef.current.themeState);
          try {
            await flush();
          } catch (error) {
            throw semanticFailure(
              "persistenceFailed",
              "$",
              `Theme committed but persistence failed: ${error?.message || String(error)}`,
              -32030,
              { stateCommitted: true, revision: result.revision }
            );
          }
          return { requestId, result };
        }

        // `preset.list` is handled above and keeps its own richer shape; the guard is here so a
        // later reordering of these branches cannot silently swap it for the generic one.
        const libraryMatch = /^(preset|theme|loudnessProfile)\.(list|export|import)$/.exec(
          request.method
        );
        if (libraryMatch && !(libraryMatch[1] === "preset" && libraryMatch[2] === "list")) {
          const [, family, action] = libraryMatch;
          const { stateKey, notFoundCode } = libraryFamily(family);

          if (action === "list") {
            const entries = buildLibraryList(family);
            return {
              requestId,
              result: {
                revision: clock.current(),
                [stateKey]: entries,
                ...(family === "loudnessProfile"
                  ? { activeId: activeLoudnessProfileId(entries) }
                  : {}),
              },
            };
          }

          if (action === "export") {
            if (
              family === "theme" &&
              request.params.ids?.some((id) => Object.hasOwn(BUILTIN_THEMES_V2, id))
            ) {
              const builtinIds = request.params.ids.filter((id) =>
                Object.hasOwn(BUILTIN_THEMES_V2, id)
              );
              throw semanticFailure(
                "themeNotExportable",
                "$.params.ids",
                `Built-in Themes cannot be exported: ${builtinIds.join(", ")}.`,
                -32602,
                { themeIds: builtinIds }
              );
            }
            let planned;
            try {
              planned = planLibraryExport(family, request.params.ids);
            } catch (error) {
              // Pack V2 export is strict: an empty library or an unreadable stored item cannot
              // become a file this build would accept back.
              if (
                !(error instanceof PackValidationError) ||
                !["preset", "theme", "loudnessProfile"].includes(family)
              ) {
                throw error;
              }
              const reason = {
                preset: "presetNotExportable",
                theme: "themeNotExportable",
                loudnessProfile: "loudnessProfileNotExportable",
              }[family];
              throw semanticFailure(
                reason,
                "$.params",
                error.message,
                -32602,
                error.issues.length > 0 ? { issues: error.issues } : undefined
              );
            }
            if (planned.missingIds.length > 0) {
              throw semanticFailure(
                notFoundCode,
                "$.params.ids",
                `These ids are not in the library: ${planned.missingIds.join(", ")}.`,
                -32020,
                { missingIds: planned.missingIds }
              );
            }
            return {
              requestId,
              result: { revision: clock.current(), pack: planned.pack },
            };
          }

          // Import is deliberately not a scene operation: the merge only appends, moves no
          // selection and dirties no Preset, so it cannot destroy an open editor's draft. The
          // GUI's own Import buttons are not disabled by editor state either.
          const currentRevision = clock.current();
          if (
            request.params.expectedRevision !== undefined &&
            request.params.expectedRevision !== currentRevision
          ) {
            throw semanticFailure(
              "revisionConflict",
              "$.params.expectedRevision",
              `App state changed after revision ${request.params.expectedRevision}.`,
              -32004,
              { expectedRevision: request.params.expectedRevision, currentRevision }
            );
          }

          let planned;
          try {
            planned = planLibraryImport(family, request.params.pack);
          } catch (error) {
            if (!(error instanceof PackValidationError)) throw error;
            // The message is the one a recipient of a shared file needs -- which library the file
            // belongs to, or that it is a whole configuration -- so it is passed through verbatim.
            throw semanticFailure(
              "invalidPack",
              "$.params.pack",
              error.message,
              -32602,
              error.issues.length > 0 ? { issues: error.issues } : undefined
            );
          }

          const result = {
            dryRun: request.params.dryRun === true,
            revision: currentRevision,
            changed: planned.changed,
            warnings: planned.warnings,
            plan: planned.plan,
            state: { [stateKey]: buildLibraryList(family) },
          };
          if (result.dryRun || !planned.changed) {
            return { requestId, result };
          }

          const committed = settlement.arm("library", { families: planned.writes });
          planned.commit();
          result.state = { [stateKey]: buildLibraryList(family) };
          result.revision = await settlement.observed("library", committed, "The library import");
          try {
            await flush();
          } catch (error) {
            throw semanticFailure(
              "persistenceFailed",
              "$",
              `Library committed but persistence failed: ${error?.message || String(error)}`,
              -32030,
              { stateCommitted: true, revision: result.revision }
            );
          }
          return { requestId, result };
        }

        if (request.method === "config.export") {
          const configuration = await exportConfiguration();
          return {
            requestId,
            result: {
              revision: clock.current(),
              configuration,
            },
          };
        }

        if (request.method === "config.import") {
          const currentRevision = clock.current();
          if (request.params.expectedRevision !== currentRevision) {
            throw semanticFailure(
              "revisionConflict",
              "$.params.expectedRevision",
              `App state changed after revision ${request.params.expectedRevision}.`,
              -32004,
              { expectedRevision: request.params.expectedRevision, currentRevision }
            );
          }
          presets.assertSceneOperationAllowed(request.method);

          let configuration;
          try {
            configuration = normalizeConfiguration(request.params.configuration);
          } catch (error) {
            if (!(error instanceof ProfileValidationError)) throw error;
            throw semanticFailure(
              "invalidConfiguration",
              "$.params.configuration",
              error.message,
              -32602
            );
          }

          if (request.params.dryRun === true) {
            return {
              requestId,
              result: {
                dryRun: true,
                revision: currentRevision,
                changed: true,
                relaunch: false,
                configuration,
              },
            };
          }

          try {
            await importConfiguration(configuration);
          } catch (error) {
            throw semanticFailure(
              "persistenceFailed",
              "$",
              `Configuration import failed: ${error?.message || String(error)}`,
              -32030
            );
          }
          return {
            requestId,
            result: {
              dryRun: false,
              revision: currentRevision,
              changed: true,
              relaunch: true,
            },
            awaitDelivery: true,
            afterResponse: relaunchAfterConfigurationChange,
          };
        }

        if (request.method === "axis.describe" || request.method === "axis.inspect") {
          const inspection = buildAxisInspection(workspace);
          return {
            requestId,
            result: {
              revision: clock.current(),
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

        if (request.method === "module.list") {
          return {
            requestId,
            result: {
              revision: clock.current(),
              modules: buildModuleList(),
            },
          };
        }

        if (request.method === "module.describe") {
          const context = { ...analysisContext, hasLoudnessReference };
          const module = buildModuleDescription(request.params.moduleId, context);
          if (!module) {
            throw semanticFailure(
              "moduleNotFound",
              "$.params.moduleId",
              `Module ${request.params.moduleId} was not found.`,
              -32011
            );
          }
          return {
            requestId,
            result: {
              revision: clock.current(),
              schemaBasis: "defaultControls",
              context: buildModuleDescriptionContext(analysisContext, hasLoudnessReference),
              module,
            },
          };
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

        if (request.method === "panel.update" || request.method === "panel.reset") {
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

          const committed = settlement.arm("workspace", {
            view: nextWorkspace,
            matches: (currentWorkspace) =>
              panelControlsMatch(currentWorkspace, nextWorkspace, panelId),
          });
          setPanelControlsForPanel(panelId, planned.panelControls);
          result.revision = await settlement.observed(
            "workspace",
            committed,
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
