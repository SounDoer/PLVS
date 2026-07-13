import { useCallback, useEffect, useMemo, useRef } from "react";
import { WorkspaceProvider, useWorkspaceStore } from "./workspace/WorkspaceContext.jsx";
import {
  MeterRuntimeProvider,
  useMeterRuntime,
  useMeterRuntimeAssembly,
} from "./runtime/MeterRuntimeContext.jsx";
import {
  deriveBackendAnalysisRequests,
  deriveChannelLabelRuntime,
  deriveDialogueRuntime,
} from "./runtime/appRuntimeDerivations.js";
import { UI_PREFERENCES } from "./uiPreferences";
import { normalizePanelControls } from "./lib/panelControls.js";
import { HISTORY_MIN_WINDOW_SEC } from "./math/historyMath";
import { useHistoryInteraction } from "./hooks/useHistoryInteraction";
import {
  useLoudnessHistory,
  HIST_SAMPLE_SEC,
  VISUAL_HIST_SAMPLE_SEC,
} from "./hooks/useLoudnessHistory.js";
import { useSettings } from "./hooks/useSettings";
import { useSnapshot } from "./hooks/useSnapshot";
import { useAudioDevices } from "./hooks/useAudioDevices.js";
import { usePresets } from "./hooks/usePresets.js";
import { useAlwaysOnTop } from "./hooks/useAlwaysOnTop.js";
import { useDockMode } from "./hooks/useDockMode.js";
import { useDockLayout } from "./dock/useDockLayout.js";
import { useDockAccessoryBridge } from "./dock/useDockAccessoryBridge.js";
import { useDockAccessoryVisibility } from "./dock/useDockAccessoryVisibility.js";
import { mergeDockSpectrumRequest } from "./dock/dockAnalysisRequest.js";
import { resolveChannelLayout } from "./math/channelLayoutResolver.js";
import {
  buildVectorscopePairOptions,
  formatVectorscopePairLabel,
} from "./math/vectorscopePairMath.js";
import { buildSpectrumChannelOptions } from "./math/spectrumChannelOptions.js";
import { getPeakMeterChannelLabels } from "./math/peakMeterChannelLabels.js";
import { getBuiltinTheme } from "./theme/builtinThemes.js";
import { AppShell } from "./components/AppShell.jsx";
import { AppSettingsOverlays } from "./components/AppSettingsOverlays.jsx";
import { deriveSourceTransportState } from "./lib/sourceTransportState.js";
import { getPanelControls } from "./workspace/panelControlInstances.js";
import { deriveClampedPanelControls } from "./workspace/clampPanelControls.js";
import { deriveAnalysisRequests } from "./analysis/analysisRequests.js";
import { formatAudioDeviceLabel } from "@/lib/audioDeviceLabels.js";
import { isTauri } from "./ipc/env.js";
import { resetTruePeakMax } from "./ipc/commands.js";
import { spectrumViewLegend } from "./math/spectrumChannelViewOptions.js";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useTray } from "./hooks/useTray.js";
import { useCloseConfirm } from "./hooks/useCloseConfirm.js";
import { useUpdateCheck } from "./hooks/useUpdateCheck.js";
import { useApplyUpdate } from "./hooks/useApplyUpdate.js";
import { useFocusViewWindow } from "./hooks/useFocusViewWindow.js";
import { useGlassEffect } from "./hooks/useGlassEffect.js";
import { useFileAnalysisReportExport } from "./hooks/useFileAnalysisReportExport.js";
import { useAppKeyboardShortcuts } from "./hooks/useAppKeyboardShortcuts.js";
import { useAppGlobalEffects } from "./hooks/useAppGlobalEffects.js";
import { useViewsChromeReveal } from "./hooks/useViewsChromeReveal.js";
import { useRuntimeBackendSync } from "./runtime/useRuntimeBackendSync.js";
import { useSourceTransportActions } from "./hooks/useSourceTransportActions.js";
import { CloseConfirmDialog } from "./components/CloseConfirmDialog.jsx";
import packageInfo from "../package.json";

const APP_VERSION = packageInfo.version;
const EMPTY_FILE_SESSION = Object.freeze({ state: "empty" });

export default function App() {
  return (
    <WorkspaceProvider>
      <MeterRuntimeProvider>
        <AppContent />
      </MeterRuntimeProvider>
    </WorkspaceProvider>
  );
}

function AppContent() {
  const {
    state: workspaceState,
    setPanelControls: setWorkspacePanelControls,
    setPanelControlsForPanel,
  } = useWorkspaceStore();
  useAppGlobalEffects();
  const {
    sourceMode,
    running,
    fileSessions,
    activeFileSession,
    analyzingFileSession,
    activeFileId,
    analyzingFileId,
    startLive,
    stopLive,
    stopFileAnalysis,
    switchSource,
    clearActiveSource,
    beginFileAnalysis: beginRuntimeFileAnalysis,
    reanalyzeFile,
    selectFile,
    removeFile,
    clearFiles,
  } = useMeterRuntime();
  const onClearRef = useRef(null);
  const settings = useSettings({ onClearRef });
  const {
    settingsOpen,
    setSettingsOpen,
    resolvedThemeId,
    clearShortcut,
    focusView,
    setFocusView,
    setAutoHideControls,
    setCompactPanels,
    setBorderless,
    channelLabelOverrides,
    setChannelLabelOverrides,
    panelOpacity,
    setPanelOpacity,
    glassEnabled,
    setGlassEnabled,
  } = settings;
  // Dock hooks run first: `docked` suspends the always-on-top and focus-view
  // window overrides below (Rust owns strip chrome + topmost while docked),
  // and preset capture/apply reads dock state. useDockMode depends on no
  // other hook, so hoisting it above useAlwaysOnTop is safe.
  const { dockEnabled, dockEdge, reserveSpace, enterDockMode, exitDockMode, setReserveSpace } =
    useDockMode();
  const dockLayout = useDockLayout();
  const docked = isTauri() && dockEnabled;
  // Suspended while docked: a preset apply may flip the stored pin to false
  // while the strip must stay topmost; when docked flips false the effect
  // re-asserts the user's value.
  const { pinned, setPinned, togglePin } = useAlwaysOnTop({ suspended: docked });
  // Suspended while docked: Rust owns strip chrome (no decorations/shadow);
  // when docked flips false the effect re-runs and re-asserts the user's values.
  useFocusViewWindow(focusView.autoHideControls, focusView.borderless, { suspended: docked });

  const {
    audioDevices,
    captureDeviceId,
    setCaptureDeviceIdAndPersist,
    defaultOutputFormatSig,
    defaultOutputLabel,
  } = useAudioDevices();

  const onHideWindow = useCallback(async () => {
    if (!isTauri()) return;
    const win = getCurrentWindow();
    await win.hide();
    await win.setSkipTaskbar(true);
  }, []);

  const onToggleWindow = useCallback(async () => {
    if (!isTauri()) return;
    const win = getCurrentWindow();
    const visible = await win.isVisible();
    if (visible) {
      await win.hide();
      await win.setSkipTaskbar(true);
    } else {
      await win.show();
      await win.setSkipTaskbar(false);
      await win.setFocus();
    }
  }, []);

  const {
    dialogOpen: closeDialogOpen,
    handleConfirm: handleCloseConfirm,
    handleCancel: handleCloseCancel,
  } = useCloseConfirm({ onHideWindow });

  const audioOutputs = useMemo(
    () => (audioDevices || []).filter((d) => d.isSystemOutputMonitor),
    [audioDevices]
  );
  const audioInputs = useMemo(
    () => (audioDevices || []).filter((d) => !d.isSystemOutputMonitor),
    [audioDevices]
  );
  const safeAudioDeviceId = useMemo(() => {
    const allowed = new Set(["default", ...(audioDevices || []).map((d) => d.id)]);
    return allowed.has(captureDeviceId) ? captureDeviceId : "default";
  }, [audioDevices, captureDeviceId]);

  const resolvedTheme = useMemo(() => getBuiltinTheme(resolvedThemeId), [resolvedThemeId]);
  useGlassEffect(glassEnabled, resolvedTheme.colorScheme === "dark");

  const { display, routing } = useMeterRuntimeAssembly();
  const {
    audio,
    setAudio,
    selectedOffset,
    setSelectedOffset,
    selectedSnapshotTimeMs,
    selectedOffsetRef,
    notice,
    raiseNotice,
    showClock,
  } = display;
  const { clockRef, elapsedMsRef, canClearRef } = display.clock;

  // Dock transitions. Exit restores the user's TRUE normal-form attributes
  // (override-not-overwrite): decorations follow focusView, always-on-top follows
  // the pin toggle — dock never persists over stored settings. Every transition
  // catches IPC rejections and surfaces them via raiseNotice(kind, text) so a
  // failed click handler can't leave an unhandled rejection.
  // NOTE: there is no in-flight guard against rapid dock transitions (v1 accepts
  // this; a fast toggle spam could interleave enter/exit IPC calls).
  const exitDockRestoringAttributes = useCallback(async () => {
    try {
      await exitDockMode({
        decorations: !(focusView.autoHideControls || focusView.borderless),
        alwaysOnTop: pinned === true,
      });
    } catch (err) {
      raiseNotice("error", `Restore window failed: ${err?.message || err}`);
    }
  }, [exitDockMode, focusView.autoHideControls, focusView.borderless, pinned, raiseNotice]);

  const onDockChange = useCallback(
    async (edgeOrNull) => {
      try {
        if (edgeOrNull) await enterDockMode(edgeOrNull);
        else await exitDockRestoringAttributes();
      } catch (err) {
        raiseNotice("error", `Dock failed: ${err?.message || err}`);
      }
    },
    [enterDockMode, exitDockRestoringAttributes, raiseNotice]
  );

  // Preset apply hand-off: dock geometry is Rust-owned, so a preset's dock
  // state is applied via enter/exit dock rather than window bounds. Left
  // uncaught here on purpose — usePresets.apply wraps this call and clears
  // activeId on failure (mirroring its existing applyWindowBounds handling).
  const applyDockPreset = useCallback(
    async (presetDock) => {
      if (presetDock.enabled) {
        dockLayout.setModules(presetDock.modules);
        dockLayout.setControlsByModuleId(presetDock.controlsByModuleId, presetDock.statsIds);
        if (!dockEnabled || dockEdge !== presetDock.edge) {
          await enterDockMode(presetDock.edge);
        }
        if (presetDock.reserveSpace !== reserveSpace) {
          await setReserveSpace(presetDock.reserveSpace, presetDock.edge);
        }
      } else if (dockEnabled) {
        await exitDockRestoringAttributes();
      }
    },
    [
      dockLayout,
      enterDockMode,
      dockEnabled,
      dockEdge,
      exitDockRestoringAttributes,
      reserveSpace,
      setReserveSpace,
    ]
  );

  // Stable identity: an inline literal would churn captureSnapshot (and the
  // memoized presets API) on every render.
  const presetDockState = useMemo(
    () => ({
      enabled: dockEnabled,
      edge: dockEdge,
      reserveSpace,
      modules: dockLayout.modules,
      controlsByModuleId: dockLayout.controlsByModuleId,
    }),
    [dockEnabled, dockEdge, dockLayout.controlsByModuleId, dockLayout.modules, reserveSpace]
  );

  const presets = usePresets({
    windowPinned: pinned,
    setWindowPinned: setPinned,
    focusView,
    setFocusView,
    panelOpacity,
    setPanelOpacity,
    glassEnabled,
    setGlassEnabled,
    dock: presetDockState,
    applyDockPreset,
  });

  const historyRetentionSec = settings.historyRetentionSec;
  const histMaxSamples = Math.round(historyRetentionSec / HIST_SAMPLE_SEC);
  const visualMaxSamples = Math.round(historyRetentionSec / VISUAL_HIST_SAMPLE_SEC);

  const fileSession = activeFileSession ?? EMPTY_FILE_SESSION;
  const normalizedPanelControls = useMemo(() => {
    const firstPanelId = workspaceState.panelOrder.find((id) => workspaceState.panelsById[id]);
    return normalizePanelControls(
      firstPanelId ? getPanelControls(workspaceState, firstPanelId) : undefined
    );
  }, [workspaceState]);
  const referenceLufs = useMemo(() => {
    const loudnessPanelId = workspaceState.panelOrder.find(
      (id) => workspaceState.panelsById[id]?.moduleId === "loudness"
    );
    return normalizePanelControls(
      loudnessPanelId ? getPanelControls(workspaceState, loudnessPanelId) : undefined
    ).loudnessReferenceLufs;
  }, [workspaceState]);
  const derivedAnalysisRequests = useMemo(
    () =>
      mergeDockSpectrumRequest(
        deriveAnalysisRequests(workspaceState),
        docked
          ? {
              spectrum: dockLayout.modules.includes("spectrum")
                ? dockLayout.controlsByModuleId.spectrum
                : null,
              spectrogram: dockLayout.modules.includes("spectrogram")
                ? dockLayout.controlsByModuleId.spectrogram
                : null,
            }
          : false
      ),
    [workspaceState, docked, dockLayout.controlsByModuleId, dockLayout.modules]
  );
  const analysisRequests = useMemo(
    () => deriveBackendAnalysisRequests(derivedAnalysisRequests),
    [derivedAnalysisRequests]
  );
  const analysisStatusByPanelId = derivedAnalysisRequests.statusByPanelId;
  const vectorscopePairUi = normalizedPanelControls.vectorscopePair;
  const spectrumChannelUi = normalizedPanelControls.spectrumChannel;
  const spectrumViewUi = normalizedPanelControls.spectrumView;
  const spectrumPeakHoldUi = normalizedPanelControls.spectrumPeakHold;
  const { updateInfo, refreshUpdateCheck } = useUpdateCheck();
  const { installStatus, install, restartToApply } = useApplyUpdate();

  const { intakeRef, fileDisplayIntake, frequencyMarkerRef, getSpectrogramSnapsForKey } = routing;

  // Stable identity: several effects (vectorscope/spectrum clamps, the displayAudio sync)
  // list updatePanelControls in their deps. If its identity changed per dispatch it would
  // re-run those effects → dispatch → re-run → "Maximum update depth exceeded" on Start.
  // Read the latest values through refs and keep useCallback deps empty.
  const panelControlsRef = useRef(normalizedPanelControls);
  panelControlsRef.current = normalizedPanelControls;
  const setWorkspacePanelControlsRef = useRef(setWorkspacePanelControls);
  setWorkspacePanelControlsRef.current = setWorkspacePanelControls;
  const updatePanelControls = useCallback((nextPanelControls) => {
    const current = panelControlsRef.current;
    const next = normalizePanelControls(
      typeof nextPanelControls === "function" ? nextPanelControls(current) : nextPanelControls
    );
    // Skip redundant dispatches: normalize() always returns a new object, so without this
    // an unchanged value would still churn workspace state (and persist) on every frame.
    if (JSON.stringify(next) === JSON.stringify(current)) return;
    setWorkspacePanelControlsRef.current(next);
  }, []);

  const {
    histSourceList,
    displayAudio,
    hasHistoryData,
    correlation,
    channelMetadata,
    targetTimestampMs,
    snapshotSpectrumByKey,
    resolveSpectrumSnapshotForKey,
    resolveVectorscopeSnapshotForKey,
  } = useSnapshot({
    selectedOffset,
    sampleSec: HIST_SAMPLE_SEC,
    intake: intakeRef.current,
    audio,
  });

  const {
    historyWindowSec,
    setHistoryWindowSec,
    historyOffsetSec,
    setHistoryOffsetSec,
    setHistoryHudUntilTs,
    historyHudHold,
    setHistoryHudHold,
    historyChartInteractive,
    totalSamples,
    clampedWindowSec,
    visibleSamples,
    maxOffsetSamples,
    effectiveOffsetSamples,
    effectiveOffsetSec,
    showSelLine,
    selLineX,
    isHistoryHudVisible,
    historyTimeTicks,
    statsMetrics,
  } = useLoudnessHistory({
    histSourceList,
    hasHistoryData,
    running,
    displayAudio,
    referenceLufs,
    selectedOffset,
    sourceMode,
    historyMaxWindowSec: historyRetentionSec,
  });

  const hasTpMaxValue = Number.isFinite(displayAudio?.tpMax);
  const vsGridDiagInset = useMemo(() => {
    const pct = UI_PREFERENCES.modules.vectorscope.gridDiagInsetPct ?? 0;
    return Math.max(0, Math.min(20, pct));
  }, []);
  const vsGridDiagFar = 100 - vsGridDiagInset;
  // In file mode the selected history sample's timestamp is absolute media time (>= 0); clamp it so
  // a scrub past the decoded tail never renders a negative time in the transport pill. Live mode
  // keeps the raw value (its timeline is wall-clock relative).
  const fileDurationMs = fileSession.summary?.durationMs ?? fileSession.metadata?.durationMs;
  const selectedMediaTimeMs =
    sourceMode === "file" && Number.isFinite(targetTimestampMs)
      ? Math.max(0, targetTimestampMs)
      : targetTimestampMs;

  // Once a file's duration is known (probe metadata while analyzing, or the final summary), fit the
  // loudness-history window to the whole file and reset scrub so the full analyzed curve shows over
  // an absolute media-time axis. selectedOffset is intentionally not a dependency so user scrubbing
  // afterwards is preserved; getHistoryViewport clamps the window to [MIN, MAX].
  useEffect(() => {
    if (sourceMode !== "file") return;
    if (fileSession.state !== "analyzing" && fileSession.state !== "complete") return;
    setHistoryWindowSec(
      Number.isFinite(fileDurationMs) ? fileDurationMs / 1000 : historyRetentionSec
    );
    setHistoryOffsetSec(0);
    setSelectedOffset(-1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceMode, fileSession.state, fileDurationMs, historyRetentionSec]);

  const previousHistoryRetentionSecRef = useRef(historyRetentionSec);
  useEffect(() => {
    if (previousHistoryRetentionSecRef.current === historyRetentionSec) return;
    previousHistoryRetentionSecRef.current = historyRetentionSec;
    setSelectedOffset(-1);
    setHistoryOffsetSec(0);
    setHistoryWindowSec((current) =>
      Math.min(
        current,
        historyRetentionSec,
        UI_PREFERENCES.modules.loudness.history.defaultWindowSec
      )
    );
  }, [historyRetentionSec, setHistoryOffsetSec, setHistoryWindowSec, setSelectedOffset]);

  const latestTimestampMs = useMemo(() => {
    const last = histSourceList.length > 0 ? histSourceList[histSourceList.length - 1] : null;
    return Number.isFinite(last?.timestampMs) ? last.timestampMs : undefined;
  }, [histSourceList]);

  const sourceTransportState = deriveSourceTransportState({
    sourceMode,
    running,
    selectedOffset,
    latestTimestampMs,
    elapsedMs: elapsedMsRef.current,
    selectedSnapshotTimeMs,
    selectedMediaTimeMs,
    fileSession,
    analyzingFileSession,
  });
  const showFileAnalysisResult = sourceMode === "file" && fileSessions.length > 0;
  const chromeState = sourceTransportState.chromeState;
  const displayChannelCount = Array.isArray(displayAudio.peakDb) ? displayAudio.peakDb.length : 0;
  const liveChannelCount = Array.isArray(audio.peakDb) ? audio.peakDb.length : 0;
  const channelCount = displayChannelCount > 0 ? displayChannelCount : liveChannelCount;
  const layoutResolution = useMemo(
    () => resolveChannelLayout("auto", { channelCount }),
    [channelCount]
  );
  const channelLabelRuntime = useMemo(
    () => deriveChannelLabelRuntime({ channelCount, layoutResolution, channelLabelOverrides }),
    [channelCount, channelLabelOverrides, layoutResolution]
  );
  const { channelLabelOverride, overrideLabels, loudnessWeights } = channelLabelRuntime;
  const { dialogueGating, dialogueVadEngine } = useMemo(
    () => deriveDialogueRuntime(workspaceState),
    [workspaceState]
  );
  const channelAutoLabels = channelLabelRuntime.channelAutoLabels;
  const channelLabelTokens = channelLabelRuntime.channelLabelTokens;
  const { loudnessWeightsRef, dialogueGatingRef, dialogueVadEngineRef } = useRuntimeBackendSync({
    analysisRequests,
    loudnessWeights,
    running,
    dialogueGating,
    dialogueVadEngine,
  });

  useEffect(() => {
    const s = document.documentElement.style;
    const p = panelOpacity;
    s.setProperty("--panel-opacity", `${p}%`);
    s.setProperty("--panel-opacity-card", `${Math.round(p * 0.55)}%`);
    s.setProperty("--panel-opacity-header", `${Math.round(p * 0.6)}%`);
    s.setProperty("--panel-opacity-meter", String(Math.max(0.25, p / 100)));
  }, [panelOpacity]);

  const currentFileAnalysisSettings = useCallback(
    () => ({
      dialogue: {
        enabled: dialogueGating,
        engine: dialogueGating ? dialogueVadEngine : null,
      },
    }),
    [dialogueGating, dialogueVadEngine]
  );

  const peakLabelContext = channelLabelRuntime.peakLabelContext;

  const setChannelLabelToken = useCallback(
    (index, token) => {
      if (channelCount <= 0) return;
      setChannelLabelOverrides((prev) => {
        const base = prev[channelCount] ?? seedTokensFromLabels(channelAutoLabels);
        const next = base.slice();
        next[index] = token;
        return { ...prev, [channelCount]: next };
      });
    },
    [channelCount, channelAutoLabels]
  );

  const resetChannelLabels = useCallback(() => {
    setChannelLabelOverrides((prev) => {
      if (!(channelCount in prev)) return prev;
      const next = { ...prev };
      delete next[channelCount];
      return next;
    });
  }, [channelCount]);

  /** Use stereo (2ch) choices when idle so Settings shows default L/R instead of an empty state. */
  const vectorscopePairOptions = useMemo(() => {
    const n = channelCount >= 2 ? channelCount : channelCount === 0 ? 2 : 1;
    return buildVectorscopePairOptions(n, peakLabelContext);
  }, [channelCount, peakLabelContext]);

  const spectrumChannelOptions = useMemo(() => {
    const n = channelCount >= 2 ? channelCount : 2;
    const labels = getPeakMeterChannelLabels(n, peakLabelContext);
    return buildSpectrumChannelOptions(n, labels);
  }, [channelCount, peakLabelContext]);
  const spectrumValueKey =
    spectrumChannelUi.type === "pair"
      ? `p-${spectrumChannelUi.x}-${spectrumChannelUi.y}`
      : `s-${spectrumChannelUi.ch}`;
  const spectrumLiveLabel =
    spectrumChannelOptions.find((o) => o.key === spectrumValueKey)?.label ??
    spectrumChannelOptions[0]?.label ??
    "L/R";
  const vectorscopeValueKey = `${vectorscopePairUi.x}-${vectorscopePairUi.y}`;
  const vectorscopeChannelLabels = getPeakMeterChannelLabels(
    channelCount >= 2 ? channelCount : 2,
    peakLabelContext
  );
  const vectorscopeLiveLabel = formatVectorscopePairLabel({
    x: vectorscopePairUi.x,
    y: vectorscopePairUi.y,
    channelLabels: vectorscopeChannelLabels,
  });
  const spectrumDisplayLabel = channelMetadata?.frequencyLabel ?? spectrumLiveLabel;
  const vectorscopeDisplayLabel = channelMetadata?.vectorscopePairLabel ?? vectorscopeLiveLabel;

  const captureFormatSignature = useMemo(() => {
    if (!isTauri()) return "";
    if (captureDeviceId === "default") {
      return defaultOutputFormatSig || "";
    }
    const d = audioDevices.find((x) => x.id === captureDeviceId);
    return d ? `${d.channels}:${d.defaultSampleRate}` : "";
  }, [captureDeviceId, audioDevices, defaultOutputFormatSig]);

  const deviceName = useMemo(() => {
    if (!isTauri()) return null;
    if (captureDeviceId === "default") {
      return defaultOutputLabel || audioDevices.find((d) => d.isSystemOutputMonitor)?.label || null;
    }
    return audioDevices.find((d) => d.id === captureDeviceId)?.label ?? null;
  }, [captureDeviceId, audioDevices, defaultOutputLabel]);
  const deviceDisplay = useMemo(
    () => (deviceName ? formatAudioDeviceLabel(deviceName) : null),
    [deviceName]
  );
  const footerDeviceLabel = deviceDisplay
    ? deviceDisplay.secondary || deviceDisplay.primary
    : "Not connected";
  const activePreset = presets.list.find((preset) => preset.id === presets.activeId);
  const activePresetName = activePreset ? `${activePreset.name}${presets.dirty ? " *" : ""}` : "-";
  const focusViewActive =
    pinned ||
    focusView.autoHideControls ||
    focusView.compactPanels ||
    focusView.borderless ||
    panelOpacity < 100;
  const frameless = focusView.autoHideControls || focusView.borderless;
  const {
    controlsVisible: focusControlsVisible,
    showControls: showFocusControls,
    hideControlsLater: hideFocusControlsLater,
    hideControlsNow: hideFocusControlsNow,
    toggleControls: toggleFocusControls,
    holdControls: holdFocusControls,
    releaseControlsHold: releaseFocusControlsHold,
    handleWindowDrag,
  } = useViewsChromeReveal({
    autoHideControls: focusView.autoHideControls,
    frameless,
  });

  // Clamp every panel instance's channel selection to the currently available channels. Lowering
  // the device channel count must repair all panels (not just the first), otherwise a stale
  // out-of-range selection would derive an analysis request key with no matching backend result.
  useEffect(() => {
    const updates = deriveClampedPanelControls(workspaceState, {
      spectrumChannelOptions,
      channelCount,
      peakLabelContext,
    });
    for (const { panelId, panelControls } of updates) {
      setPanelControlsForPanel(panelId, panelControls);
    }
  }, [
    workspaceState,
    spectrumChannelOptions,
    channelCount,
    peakLabelContext,
    setPanelControlsForPanel,
  ]);

  const onVectorscopePairChange = (pair) => {
    const nextVectorscopeLabel = formatVectorscopePairLabel({
      x: pair.x,
      y: pair.y,
      channelLabels: vectorscopeChannelLabels,
    });
    intakeRef.current.setCurrentChannelMetadata({
      frequencyLabel: spectrumLiveLabel,
      vectorscopePairLabel: nextVectorscopeLabel,
    });
    if (selectedOffsetRef.current >= 0) setSelectedOffset(-1);
    updatePanelControls((current) => ({ ...current, vectorscopePair: pair }));
  };

  const onSpectrumChannelChange = (sel) => {
    const prevLabel = spectrumLiveLabel;
    const nextKey = sel.type === "pair" ? `p-${sel.x}-${sel.y}` : `s-${sel.ch}`;
    const nextLabel = spectrumChannelOptions.find((o) => o.key === nextKey)?.label ?? prevLabel;
    intakeRef.current.setCurrentChannelMetadata({
      frequencyLabel: nextLabel,
      vectorscopePairLabel: vectorscopeLiveLabel,
    });
    if (selectedOffsetRef.current >= 0) setSelectedOffset(-1);
    updatePanelControls((current) => ({ ...current, spectrumChannel: sel }));
    if (running && prevLabel !== nextLabel) {
      intakeRef.current.setPendingFrequencyMarker({ from: prevLabel, to: nextLabel });
    }
  };

  const onSpectrumViewChange = (view) => {
    if (selectedOffsetRef.current >= 0) setSelectedOffset(-1);
    updatePanelControls((current) => ({ ...current, spectrumView: view }));
  };

  const onSpectrumPeakHoldToggle = () => {
    updatePanelControls((current) => ({ ...current, spectrumPeakHold: !spectrumPeakHoldUi }));
  };

  const {
    showHistoryHud,
    holdHistoryHud,
    onHistoryPointerDown,
    onHistoryPointerMove,
    onHistoryPointerUp,
    onHistoryWheel,
    isTimeAxisActive,
    historyTimeAxisHandlers,
  } = useHistoryInteraction({
    enabled: historyChartInteractive,
    sampleSec: HIST_SAMPLE_SEC,
    minWindowSec: HISTORY_MIN_WINDOW_SEC,
    maxWindowSec: historyRetentionSec,
    defaultWindowSec: UI_PREFERENCES.modules.loudness.history.defaultWindowSec,
    totalSamples,
    visibleSamples,
    maxOffsetSamples,
    effectiveOffsetSamples,
    effectiveOffsetSec,
    setSelectedOffset,
    setHistoryOffsetSec,
    setHistoryWindowSec,
    setHistoryHudUntilTs,
    setHistoryHudHold,
  });

  const captureCurrentSnapshot = useCallback(() => {
    if (!historyChartInteractive || totalSamples <= 0) return;
    setSelectedOffset(0);
    showHistoryHud(1600);
  }, [historyChartInteractive, totalSamples, setSelectedOffset, showHistoryHud]);

  const resetTpMax = async () => {
    if (isTauri()) {
      try {
        await resetTruePeakMax();
      } catch (_) {}
    }
    setAudio((prev) => ({ ...prev, tpMax: -Infinity }));
  };

  const { exportFileAnalysisReport } = useFileAnalysisReportExport({
    fileSession,
    appVersion: APP_VERSION,
    raiseNotice,
  });
  const {
    clearAll,
    openFile,
    onSelectFile,
    onStopFile,
    onReanalyzeFile,
    onRemoveFile,
    onClearAllFiles,
    handleDropFile,
    onStartClick,
    onSourceTransportAction,
    onSourceModeChange,
  } = useSourceTransportActions({
    sourceMode,
    running,
    selectedOffset,
    setSelectedOffset,
    setHistoryOffsetSec,
    setHistoryWindowSec,
    startLive,
    stopLive,
    switchSource,
    clearActiveSource,
    beginRuntimeFileAnalysis,
    reanalyzeFile,
    selectFile,
    removeFile,
    clearFiles,
    stopFileAnalysis,
    activeFileSession,
    getFileAnalysisSettings: currentFileAnalysisSettings,
  });
  onClearRef.current = clearAll;

  const onDockAccessoryError = useCallback(
    (error) => raiseNotice("error", `Dock accessory failed: ${error?.message || error}`),
    [raiseNotice]
  );
  const dockAccessoryVisibility = useDockAccessoryVisibility({
    active: docked,
    edge: dockEdge,
    onError: onDockAccessoryError,
  });
  const dockHeaderState = useMemo(
    () => ({
      sourceTransportState,
      clearDisabled: !running && !showClock,
      notice,
      edge: dockEdge,
      reserveSpace,
      editorView: dockAccessoryVisibility.editorView,
    }),
    [
      dockAccessoryVisibility.editorView,
      dockEdge,
      notice,
      reserveSpace,
      running,
      showClock,
      sourceTransportState,
    ]
  );
  const dockEditorState = useMemo(
    () => ({
      view: dockAccessoryVisibility.editorView,
      modules: dockLayout.modules,
      controlsByModuleId: dockLayout.controlsByModuleId,
      presets: {
        list: presets.list.map(({ id, name }) => ({ id, name })),
        activeId: presets.activeId,
        dirty: presets.dirty,
      },
    }),
    [
      dockAccessoryVisibility.editorView,
      dockLayout.controlsByModuleId,
      dockLayout.modules,
      presets.activeId,
      presets.dirty,
      presets.list,
    ]
  );
  const onDockAccessoryAction = useCallback(
    ({ type, payload }) => {
      if (type === "source-primary") onSourceTransportAction(payload.actionKind);
      else if (type === "clear") clearAll();
      else if (type === "open-editor") dockAccessoryVisibility.openEditor(payload.view);
      else if (type === "close-editor")
        dockAccessoryVisibility.closeEditor(payload.view, payload.reason);
      else if (type === "resize-editor") dockAccessoryVisibility.resizeEditor(payload);
      else if (type === "set-edge") void onDockChange(payload.edge);
      else if (type === "set-reserve-space") {
        void setReserveSpace(payload.enabled).catch((error) =>
          raiseNotice("error", `Reserve screen space failed: ${error?.message || error}`)
        );
      } else if (type === "restore-window") void exitDockRestoringAttributes();
      else if (type === "toggle-module") dockLayout.toggle(payload.moduleId);
      else if (type === "add-module") {
        if (!dockLayout.modules.includes(payload.moduleId)) {
          dockLayout.setModules([...dockLayout.modules, payload.moduleId]);
        }
      } else if (type === "remove-module") {
        dockLayout.setModules(
          dockLayout.modules.filter((moduleId) => moduleId !== payload.moduleId)
        );
      } else if (type === "reorder-module") {
        if (Array.isArray(payload.modules)) dockLayout.setModules(payload.modules);
        else dockLayout.reorder(payload.from, payload.to);
      } else if (type === "open-module-settings") {
        dockAccessoryVisibility.openEditor(`module:${payload.moduleId}`);
      } else if (type === "update-module-controls") {
        dockLayout.setModuleControls(payload.moduleId, payload.controls);
      } else if (type === "reset-module-controls") {
        dockLayout.resetModuleControls(payload.moduleId);
      } else if (type === "apply-preset") void presets.apply(payload.presetId);
      else if (type === "save-preset") void presets.save(payload.name);
      else if (type === "update-preset") void presets.update(payload.presetId);
      else if (type === "rename-preset") presets.rename(payload.presetId, payload.name);
      else if (type === "delete-preset") presets.remove(payload.presetId);
    },
    [
      clearAll,
      dockAccessoryVisibility,
      dockLayout,
      exitDockRestoringAttributes,
      onDockChange,
      onSourceTransportAction,
      presets,
      raiseNotice,
      setReserveSpace,
    ]
  );
  useDockAccessoryBridge({
    active: docked,
    headerState: dockHeaderState,
    editorState: dockEditorState,
    onAction: onDockAccessoryAction,
    onPointer: dockAccessoryVisibility.onAccessoryPointer,
  });

  useTray({
    running,
    pinned,
    togglePin,
    onStartClick,
    deviceName,
    onToggleWindow,
    colorScheme: resolvedTheme.colorScheme,
  });

  useAppKeyboardShortcuts({
    clearAll,
    running,
    showClock,
    // Settings dialog is normal-form only; ignore the shortcut while docked so
    // exiting dock doesn't pop a dialog opened invisibly from the strip.
    setSettingsOpen: docked ? () => {} : setSettingsOpen,
    clearShortcut,
    autoHideControls: focusView.autoHideControls,
    toggleFocusControls,
  });

  useEffect(() => {
    intakeRef.current.setCurrentChannelMetadata({
      frequencyLabel: spectrumLiveLabel,
      vectorscopePairLabel: vectorscopeLiveLabel,
    });
  }, [spectrumLiveLabel, vectorscopeLiveLabel]);

  const spectrumViewLegendValue = useMemo(
    () => spectrumViewLegend(spectrumViewUi, spectrumChannelUi, vectorscopeChannelLabels),
    [spectrumViewUi, spectrumChannelUi, vectorscopeChannelLabels]
  );
  const panelChromeData = useMemo(
    () => ({
      compactPanels: focusView.compactPanels,
      channelCount,
      vectorscopePairOptions,
      vectorscopeValueKey,
      vectorscopeDisplayLabel,
      spectrumChannelOptions,
      spectrumValueKey,
      spectrumDisplayLabel,
      spectrumView: spectrumViewUi,
      spectrumViewLegend: spectrumViewLegendValue,
      spectrumPeakHold: spectrumPeakHoldUi,
      analysisStatusByPanelId,
    }),
    [
      focusView.compactPanels,
      channelCount,
      vectorscopePairOptions,
      vectorscopeValueKey,
      vectorscopeDisplayLabel,
      spectrumChannelOptions,
      spectrumValueKey,
      spectrumDisplayLabel,
      spectrumViewUi,
      spectrumViewLegendValue,
      spectrumPeakHoldUi,
      analysisStatusByPanelId,
    ]
  );

  const frameData = {
    // Peak
    displayAudio,
    hasTpMaxValue,
    onResetTpMax: resetTpMax,
    // Vectorscope
    vsGridDiagInset,
    vsGridDiagFar,
    correlation,
    vectorscopePairX: vectorscopePairUi.x,
    vectorscopePairY: vectorscopePairUi.y,
    channelCount,
    peakLabelContext,
    resolvedThemeId,
    spectrumChannelOptions,
  };
  const historyData = {
    selectedOffset,
    setSelectedOffset,
    running,
    referenceLufs,
    hasHistoryData,
    historyChartInteractive,
    showSelLine,
    selLineX,
    isHistoryHudVisible,
    clampedWindowSec,
    effectiveOffsetSec,
    historyTimeTicks,
    holdHistoryHud,
    showHistoryHud,
    onHistoryWheel,
    onHistoryPointerDown,
    onHistoryPointerMove,
    onHistoryPointerUp,
    historyTimeAxisHandlers,
    historyTimeAxisActive: isTimeAxisActive,
    captureCurrentSnapshot,
    frequencyMarkerRef,
    effectiveOffsetSamples,
    visibleSamples,
    totalSamples,
    histSourceList,
    snapshotSpectrumByKey,
    resolveSpectrumSnapshotForKey,
    resolveVectorscopeSnapshotForKey,
    getVectorscopeHistoryForKey: (key) => intakeRef.current.getVisualVectorscopeHistByKey(key),
    getSpectrogramSnapsForKey,
  };
  // frameData/historyData change at frame/history-sample rate by nature, so memoizing
  // them buys nothing; the low-frequency layers are metricsData (below), panelChromeData
  // and the memoized runtime object in MeterRuntimeContext.
  const dialogueActiveNow = displayAudio?.dialogueActiveNow ?? false;
  const metricsData = useMemo(
    () => ({ statsMetrics, dialogueActiveNow }),
    [statsMetrics, dialogueActiveNow]
  );
  // Live and file sessions share bounded display history, sized from the user's History Length
  // setting. File-mode summary metrics are authoritative for the whole file; panel history is an
  // inspectable downsampled/session view, not unlimited storage.
  const runtimeEnginesProps = {
    captureDeviceId,
    captureFormatSignature,
    histMaxSamples,
    visualMaxSamples,
    loudnessWeightsRef,
    dialogueGatingRef,
    dialogueVadEngineRef,
  };
  const fileDropProps = {
    active: sourceMode === "file",
    onDropFile: handleDropFile,
  };
  const shellHandlers = {
    showFocusControls,
    hideFocusControlsNow,
    hideFocusControlsLater,
    handleWindowDrag,
    releaseFocusControlsHold,
  };
  const headerProps = {
    autoHideControls: focusView.autoHideControls,
    onPointerEnter: focusView.autoHideControls ? showFocusControls : undefined,
    onPointerLeave: focusView.autoHideControls ? hideFocusControlsLater : undefined,
    onPointerDown: frameless ? handleWindowDrag : undefined,
    onPointerUp: frameless ? releaseFocusControlsHold : undefined,
    onPointerCancel: frameless ? releaseFocusControlsHold : undefined,
    sourceTransportState,
    notice,
    sourceMode,
    onSourceModeChange,
    onSourceTransportAction,
    onClear: clearAll,
    clearDisabled: sourceMode === "file" ? !activeFileSession : !running && !showClock,
    isTauriApp: isTauri(),
    onOpenFile: openFile,
    audioDevices,
    audioOutputs,
    audioInputs,
    safeAudioDeviceId,
    setCaptureDeviceId: setCaptureDeviceIdAndPersist,
    holdFocusControls,
    focusView,
    focusViewActive,
    pinned,
    setPinned,
    setAutoHideControls,
    setCompactPanels,
    setBorderless,
    panelOpacity,
    setPanelOpacity,
    glassEnabled,
    setGlassEnabled,
    showDock: isTauri(),
    dockEdge: docked ? dockEdge : null,
    onDockChange,
    dockDisabled: sourceMode === "file",
    presets,
    setSettingsOpen,
  };
  const fileSummaryProps = {
    fileSession,
    fileSessions,
    activeFileId,
    analyzingFileId,
    onSelectFile,
    onReanalyzeFile,
    onRemoveFile,
    onClearAllFiles,
    onStopFile,
    onExportReport: exportFileAnalysisReport,
  };
  const footer = {
    deviceLabel: footerDeviceLabel,
    referenceLufs,
    activePresetName,
    hasUpdate: updateInfo?.hasUpdate,
    onOpenSettings: () => setSettingsOpen(true),
  };
  const dockProps = docked
    ? {
        modules: dockLayout.modules,
        onPointerEnter: dockAccessoryVisibility.onStripPointerEnter,
        onPointerLeave: dockAccessoryVisibility.onStripPointerLeave,
        controls: {
          controlsByModuleId: dockLayout.controlsByModuleId,
          sourceTransportState,
          onSourceTransportAction,
          notice,
        },
      }
    : null;

  return (
    <AppShell
      docked={docked}
      dockProps={dockProps}
      frameData={frameData}
      historyData={historyData}
      metricsData={metricsData}
      runtimeEnginesProps={runtimeEnginesProps}
      fileDropProps={fileDropProps}
      focusView={focusView}
      focusControlsVisible={focusControlsVisible}
      shellHandlers={shellHandlers}
      headerProps={headerProps}
      showFileAnalysisResult={showFileAnalysisResult}
      fileSummaryProps={fileSummaryProps}
      panelChromeData={panelChromeData}
      footer={footer}
    >
      <AppSettingsOverlays
        settings={settings}
        channelSettings={{
          channelCount,
          channelLabelTokens,
          channelLabelHasOverride: !!channelLabelOverride,
          setChannelLabelToken,
          resetChannelLabels,
        }}
        updateControls={{
          updateInfo,
          refreshUpdateCheck,
          installStatus,
          install,
          restartToApply,
        }}
        appVersion={APP_VERSION}
      />

      <CloseConfirmDialog
        open={closeDialogOpen}
        onConfirm={handleCloseConfirm}
        onCancel={handleCloseCancel}
      />
    </AppShell>
  );
}
