import { useEffect, useMemo, useState } from "react";
import { availableMonitors, currentMonitor, primaryMonitor } from "@tauri-apps/api/window";
import { useDock } from "../dock/DockContext.jsx";
import { useWindowChrome } from "../hooks/WindowChromeContext.jsx";
import { usePresetLibrary } from "../hooks/PresetsContext.jsx";
import { useLoudnessProfile } from "../hooks/LoudnessProfileContext.jsx";
import { useAppSettings } from "../settings/SettingsContext.jsx";
import { isTauri } from "../ipc/env.js";
import { supportsDockMode } from "../lib/platform.js";
import { readAgentControlRuntime } from "./appSnapshot.js";
import { useAgentControlBridge } from "./useAgentControlBridge.js";

/**
 * Agent Control as a component, so it can sit inside the domain providers and read them itself.
 * Each domain that gains an owner moves its wiring from `App.jsx` into this file; the areas still
 * listed in the props are the ones `AppContent` owns for now.
 *
 * @param {Omit<Parameters<typeof useAgentControlBridge>[0], | "dock"
 *   | "executeDock"
 *   | "dockContext"
 *   | "viewContext"
 *   | "presets"
 *   | "loudnessProfile"
 *   | "hasLoudnessReference"
 *   | "customThemes"
 *   | "theme"> & {
 *   dockContext: Omit<
 *     import("./useAgentControlBridge.js").AgentControlDockContext,
 *     "transitioning" | "monitors" | "fallbackMonitor" | "monitorRects" | "monitorInventoryReady"
 *   >,
 * }} props
 */
export function AgentControlBridge(props) {
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
      platform: props.runtime.platform,
      docked,
      applyView: applyViewState,
    }),
    [
      props.runtime.platform,
      applyViewState,
      docked,
      focusView,
      glassEnabled,
      surfaceOpacity,
      pinned,
    ]
  );

  const presets = usePresetLibrary();
  const loudnessProfile = useLoudnessProfile();
  const settings = useAppSettings();

  useAgentControlBridge({
    ...props,
    presets,
    loudnessProfile,
    hasLoudnessReference: Number.isFinite(loudnessProfile.referenceLufs),
    customThemes: settings.customThemes,
    theme: { control: settings.themeControl, state: settings.themeControl.readState() },
    viewContext: agentControlViewContext,
    dock: agentControlDock,
    dockContext: {
      ...props.dockContext,
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
