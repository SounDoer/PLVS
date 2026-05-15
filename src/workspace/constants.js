/** @import { TreeNode, ModuleId, WorkspaceState, Preset } from './types.js' */

export const WORKSPACE_STORAGE_KEY = 'audiometer:workspace:v2';

/** @type {ModuleId[]} */
export const ALL_MODULE_IDS = ['peak', 'loudness', 'loudnessStats', 'vectorscope', 'spectrum', 'spectrogram'];

// ---------------------------------------------------------------------------
// Default tree — replicates the former "Default" preset layout:
//   H[ leaf(peak, vectorscope) | V[ leaf(loudness) | leaf(spectrum, spectrogram) ] | leaf(loudnessStats) ]
// ---------------------------------------------------------------------------

/** @type {TreeNode} */
export const DEFAULT_TREE = {
  type: 'split',
  direction: 'h',
  sizes: [220, 0, 260],
  children: [
    { type: 'leaf', tabs: ['peak', 'vectorscope'], activeTab: 'peak' },
    {
      type: 'split',
      direction: 'v',
      sizes: [0, 0],
      children: [
        { type: 'leaf', tabs: ['loudness'], activeTab: 'loudness' },
        { type: 'leaf', tabs: ['spectrum', 'spectrogram'], activeTab: 'spectrum' },
      ],
    },
    { type: 'leaf', tabs: ['loudnessStats'], activeTab: 'loudnessStats' },
  ],
};

/** @type {Preset[]} */
export const BUILTIN_PRESETS = [
  {
    id: 'default',
    name: 'Default',
    builtin: true,
    visibleModules: [...ALL_MODULE_IDS],
    tree: DEFAULT_TREE,
  },
  {
    id: 'broadcast',
    name: 'Broadcast',
    builtin: true,
    visibleModules: ['peak', 'loudness', 'loudnessStats'],
    tree: {
      type: 'split',
      direction: 'h',
      sizes: [200, 0, 260],
      children: [
        { type: 'leaf', tabs: ['peak'], activeTab: 'peak' },
        { type: 'leaf', tabs: ['loudness'], activeTab: 'loudness' },
        { type: 'leaf', tabs: ['loudnessStats'], activeTab: 'loudnessStats' },
      ],
    },
  },
  {
    id: 'compact',
    name: 'Compact (Tabs)',
    builtin: true,
    visibleModules: [...ALL_MODULE_IDS],
    tree: {
      type: 'split',
      direction: 'h',
      sizes: [200, 0],
      children: [
        { type: 'leaf', tabs: ['peak', 'vectorscope'], activeTab: 'peak' },
        {
          type: 'split',
          direction: 'v',
          sizes: [0, 0],
          children: [
            { type: 'leaf', tabs: ['loudness', 'loudnessStats'], activeTab: 'loudness' },
            { type: 'leaf', tabs: ['spectrum', 'spectrogram'], activeTab: 'spectrum' },
          ],
        },
      ],
    },
  },
  {
    id: 'spectrum-focus',
    name: 'Spectrum Focus',
    builtin: true,
    visibleModules: ['loudness', 'loudnessStats', 'spectrum', 'spectrogram'],
    tree: {
      type: 'split',
      direction: 'h',
      sizes: [0, 260],
      children: [
        {
          type: 'split',
          direction: 'v',
          sizes: [0, 0],
          children: [
            { type: 'leaf', tabs: ['loudness'], activeTab: 'loudness' },
            { type: 'leaf', tabs: ['spectrum'], activeTab: 'spectrum' },
          ],
        },
        {
          type: 'split',
          direction: 'v',
          sizes: [0, 0],
          children: [
            { type: 'leaf', tabs: ['loudnessStats'], activeTab: 'loudnessStats' },
            { type: 'leaf', tabs: ['spectrogram'], activeTab: 'spectrogram' },
          ],
        },
      ],
    },
  },
];

/** @type {WorkspaceState} */
export const DEFAULT_WORKSPACE_STATE = {
  tree: DEFAULT_TREE,
  visibleModules: [...ALL_MODULE_IDS],
  focusId: null,
  activePresetId: 'default',
  fullscreenId: null,
  customPresets: [],
};
