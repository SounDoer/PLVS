function sampledIntensityStops(samples) {
  return Object.freeze(
    samples.map(([position, color]) => Object.freeze({ position: position / 255, color }))
  );
}

// Perceptually uniform sequential colormaps sampled at the nearest 8-bit index to each decile,
// including both endpoints. Source: Matplotlib's 256-entry listed colormaps at commit
// 717459bbba42e8990601910b76ca365c0847a9f6. Keeping the source index in this definition makes the
// sampling rule reproducible while exposing normalized positions to Theme documents.
const INFERNO_STOPS = sampledIntensityStops([
  [0, "#000004"],
  [26, "#180c3c"],
  [51, "#420a68"],
  [77, "#6c186e"],
  [102, "#932667"],
  [128, "#bc3754"],
  [153, "#dd513a"],
  [179, "#f37819"],
  [204, "#fca50a"],
  [230, "#f6d746"],
  [255, "#fcffa4"],
]);

const VIRIDIS_STOPS = sampledIntensityStops([
  [0, "#440154"],
  [26, "#482576"],
  [51, "#414487"],
  [77, "#34608d"],
  [102, "#2a788e"],
  [128, "#21918c"],
  [153, "#22a884"],
  [179, "#44bf70"],
  [204, "#7ad151"],
  [230, "#bddf26"],
  [255, "#fde725"],
]);

const MAGMA_STOPS = sampledIntensityStops([
  [0, "#000004"],
  [26, "#150e38"],
  [51, "#3b0f70"],
  [77, "#651a80"],
  [102, "#8c2981"],
  [128, "#b73779"],
  [153, "#de4968"],
  [179, "#f7705c"],
  [204, "#fe9f6d"],
  [230, "#fecf92"],
  [255, "#fcfdbf"],
]);

const PRESETS = Object.freeze({
  status: Object.freeze([
    Object.freeze({
      id: "status-plvs",
      label: "PLVS",
      value: Object.freeze({ safe: "#34d399", warning: "#fbbf24", critical: "#f97373" }),
    }),
  ]),
  intensity: Object.freeze([
    Object.freeze({
      id: "intensity-inferno",
      label: "Inferno",
      value: INFERNO_STOPS,
    }),
    Object.freeze({
      id: "intensity-viridis",
      label: "Viridis",
      value: VIRIDIS_STOPS,
    }),
    Object.freeze({
      id: "intensity-magma",
      label: "Magma",
      value: MAGMA_STOPS,
    }),
    Object.freeze({
      id: "intensity-monochrome",
      label: "Monochrome",
      value: Object.freeze([
        Object.freeze({ position: 0, color: "#000000" }),
        Object.freeze({ position: 1, color: "#ffffff" }),
      ]),
    }),
  ]),
  frequency: Object.freeze([
    Object.freeze({
      id: "frequency-plvs",
      label: "PLVS",
      value: Object.freeze({ low: "#ff2d3d", mid: "#fb923c", high: "#356dff" }),
    }),
  ]),
  interface: Object.freeze([
    Object.freeze({
      id: "interface-plvs",
      label: "PLVS",
      value: Object.freeze({ success: "#209a6e", warning: "#da8d08", danger: "#e43b46" }),
    }),
  ]),
});

export const PALETTE_KINDS = Object.freeze(Object.keys(PRESETS));

/**
 * @param {string} kind
 */
export function listPalettePresets(kind) {
  return PRESETS[kind] ?? [];
}

/**
 * @param {string} kind
 * @param {string} id
 */
export function getPalettePreset(kind, id) {
  return listPalettePresets(kind).find((preset) => preset.id === id) ?? null;
}

/**
 * @param {string} kind
 */
export function findMatchingPalettePresetId(kind, palette) {
  if (!palette || typeof palette !== "object") return null;
  const match = listPalettePresets(kind).find(
    (/** @type {{ value: string | { [s: string]: any; } | ArrayLike<any>; }} */ preset) => {
      if (kind === "intensity") {
        return (
          Array.isArray(palette.stops) &&
          palette.stops.length === preset.value.length &&
          palette.stops.every(
            (stop, index) =>
              stop.position === preset.value[index].position &&
              stop.color === preset.value[index].color
          )
        );
      }
      return Object.entries(preset.value).every(([key, color]) => palette[key] === color);
    }
  );
  return match?.id ?? null;
}

/** Return an editable snapshot; saved themes never inherit future preset changes. */
/**
 * Return an editable snapshot; saved themes never inherit future preset changes.
 * @param {string} kind
 * @param {string} id
 */
export function applyPalettePreset(kind, id) {
  const preset = getPalettePreset(kind, id);
  if (!preset) return null;
  return { presetId: preset.id, ...structuredClonePresetValue(kind, preset.value) };
}

/**
 * @param {string} kind
 */
function structuredClonePresetValue(kind, value) {
  if (kind === "intensity") return { stops: value.map((stop) => ({ ...stop })) };
  return { ...value };
}
