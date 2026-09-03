import { DEFAULT_PANEL_CONTROLS, normalizePanelControls } from "../lib/panelControls.js";
import { STATS_CANONICAL_ORDER } from "../lib/statsCatalog.js";
import { buildSpectrumChannelOptions } from "../math/spectrumChannelOptions.js";
import { readPublicPanelControls } from "./panelControls.js";

const smoothingOptions = ["off", "1/12", "1/6", "1/3"];

function field(type, title, description, additions = {}) {
  return { type, title, description, ...additions };
}

function active(schema, effective, inactiveReason) {
  return {
    ...schema,
    effective,
    ...(!effective && inactiveReason ? { inactiveReason } : {}),
  };
}

function range(title, unit, defaultValue, minimum, maximum, minimumSpan, additions = {}) {
  return field("object", title, `Stored ${title.toLowerCase()} minimum and maximum.`, {
    unit,
    default: defaultValue,
    patchMode: "replace",
    required: ["min", "max"],
    properties: {
      min: field("number", "Minimum", `Minimum ${title.toLowerCase()}.`, { minimum, maximum }),
      max: field("number", "Maximum", `Maximum ${title.toLowerCase()}.`, { minimum, maximum }),
    },
    constraints: [
      { kind: "ordered", lower: "min", upper: "max" },
      ...(minimumSpan === undefined ? [] : [{ kind: "minimumSpan", value: minimumSpan }]),
    ],
    ...additions,
  });
}

function topology(context) {
  const detected = Number.isInteger(context.channelCount) && context.channelCount > 0;
  return {
    status: detected ? "detected" : "assumed",
    channelCount: detected ? context.channelCount : 2,
  };
}

function channelSchema(defaultValue, context) {
  const channelTopology = topology(context);
  const options = buildSpectrumChannelOptions(
    channelTopology.channelCount,
    context.channelLabels ?? []
  ).map(({ label, sel }) => ({ title: label, value: sel }));
  return field("object", "Channel", "Channel or channel pair used by this panel.", {
    default: defaultValue,
    patchMode: "replace",
    options,
    effective: true,
  });
}

function pairSchema(defaultValue, context) {
  const channelTopology = topology(context);
  const labels = context.channelLabels ?? [];
  const options = [];
  for (let x = 0; x < channelTopology.channelCount; x += 1) {
    for (let y = x + 1; y < channelTopology.channelCount; y += 1) {
      options.push({
        title: `${labels[x] ?? `Ch ${x + 1}`}+${labels[y] ?? `Ch ${y + 1}`}`,
        value: { x, y },
      });
    }
  }
  return field("object", "Channel Pair", "Ordered pair of distinct channels.", {
    default: defaultValue,
    patchMode: "replace",
    options,
    effective: true,
  });
}

function root(properties, additions = {}) {
  return { type: "object", patchMode: "merge", properties, ...additions };
}

export function buildPublicPanelControlSchema(moduleId, panelControls, context = {}) {
  const controls = normalizePanelControls(panelControls);
  const defaults = readPublicPanelControls(moduleId, DEFAULT_PANEL_CONTROLS, context);

  if (moduleId === "levelMeter") {
    const loudnessMode =
      controls.levelMeterMode === "momentary" || controls.levelMeterMode === "shortTerm";
    return root({
      mode: field("string", "Mode", "Measurement displayed by the meter.", {
        default: defaults.mode,
        options: ["peak", "rms", "momentary", "shortTerm"],
        effective: true,
      }),
      playbackMax: active(
        field("boolean", "Playback Max", "Show the highest measured playback value.", {
          default: defaults.playbackMax,
        }),
        controls.levelMeterMode !== "peak",
        "peakMode"
      ),
      floatingValue: active(
        field("boolean", "Floating Value", "Show a floating loudness value marker.", {
          default: defaults.floatingValue,
        }),
        loudnessMode,
        "nonLoudnessMode"
      ),
      tpMaxMarker: active(
        field("boolean", "TP Max Marker", "Show the true-peak maximum marker.", {
          default: defaults.tpMaxMarker,
        }),
        controls.levelMeterMode === "peak",
        "nonPeakMode"
      ),
      levelRangeDbfs: active(
        range("Level Range", "dBFS", defaults.levelRangeDbfs, -60, 3, 12),
        !loudnessMode,
        "loudnessMode"
      ),
      loudnessRangeLufs: active(
        range("Loudness Range", "LUFS", defaults.loudnessRangeLufs, -64, 0, 12),
        loudnessMode,
        "levelMode"
      ),
    });
  }

  if (moduleId === "loudness") {
    const options = [
      "momentary",
      "shortTerm",
      ...(context.hasLoudnessReference === true ? ["reference"] : []),
    ];
    return root({
      layers: field("array", "Layers", "Visible loudness history layers.", {
        default: defaults.layers,
        patchMode: "replace",
        uniqueItems: true,
        options,
        items: { type: "string", options },
        effective: true,
      }),
      loudnessRangeLufs: active(
        range("Loudness Range", "LUFS", defaults.loudnessRangeLufs, -64, 0, 12),
        true
      ),
    });
  }

  if (moduleId === "vectorscope") {
    const channelTopology = topology(context);
    return root(
      {
        channelPair: pairSchema(defaults.channelPair, context),
        mode: field("string", "Mode", "Vectorscope display mode.", {
          default: defaults.mode,
          options: ["lissajous", "polarSample", "polarLevel"],
          effective: true,
        }),
        maxHold: active(
          field("boolean", "Max Hold", "Hold the maximum polar level.", {
            default: defaults.maxHold,
          }),
          controls.vectorscopeMode === "polarLevel",
          "nonPolarLevelMode"
        ),
      },
      { channelTopology }
    );
  }

  if (moduleId === "waveform") {
    return root({
      frequencyColor: field("boolean", "Frequency Color", "Color the waveform by spectral band.", {
        default: defaults.frequencyColor,
        effective: true,
      }),
      frequencyBandsHz: active(
        field("object", "Frequency Bands", "Frequency Color split points.", {
          unit: "Hz",
          default: defaults.frequencyBandsHz,
          patchMode: "replace",
          required: ["lowMid", "midHigh"],
          properties: {
            lowMid: field("integer", "Low/Mid", "Low-to-mid split frequency.", {
              minimum: 20,
              maximum: 20000,
            }),
            midHigh: field("integer", "Mid/High", "Mid-to-high split frequency.", {
              minimum: 20,
              maximum: 20000,
            }),
          },
          constraints: [{ kind: "ordered", lower: "lowMid", upper: "midHigh" }],
        }),
        controls.waveformFrequencyColor,
        "frequencyColorOff"
      ),
      centroid: field("boolean", "Centroid", "Show the spectral centroid overlay.", {
        default: defaults.centroid,
        effective: true,
      }),
    });
  }

  if (moduleId === "stats") {
    const array = (title, description, defaultValue, constraints = []) =>
      field("array", title, description, {
        default: defaultValue,
        patchMode: "replace",
        uniqueItems: true,
        options: [...STATS_CANONICAL_ORDER],
        items: { type: "string", options: [...STATS_CANONICAL_ORDER] },
        constraints,
        effective: true,
      });
    return root({
      metrics: field("object", "Metrics", "Visible metrics and their display order.", {
        default: defaults.metrics,
        patchMode: "merge",
        effective: true,
        properties: {
          visible: array(
            "Visible Metrics",
            "Complete set of visible metric identifiers.",
            defaults.metrics.visible
          ),
          order: array(
            "Metric Order",
            "Complete display ordering of all metrics.",
            defaults.metrics.order,
            [{ kind: "fullPermutation" }]
          ),
        },
      }),
    });
  }

  if (moduleId === "spectrum") {
    const channelTopology = topology(context);
    const pairSelected = controls.spectrumChannel?.type === "pair";
    return root(
      {
        channel: channelSchema(defaults.channel, context),
        view: active(
          field("string", "View", "Channel-pair rendering mode.", {
            default: defaults.view,
            options: ["combined", "lr", "ms"],
          }),
          pairSelected,
          "singleChannel"
        ),
        maxMode: field("string", "Max Mode", "Spectrum maximum trace behavior.", {
          default: defaults.maxMode,
          options: ["off", "decay", "hold"],
          effective: true,
        }),
        peakLabels: field("boolean", "Peak Labels", "Show labels for spectrum peaks.", {
          default: defaults.peakLabels,
          effective: true,
        }),
        speedPercent: field("integer", "Speed", "Spectrum response speed.", {
          unit: "%",
          default: defaults.speedPercent,
          minimum: 0,
          maximum: 100,
          effective: true,
        }),
        tiltDbPerOctave: field("number", "Tilt", "Display compensation per octave.", {
          unit: "dB/oct",
          default: defaults.tiltDbPerOctave,
          minimum: 0,
          maximum: 6,
          suggestedStep: 0.25,
          effective: true,
        }),
        octaveSmoothing: field("string", "Octave Smoothing", "Frequency-domain smoothing.", {
          default: defaults.octaveSmoothing,
          options: smoothingOptions,
          effective: true,
        }),
        levelRangeDb: active(range("Level Range", "dB", defaults.levelRangeDb, -120, 0, 12), true),
      },
      { channelTopology }
    );
  }

  if (moduleId === "spectrogram") {
    const channelTopology = topology(context);
    const threeD = controls.spectrogramMode !== "heatmap";
    const threeDField = (type, title, description, additions) =>
      active(field(type, title, description, additions), threeD, "heatmapMode");
    return root(
      {
        channel: channelSchema(defaults.channel, context),
        mode: field("string", "Mode", "Spectrogram rendering mode.", {
          default: defaults.mode,
          options: ["heatmap", "lines", "surface"],
          effective: true,
        }),
        tiltDbPerOctave: field("number", "Tilt", "Display compensation per octave.", {
          unit: "dB/oct",
          default: defaults.tiltDbPerOctave,
          minimum: 0,
          maximum: 6,
          suggestedStep: 0.25,
          effective: true,
        }),
        octaveSmoothing: field("string", "Octave Smoothing", "Frequency-domain smoothing.", {
          default: defaults.octaveSmoothing,
          options: smoothingOptions,
          effective: true,
        }),
        dbFloor: field("integer", "dB Floor", "Lowest displayed spectrogram level.", {
          unit: "dB",
          default: defaults.dbFloor,
          minimum: -96,
          maximum: -12,
          effective: true,
        }),
        threeD: active(
          field("object", "3D", "Controls used by Lines and Surface modes.", {
            default: defaults.threeD,
            patchMode: "merge",
            properties: {
              azimuthDeg: threeDField("number", "Azimuth", "3D camera azimuth.", {
                unit: "deg",
                default: defaults.threeD.azimuthDeg,
                minimum: 0,
                exclusiveMaximum: 360,
              }),
              elevationDeg: threeDField("number", "Elevation", "3D camera elevation.", {
                unit: "deg",
                default: defaults.threeD.elevationDeg,
                minimum: 5,
                maximum: 85,
              }),
              heightScale: threeDField("number", "Height Scale", "Vertical 3D amplitude scale.", {
                default: defaults.threeD.heightScale,
                minimum: 0.3,
                maximum: 3,
              }),
              colorize: threeDField("boolean", "Colorize", "Color the 3D surface.", {
                default: defaults.threeD.colorize,
              }),
              grid: threeDField("boolean", "Grid", "Show the 3D floor grid.", {
                default: defaults.threeD.grid,
              }),
            },
          }),
          threeD,
          "heatmapMode"
        ),
      },
      { channelTopology }
    );
  }

  if (moduleId === "stereo-map") {
    const channelTopology = topology(context);
    return root(
      {
        mode: field("string", "Mode", "Stereo Map display mode.", {
          default: defaults.mode,
          options: ["position", "correlation", "monoLossDb", "msRatioDb"],
          effective: true,
        }),
        channelPair: pairSchema(defaults.channelPair, context),
        maxHold: field("boolean", "Max Hold", "Hold maximum Stereo Map values.", {
          default: defaults.maxHold,
          effective: true,
        }),
        speedPercent: field("integer", "Speed", "Stereo Map response speed.", {
          unit: "%",
          default: defaults.speedPercent,
          minimum: 0,
          maximum: 100,
          effective: true,
        }),
        octaveSmoothing: field("string", "Octave Smoothing", "Frequency-domain smoothing.", {
          default: defaults.octaveSmoothing,
          options: smoothingOptions,
          effective: true,
        }),
        monoLossFloorDb: active(
          field("number", "Mono Loss Floor", "Lowest displayed mono-loss value.", {
            unit: "dB",
            default: defaults.monoLossFloorDb,
            minimum: -60,
            maximum: -6,
          }),
          controls.stereoMapMode === "monoLossDb",
          "nonMonoLossMode"
        ),
        msRatioRangeDb: active(
          range("M/S Ratio Range", "dB", defaults.msRatioRangeDb, -96, 48, undefined, {
            constraints: [
              { kind: "ordered", lower: "min", upper: "max" },
              { kind: "includes", value: 0 },
            ],
          }),
          controls.stereoMapMode === "msRatioDb",
          "nonMsRatioMode"
        ),
      },
      { channelTopology }
    );
  }

  throw new Error(`Unsupported panel module: ${String(moduleId)}.`);
}
