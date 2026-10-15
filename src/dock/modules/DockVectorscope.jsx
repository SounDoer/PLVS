import { usePanelChromeData } from "../../workspace/AudioDataContext.jsx";
import { VectorscopePanel } from "../../components/panels/VectorscopePanel.jsx";
import { PanelInstanceProvider } from "../../workspace/AudioDataContext.jsx";
import { normalizeDockModuleControls } from "../dockModuleControls.js";

/** @param {{ controls?: import("../dockModuleControls.js").DockModuleProps<"correlation">, heightMode?: string }} props */
export function DockVectorscope({ controls = {} }) {
  const panelControls = normalizeDockModuleControls("correlation", controls);
  return (
    <div className="flex h-full min-h-0 min-w-0" data-testid="dock-vectorscope">
      <PanelInstanceProvider value={{ panelControls }}>
        <VectorscopePanel
          showAxes={usePanelChromeData()?.hideAxesAndLabels !== true}
          compact
          className="px-[var(--ui-dock-pad-x)] py-[var(--ui-dock-pad-y)] [--ui-chart-axis-gap:var(--ui-dock-gap-row)] [--ui-chart-x-axis-row-h:var(--ui-fs-axis)] [--ui-vector-outer-inset:0px]"
        />
      </PanelInstanceProvider>
    </div>
  );
}
