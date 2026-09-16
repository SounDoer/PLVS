/** @import { TreeNode, ModuleId, WorkspaceState } from './types.js' */
import { createPanel } from "./panelInstances.js";
import { normalizePanelControlsById } from "./panelControlInstances.js";
import { normalizeAxisViewportsState } from "./axisViewports.js";
import { DEFAULT_PANEL_CONTROLS } from "../lib/panelControls.js";
import { STATS_CANONICAL_ORDER } from "../lib/statsCatalog.js";

/** @type {ModuleId[]} */
export const ALL_MODULE_IDS = [
  "levelMeter",
  "loudness",
  "stats",
  "vectorscope",
  "spectrum",
  "spectrogram",
  "waveform",
];

/// The first-run panels: the seven original modules plus Stereo Map. Stereo Map stays out of
/// ALL_MODULE_IDS; it only joins the default layout.
/** @type {ModuleId[]} */
const DEFAULT_MODULE_IDS = [...ALL_MODULE_IDS, "stereo-map"];

// ---------------------------------------------------------------------------
// Default tree, hand-tuned at 1280x800 logical
// (docs/history/specs/2026-09-14-first-run-defaults-design.md):
//   H[ leaf(levelMeter)
//    | V[ H[ leaf(loudness) | leaf(waveform) ] | leaf(spectrogram) | leaf(spectrum) | leaf(stereo-map) ]
//    | V[ leaf(stats) | leaf(vectorscope) ] ]
// ---------------------------------------------------------------------------

/** @type {TreeNode} */
export const DEFAULT_TREE = {
  type: "split",
  direction: "h",
  sizes: [0.132, null, 0.18],
  children: [
    { type: "leaf", tabs: ["levelMeter"], activeTab: "levelMeter" },
    {
      type: "split",
      direction: "v",
      sizes: [null, null, null, null],
      children: [
        {
          type: "split",
          direction: "h",
          sizes: [null, null],
          children: [
            { type: "leaf", tabs: ["loudness"], activeTab: "loudness" },
            { type: "leaf", tabs: ["waveform"], activeTab: "waveform" },
          ],
        },
        { type: "leaf", tabs: ["spectrogram"], activeTab: "spectrogram" },
        { type: "leaf", tabs: ["spectrum"], activeTab: "spectrum" },
        { type: "leaf", tabs: ["stereo-map"], activeTab: "stereo-map" },
      ],
    },
    {
      type: "split",
      direction: "v",
      sizes: [0.623, null],
      children: [
        { type: "leaf", tabs: ["stats"], activeTab: "stats" },
        { type: "leaf", tabs: ["vectorscope"], activeTab: "vectorscope" },
      ],
    },
  ],
};

/** @type {WorkspaceState} */
export const DEFAULT_PANELS_BY_ID = Object.fromEntries(
  DEFAULT_MODULE_IDS.map((moduleId) => {
    const panel = createPanel(moduleId, {}, { id: moduleId });
    return [panel.id, panel];
  })
);

export const DEFAULT_PANEL_ORDER = [...DEFAULT_MODULE_IDS];

/// Controls the first-run panels carry on top of the panel defaults. Only these instances get them:
/// DEFAULT_PANEL_CONTROLS is unchanged, so a panel the user adds later starts from the defaults.
const FIRST_RUN_PANEL_CONTROLS = {
  levelMeter: { levelMeterTpMaxMarker: true },
  stats: { statsVisibleIds: [...STATS_CANONICAL_ORDER] },
  spectrum: { spectrumView: "lr", spectrumMaxMode: "decay" },
  waveform: { waveformFrequencyColor: true, waveformCentroid: true },
};

export const DEFAULT_PANEL_CONTROLS_BY_ID = normalizePanelControlsById(
  DEFAULT_PANELS_BY_ID,
  Object.fromEntries(
    DEFAULT_MODULE_IDS.map((id) => [
      id,
      { ...DEFAULT_PANEL_CONTROLS, ...FIRST_RUN_PANEL_CONTROLS[id] },
    ])
  )
);

export const DEFAULT_WORKSPACE_STATE = {
  tree: DEFAULT_TREE,
  panelsById: DEFAULT_PANELS_BY_ID,
  panelOrder: DEFAULT_PANEL_ORDER,
  fullscreenId: null,
  panelControlsById: DEFAULT_PANEL_CONTROLS_BY_ID,
  pinnedPanelsById: {},
  axisViewports: normalizeAxisViewportsState(),
};
