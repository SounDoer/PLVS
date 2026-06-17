/** @import { TreeNode, ModuleId, WorkspaceState, Preset } from './types.js' */
import { DEFAULT_PANEL_CONTROLS } from "../lib/panelControls.js";

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

/** @type {Preset[]} */
export const BUILTIN_PRESETS = [
  {
    id: "default",
    name: "PLVSSW",
    builtin: true,
    visibleModules: [...ALL_MODULE_IDS],
    tree: DEFAULT_TREE,
  },
  {
    id: "lls",
    name: "LLS",
    builtin: true,
    visibleModules: ["loudness", "loudnessStats", "spectrum"],
    tree: {
      type: "split",
      direction: "v",
      sizes: [null, null],
      children: [
        {
          type: "split",
          direction: "h",
          sizes: [0.8, null],
          children: [
            { type: "leaf", tabs: ["loudness"], activeTab: "loudness" },
            { type: "leaf", tabs: ["loudnessStats"], activeTab: "loudnessStats" },
          ],
        },
        { type: "leaf", tabs: ["spectrum"], activeTab: "spectrum" },
      ],
    },
  },
  {
    id: "pllv",
    name: "PLLV",
    builtin: true,
    visibleModules: ["peak", "loudness", "loudnessStats", "vectorscope"],
    tree: {
      type: "split",
      direction: "h",
      sizes: [0.14, null, 0.18],
      children: [
        {
          type: "split",
          direction: "v",
          sizes: [0.62, null],
          children: [
            { type: "leaf", tabs: ["peak"], activeTab: "peak" },
            { type: "leaf", tabs: ["vectorscope"], activeTab: "vectorscope" },
          ],
        },
        { type: "leaf", tabs: ["loudness"], activeTab: "loudness" },
        { type: "leaf", tabs: ["loudnessStats"], activeTab: "loudnessStats" },
      ],
    },
  },
];

/** @type {WorkspaceState} */
export const DEFAULT_WORKSPACE_STATE = {
  tree: DEFAULT_TREE,
  visibleModules: [...ALL_MODULE_IDS],
  activePresetId: "default",
  fullscreenId: null,
  panelControls: DEFAULT_PANEL_CONTROLS,
  customPresets: [],
};
