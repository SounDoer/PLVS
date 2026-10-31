/**
 * How each gesture in the panel gesture reference (`src/components/panels/chartHelp.js`) is
 * reproduced on camera through Agent Control: by a command, or by the pointer itself resting on the
 * chart. `chartGestureCoverage.test.js` fails when the reference gains a gesture with no entry.
 */
export const CHART_GESTURE_REPRODUCTION = Object.freeze({
  inspect: "pointer",
  select: "transport.snapshot.select",
  capture: "transport.snapshot.select",
  live: "transport.snapshot.clear",
  scrub: "transport.snapshot.select",
  "zoom-time": "axis.shared.update",
  "zoom-time-axis": "axis.shared.update",
  "pan-time-axis": "axis.shared.update",
  "pan-timeline": "axis.shared.update",
  "pan-timeline-ctrl": "axis.shared.update",
  "reset-time-axis": "axis.shared.reset",
  "reset-timeline": "axis.shared.reset",
  "zoom-frequency": "axis.shared.update",
  "zoom-frequency-axis": "axis.shared.update",
  "pan-frequency": "axis.shared.update",
  "pan-frequency-axis": "axis.shared.update",
  "swipe-frequency": "axis.shared.update",
  "pan-viewport": "axis.panel.update",
  "zoom-level-axis": "axis.panel.update",
  "pan-level-axis": "axis.panel.update",
  "zoom-loudness": "axis.panel.update",
  "zoom-loudness-axis": "axis.panel.update",
  "pan-loudness-axis": "axis.panel.update",
  "zoom-db": "axis.panel.update",
  "reset-axis": "axis.panel.reset",
  rotate: "panel.update",
  height: "panel.update",
  "reset-viewpoint": "panel.update",
  "clear-max-hold": "measurement.resetHold",
  "reset-max-hold": "measurement.resetHold",
  "reset-tp-max": "measurement.resetTruePeakMax",
  "hold-slow": "panel.holdSlow",
});
