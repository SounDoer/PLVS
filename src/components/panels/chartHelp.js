const LEVEL_METER_AXES_HELP = [
  {
    title: "Axes",
    items: [
      "Level axis wheel - Zoom level",
      "Level axis drag - Pan level",
      "Double-click axis - Reset axis",
    ],
  },
];

const LEVEL_METER_TP_MAX_HELP = [
  ...LEVEL_METER_AXES_HELP,
  {
    title: "Markers",
    items: ["Click marker - Reset TP Max"],
  },
];

// The TP Max marker only renders in Peak mode with its switch on (see LevelMeterPanel's
// showTpMaxMarker) -- everywhere else the "Markers" section would document a control that isn't
// there.
function resolveLevelMeterHelp(controls) {
  return controls?.levelMeterMode === "peak" && controls?.levelMeterTpMaxMarker
    ? LEVEL_METER_TP_MAX_HELP
    : LEVEL_METER_AXES_HELP;
}

export const LOUDNESS_HELP = [
  {
    title: "Snapshot",
    items: [
      "Left click - Select snapshot",
      "Left drag - Scrub timeline",
      "Left double-click - Return to live",
    ],
  },
  {
    title: "Viewport",
    items: [
      "Mouse wheel - Zoom time",
      "Ctrl + wheel - Zoom loudness",
      "Ctrl + drag - Pan viewport",
      "Right drag - Pan timeline",
      "Right double-click - Reset timeline",
    ],
  },
  {
    title: "Axes",
    items: [
      "Time axis wheel - Zoom time",
      "Time axis drag - Pan time",
      "Loudness axis wheel - Zoom loudness",
      "Loudness axis drag - Pan loudness",
      "Double-click axis - Reset axis",
    ],
  },
];

export const SPECTRUM_HELP = [
  {
    title: "Inspect",
    items: [
      "Hover - Inspect value",
      "Left hold - Slow the trace",
      "Click - Capture snapshot",
      "Double-click - Return to live",
      "Click held line - Clear Max Hold",
    ],
  },
  {
    title: "Viewport",
    items: [
      "Mouse wheel - Zoom frequency",
      "Ctrl + wheel - Zoom dB",
      "Trackpad swipe - Pan frequency",
      "Ctrl + drag - Pan viewport",
    ],
  },
  {
    title: "Axes",
    items: [
      "Frequency axis wheel - Zoom frequency",
      "Frequency axis drag - Pan frequency",
      "Level axis wheel - Zoom dB",
      "Level axis drag - Pan dB",
      "Double-click axis - Reset axis",
    ],
  },
];

// Spectrogram help is resolved per view mode. The right button is the reason it has to be: in 2D it
// pans and resets the timeline, in 3D it rotates and resets the viewpoint. Listing both at once
// leaves the reader to guess which half applies, and one of the two is always wrong.
const SPECTROGRAM_SNAPSHOT_HELP = {
  title: "Snapshot",
  items: [
    "Left click - Select snapshot",
    "Left drag - Scrub timeline",
    "Left double-click - Return to live",
  ],
};

const SPECTROGRAM_AXIS_ITEMS = [
  "Time axis wheel - Zoom time",
  "Time axis drag - Pan time",
  "Frequency axis wheel - Zoom frequency",
  "Frequency axis drag - Pan frequency",
  "Double-click axis - Reset axis",
];

export const SPECTROGRAM_2D_HELP = [
  SPECTROGRAM_SNAPSHOT_HELP,
  {
    title: "Viewport",
    items: [
      "Mouse wheel - Zoom time",
      "Ctrl + wheel - Zoom frequency",
      "Ctrl + drag - Pan viewport",
      "Right drag - Pan timeline",
      "Right double-click - Reset timeline",
    ],
  },
  { title: "Axes", items: SPECTROGRAM_AXIS_ITEMS },
];

export const SPECTROGRAM_3D_HELP = [
  SPECTROGRAM_SNAPSHOT_HELP,
  {
    title: "Viewport",
    items: [
      "Mouse wheel - Zoom time",
      "Ctrl + wheel - Zoom frequency",
      "Ctrl + drag - Pan viewport",
      "Shift + wheel - Height Scale",
    ],
  },
  {
    title: "Viewpoint",
    items: ["Right drag - Rotate", "Right double-click - Reset viewpoint"],
  },
  { title: "Axes", items: SPECTROGRAM_AXIS_ITEMS },
];

function resolveSpectrogramHelp(controls) {
  const mode = controls?.spectrogramMode;
  return mode === "lines" || mode === "surface" ? SPECTROGRAM_3D_HELP : SPECTROGRAM_2D_HELP;
}

export const WAVEFORM_HELP = [
  {
    title: "Snapshot",
    items: [
      "Left click - Select snapshot",
      "Left drag - Scrub timeline",
      "Left double-click - Return to live",
    ],
  },
  {
    title: "Viewport",
    items: [
      "Mouse wheel - Zoom time",
      "Ctrl + drag - Pan timeline",
      "Right drag - Pan timeline",
      "Right double-click - Reset timeline",
    ],
  },
  {
    title: "Axes",
    items: [
      "Time axis wheel - Zoom time",
      "Time axis drag - Pan time",
      "Double-click time axis - Reset time",
    ],
  },
];

export const VECTORSCOPE_LISSAJOUS_HELP = [
  {
    title: "Persistence",
    items: ["Left hold - Slow trace decay"],
  },
];

export const VECTORSCOPE_POLAR_LEVEL_HELP = [
  {
    title: "Max hold",
    items: ["Click plot - Reset Max hold"],
  },
];

export const STEREO_MAP_HELP = [
  {
    title: "Inspect",
    items: ["Hover - Inspect value", "Click - Capture snapshot", "Double-click - Return to live"],
  },
  {
    title: "Viewport",
    items: [
      "Mouse wheel - Zoom frequency",
      "Trackpad swipe - Pan frequency",
      "Ctrl + drag - Pan viewport",
    ],
  },
  {
    title: "Axes",
    items: [
      "Frequency axis wheel - Zoom frequency",
      "Frequency axis drag - Pan frequency",
      "Double-click axis - Reset axis",
    ],
  },
];

function resolveVectorscopeHelp(controls) {
  const mode = controls?.vectorscopeMode ?? "lissajous";
  if (mode === "lissajous") return VECTORSCOPE_LISSAJOUS_HELP;
  if (mode === "polarLevel" && controls?.vectorscopePolarLevelMaxHold === true) {
    return VECTORSCOPE_POLAR_LEVEL_HELP;
  }
  return null;
}

export const PANEL_HELP_BY_MODULE_ID = {
  levelMeter: resolveLevelMeterHelp,
  loudness: LOUDNESS_HELP,
  spectrum: SPECTRUM_HELP,
  spectrogram: resolveSpectrogramHelp,
  waveform: WAVEFORM_HELP,
  vectorscope: resolveVectorscopeHelp,
  "stereo-map": STEREO_MAP_HELP,
};

export function resolvePanelHelpItems(moduleId, controls) {
  const help = PANEL_HELP_BY_MODULE_ID[moduleId];
  return typeof help === "function" ? help(controls) : (help ?? null);
}
