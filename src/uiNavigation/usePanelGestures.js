import { usePanelInstanceData } from "../workspace/AudioDataContext.jsx";
import { useUiNavigationTarget } from "./UiNavigationContext.jsx";

/**
 * Exposes a panel's chart gestures that have no other command to Agent Control, through the same
 * functions the pointer gestures call. Each entry is null while the gesture is unavailable, exactly
 * as the panel's gesture reference hides it.
 *
 * @param {{
 *   holdSlow?: { start: () => void, stop: () => void } | null,
 *   clearMaxHold?: (() => void) | null,
 *   resetTruePeakMax?: (() => void) | null,
 * }} gestures
 */
export function usePanelGestures(gestures) {
  const { panelId } = usePanelInstanceData() ?? {};
  // Unregistered panels (previews, Dock modules without an id) simply offer nothing.
  useUiNavigationTarget("panelGestures", panelId ?? "", panelId ? gestures : {});
}
