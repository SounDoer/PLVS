import { STATS_CANONICAL_ORDER } from "../lib/statsCatalog.js";
import { validatePortablePreset } from "../transfer/portablePreset.js";

const VISIBLE_STATS = [
  "momentary",
  "shortTerm",
  "integrated",
  "momentaryMax",
  "shortTermMax",
  "lra",
  "psr",
  "plr",
  "truePeak",
  "correlation",
  "sideToMid",
];

/**
 * Canonical portable document shared by the review renderer and the eventual Sharesets artifact.
 * Keep this source-independent: a Preset arranges monitoring tools but never invents channels.
 */
export const MULTICHANNEL_MONITORING_PRESET = validatePortablePreset({
  kind: "plvs-preset",
  formatVersion: 1,
  semanticsVersion: 1,
  name: "Multichannel Monitoring",
  workspace: {
    layout: {
      type: "split",
      direction: "horizontal",
      weights: [0.38, 0.62],
      children: [
        { type: "panel", key: "level-meter" },
        {
          type: "split",
          direction: "vertical",
          weights: [0.31, 0.31, 0.38],
          children: [
            { type: "panel", key: "waveform" },
            { type: "panel", key: "spectrum" },
            {
              type: "split",
              direction: "horizontal",
              weights: [0.5, 0.5],
              children: [
                { type: "panel", key: "vectorscope" },
                { type: "panel", key: "stats" },
              ],
            },
          ],
        },
      ],
    },
    panels: [
      {
        key: "level-meter",
        moduleId: "levelMeter",
        controls: {
          mode: "peak",
          playbackMax: false,
          floatingValue: false,
          tpMaxMarker: true,
          barColors: "levelZones",
          peakThresholdsDbfs: { warning: -6, critical: -1 },
          levelRangeDbfs: { min: -60, max: 0 },
        },
        axes: {},
      },
      {
        key: "waveform",
        moduleId: "waveform",
        controls: { frequencyColor: true, centroid: false },
        axes: { time: { linked: true, windowSec: 60 } },
      },
      {
        key: "stats",
        moduleId: "stats",
        controls: {
          metrics: { visible: VISIBLE_STATS, order: [...STATS_CANONICAL_ORDER] },
        },
        axes: {},
      },
      {
        key: "spectrum",
        moduleId: "spectrum",
        controls: {
          channel: { type: "pair", x: 0, y: 1 },
          view: "combined",
          maxMode: "decay",
          peakLabels: true,
          grid: false,
          speedPercent: 25,
          tiltDbPerOctave: 4.5,
          octaveSmoothing: "off",
          levelRangeDb: { min: -90, max: 0 },
        },
        axes: { frequency: { linked: true, minHz: 20, maxHz: 20_000 } },
      },
      {
        key: "vectorscope",
        moduleId: "vectorscope",
        controls: {
          channelPair: { x: 0, y: 1 },
          mode: "lissajous",
          maxHold: false,
        },
        axes: {},
      },
    ],
  },
  presentation: {
    alwaysOnTop: false,
    focusView: { autoHideControls: false, compactPanels: false, borderless: false },
    panelOpacityPercent: 100,
    glassEnabled: false,
  },
  dock: { enabled: false },
  loudnessProfile: { dependencyId: null },
});
