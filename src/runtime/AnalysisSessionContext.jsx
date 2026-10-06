import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from "react";
import { useWorkspaceStore } from "../workspace/WorkspaceContext.jsx";
import { useSharedTimeViewport } from "../workspace/useSharedTimeViewport.js";
import { deriveClampedPanelControls } from "../workspace/clampPanelControls.js";
import { useAppSettings } from "../settings/SettingsContext.jsx";
import { useDock } from "../dock/DockContext.jsx";
import { mergeDockAnalysisRequests, mergeDockRetainedKeys } from "../dock/dockAnalysisRequest.js";
import {
  deriveAnalysisRequests,
  deriveRetainedAnalysisKeys,
} from "../analysis/analysisRequests.js";
import {
  buildVectorscopePairOptions,
  clampVectorscopePairToAvailable,
} from "../math/vectorscopePairMath.js";
import {
  buildSpectrumChannelOptions,
  clampSpectrumChannelToAvailable,
} from "../math/spectrumChannelOptions.js";
import { getPeakMeterChannelLabels } from "../math/peakMeterChannelLabels.js";
import { seedTokensFromLabels } from "../math/channelRoles.js";
import { rolesForLayout } from "../math/channelLayoutTable.js";
import {
  deriveBackendAnalysisRequests,
  deriveChannelLabelRuntime,
} from "./appRuntimeDerivations.js";
import {
  useMeterDisplayState,
  useMeterRuntime,
  useMeterRuntimeAssembly,
} from "./MeterRuntimeContext.jsx";
import { useSourceActions } from "./SourceActionsContext.jsx";
import { useDisplaySnapshot } from "./DisplaySnapshotContext.jsx";
import { useRuntimeBackendSync } from "./useRuntimeBackendSync.js";

/**
 * @typedef {ReturnType<typeof useRuntimeBackendSync> & {
 *   channelCount: number,
 *   channelLabelRuntime: ReturnType<typeof deriveChannelLabelRuntime>,
 *   peakLabelContext: any,
 *   setChannelLabelToken: (index: number, token: string) => void,
 *   setChannelLayout: (layoutId: string) => void,
 *   resetChannelLabels: () => void,
 *   vectorscopePairOptions: any[],
 *   spectrumChannelOptions: any[],
 *   derivedAnalysisRequests: ReturnType<typeof mergeDockAnalysisRequests>,
 *   analysisRequests: ReturnType<typeof deriveBackendAnalysisRequests>,
 *   fileDurationMs: number | undefined,
 * }} AnalysisSession
 */
const AnalysisSessionContext = createContext(/** @type {AnalysisSession | null} */ (null));

/**
 * What is being analysed and how its channels are named: the channel count and labels, the
 * analysis requests derived from the open panels, their synchronization to the Rust engine, and
 * the repairs applied to panel controls when the channel count changes.
 *
 * Re-renders per meter frame, because the channel count comes from the displayed frame. The value
 * it publishes is memoized on facts that change at human speed, so its consumers do not.
 *
 * Its effects stay in this one component in a fixed order: the backend learns the analysis
 * requests before the clamps repair a selection, exactly as before the move.
 */
export function AnalysisSessionProvider({ children }) {
  const { state: workspaceState, setPanelControlsForPanel } = useWorkspaceStore();
  const { setHistoryWindowSec, setHistoryOffsetSec } = useSharedTimeViewport();
  const { sourceMode } = useMeterRuntime();
  const { setSelectedOffset } = useMeterDisplayState();
  const { routing } = useMeterRuntimeAssembly();
  const { ingestingIntakes } = routing;
  const { channelCount } = useDisplaySnapshot();
  const { fileSession, dialogueGating } = useSourceActions();
  const { docked, layout: dockLayout } = useDock();
  const {
    historyRetentionSec,
    dialogueVadEngine,
    channelLabelOverrides,
    setChannelLabelOverrides,
  } = useAppSettings();

  const fileDurationMs = fileSession.summary?.durationMs ?? fileSession.metadata?.durationMs;
  // Once a file's duration is known (probe metadata while analyzing, or the final summary), fit the
  // shared time window to the whole file and reset scrub so the full analyzed curve shows over
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
    // Each panel clamps the persisted viewport against the new retention at render time. Keep the
    // stored shared and dormant local values intact so increasing retention can reveal them again.
  }, [historyRetentionSec, setSelectedOffset]);

  const dockPanelInstances = useMemo(
    () =>
      dockLayout.panels.map((panel) => ({
        panelId: panel.id,
        moduleId: panel.moduleId,
        controls: dockLayout.controlsByPanelId[panel.id],
      })),
    [dockLayout.panels, dockLayout.controlsByPanelId]
  );
  const derivedAnalysisRequests = useMemo(
    () =>
      mergeDockAnalysisRequests(
        deriveAnalysisRequests(workspaceState, { channelCount }),
        docked ? dockPanelInstances : false
      ),
    [workspaceState, channelCount, docked, dockPanelInstances]
  );
  const analysisRequests = useMemo(
    () => deriveBackendAnalysisRequests(derivedAnalysisRequests),
    [derivedAnalysisRequests]
  );
  // Which histories survive is a different question from what Rust computes, so this is derived
  // from the open panels rather than from `analysisRequests` -- and deliberately without `docked`,
  // because AppShell renders the strip or the panels and whichever is hidden comes back intact.
  const retainedAnalysisKeys = useMemo(
    () => mergeDockRetainedKeys(deriveRetainedAnalysisKeys(workspaceState), dockPanelInstances),
    [workspaceState, dockPanelInstances]
  );
  // Sweeping runs inside pushVisualHistRow -- i.e. only on the intakes that INGEST frames
  // (routing's `ingestingIntakes`: live + file-analysis), not on `intakeRef.current`, which is
  // whichever intake is DISPLAYED. Those differ across a source switch, and `intakeRef` is a
  // stable ref object, so an effect keyed on it would never re-fire when only its `.current`
  // changes -- go live, switch to file, edit panels there, switch back, and the live intake is
  // still holding the key set from before the excursion (switchSource resets its rows but not
  // `_retainedVisualKeys`). It then ingests under the newly-keyed panel and, a grace period later,
  // sweeps that panel's history away as unretained. Target the ingesting intakes directly instead,
  // so the set follows what is actually writing rows. `fileDisplayIntake` needs nothing of its
  // own: it is either the same object as `fileAnalysisIntake`, or a frozen session that receives
  // no frames and therefore never sweeps.
  useEffect(() => {
    const windowMs = historyRetentionSec * 1000;
    for (const intake of ingestingIntakes) {
      intake?.setRetainedVisualKeys(retainedAnalysisKeys, windowMs);
    }
  }, [ingestingIntakes, retainedAnalysisKeys, historyRetentionSec]);
  const channelLabelRuntime = useMemo(
    () => deriveChannelLabelRuntime({ channelCount, channelLabelOverrides }),
    [channelCount, channelLabelOverrides]
  );
  const { channelRoles } = channelLabelRuntime;
  const {
    channelRolesRef,
    dialogueGatingRef,
    dialogueVadEngineRef,
    setChannelRolesForControl,
    setDialogueVadEngineForControl,
  } = useRuntimeBackendSync({
    analysisRequests,
    channelRoles,
    dialogueGating,
    dialogueVadEngine,
  });
  const channelAutoLabels = channelLabelRuntime.channelAutoLabels;

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
    [channelCount, channelAutoLabels, setChannelLabelOverrides]
  );

  const setChannelLayout = useCallback(
    (/** @type {string} */ layoutId) => {
      if (layoutId === "custom") return;
      const roles = rolesForLayout(layoutId);
      if (roles.length !== channelCount) return;
      setChannelLabelOverrides((prev) => ({ ...prev, [channelCount]: roles }));
    },
    [channelCount, setChannelLabelOverrides]
  );

  const resetChannelLabels = useCallback(() => {
    setChannelLabelOverrides((prev) => {
      if (!(channelCount in prev)) return prev;
      const next = { ...prev };
      delete next[channelCount];
      return next;
    });
  }, [channelCount, setChannelLabelOverrides]);

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

  const dockPanels = dockLayout.panels;
  const dockControlsByPanelId = dockLayout.controlsByPanelId;
  const setDockPanelControls = dockLayout.setPanelControls;

  useEffect(() => {
    for (const panel of dockPanels) {
      if (panel.moduleId !== "vectorscope") continue;
      const controls = dockControlsByPanelId[panel.id];
      const pair = controls?.vectorscopePair;
      const nextPair = clampVectorscopePairToAvailable(
        pair,
        channelCount >= 2 ? channelCount : 2,
        peakLabelContext
      );
      if (nextPair.x === pair?.x && nextPair.y === pair?.y) continue;
      setDockPanelControls(panel.id, { ...controls, vectorscopePair: nextPair });
    }
  }, [channelCount, dockControlsByPanelId, dockPanels, setDockPanelControls, peakLabelContext]);

  useEffect(() => {
    for (const panel of dockPanels) {
      if (panel.moduleId !== "stereo-map") continue;
      const controls = dockControlsByPanelId[panel.id];
      const pair = controls?.stereoMapPair;
      const nextPair = clampVectorscopePairToAvailable(
        pair,
        channelCount >= 2 ? channelCount : 2,
        peakLabelContext
      );
      if (nextPair.x === pair?.x && nextPair.y === pair?.y) continue;
      setDockPanelControls(panel.id, { ...controls, stereoMapPair: nextPair });
    }
  }, [channelCount, dockControlsByPanelId, dockPanels, setDockPanelControls, peakLabelContext]);

  useEffect(() => {
    for (const panel of dockPanels) {
      if (panel.moduleId !== "spectrum" && panel.moduleId !== "spectrogram") continue;
      const controls = dockControlsByPanelId[panel.id];
      const channel = controls?.spectrumChannel;
      const nextChannel = clampSpectrumChannelToAvailable(channel, spectrumChannelOptions);
      const currentKey =
        channel?.type === "single" ? `s-${channel.ch}` : `p-${channel?.x ?? 0}-${channel?.y ?? 1}`;
      const nextKey =
        nextChannel.type === "single"
          ? `s-${nextChannel.ch}`
          : `p-${nextChannel.x}-${nextChannel.y}`;
      if (currentKey === nextKey) continue;
      setDockPanelControls(panel.id, { ...controls, spectrumChannel: nextChannel });
    }
  }, [dockControlsByPanelId, dockPanels, setDockPanelControls, spectrumChannelOptions]);

  const value = useMemo(
    () => ({
      channelCount,
      channelLabelRuntime,
      peakLabelContext,
      setChannelLabelToken,
      setChannelLayout,
      resetChannelLabels,
      vectorscopePairOptions,
      spectrumChannelOptions,
      derivedAnalysisRequests,
      analysisRequests,
      fileDurationMs,
      channelRolesRef,
      dialogueGatingRef,
      dialogueVadEngineRef,
      setChannelRolesForControl,
      setDialogueVadEngineForControl,
    }),
    [
      channelCount,
      channelLabelRuntime,
      peakLabelContext,
      setChannelLabelToken,
      setChannelLayout,
      resetChannelLabels,
      vectorscopePairOptions,
      spectrumChannelOptions,
      derivedAnalysisRequests,
      analysisRequests,
      fileDurationMs,
      channelRolesRef,
      dialogueGatingRef,
      dialogueVadEngineRef,
      setChannelRolesForControl,
      setDialogueVadEngineForControl,
    ]
  );
  return (
    <AnalysisSessionContext.Provider value={value}>{children}</AnalysisSessionContext.Provider>
  );
}

export function useAnalysisSession() {
  const session = useContext(AnalysisSessionContext);
  if (!session) throw new Error("useAnalysisSession must be used inside AnalysisSessionProvider");
  return session;
}
