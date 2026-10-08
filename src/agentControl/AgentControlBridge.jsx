import { useCallback, useEffect, useMemo, useState } from "react";
import { availableMonitors, currentMonitor, primaryMonitor } from "@tauri-apps/api/window";
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
import { roleTokensToLabels } from "../math/channelRoles.js";
import { standardLayoutIdForCount } from "../math/channelLayoutTable.js";
import { seedTokensFromLabels } from "../math/channelRoles.js";
import { buildPublicSettings } from "./settingsControl.js";
import { buildTransportSnapshot } from "./transportControl.js";
import { isTauri } from "../ipc/env.js";
import { supportsDockMode } from "../lib/platform.js";
import { readAgentControlRuntime } from "./appSnapshot.js";
import { useAgentControlBridge } from "./useAgentControlBridge.js";
import { useAgentControlState } from "./AgentControlStateContext.jsx";
import { useVisualCaptureSurfaces } from "./useVisualCaptureSurfaces.js";
import { settleDockAccessory } from "./settleDockAccessory.js";
import { useDockAccessories } from "../dock/DockAccessoriesContext.jsx";
import { isParticipantInstance } from "../lib/runtimeRole.js";
import {
  captureVisualScreenshot,
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
  const { visualRuntimeRef } = useDockAccessories();
  const {
    docked,
    dockEdge,
    dockMonitor,
    dockHeight,
    dockSuspended,
    dockTransitioning,
    reserveSpace,
    layout: dockLayout,
    executeDockForControl,
  } = useDock();

  const [agentControlMonitors, setAgentControlMonitors] = useState([]);
  const [agentControlFallbackMonitor, setAgentControlFallbackMonitor] = useState(null);
  const [agentControlMonitorRects, setAgentControlMonitorRects] = useState([]);
  const [agentControlMonitorInventoryReady, setAgentControlMonitorInventoryReady] = useState(false);
  useEffect(() => {
    // Dock Control is the only consumer, and it exists only in a development-identity build, so a
    // release has no reason to query the monitor list at boot.
    if (!isTauri() || readAgentControlRuntime().available !== true) return;
    let cancelled = false;
    void Promise.resolve()
      .then(async () => {
        const [monitors, current, primary] = await Promise.all([
          availableMonitors(),
          currentMonitor(),
          primaryMonitor(),
        ]);
        if (cancelled) return;
        setAgentControlMonitors(
          monitors.flatMap((monitor) =>
            typeof monitor.name === "string" ? [{ id: monitor.name, name: monitor.name }] : []
          )
        );
        setAgentControlFallbackMonitor(
          typeof current?.name === "string"
            ? current.name
            : typeof primary?.name === "string"
              ? primary.name
              : null
        );
        setAgentControlMonitorRects(
          monitors.flatMap((monitor) =>
            Number.isFinite(monitor.position?.x) &&
            Number.isFinite(monitor.position?.y) &&
            Number.isFinite(monitor.size?.width) &&
            Number.isFinite(monitor.size?.height)
              ? [
                  {
                    x: monitor.position.x,
                    y: monitor.position.y,
                    width: monitor.size.width,
                    height: monitor.size.height,
                  },
                ]
              : []
          )
        );
        setAgentControlMonitorInventoryReady(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  const agentControlDock = useMemo(
    () => ({
      supported: supportsDockMode(),
      enabled: docked,
      edge: dockEdge,
      monitor: dockMonitor,
      reserveSpace,
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
    ]
  );

  const { view, applyViewState } = useWindowChrome();
  const { pinned, focusView, surfaceOpacity, glassEnabled } = view;
  const agentControlViewContext = useMemo(
    () => ({
      view: { pinned, focusView, surfaceOpacity, glassEnabled },
      platform: runtime.platform,
      docked,
      applyView: applyViewState,
    }),
    [runtime.platform, applyViewState, docked, focusView, glassEnabled, surfaceOpacity, pinned]
  );

  const presets = usePresetLibrary();
  const uiNavigation = useUiNavigation();
  const meterRuntime = useMeterRuntime();
  const {
    analyzingFileId,
    stopFileAnalysis,
    switchSource,
    stopLiveForControl,
    startLiveForControl,
    clearLiveForControl,
    beginFileAnalysisForControl,
    reanalyzeFileForControl,
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
  const { updateBusy } = useAppLifecycle();
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
  const { currentFileAnalysisSettings, dialogueGating } = useSourceActions();
  const agentControlTransport = useMemo(
    () =>
      buildTransportSnapshot(meterRuntime, {
        requestedDeviceId: captureDeviceId,
        selectedOffset,
        docked,
      }),
    [captureDeviceId, docked, meterRuntime, selectedOffset]
  );
  const executeAgentControlTransport = useCallback(
    async (/** @type {string} */ method, params) => {
      if (method === "transport.source.live") {
        if (analyzingFileId) await stopFileAnalysis(analyzingFileId);
        switchSource("live");
        return {};
      }
      if (method === "transport.source.file") {
        if (meterRuntime.liveLifecycle === "running") await stopLiveForControl();
        switchSource("file");
        return {};
      }
      if (method === "transport.live.start") {
        if (analyzingFileId) await stopFileAnalysis(analyzingFileId);
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
        if (meterRuntime.liveLifecycle === "running") await stopLiveForControl();
        switchSource("file");
        const run = beginFileAnalysisForControl(params.path, currentFileAnalysisSettings());
        if (!run) throw new Error("FILE analysis was not accepted.");
        await run.accepted;
        const { sessionId } = run;
        return { sessionId };
      }
      if (method === "transport.file.reanalyze") {
        switchSource("file");
        const run = reanalyzeFileForControl(params.sessionId, currentFileAnalysisSettings());
        if (!run) throw new Error("FILE reanalysis was not accepted.");
        await run.accepted;
        return { sessionId: params.sessionId };
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
        await clearFiles();
        return {};
      }
      throw new Error(`Unsupported Transport method: ${method}`);
    },
    [
      analyzingFileId,
      beginFileAnalysisForControl,
      clearFiles,
      clearLiveForControl,
      clearSnapshot,
      currentFileAnalysisSettings,
      meterRuntime.liveLifecycle,
      reanalyzeFileForControl,
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
  const { onClearRef } = settings;
  const {
    state: workspaceState,
    replaceWorkspace,
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
  } = useAnalysisSession();
  const { channelLabelOverride, channelRoles } = channelLabelRuntime;
  const { activeBlockingEditors } = useSceneGuard();
  const { historyRetentionSec, channelLabelOverrides } = settings;
  const { sourceMode, running, fileSessions } = meterRuntime;
  const agentControlSettingsContext = useMemo(
    () => ({
      autostartReady: settings.autostartReady,
      clearShortcutReady: settings.clearReady,
      clearShortcutCapturing: settings.clearCapturing,
      clearShortcutRegistrationError: settings.registrationError,
      dialogueDetectionRequested: dialogueGating,
      dialogueDetectionActive: dialogueGating && running,
      hasCompletedFileAnalysis: fileSessions.some((session) => session.state === "complete"),
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
      settings.clearCapturing,
      settings.clearReady,
      settings.registrationError,
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
        if (changed.some((path) => path.startsWith("settings.clearShortcut."))) {
          await settings.applyClearShortcutForControl(next.clearShortcut);
          compensation.push(() =>
            settings.applyClearShortcutForControl(agentControlSettings.clearShortcut)
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
        settings.setHistoryRetentionSec(next.historyRetentionSec);
      }
      if (changed.includes("settings.dialogueVadEngine")) {
        settings.setDialogueVadEngine(next.dialogueVadEngine);
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
      if (effects.length > 0) {
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
      const override = channelLabelOverrides[count];
      const autoLayoutId = standardLayoutIdForCount(count);
      return getPeakMeterChannelLabels(count, {
        formatId: autoLayoutId ?? undefined,
        resolvedLayout: autoLayoutId ? undefined : "unknown",
        overrideLabels: override ? roleTokensToLabels(override) : null,
      });
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
        target.kind === "dockHeader" || target.kind === "dockEditor"
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
    device: agentControlDevice,
    presets,
    loudnessProfile,
    hasLoudnessReference: Number.isFinite(loudnessProfile.referenceLufs),
    customThemes: settings.customThemes,
    theme: { control: settings.themeControl, state: settings.themeControl.readState() },
    viewContext: agentControlViewContext,
    dock: agentControlDock,
    dockContext: {
      platform: runtime.platform,
      ...agentControlAnalysisContext,
      sourceMode,
      activeEditors: activeBlockingEditors,
      transitioning: dockTransitioning,
      monitors: agentControlMonitors,
      fallbackMonitor: agentControlFallbackMonitor,
      monitorRects: agentControlMonitorRects,
      monitorInventoryReady: agentControlMonitorInventoryReady,
    },
    executeDock: executeDockForControl,
  });
  return null;
}
