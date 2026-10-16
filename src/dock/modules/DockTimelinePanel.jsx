import { usePanelChromeData } from "../../workspace/AudioDataContext.jsx";
import { dockFrequencyViewport } from "../dockFrequencyViewport.js";
import { useMemo } from "react";
import { useHistoryData, PanelInstanceProvider } from "../../workspace/AudioDataContext.jsx";
import { usePanelHistoryData } from "../../hooks/usePanelHistoryData.js";
import { normalizeDockModuleControls, dockSettingsTab } from "../dockModuleControls.js";

export function DockTimelinePanel({ moduleId, controls, component: Component }) {
  const globalHistory = useHistoryData();
  // The strip hands every module a freshly merged `controls` object each render; key the
  // normalized controls on the stored instance so the viewport and handlers below stay stable.
  const panelId = controls?.panelId;
  const storedControls = controls?.controlsByPanelId?.[panelId] ?? controls;
  const panelControls = useMemo(
    () => normalizeDockModuleControls(moduleId, storedControls),
    [moduleId, storedControls]
  );
  const onDockPanelControlsChange = controls?.onDockPanelControlsChange;
  const linked = panelControls.linkTimeViewport;
  const {
    historyWindowSec: globalWindowSec,
    historyOffsetSec: globalOffsetSec,
    setHistoryWindowSec: setGlobalWindowSec,
    setHistoryOffsetSec: setGlobalOffsetSec,
  } = globalHistory ?? {};
  const axisViewportData = useMemo(
    () => ({
      axisViewports: {
        time: {
          linked,
          windowSec: linked ? globalWindowSec : panelControls.historyWindowSec,
          offsetSec: linked ? globalOffsetSec : panelControls.historyOffsetSec,
        },
      },
      setAxisViewportValue: (_kind, next) => {
        if (linked) {
          setGlobalWindowSec?.(next.windowSec);
          setGlobalOffsetSec?.(next.offsetSec);
        } else
          onDockPanelControlsChange?.(panelId, {
            ...panelControls,
            historyWindowSec: next.windowSec,
            historyOffsetSec: next.offsetSec,
          });
      },
    }),
    [
      linked,
      globalWindowSec,
      globalOffsetSec,
      setGlobalWindowSec,
      setGlobalOffsetSec,
      panelControls,
      onDockPanelControlsChange,
      panelId,
    ]
  );
  const historyData = usePanelHistoryData(
    dockSettingsTab(moduleId),
    axisViewportData,
    panelControls
  );
  return (
    <div className="flex h-full min-h-0 min-w-0" data-testid={`dock-${moduleId}`}>
      <PanelInstanceProvider
        value={{
          ...dockFrequencyViewport(
            dockSettingsTab(moduleId),
            panelControls,
            controls?.sharedFrequencyViewport,
            controls?.onSharedFrequencyChange,
            (next) => onDockPanelControlsChange?.(panelId, next)
          ),
          panelControls,
          historyData,
          onPanelControlsChange: (next) => onDockPanelControlsChange?.(panelId, next),
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
