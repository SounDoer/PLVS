import { useMemo } from "react";
import { useWorkspaceStore } from "../workspace/WorkspaceContext.jsx";
import { getPanelControls } from "../workspace/panelControlInstances.js";
import { useDock } from "../dock/DockContext.jsx";
import { normalizeDockModuleControls } from "../dock/dockModuleControls.js";
import { normalizePanelControls } from "../lib/panelControls.js";
import { listMissingPreferredMetrics, planShowMissing } from "../lib/loudnessProfileMissing.js";
import { useLoudnessProfile } from "./LoudnessProfileContext.jsx";

/**
 * The stats every Stats surface shows, and the action that adds the ones the active loudness
 * profile asks for. Owns no state: it reads the Workspace, the Dock layout and the profile.
 */
export function useLoudnessProfileStats() {
  const { state: workspaceState, setPanelControlsForPanel } = useWorkspaceStore();
  const { layout: dockLayout } = useDock();
  // Read as its own value: the memo below depends on the document, not on the whole controller.
  const { document: profileDocument } = useLoudnessProfile();

  // Missing-stats fulfillment spans every Stats panel: the profile's needs are a session-level
  // statement, so a row added for it should appear wherever Stats is shown. Union for detection,
  // append per panel for the fix -- each panel keeps the order its user arranged.
  const statsPanelIds = useMemo(
    () =>
      workspaceState.panelOrder.filter((id) => workspaceState.panelsById[id]?.moduleId === "stats"),
    [workspaceState]
  );
  // Dock Stats is a second implementation with its own visible ids (dockModuleControls), so both
  // sets have to be unioned for detection and both appended to on fulfill. Missing either half
  // makes Show missing look like it worked while one surface keeps hiding the rows.
  const dockStatsPanelIds = useMemo(
    () =>
      Object.values(dockLayout.panelsById ?? {})
        .filter((panel) => panel?.moduleId === "stats")
        .map((panel) => panel.id),
    [dockLayout.panelsById]
  );
  const loudnessProfileStats = useMemo(() => {
    if (statsPanelIds.length === 0 && dockStatsPanelIds.length === 0) return null;

    const workspaceControls = statsPanelIds.map((panelId) => ({
      panelId,
      controls: normalizePanelControls(getPanelControls(workspaceState, panelId)),
      apply: setPanelControlsForPanel,
    }));
    const dockControls = dockStatsPanelIds.map((panelId) => ({
      panelId,
      controls: normalizeDockModuleControls("stats", dockLayout.controlsByPanelId?.[panelId]),
      apply: dockLayout.setPanelControls,
    }));
    const everyStatsSurface = [...workspaceControls, ...dockControls];

    const seen = new Set();
    for (const { controls } of everyStatsSurface) {
      for (const id of controls.statsVisibleIds) seen.add(id);
    }

    return {
      visibleIds: [...seen],
      onShowMissing: () => {
        for (const { panelId, controls, apply } of everyStatsSurface) {
          const missing = listMissingPreferredMetrics(profileDocument, controls.statsVisibleIds);
          if (missing.length === 0) continue;
          apply(panelId, {
            ...controls,
            statsVisibleIds: planShowMissing(controls.statsVisibleIds, missing),
          });
        }
      },
    };
  }, [
    statsPanelIds,
    dockStatsPanelIds,
    workspaceState,
    dockLayout.controlsByPanelId,
    dockLayout.setPanelControls,
    profileDocument,
    setPanelControlsForPanel,
  ]);

  return loudnessProfileStats;
}
