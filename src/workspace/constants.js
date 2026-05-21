/** @import { TreeNode, ModuleId, WorkspaceState, Preset } from './types.js' */

export const WORKSPACE_STORAGE_KEY = "plvs:workspace:v3";

/** @type {ModuleId[]} */
export const ALL_MODULE_IDS = [
  "peak",
  "loudness",
  "loudnessStats",
  "vectorscope",
  "spectrum",
  "spectrogram",
];

// ---------------------------------------------------------------------------
// Default tree — PLVS Full:
//   H[ leaf(peak) | V[ leaf(loudness) | leaf(spectrogram) | leaf(spectrum) ] | V[ leaf(loudnessStats) | leaf(vectorscope) ] ]
// Ratios: peak=20% of container width, right column=33%, middle fills remainder.
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
      sizes: [null, null, null],
      children: [
        { type: "leaf", tabs: ["loudness"], activeTab: "loudness" },
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
    name: "PLVS Full",
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
  focusId: null,
  activePresetId: "default",
  fullscreenId: null,
  customPresets: [],
};
