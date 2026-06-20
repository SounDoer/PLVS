/** @import { TreeNode, ModuleId, WorkspaceState } from './types.js' */
import { DEFAULT_PANEL_CONTROLS } from "../lib/panelControls.js";
import { createPanel } from "./panelInstances.js";

/** @type {ModuleId[]} */
export const ALL_MODULE_IDS = [
  "peak",
  "loudness",
  "loudnessStats",
  "vectorscope",
  "spectrum",
  "spectrogram",
  "waveform",
];

// ---------------------------------------------------------------------------
// Default tree — PLVSSW:
//   H[ leaf(peak) | V[ leaf(loudness) | leaf(waveform) | leaf(spectrogram) | leaf(spectrum) ] | V[ leaf(loudnessStats) | leaf(vectorscope) ] ]
// Ratios: peak=14% of container width, right column=18%, middle fills remainder.
// ---------------------------------------------------------------------------

/** @type {TreeNode} */
export const DEFAULT_TREE = {
  type: "split",
  direction: "h",
  sizes: [0.14, null, 0.18],
  children: [
    { type: "leaf", tabs: ["peak"], activeTab: "peak" },
    {
      type: "split",
      direction: "v",
      sizes: [null, null, null, null],
      children: [
        { type: "leaf", tabs: ["loudness"], activeTab: "loudness" },
        { type: "leaf", tabs: ["waveform"], activeTab: "waveform" },
        { type: "leaf", tabs: ["spectrogram"], activeTab: "spectrogram" },
        { type: "leaf", tabs: ["spectrum"], activeTab: "spectrum" },
      ],
    },
    {
      type: "split",
      direction: "v",
      sizes: [0.54, null],
      children: [
        { type: "leaf", tabs: ["loudnessStats"], activeTab: "loudnessStats" },
        { type: "leaf", tabs: ["vectorscope"], activeTab: "vectorscope" },
      ],
    },
  ],
};

/** @type {WorkspaceState} */
export const DEFAULT_PANELS_BY_ID = Object.fromEntries(
  ALL_MODULE_IDS.map((moduleId) => {
    const panel = createPanel(moduleId, {}, { id: moduleId });
    return [panel.id, panel];
  })
);

export const DEFAULT_PANEL_ORDER = [...ALL_MODULE_IDS];

export const DEFAULT_WORKSPACE_STATE = {
  tree: DEFAULT_TREE,
  panelsById: DEFAULT_PANELS_BY_ID,
  panelOrder: DEFAULT_PANEL_ORDER,
  fullscreenId: null,
  panelControls: DEFAULT_PANEL_CONTROLS,
};
