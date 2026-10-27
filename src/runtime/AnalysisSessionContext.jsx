import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from "react";
import { useWorkspaceStore } from "../workspace/WorkspaceContext.jsx";
import { useSharedTimeViewport } from "../workspace/useSharedTimeViewport.js";
import { useAppSettings } from "../settings/SettingsContext.jsx";
import { useChannelRolesRestart } from "../hooks/useDialogueEngineRestart.js";
import { useDock } from "../dock/DockContext.jsx";
import { mergeDockAnalysisRequests, mergeDockRetainedKeys } from "../dock/dockAnalysisRequest.js";
import { dockModuleIdForPanelModuleId } from "../dock/dockLayout.js";
import {
  deriveAnalysisRequests,
  deriveRetainedAnalysisKeys,
  unionRetainedAnalysisKeys,
} from "../analysis/analysisRequests.js";
import {
  effectiveWorkspaceState,
  resolveEffectiveChannelControls,
} from "../analysis/effectiveChannels.js";
import { buildVectorscopePairOptions } from "../math/vectorscopePairMath.js";
import { buildSpectrumChannelOptions } from "../math/spectrumChannelOptions.js";
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
 *   channelTopology: import("../analysis/effectiveChannels.js").ChannelTopology,
 *   derivedAnalysisRequests: ReturnType<typeof mergeDockAnalysisRequests>,
 *   analysisRequests: ReturnType<typeof deriveBackendAnalysisRequests>,
 *   fileDurationMs: number | undefined,
 * }} AnalysisSession
 */
const AnalysisSessionContext = createContext(/** @type {AnalysisSession | null} */ (null));

/**
 * What is being analysed and how its channels are named: the channel count and labels, and the
 * analysis requests derived from the open panels -- with each panel's requested channels resolved
 * against what the source offers -- and their synchronization to the Rust engine.
 *
 * Re-renders per meter frame, because the channel count comes from the displayed frame. The value
 * it publishes is memoized on facts that change at human speed, so its consumers do not.
 *
 * Its effects stay in this one component in a fixed order.
 */
export function AnalysisSessionProvider({ children }) {
  const { state: workspaceState } = useWorkspaceStore();
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
    onClearRef,
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

  const channelLabelRuntime = useMemo(
    () => deriveChannelLabelRuntime({ channelCount, channelLabelOverrides }),
    [channelCount, channelLabelOverrides]
  );
  const peakLabelContext = channelLabelRuntime.peakLabelContext;

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

  // What the current source offers. Panels keep their requested channels; requests and history
  // keys use the effective ones resolved against this, so a narrower source never rewrites a panel.
  const channelTopology = useMemo(
    () => ({ channelCount, spectrumChannelOptions, peakLabelContext }),
    [channelCount, spectrumChannelOptions, peakLabelContext]
  );
  const effectiveWorkspace = useMemo(
    () => effectiveWorkspaceState(workspaceState, channelTopology),
    [workspaceState, channelTopology]
  );

  const dockPanelInstances = useMemo(
    () =>
      dockLayout.panels.map((panel) => ({
        panelId: panel.id,
        moduleId: panel.moduleId,
        controls: dockLayout.controlsByPanelId[panel.id],
      })),
    [dockLayout.panels, dockLayout.controlsByPanelId]
  );
  const effectiveDockPanelInstances = useMemo(
    () =>
      dockPanelInstances.map((panel) => {
        const { controls, unavailable } = resolveEffectiveChannelControls(
          dockModuleIdForPanelModuleId(panel.moduleId) ?? panel.moduleId,
          panel.controls,
          channelTopology
        );
        return unavailable ? { ...panel, controls } : panel;
      }),
    [dockPanelInstances, channelTopology]
  );
  const derivedAnalysisRequests = useMemo(
    () =>
      mergeDockAnalysisRequests(
        deriveAnalysisRequests(effectiveWorkspace, { channelCount }),
        docked ? effectiveDockPanelInstances : false
      ),
    [effectiveWorkspace, channelCount, docked, effectiveDockPanelInstances]
  );
  const analysisRequests = useMemo(
    () => deriveBackendAnalysisRequests(derivedAnalysisRequests),
    [derivedAnalysisRequests]
  );
  // Which histories survive is a different question from what Rust computes, so this is derived
  // from the open panels rather than from `analysisRequests` -- and deliberately without `docked`,
  // because AppShell renders the strip or the panels and whichever is hidden comes back intact.
  // A panel falling back keeps both keys: its request's history returns with the wider source.
  const retainedAnalysisKeys = useMemo(
    () =>
      mergeDockRetainedKeys(
        unionRetainedAnalysisKeys(
          deriveRetainedAnalysisKeys(workspaceState),
          effectiveWorkspace === workspaceState
            ? null
            : deriveRetainedAnalysisKeys(effectiveWorkspace)
        ),
        [
          ...dockPanelInstances,
          ...effectiveDockPanelInstances.filter(
            (panel, index) => panel !== dockPanelInstances[index]
          ),
        ]
      ),
    [workspaceState, effectiveWorkspace, dockPanelInstances, effectiveDockPanelInstances]
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
  const { channelRoles } = channelLabelRuntime;
  useChannelRolesRestart(channelLabelOverrides, sourceMode === "live", onClearRef);
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
      channelTopology,
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
      channelTopology,
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
