import { usePanelChromeData } from "../../workspace/AudioDataContext.jsx";
import { dockFrequencyViewport } from "../dockFrequencyViewport.js";
import { useMemo } from "react";
import { useHistoryData, PanelInstanceProvider } from "../../workspace/AudioDataContext.jsx";
import { usePanelHistoryData } from "../../hooks/usePanelHistoryData.js";
import { normalizeDockModuleControls, dockSettingsTab } from "../dockModuleControls.js";

export function DockTimelinePanel({ moduleId, controls, component: Component }) {
  const globalHistory = useHistoryData();
  const panelControls = normalizeDockModuleControls(moduleId, controls);
  const linked = panelControls.linkTimeViewport;
  const axisViewportData = useMemo(
    () => ({
      axisViewports: {
        time: {
          linked,
          windowSec: linked ? globalHistory.historyWindowSec : panelControls.historyWindowSec,
          offsetSec: linked ? globalHistory.historyOffsetSec : panelControls.historyOffsetSec,
        },
      },
      setAxisViewportValue: (_kind, next) => {
        if (linked) {
          globalHistory.setHistoryWindowSec?.(next.windowSec);
          globalHistory.setHistoryOffsetSec?.(next.offsetSec);
        } else
          controls?.onDockPanelControlsChange?.(controls.panelId, {
            ...panelControls,
            historyWindowSec: next.windowSec,
            historyOffsetSec: next.offsetSec,
          });
      },
    }),
    [linked, globalHistory, panelControls, controls]
  );
  const historyData = usePanelHistoryData(dockSettingsTab(moduleId), axisViewportData);
  return (
    <div className="flex h-full min-h-0 min-w-0" data-testid={`dock-${moduleId}`}>
      <PanelInstanceProvider
        value={{
          ...dockFrequencyViewport(
            dockSettingsTab(moduleId),
            panelControls,
            controls?.sharedFrequencyViewport,
            controls?.onSharedFrequencyChange,
            (next) => controls?.onDockPanelControlsChange?.(controls.panelId, next)
          ),
          panelControls,
          historyData,
          onPanelControlsChange: (next) =>
            controls?.onDockPanelControlsChange?.(controls.panelId, next),
        }}
      >
        <Component
          showAxes={usePanelChromeData()?.hideAxesAndLabels !== true}
          className="px-[var(--ui-dock-pad-x)] py-[var(--ui-dock-pad-y)] [--ui-chart-inset-top:0px] [--ui-chart-inset-bottom:0px]"
        />
      </PanelInstanceProvider>
    </div>
  );
}
