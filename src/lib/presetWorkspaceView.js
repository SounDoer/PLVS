import { normalizePanelControlsById } from "../workspace/panelControlInstances.js";
import { normalizePinnedPanelsById } from "../workspace/reducer.js";
import { normalizeAxisViewportsState } from "../workspace/axisViewports.js";

const clone = (value) => JSON.parse(JSON.stringify(value));

/// The Workspace a Preset becomes when it is applied.
///
/// Applying migrates the stored controls: `normalizePanelControlsById` fills in controls added
/// since the Preset was saved and drops ones that no longer exist. So the resulting Workspace is
/// deliberately not equal to the stored record, and anything comparing the two - such as waiting
/// for an apply to land - has to compare against this view instead of against the Preset itself.
///
/// This must stay a fixed point of the reducer's `SET_VIEW`: whatever normalization that branch
/// applies has to be applied here too, or the state it stores differs from the view and a
/// settlement waiting on equality never fires. `presetWorkspaceView.test.js` pins that.
export function presetWorkspaceView(preset) {
  return {
    tree: clone(preset.tree),
    panelsById: clone(preset.panelsById),
    panelOrder: [...preset.panelOrder],
    panelControlsById: normalizePanelControlsById(preset.panelsById, preset.panelControlsById),
    pinnedPanelsById: normalizePinnedPanelsById(preset.panelsById, preset.pinnedPanelsById),
    axisViewports: normalizeAxisViewportsState(preset.axisViewports),
    // SET_VIEW always clears it, and the persistence wait compares it.
    fullscreenId: null,
  };
}
