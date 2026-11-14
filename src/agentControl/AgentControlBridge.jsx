import { useCallback, useMemo } from "react";
import { readMonitorInventory } from "./monitorInventory.js";
import { useDock } from "../dock/DockContext.jsx";
import { useWindowChrome } from "../hooks/WindowChromeContext.jsx";
import { usePresetLibrary } from "../hooks/PresetsContext.jsx";
import { useLoudnessProfile } from "../hooks/LoudnessProfileContext.jsx";
import { useAppSettings } from "../settings/SettingsContext.jsx";
import { useAppLifecycle } from "../hooks/AppLifecycleContext.jsx";
import { useMeterDisplayState, useMeterRuntime } from "../runtime/MeterRuntimeContext.jsx";
import { useSource } from "../runtime/SourceContext.jsx";
import { useSourceActions } from "../runtime/SourceActionsContext.jsx";
import { useUiNavigation } from "../uiNavigation/UiNavigationContext.jsx";
import { useWorkspaceStore } from "../workspace/WorkspaceContext.jsx";
import { useAnalysisSession } from "../runtime/AnalysisSessionContext.jsx";
import { useDisplaySnapshot } from "../runtime/DisplaySnapshotContext.jsx";
import { useSceneGuard } from "../hooks/SceneGuardContext.jsx";
import { firstHistoryTimestampMs, latestHistoryTimestampMs } from "../lib/historyTimestamps.js";
import { getPeakMeterChannelLabels } from "../math/peakMeterChannelLabels.js";
import { deriveChannelLabelRuntime } from "../runtime/appRuntimeDerivations.js";
import { isDockSupported } from "../lib/platform.js";
import { seedTokensFromLabels } from "../math/channelRoles.js";
import { buildPublicSettings } from "./settingsControl.js";
import { buildTransportSnapshot, selectImportTrack } from "./transportControl.js";
import { semanticFailure } from "./bridge/failures.js";
import { getSuccessfulFileSession } from "../lib/fileAnalysisSessionRegistry.js";
import { useAgentControlBridge } from "./useAgentControlBridge.js";
import { useAgentControlState } from "./AgentControlStateContext.jsx";
import { useVisualCaptureSurfaces } from "./useVisualCaptureSurfaces.js";
import { settleDockAccessory } from "./settleDockAccessory.js";
import { useDockAccessories } from "../dock/DockAccessoriesContext.jsx";
import { isParticipantInstance } from "../lib/runtimeRole.js";
import { useDevelopmentEventFixtures } from "../dev/DevelopmentEventFixturesContext.jsx";
import { useDevelopmentPerformance } from "../dev/useDevelopmentPerformance.js";
import { useEditorDraftRegistry } from "./EditorDraftContext.jsx";
import {
  maximizeWindow,
  minimizeWindow,
  moveWindowTo,
  readWindowGeometry,
  readWindowMonitors,
  unmaximizeWindow,
} from "../lib/windowGeometry.js";
import { isTauri } from "../ipc/env.js";
import { listRuntimeInstances, openAdditionalWorkbench } from "../ipc/commands.js";
import { prepareGlobalOperation, quitPreparedInstances } from "../runtime/coordination.js";
import { planFileImport } from "../lib/fileImportPlan.js";
import {
  applyWindowBounds,
  probeFileAnalysis,
  captureVisualScreenshot,
  movePointer,
  inspectVisualRecording,
  startVisualRecording,
  stopVisualRecording,
  updateVisualRecordingAudioState,
  updateVisualRecordingGeometry,
} from "../ipc/commands.js";

/**
 * Agent Control as a component, so it can sit inside the domain providers and read them itself.
 * It builds every area from the owning domain and takes nothing from its parent.
 */
export function AgentControlBridge() {
  const { runtime, enabled, platformCapabilities, setRecordingState } = useAgentControlState();
  const { visualRuntimeRef, getAccessoryTargets } = useDockAccessories();
  const editorDraft = useEditorDraftRegistry();
  const {
    docked,
    dockEdge,
    dockMonitor,
    dockHeight,
    dockSuspended,
    dockTransitioning,
    reserveSpace,
    aboveFullScreen,
    layout: dockLayout,
    executeDockForControl,
  } = useDock();

  const agentControlDock = useMemo(
    () => ({
      supported: isDockSupported(),
      enabled: docked,
      edge: dockEdge,
      monitor: dockMonitor,
      reserveSpace,
      aboveFullScreen,
      height: dockHeight,
      suspended: dockSuspended,
      panelsById: dockLayout.panelsById,
      panelOrder: dockLayout.panelOrder,
      panelSizesById: dockLayout.panelSizesById,
      controlsByPanelId: dockLayout.controlsByPanelId,
    }),
    [
      dockEdge,
      dockHeight,
      dockLayout.controlsByPanelId,
      dockLayout.panelOrder,
      dockLayout.panelSizesById,
      dockLayout.panelsById,
      dockMonitor,
      dockSuspended,
      docked,
      reserveSpace,
      aboveFullScreen,
    ]
  );

  const { view, applyViewState, reveal: chromeReveal = null } = useWindowChrome();
  const { pinned, focusView, panelPresentation, surfaceOpacity, dockSurfaceOpacity, glassEnabled } =
    view;
  const agentControlViewContext = useMemo(
    () => ({
      view: {
        pinned,
        focusView,
        panelPresentation,
        surfaceOpacity,
        dockSurfaceOpacity,
        glassEnabled,
      },
      platform: runtime.platform,
      docked,
      applyView: applyViewState,
    }),
    [
      runtime.platform,
      applyViewState,
      docked,
      focusView,
      panelPresentation,
      glassEnabled,
      surfaceOpacity,
      dockSurfaceOpacity,
      pinned,
    ]
  );

  const presets = usePresetLibrary();
  const uiNavigation = useUiNavigation();
  const developmentFixtures = useDevelopmentEventFixtures();
  const developmentPerformance = useDevelopmentPerformance(developmentFixtures.enabled);
  const meterRuntime = useMeterRuntime();
  const {
    analyzingFileId,
    preparingFileId,
    stopFileAnalysis,
    switchSource,
    stopLiveForControl,
    startLiveForControl,
    clearLiveForControl,
    beginFileAnalysisForControl,
    reanalyzeFileForControl,
    restoreFileHistoryForControl,
    selectFile,
    removeFile,
    clearFiles,
  } = meterRuntime;
  const { selectedOffset, selectSnapshot, clearSnapshot } = useMeterDisplayState();
  const { histSourceList } = useDisplaySnapshot();
  const {
    snapshot: audioDeviceSnapshot,
    captureDeviceId,
    previewSelection,
    commitCaptureDevice,
  } = useSource();
  const { beginDeviceRestartForControl } = meterRuntime;
  const { updateBusy, updateControls, requestCloseAction, windowVisible, onShowWindow } =
    useAppLifecycle();
  const windowControl = useMemo(
    () => ({
      available: isTauri(),
      form: docked ? "dock" : "normal",
      visible: windowVisible,
      readGeometry: readWindowGeometry,
      readMonitors: readWindowMonitors,
      applyBounds: applyWindowBounds,
      moveTo: moveWindowTo,
      maximize: maximizeWindow,
      unmaximize: unmaximizeWindow,
      minimize: minimizeWindow,
      show: onShowWindow,
      // The tray's Hide: persistence is flushed first, and it is refused while an update installs.
      hide: () => requestCloseAction("tray"),
    }),
    [docked, onShowWindow, requestCloseAction, windowVisible]
  );
  // Quit Workbench, Quit PLVS and a second launch, through the paths the Tray and the OS use.
  const workbenchControl = useMemo(
    () => ({
      available: isTauri(),
      busy: updateBusy,
      quitWorkbench: () => requestCloseAction("quit"),
      prepareQuitAll: prepareGlobalOperation,
      commitQuitAll: quitPreparedInstances,
      listInstances: listRuntimeInstances,
      openWorkbench: openAdditionalWorkbench,
    }),
    [requestCloseAction, updateBusy]
  );
  const agentControlDevice = useMemo(
    () => ({
      snapshot: audioDeviceSnapshot,
      live: {
        state: meterRuntime.liveLifecycle,
        transition: meterRuntime.liveDeviceTransition,
        usingRequestedSelection:
          meterRuntime.liveLifecycle === "running" &&
          meterRuntime.liveDeviceTransition === null &&
          (captureDeviceId === "default" || meterRuntime.liveResolvedDeviceId === captureDeviceId),
      },
      previewSelection,
      commitSelection: commitCaptureDevice,
      beginRestart: beginDeviceRestartForControl,
      runtimeUnavailable: updateBusy,
    }),
    [
      audioDeviceSnapshot,
      beginDeviceRestartForControl,
      captureDeviceId,
      commitCaptureDevice,
      meterRuntime.liveDeviceTransition,
      meterRuntime.liveLifecycle,
      meterRuntime.liveResolvedDeviceId,
      previewSelection,
      updateBusy,
    ]
  );
  const { currentFileAnalysisSettings, dialogueGating, fileQueue } = useSourceActions();
  const agentControlTransport = useMemo(
    () =>
      buildTransportSnapshot(meterRuntime, {
        requestedDeviceId: captureDeviceId,
        selectedOffset,
        docked,
        fileBatch: fileQueue?.snapshot,
      }),
    [captureDeviceId, docked, fileQueue?.snapshot, meterRuntime, selectedOffset]
  );
  const executeAgentControlTransport = useCallback(
    async (/** @type {string} */ method, params) => {
      const fileTaskId = analyzingFileId ?? preparingFileId;
      if (method.startsWith("transport.file.batch.")) {
        const batch = fileQueue.snapshot;
        const reject = (message) => {
          throw semanticFailure("invalidFileBatchState", "$.params", message, -32012);
        };
        if (meterRuntime.sourceMode !== "file" || docked)
          reject("Switch to File Mode before controlling the batch.");
        if (method === "transport.file.batch.enqueue") fileQueue.enqueue(params.paths);
        else if (method === "transport.file.batch.chooseTrack") {
          if (!fileQueue.confirmTrack(params.itemId, params.trackIndex))
            reject("The queued item is not waiting for that audio track.");
        } else if (method === "transport.file.batch.stop") {
          if (batch.currentId !== params.itemId) reject("That item is no longer running.");
          await fileQueue.stopCurrent();
        } else if (method === "transport.file.batch.cancel") {
          if (!batch.active) reject("No File batch is active.");
          await fileQueue.cancelBatch();
        } else if (method === "transport.file.batch.resume") {
          if (batch.active || !batch.canResume) reject("No idle File batch can be resumed.");
          fileQueue.resumeBatch();
        }
        fileQueue.acknowledgeCommand();
        return { sequence: batch.commandSequence + 1 };
      }
      if (method === "transport.source.live") {
        if (fileTaskId) await stopFileAnalysis(fileTaskId);
        switchSource("live");
        return {};
      }
      if (method === "transport.source.file") {
        if (meterRuntime.liveLifecycle === "running") await stopLiveForControl();
        switchSource("file");
        return {};
      }
      if (method === "transport.live.start") {
        if (fileTaskId) await stopFileAnalysis(fileTaskId);
        switchSource("live");
        await startLiveForControl();
        return {};
      }
      if (method === "transport.live.stop") {
        await stopLiveForControl();
        return {};
      }
      if (method === "transport.live.clear") {
        await clearLiveForControl();
        return {};
      }
      if (method === "transport.snapshot.select") {
        selectSnapshot(params.offsetSec);
        return {};
      }
      if (method === "transport.snapshot.clear") {
        clearSnapshot();
        return {};
      }
      if (method === "transport.file.analyze") {
        // Same import decision as the GUI: probe first, choose the track, then reuse an unchanged
        // file/track entry instead of creating another. A refusal here has no side effects.
        const settings = currentFileAnalysisSettings();
        const probe = isTauri()
          ? selectImportTrack(await probeFileAnalysis(params.path), params.trackIndex)
          : null;
        const plan = probe
          ? planFileImport(meterRuntime.fileSessions, probe, settings)
          : { action: "analyze", sessionId: null };
        if (meterRuntime.liveLifecycle === "running") await stopLiveForControl();
        switchSource("file");
        if (plan.action === "select") {
          selectFile(plan.sessionId);
          return {
            sessionId: plan.sessionId,
            reused: true,
            result: { status: "completed" },
          };
        }
        const run = beginFileAnalysisForControl(
          params.path,
          settings,
          probe,
          plan.action === "rerun" ? plan.sessionId : null
        );
        if (!run) throw new Error("FILE analysis was not accepted.");
        const runId = await run.accepted;
        const { sessionId } = run;
        return { sessionId, runId };
      }
      if (method === "transport.file.reanalyze") {
        if (meterRuntime.liveLifecycle === "running") await stopLiveForControl();
        switchSource("file");
        const run = await reanalyzeFileForControl(params.sessionId, currentFileAnalysisSettings());
        if (!run) throw new Error("FILE reanalysis was not accepted.");
        const runId = await run.accepted;
        return { sessionId: run.sessionId, runId };
      }
      if (method === "transport.file.restore") {
        if (meterRuntime.liveLifecycle === "running") await stopLiveForControl();
        switchSource("file");
        const run = await restoreFileHistoryForControl(params.sessionId);
        if (!run) throw new Error("History restoration was not accepted.");
        const runId = await run.accepted;
        return { sessionId: run.sessionId, runId };
      }
      if (method === "transport.file.stop") {
        await stopFileAnalysis(params.sessionId);
        return { sessionId: params.sessionId };
      }
      if (method === "transport.file.select") {
        if (meterRuntime.liveLifecycle === "running") await stopLiveForControl();
        switchSource("file");
        selectFile(params.sessionId);
        return { sessionId: params.sessionId };
      }
      if (method === "transport.file.remove") {
        await removeFile(params.sessionId);
        return { sessionId: params.sessionId };
      }
      if (method === "transport.file.clear") {
        fileQueue?.clear();
        await clearFiles();
        return {};
      }
      throw new Error(`Unsupported Transport method: ${method}`);
    },
    [
      analyzingFileId,
      preparingFileId,
      beginFileAnalysisForControl,
      clearFiles,
      clearLiveForControl,
      clearSnapshot,
      currentFileAnalysisSettings,
      docked,
      fileQueue,
      meterRuntime.sourceMode,
      meterRuntime.fileSessions,
      meterRuntime.liveLifecycle,
      reanalyzeFileForControl,
      restoreFileHistoryForControl,
      removeFile,
      selectFile,
      selectSnapshot,
      startLiveForControl,
      stopFileAnalysis,
      stopLiveForControl,
      switchSource,
    ]
  );
  const loudnessProfile = useLoudnessProfile();
  const settings = useAppSettings();
  const pointerControl = useMemo(
    () => ({
      available: isTauri() && ["windows", "macos"].includes(runtime.platform),
      windowVisible,
      scale: (surface) => {
        const geometry = visualRuntimeRef.current?.accessoryGeometry?.dockSettings;
        return (
          (surface === geometry?.windowLabel && geometry?.devicePixelRatio) ||
          globalThis.devicePixelRatio ||
          1
        );
      },
      move: movePointer,
      accessoryTargets: getAccessoryTargets,
      // An auto-hidden toolbar appears when a person's pointer reaches the top of the window.
      revealToolbar: chromeReveal?.showControls,
    }),
    [
      chromeReveal?.showControls,
      getAccessoryTargets,
      runtime.platform,
      visualRuntimeRef,
      windowVisible,
    ]
  );
  const updateControl = useMemo(
    () => ({
      initialized: updateControls.initialized,
      info: updateControls.updateInfo,
      installStatus: updateControls.installStatus,
      check: updateControls.refreshUpdateCheck,
    }),
    [updateControls]
  );
  const developmentUpdate = useMemo(
    () => ({
      enabled: runtime.identifier?.startsWith("com.soundoer.plvs.updatetest.h") === true,
      setPreferences: settings.setUpdatePreferences,
      open: updateControls.openDetails,
      confirm: () => updateControls.confirmInstall(),
      quit: () => requestCloseAction("quit"),
    }),
    [requestCloseAction, runtime.identifier, settings.setUpdatePreferences, updateControls]
  );
  const { onClearRef } = settings;
  const {
    state: workspaceState,
    replaceWorkspace,
    resetWorkspace,
    setPanelControlsForPanel,
    waitForWorkspacePersistenceEnqueue,
  } = useWorkspaceStore();
  const {
    channelCount,
    channelLabelRuntime,
    setChannelRolesForControl,
    setDialogueVadEngineForControl,
    derivedAnalysisRequests,
    analysisRequests,
    fileDurationMs,
    channelTopology,
  } = useAnalysisSession();
  const { channelLabelOverride, channelRoles } = channelLabelRuntime;
  const { activeBlockingEditors, getSceneOperationBlockers } = useSceneGuard();
  const { historyRetentionSec, channelLabelOverrides } = settings;
  const { sourceMode, running, fileSessions } = meterRuntime;
  const agentControlSettingsContext = useMemo(
    () => ({
      autostartReady: settings.autostartReady,
      shortcutsReady: settings.shortcutsReady,
      shortcutCapturing: settings.shortcutCapturing,
      shortcutRegistrationErrors: settings.shortcutRegistrationErrors,
      dialogueDetectionRequested: dialogueGating,
      dialogueDetectionActive: dialogueGating && running,
      hasCompletedFileAnalysis: fileSessions.some((session) =>
        Boolean(getSuccessfulFileSession(session))
      ),
      sourceMode,
      channelCount,
      channelLabelMode: channelLabelOverride ? "custom" : "auto",
      channelLabelRoles: channelLabelRuntime.channelLabelTokens,
      channelAutoRoles: seedTokensFromLabels(channelLabelRuntime.channelAutoLabels),
    }),
    [
      channelCount,
      channelLabelOverride,
      channelLabelRuntime.channelAutoLabels,
      channelLabelRuntime.channelLabelTokens,
      dialogueGating,
      fileSessions,
      running,
      settings.autostartReady,
      settings.shortcutCapturing,
      settings.shortcutRegistrationErrors,
      settings.shortcutsReady,
      sourceMode,
    ]
  );
  const agentControlSettings = useMemo(
    () => buildPublicSettings(settings, agentControlSettingsContext),
    [agentControlSettingsContext, settings]
  );
  const applyAgentControlSettings = useCallback(
    async (next, { changed, effects }) => {
      const compensation = [];
      try {
        if (changed.includes("settings.openAtLogin")) {
          await settings.setAutostartEnabledForControl(next.openAtLogin);
          compensation.push(() =>
            settings.setAutostartEnabledForControl(agentControlSettings.openAtLogin)
          );
        }
        if (changed.some((path) => path.startsWith("settings.keyboardShortcuts."))) {
          await settings.applyKeyboardShortcutsForControl(next.keyboardShortcuts);
          compensation.push(() =>
            settings.applyKeyboardShortcutsForControl(agentControlSettings.keyboardShortcuts)
          );
        }
        if (changed.includes("settings.dialogueVadEngine")) {
          await setDialogueVadEngineForControl(next.dialogueVadEngine);
          compensation.push(() =>
            setDialogueVadEngineForControl(agentControlSettings.dialogueVadEngine)
          );
        }
        if (changed.includes("settings.channelLabels")) {
          const nextRoles = next.channelLabels.roles ?? null;
          if (JSON.stringify(nextRoles) !== JSON.stringify(channelRoles)) {
            await setChannelRolesForControl(nextRoles);
            compensation.push(() => setChannelRolesForControl(channelRoles));
          }
        }
      } catch (error) {
        let rollbackFailed = false;
        for (const compensate of compensation.reverse()) {
          await compensate().catch(() => {
            rollbackFailed = true;
          });
        }
        error.partial = rollbackFailed;
        error.rollback = rollbackFailed ? "failed" : "completed";
        throw error;
      }

      if (changed.includes("settings.closeBehavior")) {
        settings.setCloseAction(next.closeBehavior);
      }
      if (changed.includes("settings.interfaceSize")) {
        settings.setInterfaceSize(next.interfaceSize);
      }
      if (changed.includes("settings.historyRetentionSec")) {
        await settings.setHistoryRetentionSec(next.historyRetentionSec);
      }
      if (changed.includes("settings.dialogueVadEngine")) {
        settings.setDialogueVadEngine(next.dialogueVadEngine);
      }
      if (changed.includes("settings.fileDialogueDetection")) {
        settings.setFileDialogueDetection(next.fileDialogueDetection);
      }
      if (changed.includes("settings.fileSummaryMetrics")) {
        settings.setFileSummaryMetrics(next.fileSummaryMetrics);
      }
      if (changed.includes("settings.channelLabels")) {
        settings.setChannelLabelOverrides((current) => {
          const updated = { ...current };
          if (next.channelLabels.mode === "custom") {
            updated[next.channelLabels.channelCount] = [...next.channelLabels.roles];
          } else {
            delete updated[next.channelLabels.channelCount];
          }
          return updated;
        });
      }
      // History Length already routes through its shared Live-clear operation. Other restart
      // effects still use the general source Clear below; a combined patch must clear only once.
      if (effects.length > 0 && !changed.includes("settings.historyRetentionSec")) {
        try {
          await onClearRef.current?.();
        } catch (error) {
          error.partial = true;
          error.rollback = "notPossible";
          error.changed = changed;
          error.effects = effects;
          throw error;
        }
      }
    },
    [
      agentControlSettings,
      channelRoles,
      onClearRef,
      setDialogueVadEngineForControl,
      setChannelRolesForControl,
      settings,
    ]
  );

  const agentControlAnalysisContext = useMemo(
    () => {
      const firstTimestampMs = firstHistoryTimestampMs(histSourceList);
      const latestTimestampMs = latestHistoryTimestampMs(histSourceList);
      const measuredDurationSec =
        Number.isFinite(firstTimestampMs) && Number.isFinite(latestTimestampMs)
          ? Math.max(0, (latestTimestampMs - firstTimestampMs) / 1000)
          : 0;
      const availableDurationSec =
        sourceMode === "file" && Number.isFinite(fileDurationMs)
          ? Math.min(historyRetentionSec, fileDurationMs / 1000)
          : Math.min(historyRetentionSec, measuredDurationSec);
      return {
        channelCount,
        channelTopology,
        channelLabels: channelLabelRuntime.channelAutoLabels,
        dialogueDetectionActive: dialogueGating,
        spectralWaveformActive: derivedAnalysisRequests.spectralWaveform,
        timeMaxWindowSec: Math.max(60, availableDurationSec),
        timeMaxOffsetSec: Math.max(0, availableDurationSec - 5),
        historyAvailable: Number.isFinite(firstTimestampMs) && Number.isFinite(latestTimestampMs),
        historyMaxOffsetSec:
          Number.isFinite(firstTimestampMs) && Number.isFinite(latestTimestampMs)
            ? Math.max(0, (latestTimestampMs - firstTimestampMs) / 1000)
            : 0,
      };
    },
    // The history ring mutates in place; its version intentionally invalidates this snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      channelCount,
      channelTopology,
      channelLabelRuntime.channelAutoLabels,
      dialogueGating,
      derivedAnalysisRequests.spectralWaveform,
      fileDurationMs,
      histSourceList,
      histSourceList.version,
      historyRetentionSec,
      sourceMode,
    ]
  );
  const measurementChannelLabels = useCallback(
    (record) => {
      const count = Array.isArray(record?.audio?.peakDb) ? record.audio.peakDb.length : 0;
      if (count <= 0) return [];
      const runtime = deriveChannelLabelRuntime({
        channelCount: count,
        channelLabelOverrides,
        autoChannelRoles: record?.audio?.autoChannelRoles ?? null,
      });
      return getPeakMeterChannelLabels(count, runtime.peakLabelContext);
    },
    [channelLabelOverrides]
  );
  const agentControlMeasurementContext = useMemo(
    () => ({
      getLiveMeasurement: meterRuntime.getLiveMeasurement,
      subscribeLiveMeasurement: meterRuntime.subscribeLiveMeasurement,
      getChannelLabels: measurementChannelLabels,
      liveState: meterRuntime.liveLifecycle,
      vectorscopeRequests: analysisRequests.vectorscope,
      dialogueActive: dialogueGating,
    }),
    [
      analysisRequests.vectorscope,
      dialogueGating,
      measurementChannelLabels,
      meterRuntime.getLiveMeasurement,
      meterRuntime.subscribeLiveMeasurement,
      meterRuntime.liveLifecycle,
    ]
  );

  const visualCaptureSurfaces = useVisualCaptureSurfaces({ workspace: workspaceState });
  const agentControlVisual = useMemo(
    () => ({
      platformCapabilities,
      getRuntime: () => visualRuntimeRef.current,
      settle: (target, options) =>
        ["dockHeader", "dockEditor", "dockUpdate", "dockSettings"].includes(target.kind)
          ? settleDockAccessory(target, visualRuntimeRef.current, options)
          : visualCaptureSurfaces.settle(target, options),
      captureScreenshot: captureVisualScreenshot,
      startRecording: startVisualRecording,
      inspectRecording: inspectVisualRecording,
      stopRecording: stopVisualRecording,
      updateRecordingGeometry: updateVisualRecordingGeometry,
      updateRecordingAudioState: updateVisualRecordingAudioState,
      subscribe: visualCaptureSurfaces.subscribe,
      setRecordingState,
    }),
    [platformCapabilities, setRecordingState, visualCaptureSurfaces, visualRuntimeRef]
  );

  useAgentControlBridge({
    enabled:
      runtime.available === true &&
      (enabled || isParticipantInstance()) &&
      platformCapabilities !== null,
    runtime,
    visual: agentControlVisual,
    analysisContext: agentControlAnalysisContext,
    measurementContext: agentControlMeasurementContext,
    workspace: workspaceState,
    replaceWorkspace,
    resetWorkspace,
    setPanelControlsForPanel,
    waitForWorkspacePersistenceEnqueue,
    settings: agentControlSettings,
    settingsContext: agentControlSettingsContext,
    applySettings: applyAgentControlSettings,
    transport: agentControlTransport,
    transportContext: {
      docked,
      deviceTransitioning: meterRuntime.liveDeviceTransition !== null,
      historyAvailable: agentControlAnalysisContext.historyAvailable,
      historyMaxOffsetSec: agentControlAnalysisContext.historyMaxOffsetSec,
    },
    executeTransport: executeAgentControlTransport,
    uiNavigation,
    editorDraft,
    developmentFixtures,
    developmentPerformance,
    developmentUpdate,
    windowControl,
    workbenchControl,
    updateControl,
    pointerControl,
    device: agentControlDevice,
    presets,
    loudnessProfile,
    hasLoudnessReference: Number.isFinite(loudnessProfile.referenceLufs),
    customThemes: settings.customThemes,
    theme: { control: settings.themeControl, state: settings.themeControl.readState() },
    viewContext: agentControlViewContext,
    dock: agentControlDock,
    dockContext: {
      sharedFrequencyViewport: workspaceState.axisViewports.frequency,
      platform: runtime.platform,
      ...agentControlAnalysisContext,
      sourceMode,
      activeEditors: activeBlockingEditors,
      readDockEntryBlockingEditors: () =>
        getSceneOperationBlockers?.("dock.enter") ?? activeBlockingEditors,
      transitioning: dockTransitioning,
      readMonitorInventory,
    },
    executeDock: executeDockForControl,
  });
  return null;
}
