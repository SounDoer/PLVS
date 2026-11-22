import { usePanelInstanceData } from "../workspace/AudioDataContext.jsx";
import { useUiNavigationTarget } from "./UiNavigationContext.jsx";

/**
 * Exposes the numbers behind what a panel last drew to Agent Control's read-only measurement
 * queries. `read` is replaced on every render, so a query reads the render the user is looking at
 * rather than starting an analysis of its own.
 *
 * @param {{ moduleId: string, read: () => any } | null} readout
 */
export function usePanelReadout(readout) {
  const { panelId } = usePanelInstanceData() ?? {};
  // Unregistered panels (previews, Dock modules without an id) simply offer nothing.
  useUiNavigationTarget("panelReadout", panelId ?? "", panelId && readout ? readout : {});
}
