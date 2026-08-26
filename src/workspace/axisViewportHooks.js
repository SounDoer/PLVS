import { useCallback, useMemo } from "react";
import { normalizePanelControls } from "../lib/panelControls.js";
import { AXIS_VIEWPORTS, resolveAxisViewport, writeLocalRange } from "./axisViewports.js";
import { usePanelInstanceData } from "./AudioDataContext.jsx";
import { useWorkspaceStore } from "./WorkspaceContext.jsx";

/**
 * Builds the axis-viewport half of a panel's instance data. Both places that mount a panel — the
 * normal leaf and the fullscreen overlay — call this, so the two cannot drift.
 *
 * The panel receives a range, whether it came from the group, and two setters that already know
 * where to write. It never learns that a shared viewport exists.
 */
export function usePanelAxisViewports(panelId) {
  const { state, setAxisViewport, joinAxisViewport, leaveAxisViewport, setPanelControlsForPanel } =
    useWorkspaceStore();

  const axisViewports = useMemo(() => {
    if (!panelId) return null;
    const resolved = {};
    for (const kindId of Object.keys(AXIS_VIEWPORTS)) {
      const viewport = resolveAxisViewport(state, panelId, kindId);
      if (viewport) resolved[kindId] = viewport;
    }
    return Object.keys(resolved).length > 0 ? resolved : null;
  }, [panelId, state]);

  const setAxisViewportRange = useCallback(
    (kindId, min, max) => {
      if (!panelId) return;
      // While linked the gesture moves the group; while not, it moves this panel's own control.
      // Which one is not the panel's business, which is why it goes through here.
      if (axisViewports?.[kindId]?.linked) {
        setAxisViewport(kindId, { min, max });
        return;
      }
      const moduleId = state.panelsById?.[panelId]?.moduleId;
      setPanelControlsForPanel(
        panelId,
        normalizePanelControls({
          ...state.panelControlsById?.[panelId],
          ...writeLocalRange(kindId, moduleId, { min, max }),
        })
      );
    },
    [axisViewports, panelId, setAxisViewport, setPanelControlsForPanel, state]
  );

  const setAxisViewportLinked = useCallback(
    (kindId, linked) => {
      if (!panelId) return;
      if (linked) joinAxisViewport(kindId, panelId);
      else leaveAxisViewport(kindId, panelId);
    },
    [joinAxisViewport, leaveAxisViewport, panelId]
  );

  return useMemo(
    () => ({ axisViewports, setAxisViewportRange, setAxisViewportLinked }),
    [axisViewports, setAxisViewportLinked, setAxisViewportRange]
  );
}

/**
 * A panel's view of one axis kind: the range to draw, whether it came from the group, and one
 * setter that already knows where to write.
 *
 * `localKeys` names the panel's own control keys, and is the answer when no shared viewport is on
 * offer — a panel rendered outside a workspace leaf, which is how the panel tests mount them. That
 * path is the unlinked one, so it needs no separate behaviour, only a place to read and write.
 *
 * @param {string} kindId
 * @param {{ minKey: string, maxKey: string }} localKeys
 */
export function useAxisViewport(kindId, localKeys) {
  const instance = usePanelInstanceData();
  const viewport = instance?.axisViewports?.[kindId] ?? null;
  const { setAxisViewportRange, onPanelControlsChange, panelControls } = instance ?? {};

  const setRange = useCallback(
    (min, max) => {
      if (viewport) {
        setAxisViewportRange?.(kindId, min, max);
        return;
      }
      onPanelControlsChange?.(
        normalizePanelControls({
          ...panelControls,
          [localKeys.minKey]: min,
          [localKeys.maxKey]: max,
        })
      );
    },
    [kindId, localKeys, onPanelControlsChange, panelControls, setAxisViewportRange, viewport]
  );

  const setLinked = useCallback(
    (linked) => instance?.setAxisViewportLinked?.(kindId, linked),
    [instance, kindId]
  );

  const local = normalizePanelControls(panelControls ?? {});
  const min = viewport ? viewport.min : local[localKeys.minKey];
  const max = viewport ? viewport.max : local[localKeys.maxKey];

  return useMemo(
    () => ({
      min,
      max,
      linked: viewport?.linked ?? false,
      linkable: viewport != null,
      setRange,
      setLinked,
    }),
    [max, min, setLinked, setRange, viewport]
  );
}
