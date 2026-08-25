/** 拖动 clamp 用的最小尺寸——保证 tab icon 可见，其余内容允许被裁。 */
const MIN_PANEL_WIDTH = 32;
const MIN_PANEL_HEIGHT = 36;

/**
 * Module identity and layout metrics, free of any React import.
 *
 * `registry.jsx` layers the panel Component and Icon on top of these entries. The split exists so
 * that logic-only consumers — profile validation, the workspace reducer, preset filtering — can ask
 * "is this module id known?" or "what is its title?" without evaluating eight canvas panels and the
 * icon library. Keep this file free of React imports, and keep the key order in sync with
 * `MODULE_REGISTRY`; `constants.test.js` asserts on it.
 *
 * @type {Record<import('./types.js').ModuleId, { id: string, title: string, minWidth: number, minHeight: number }>}
 */
export const MODULE_CATALOG = {
  levelMeter: {
    id: "levelMeter",
    title: "Level Meter",
    minWidth: MIN_PANEL_WIDTH,
    minHeight: MIN_PANEL_HEIGHT,
  },
  loudness: {
    id: "loudness",
    title: "Loudness",
    minWidth: MIN_PANEL_WIDTH,
    minHeight: MIN_PANEL_HEIGHT,
  },
  stats: {
    id: "stats",
    title: "Stats",
    minWidth: MIN_PANEL_WIDTH,
    minHeight: MIN_PANEL_HEIGHT,
  },
  vectorscope: {
    id: "vectorscope",
    title: "Vectorscope",
    minWidth: MIN_PANEL_WIDTH,
    minHeight: MIN_PANEL_HEIGHT,
  },
  spectrum: {
    id: "spectrum",
    title: "Spectrum",
    minWidth: MIN_PANEL_WIDTH,
    minHeight: MIN_PANEL_HEIGHT,
  },
  spectrogram: {
    id: "spectrogram",
    title: "Spectrogram",
    minWidth: MIN_PANEL_WIDTH,
    minHeight: MIN_PANEL_HEIGHT,
  },
  waveform: {
    id: "waveform",
    title: "Waveform",
    minWidth: MIN_PANEL_WIDTH,
    minHeight: MIN_PANEL_HEIGHT,
  },
  "stereo-map": {
    id: "stereo-map",
    title: "Stereo Map",
    minWidth: MIN_PANEL_WIDTH,
    minHeight: MIN_PANEL_HEIGHT,
  },
};
