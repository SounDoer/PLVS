import { useCallback, useEffect, useMemo } from "react";
import { useWorkspaceStore } from "./WorkspaceContext.jsx";
import { useSharedTimeViewport } from "./useSharedTimeViewport.js";
import { getPanelControls } from "./panelControlInstances.js";
import { useDock } from "../dock/DockContext.jsx";
import { useLoudnessProfile } from "../hooks/LoudnessProfileContext.jsx";
import { useLoudnessHistory } from "../hooks/useLoudnessHistory.js";
import { useWindowChrome } from "../hooks/WindowChromeContext.jsx";
import { normalizePanelControls } from "../lib/panelControls.js";
import { normalizePanelPresentation } from "../lib/panelPresentation.js";
import { getPeakMeterChannelLabels } from "../math/peakMeterChannelLabels.js";
import { spectrumViewLegend } from "../math/spectrumChannelViewOptions.js";
import { formatVectorscopePairLabel } from "../math/vectorscopePairMath.js";
import { useAnalysisSession } from "../runtime/AnalysisSessionContext.jsx";
import { useDisplaySnapshot } from "../runtime/DisplaySnapshotContext.jsx";
import {
  useMeterDisplayState,
  useMeterRuntime,
  useMeterRuntimeAssembly,
} from "../runtime/MeterRuntimeContext.jsx";
import { useSourceActions } from "../runtime/SourceActionsContext.jsx";
import { useAppSettings } from "../settings/SettingsContext.jsx";

export function usePanelRuntimeData() {
  const meterRuntime = useMeterRuntime();
  const { sourceMode, running } = meterRuntime;
  const { selectedOffset, setSelectedOffset, selectSnapshot } = useMeterDisplayState();
  const { routing } = useMeterRuntimeAssembly();
  const { state: workspaceState } = useWorkspaceStore();
  const { sharedTimeViewport, setHistoryWindowSec, setHistoryOffsetSec } = useSharedTimeViewport();
  const { docked } = useDock();
  const { view: chromeView } = useWindowChrome();
  const { focusView, resolvedThemeId, historyRetentionSec } = useAppSettings();
  const loudnessProfile = useLoudnessProfile();
  const { vectorscopeResetEpoch, stereoMapResetEpoch } = useSourceActions();
  const { peakLabelContext, vectorscopePairOptions, spectrumChannelOptions } = useAnalysisSession();

  const normalizedPanelControls = useMemo(() => {
    const firstPanelId = workspaceState.panelOrder.find((id) => workspaceState.panelsById[id]);
    return normalizePanelControls(
      firstPanelId ? getPanelControls(workspaceState, firstPanelId) : undefined
    );
  }, [workspaceState]);
  const referenceLufs = loudnessProfile.referenceLufs;
  // Only the two metrics the history chart draws can tint their traces; split them out here so the
  // panel and the dock read the same rules from one place.
  const loudnessTraceRules = useMemo(() => {
    const rules = loudnessProfile.document?.rules ?? [];
    return {
      momentary: rules.filter((rule) => rule.metricId === "momentary"),
      shortTerm: rules.filter((rule) => rule.metricId === "shortTerm"),
    };
  }, [loudnessProfile.document]);

  const vectorscopePairUi = normalizedPanelControls.vectorscopePair;
  const spectrumChannelUi = normalizedPanelControls.spectrumChannel;
  const spectrumViewUi = normalizedPanelControls.spectrumView;

  const { intakeRef, getSpectrogramSnapsForKey } = routing;

  const {
    histSourceList,
    targetTimestampMs,
    loudnessDisplayIndex,
    waveformHistoryIndex,
    visualWaveformHist,
    frequencyMarkerIndex,
    displayAudio,
    hasHistoryData,
    correlation,
    channelMetadata,
    snapshotSpectrumByKey,
    resolveSpectrumSnapshotForKey,
    resolveVectorscopeSnapshotForKey,
    resolveStereoMapSnapshotForKey,
    channelCount,
  } = useDisplaySnapshot();

  const { historyChartInteractive, totalSamples, statsMetrics } = useLoudnessHistory({
    histSourceList,
    hasHistoryData,
    running,
    displayAudio,
    referenceLufs,
  });

  const hasTpMaxValue = Number.isFinite(displayAudio?.tpMax);
  const spectrumValueKey =
    spectrumChannelUi.type === "pair"
      ? `p-${spectrumChannelUi.x}-${spectrumChannelUi.y}`
      : `s-${spectrumChannelUi.ch}`;
  const spectrumLiveLabel =
    spectrumChannelOptions.find((o) => o.key === spectrumValueKey)?.label ??
    spectrumChannelOptions[0]?.label ??
    "L/R";
  const vectorscopeChannelLabels = getPeakMeterChannelLabels(
    channelCount >= 2 ? channelCount : 2,
    peakLabelContext
  );
  const vectorscopeLiveLabel = formatVectorscopePairLabel({
    x: vectorscopePairUi.x,
    y: vectorscopePairUi.y,
    channelLabels: vectorscopeChannelLabels,
  });
  const vectorscopeDisplayLabel = channelMetadata?.vectorscopePairLabel ?? vectorscopeLiveLabel;

  const captureCurrentSnapshot = useCallback(() => {
    if (!historyChartInteractive || totalSamples <= 0) return;
    setSelectedOffset(0);
  }, [historyChartInteractive, totalSamples, setSelectedOffset]);

  useEffect(() => {
    intakeRef.current.setCurrentChannelMetadata({
      frequencyLabel: spectrumLiveLabel,
      vectorscopePairLabel: vectorscopeLiveLabel,
    });
  }, [intakeRef, spectrumLiveLabel, vectorscopeLiveLabel]);

  const spectrumViewLegendValue = useMemo(
    () => spectrumViewLegend(spectrumViewUi, spectrumChannelUi, vectorscopeChannelLabels),
    [spectrumViewUi, spectrumChannelUi, vectorscopeChannelLabels]
  );
  const panelPresentation = useMemo(
    () => normalizePanelPresentation(chromeView?.panelPresentation, focusView),
    [chromeView?.panelPresentation, focusView]
  );
  const panelChromeData = useMemo(
    () => ({
      hidePanelHeaders: panelPresentation.workspace.hidePanelHeaders,
      hideAxesAndLabels: panelPresentation[docked ? "dock" : "workspace"].hideAxesAndLabels,
      docked,
      channelCount,
      vectorscopePairOptions,
      stereoMapPairOptions: vectorscopePairOptions,
      stereoMapPairDisplayLabel: vectorscopeDisplayLabel,
      spectrumChannelOptions,
      spectrumViewLegend: spectrumViewLegendValue,
    }),
    [
      panelPresentation,
      docked,
      channelCount,
      vectorscopePairOptions,
      vectorscopeDisplayLabel,
      spectrumChannelOptions,
      spectrumViewLegendValue,
    ]
  );

  const frameData = {
    // Peak
    displayAudio,
    hasTpMaxValue,
    onResetTpMax:
      sourceMode === "live" &&
      meterRuntime.liveLifecycle === "running" &&
      !meterRuntime.liveDeviceTransition &&
      selectedOffset < 0
        ? meterRuntime.resetLiveTruePeakMax
        : null,
    // Vectorscope
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
    selectedMediaTimestampMs: targetTimestampMs,
    setSelectedOffset,
    selectSnapshot,
    // The Time Range settings row edits the viewport these describe. It reads the effective values
    // rather than the stored window, because those are what the axis labels are built from.
    sourceMode,
    fileDisplayIntake: sourceMode === "file" ? routing.fileDisplayIntake : null,
    historyMaxWindowSec: historyRetentionSec,
    historyWindowSec: sharedTimeViewport.windowSec,
    historyOffsetSec: sharedTimeViewport.offsetSec,
    setHistoryWindowSec,
    setHistoryOffsetSec,
    running,
    referenceLufs,
    momentaryRules: loudnessTraceRules.momentary,
    shortTermRules: loudnessTraceRules.shortTerm,
    hasHistoryData,
    historyChartInteractive,
    captureCurrentSnapshot,
    frequencyMarkerIndex,
    totalSamples,
    histSourceList,
    loudnessDisplayIndex,
    waveformHistoryIndex,
    visualWaveformHist,
    snapshotSpectrumByKey,
    resolveSpectrumSnapshotForKey,
    resolveVectorscopeSnapshotForKey,
    resolveStereoMapSnapshotForKey,
    getVectorscopeHistoryForKey: (key) => intakeRef.current.getVisualVectorscopeHistByKey(key),
    getStereoMapHistoryForKey: (key) => intakeRef.current.getVisualStereoMapHistByKey(key),
    vectorscopeResetEpoch,
    stereoMapResetEpoch,
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
  return { frameData, historyData, metricsData, panelChromeData, panelPresentation };
}
