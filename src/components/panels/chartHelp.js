import { normalizePanelControls } from "../../lib/panelControls.js";
import { STEREO_MAP_MODES } from "../../math/stereoMapMath.js";
import {
  spectrumGestureAvailability,
  vectorscopeGestureAvailability,
} from "./panelGestureAvailability.js";

/**
 * @typedef {{ id: string, gesture: "hover" | "left-click" | "left-drag" | "left-hold" |
 *   "left-double-click" | "right-drag" | "right-double-click" | "wheel" | "trackpad-swipe",
 *   modifiers: string[], target: string, effect: string }} PanelHelpItem
 * @typedef {{ title: string, items: PanelHelpItem[] }} PanelHelpGroup
 */

/** @returns {PanelHelpItem} */
function item(id, gesture, effect, target = "", modifiers = []) {
  return { id, gesture, modifiers, target, effect };
}
const group = (title, items) => ({ title, items });
const inspect = group("Inspect", [item("inspect", "hover", "Inspect Value")]);
const snapshot = group("Snapshot", [
  item("select", "left-click", "Select Snapshot"),
  item("scrub", "left-drag", "Scrub Timeline"),
  item("live", "left-double-click", "Return to Live"),
]);
const capture = [
  item("capture", "left-click", "Capture Snapshot"),
  item("live", "left-double-click", "Return to Live"),
];
const panTimeline = [
  item("pan-timeline", "right-drag", "Pan Timeline"),
  item("reset-timeline", "right-double-click", "Reset Timeline"),
];
const timeAxes = [
  item("zoom-time-axis", "wheel", "Zoom Time", "Time Axis"),
  item("pan-time-axis", "left-drag", "Pan Time", "Time Axis"),
];
const frequencyAxes = [
  item("zoom-frequency-axis", "wheel", "Zoom Frequency", "Frequency Axis"),
  item("pan-frequency-axis", "left-drag", "Pan Frequency", "Frequency Axis"),
];
const levelAxes = [
  item("zoom-level-axis", "wheel", "Zoom Level", "Level Axis"),
  item("pan-level-axis", "left-drag", "Pan Level", "Level Axis"),
];
const resetAxes = item("reset-axis", "left-double-click", "Reset Axis", "Axis");
const panViewport = item("pan-viewport", "left-drag", "Pan Viewport", "", ["Ctrl"]);
const zoomTime = item("zoom-time", "wheel", "Zoom Time");
const zoomFrequency = item("zoom-frequency", "wheel", "Zoom Frequency");
const swipeFrequency = item("swipe-frequency", "trackpad-swipe", "Pan Frequency");
const ctrlZoomFrequency = item("zoom-frequency", "wheel", "Zoom Frequency", "", ["Ctrl"]);

export const LOUDNESS_HELP = [
  inspect,
  snapshot,
  group("Viewport", [
    zoomTime,
    item("zoom-loudness", "wheel", "Zoom Loudness", "", ["Ctrl"]),
    panViewport,
    ...panTimeline,
  ]),
  group("Axes", [
    ...timeAxes,
    item("zoom-loudness-axis", "wheel", "Zoom Loudness", "Loudness Axis"),
    item("pan-loudness-axis", "left-drag", "Pan Loudness", "Loudness Axis"),
    resetAxes,
  ]),
];

function resolveSpectrumHelp(controls, { isSnapshot = false } = {}) {
  const available = spectrumGestureAvailability(controls, isSnapshot);
  return [
    group("Inspect", [
      ...inspect.items,
      ...(available.holdSlow ? [item("hold-slow", "left-hold", "Slow Trace")] : []),
      ...capture,
      ...(available.clearMaxHold
        ? [item("clear-max-hold", "left-click", "Clear Max Hold", "Held Line")]
        : []),
    ]),
    group("Viewport", [
      zoomFrequency,
      item("zoom-db", "wheel", "Zoom dB", "", ["Ctrl"]),
      swipeFrequency,
      panViewport,
    ]),
    group("Axes", [
      ...frequencyAxes,
      item("zoom-level-axis", "wheel", "Zoom dB", "Level Axis"),
      item("pan-level-axis", "left-drag", "Pan dB", "Level Axis"),
      resetAxes,
    ]),
  ];
}

export const SPECTROGRAM_2D_HELP = [
  inspect,
  snapshot,
  group("Viewport", [zoomTime, ctrlZoomFrequency, panViewport, ...panTimeline]),
  group("Axes", [...timeAxes, ...frequencyAxes, resetAxes]),
];
export const SPECTROGRAM_3D_HELP = [
  snapshot,
  group("Viewport", [
    zoomTime,
    ctrlZoomFrequency,
    panViewport,
    item("height", "wheel", "Adjust Height Scale", "", ["Shift"]),
  ]),
  group("Viewpoint", [
    item("rotate", "right-drag", "Rotate"),
    item("reset-viewpoint", "right-double-click", "Reset Viewpoint"),
  ]),
  group("Axes", [...timeAxes, ...frequencyAxes, resetAxes]),
];

export const WAVEFORM_HELP = [
  inspect,
  snapshot,
  group("Viewport", [
    zoomTime,
    item("pan-timeline-ctrl", "left-drag", "Pan Timeline", "", ["Ctrl"]),
    ...panTimeline,
  ]),
  group("Axes", [
    ...timeAxes,
    item("reset-time-axis", "left-double-click", "Reset Time", "Time Axis"),
  ]),
];

function resolveLevelMeterHelp(controls) {
  return [
    group("Axes", [...levelAxes, resetAxes]),
    ...(controls.levelMeterMode === "peak" && controls.levelMeterTpMaxMarker
      ? [group("Markers", [item("reset-tp-max", "left-click", "Reset TP Max", "Marker")])]
      : []),
  ];
}

function resolveVectorscopeHelp(controls, { isSnapshot = false } = {}) {
  const available = vectorscopeGestureAvailability(controls, isSnapshot);
  if (available.holdSlow) {
    return [group("Persistence", [item("hold-slow", "left-hold", "Slow Trace Decay")])];
  }
  if (available.resetMaxHold) {
    return [group("Max Hold", [item("reset-max-hold", "left-click", "Reset Max Hold", "Plot")])];
  }
  return [];
}

function resolveStereoMapHelp(controls) {
  const hasLevelAxis =
    controls.stereoMapMode === STEREO_MAP_MODES.MONO_LOSS_DB ||
    controls.stereoMapMode === STEREO_MAP_MODES.MS_RATIO_DB;
  return [
    group("Inspect", [...inspect.items, ...capture]),
    group("Viewport", [
      zoomFrequency,
      swipeFrequency,
      item("pan-frequency", "left-drag", "Pan Frequency", "", ["Ctrl"]),
    ]),
    group("Axes", [...frequencyAxes, ...(hasLevelAxis ? levelAxes : []), resetAxes]),
  ];
}

export const PANEL_HELP_BY_MODULE_ID = {
  levelMeter: resolveLevelMeterHelp,
  loudness: () => LOUDNESS_HELP,
  waveform: () => WAVEFORM_HELP,
  spectrum: resolveSpectrumHelp,
  spectrogram: (controls) =>
    controls.spectrogramMode === "lines" || controls.spectrogramMode === "surface"
      ? SPECTROGRAM_3D_HELP
      : SPECTROGRAM_2D_HELP,
  vectorscope: resolveVectorscopeHelp,
  "stereo-map": resolveStereoMapHelp,
};

/**
 * @param {string} moduleId
 * @param {any} controls
 * @param {{ isSnapshot?: boolean, hideAxesAndLabels?: boolean }} [context]
 * @returns {PanelHelpGroup[] | null}
 */
export function resolvePanelHelpItems(moduleId, controls, context = {}) {
  const resolve = PANEL_HELP_BY_MODULE_ID[moduleId];
  if (!resolve) return null;
  const sections = resolve(normalizePanelControls(controls), context).filter(
    (section) => section.items.length && !(section.title === "Axes" && context.hideAxesAndLabels)
  );
  return sections.length ? sections : null;
}
