export const LEVEL_METER_HELP = [
  {
    title: "Axes",
    items: [
      "Y axis wheel - Zoom level",
      "Y axis drag - Pan level",
      "Double-click axis - Reset axis",
    ],
  },
];

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
      "Ctrl + wheel - Zoom level",
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
      "Y axis wheel - Zoom level",
      "Y axis drag - Pan level",
      "Double-click axis - Reset axis",
    ],
  },
];

export const SPECTRUM_HELP = [
  {
    title: "Inspect",
    items: [
      "Hover - Inspect value",
      "Left hold - Increase smoothing",
      "Click - Capture snapshot",
      "Double-click - Return to live",
    ],
  },
  {
    title: "Viewport",
    items: ["Mouse wheel - Zoom frequency", "Ctrl + wheel - Zoom dB", "Ctrl + drag - Pan viewport"],
  },
  {
    title: "Axes",
    items: [
      "X axis wheel - Zoom frequency",
      "X axis drag - Pan frequency",
      "Y axis wheel - Zoom dB",
      "Y axis drag - Pan dB",
      "Double-click axis - Reset axis",
    ],
  },
];

export const SPECTROGRAM_HELP = [
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
      "Ctrl + wheel - Zoom frequency",
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
      "Y axis wheel - Zoom frequency",
      "Y axis drag - Pan frequency",
      "Double-click axis - Reset axis",
    ],
  },
];

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

export const PANEL_HELP_BY_MODULE_ID = {
  levelMeter: LEVEL_METER_HELP,
  loudness: LOUDNESS_HELP,
  spectrum: SPECTRUM_HELP,
  spectrogram: SPECTROGRAM_HELP,
  waveform: WAVEFORM_HELP,
};
