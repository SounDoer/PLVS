import { SpectrumPanel } from "../../components/panels/SpectrumPanel.jsx";
import { normalizeDockModuleControls } from "../dockModuleControls.js";
import { PanelInstanceProvider } from "../../workspace/AudioDataContext.jsx";

/**
 * The shared chart keeps its interactions and snapshot state at every Dock height.
 * @param {{ controls?: any, heightMode?: string }} props
 */
export function DockSpectrum({ controls }) {
  const panelControls = normalizeDockModuleControls("spectrum", controls);
  return (
    <div className="flex h-full min-h-0 min-w-0" data-testid="dock-spectrum">
      <PanelInstanceProvider
        value={{
          panelControls,
          onPanelControlsChange: (next) =>
            controls?.onDockPanelControlsChange?.(controls.panelId, next),
        }}
      >
        <SpectrumPanel
          showAxes={false}
          className="px-[var(--ui-dock-pad-x)] py-[var(--ui-dock-pad-y)] [--ui-chart-inset-top:0px] [--ui-chart-inset-bottom:0px]"
        />
      </PanelInstanceProvider>
    </div>
  );
}
