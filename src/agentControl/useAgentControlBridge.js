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
import { describeActiveLoudnessProfile } from "../lib/activeLoudnessProfile.js";
import { isSceneOperationRefused } from "../lib/sceneOperations.js";
import { agentControlRpcError, normalizeAgentControlRequest } from "./protocol.js";
import {
  isDevelopmentFixtureMethod,
  normalizeDevelopmentFixtureRequest,
} from "./developmentFixtureProtocol.js";
import { buildMeasurementDescription, buildMeasurementInspection } from "./measurementControl.js";
import { measurementPredicateMatches } from "./measurementPredicates.js";
import { buildVisualDescription } from "./visualControl.js";
import { describeEditorDraft, planEditorDraftPatch } from "./editorDraftControl.js";
import { WorkspaceLayoutError } from "./workspaceLayout.js";
import { createRevisionClock } from "./bridge/revisionClock.js";
import { createWaiters } from "./bridge/waiters.js";
import { METHOD_TABLE } from "./handlers/index.js";
import { createDomainRunner } from "./bridge/domains.js";
import { createSettlementRegistry } from "./bridge/settlement.js";
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
  themeStateSignature,
  loudnessProfileStateSignature,
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

function isDifferentPublishedMeasurement(live, afterGeneration, afterSequence) {
  const sequence = live?.record?.sequence;
  if (!Number.isSafeInteger(sequence)) return false;
  return live.generation !== afterGeneration || sequence !== (afterSequence ?? null);
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
