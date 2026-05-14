/** @import { DockState, ModuleId, WorkspaceState, Preset } from './types.js' */

export const WORKSPACE_STORAGE_KEY = 'audiometer:workspace:v1';

/** Default size (px) restored when a region transitions from empty → visible. */
export const DEFAULT_REGION_SIZES = { left: 220, right: 260, bottom: 200 };

/** @type {DockState} */
export const DEFAULT_DOCK_STATE = {
  regions: {
    left: {
      size: 220,
      slots: [
        { tabs: ['peak'], activeTab: 'peak', collapsed: false },
        { tabs: ['vectorscope'], activeTab: 'vectorscope', collapsed: false },
      ],
    },
    center: {
      slots: [
        { tabs: ['loudness'], activeTab: 'loudness', collapsed: false },
        { tabs: ['spectrum', 'spectrogram'], activeTab: 'spectrum', collapsed: false },
      ],
    },
    right: {
      size: 260,
      slots: [{ tabs: ['loudnessStats'], activeTab: 'loudnessStats', collapsed: false }],
    },
    bottom: { size: 0, slots: [] },
  },
};

/** @type {ModuleId[]} */
export const ALL_MODULE_IDS = ['peak', 'loudness', 'loudnessStats', 'vectorscope', 'spectrum', 'spectrogram'];

/** @type {Preset[]} */
export const BUILTIN_PRESETS = [
  {
    id: 'default',
    name: 'Default',
    builtin: true,
    dock: DEFAULT_DOCK_STATE,
    visibleModules: [...ALL_MODULE_IDS],
  },
  {
    id: 'broadcast',
    name: 'Broadcast',
    builtin: true,
    visibleModules: ['peak', 'loudness', 'loudnessStats'],
    dock: {
      regions: {
        left: {
          size: 200,
          slots: [{ tabs: ['peak'], activeTab: 'peak', collapsed: false }],
        },
        center: {
          slots: [{ tabs: ['loudness'], activeTab: 'loudness', collapsed: false }],
        },
        right: {
          size: 260,
          slots: [{ tabs: ['loudnessStats'], activeTab: 'loudnessStats', collapsed: false }],
        },
        bottom: { size: 0, slots: [] },
      },
    },
  },
  {
    id: 'compact',
    name: 'Compact (Tabs)',
    builtin: true,
    visibleModules: [...ALL_MODULE_IDS],
    dock: {
      regions: {
        left: {
          size: 200,
          slots: [
            {
              tabs: ['peak', 'vectorscope'],
              activeTab: 'peak',
              collapsed: false,
            },
          ],
        },
        center: {
          slots: [
            {
              tabs: ['loudness', 'loudnessStats'],
              activeTab: 'loudness',
              collapsed: false,
            },
            {
              tabs: ['spectrum', 'spectrogram'],
              activeTab: 'spectrum',
              collapsed: false,
            },
          ],
        },
        right: { size: 0, slots: [] },
        bottom: { size: 0, slots: [] },
      },
    },
  },
  {
    id: 'spectrum-focus',
    name: 'Spectrum Focus',
    builtin: true,
    visibleModules: ['loudness', 'loudnessStats', 'spectrum', 'spectrogram'],
    dock: {
      regions: {
        left: { size: 0, slots: [] },
        center: {
          slots: [
            { tabs: ['loudness'], activeTab: 'loudness', collapsed: false },
            { tabs: ['spectrum'], activeTab: 'spectrum', collapsed: false },
          ],
        },
        right: {
          size: 260,
          slots: [
            { tabs: ['loudnessStats'], activeTab: 'loudnessStats', collapsed: false },
            { tabs: ['spectrogram'], activeTab: 'spectrogram', collapsed: false },
          ],
        },
        bottom: { size: 0, slots: [] },
      },
    },
  },
];

/** @type {WorkspaceState} */
export const DEFAULT_WORKSPACE_STATE = {
  dock: DEFAULT_DOCK_STATE,
  visibleModules: [...ALL_MODULE_IDS],
  focusId: null,
  activePresetId: 'default',
  fullscreenId: null,
  customPresets: [],
};
