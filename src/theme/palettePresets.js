const PRESETS = Object.freeze({
  status: Object.freeze([
    Object.freeze({
      id: "status-plvs",
      label: "PLVS Default",
      value: Object.freeze({ good: "#34d399", warning: "#fbbf24", critical: "#f97373" }),
    }),
    Object.freeze({
      id: "status-bold",
      label: "Bold",
      value: Object.freeze({ good: "#22c55e", warning: "#f59e0b", critical: "#ef4444" }),
    }),
    Object.freeze({
      id: "status-cool",
      label: "Cool",
      value: Object.freeze({ good: "#14b8a6", warning: "#eab308", critical: "#e11d48" }),
    }),
  ]),
  intensity: Object.freeze([
    Object.freeze({
      id: "intensity-inferno",
      label: "Inferno",
      value: Object.freeze([
        Object.freeze({ position: 0, color: "#000004" }),
        Object.freeze({ position: 0.2, color: "#420f6e" }),
        Object.freeze({ position: 0.4, color: "#9e0c8f" }),
        Object.freeze({ position: 0.6, color: "#e74152" }),
        Object.freeze({ position: 0.8, color: "#fbc40a" }),
        Object.freeze({ position: 1, color: "#fcffa4" }),
      ]),
    }),
    Object.freeze({
      id: "intensity-viridis",
      label: "Viridis",
      value: Object.freeze([
        Object.freeze({ position: 0, color: "#440154" }),
        Object.freeze({ position: 0.25, color: "#3b528b" }),
        Object.freeze({ position: 0.5, color: "#21918c" }),
        Object.freeze({ position: 0.75, color: "#5ec962" }),
        Object.freeze({ position: 1, color: "#fde725" }),
      ]),
    }),
    Object.freeze({
      id: "intensity-magma",
      label: "Magma",
      value: Object.freeze([
        Object.freeze({ position: 0, color: "#000004" }),
        Object.freeze({ position: 0.25, color: "#51127c" }),
        Object.freeze({ position: 0.5, color: "#b73779" }),
        Object.freeze({ position: 0.75, color: "#fc8961" }),
        Object.freeze({ position: 1, color: "#fcfdbf" }),
      ]),
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
      label: "PLVS Default",
      value: Object.freeze({ low: "#ff2d3d", mid: "#fb923c", high: "#356dff" }),
    }),
    Object.freeze({
      id: "frequency-spectrum",
      label: "Spectrum",
      value: Object.freeze({ low: "#ef4444", mid: "#22c55e", high: "#3b82f6" }),
    }),
    Object.freeze({
      id: "frequency-cool",
      label: "Cool",
      value: Object.freeze({ low: "#a855f7", mid: "#06b6d4", high: "#60a5fa" }),
    }),
  ]),
});

export const PALETTE_KINDS = Object.freeze(Object.keys(PRESETS));

export function listPalettePresets(kind) {
  return PRESETS[kind] ?? [];
}

export function getPalettePreset(kind, id) {
  return listPalettePresets(kind).find((preset) => preset.id === id) ?? null;
}

/** Return an editable snapshot; saved themes never inherit future preset changes. */
export function applyPalettePreset(kind, id) {
  const preset = getPalettePreset(kind, id);
  if (!preset) return null;
  return { presetId: preset.id, ...structuredClonePresetValue(kind, preset.value) };
}

function structuredClonePresetValue(kind, value) {
  if (kind === "intensity") return { stops: value.map((stop) => ({ ...stop })) };
  return { ...value };
}
