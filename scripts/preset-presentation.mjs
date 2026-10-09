import { MODULE_CATALOG } from "../src/workspace/moduleCatalog.js";
import { STATS_META } from "../src/lib/statsCatalog.js";
import { escapeHtml, profileDetails } from "./site-components.mjs";

const labels = {
  dbFloor: "Level Floor",
  threeD: "3D",
  widthCssPx: "Width",
  persistenceMs: "Persistence",
  azimuthDeg: "Azimuth",
  elevationDeg: "Elevation",
  tpMaxMarker: "True Peak Max Marker",
  levelRangeDbfs: "Level Range",
  loudnessRangeLufs: "Loudness Range",
  levelRangeDb: "Level Range",
  msRatioRangeDb: "Mid/Side Ratio Range",
  monoLossFloorDb: "Mono Loss Floor",
  speedPercent: "Speed",
  tiltDbPerOctave: "Tilt",
  panelOpacityPercent: "Panel Opacity",
  heightCssPx: "Height",
  preferredWidthCssPx: "Preferred Width",
  minHz: "Minimum Frequency",
  maxHz: "Maximum Frequency",
  windowSec: "Time Window",
  glassEnabled: "Glass",
  peakThresholdsDbfs: "Peak Thresholds",
  rmsThresholdsDbfs: "RMS Thresholds",
};
const names = {
  lr: "L/R",
  ms: "M/S",
  rms: "RMS",
  lissajous: "Lissajous",
  off: "Off",
  shortTerm: "Short-term",
};
const words = (key) =>
  labels[key] ??
  key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
const unit = (key) =>
  /Dbfs$/.test(key)
    ? " dBFS"
    : /Lufs$/.test(key)
      ? " LUFS"
      : /DbPerOctave$/.test(key)
        ? " dB/oct"
        : /Db$/.test(key)
          ? " dB"
          : /Percent$/.test(key)
            ? "%"
            : /Hz$/.test(key)
              ? " Hz"
              : /Sec$/.test(key)
                ? " s"
                : /CssPx$/.test(key)
                  ? " px"
                  : "";
const display = (value) =>
  typeof value === "boolean"
    ? value
      ? "On"
      : "Off"
    : typeof value === "number"
      ? String(value).replace("-", "−")
      : (STATS_META[value]?.label ?? names[value] ?? words(String(value)));
const row = (label, value) =>
  `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;

export function settingRows(settings, prefix = "", inheritedUnit = "") {
  return Object.entries(settings ?? {})
    .map(([key, value]) => {
      const label = [prefix, words(key)].filter(Boolean).join(" · ");
      const suffix =
        (key === "dbFloor"
          ? " dB"
          : key.endsWith("Ms")
            ? " ms"
            : key.endsWith("Deg")
              ? "°"
              : unit(key)) || inheritedUnit;
      if (value === null) return row(label, "Not Set");
      if (Array.isArray(value))
        return row(label, value.length ? value.map(display).join(", ") : "None");
      if (typeof value === "object") {
        if (key === "channelPair" || (key === "channel" && value.type === "pair"))
          return row(label, `Channels ${value.x + 1} / ${value.y + 1}`);
        if (key === "channel" && value.type === "single")
          return row(label, `Channel ${value.ch + 1}`);
        if (Object.keys(value).length === 2 && "min" in value && "max" in value)
          return row(label, `${display(value.min)} to ${display(value.max)}${suffix}`);
        return settingRows(value, label, suffix);
      }
      return row(label, `${display(value)}${typeof value === "number" ? suffix : ""}`);
    })
    .join("");
}

export function presetProfile(pack) {
  const id = pack?.items[0]?.loudnessProfile?.dependencyId;
  return id
    ? (pack.dependencies ?? []).flatMap((group) => group.items ?? []).find((item) => item.id === id)
    : null;
}

export function presetExtraDetails(pack) {
  const preset = pack.items[0];
  const profile = presetProfile(pack);
  return (
    row("Loudness Profile", profile?.name ?? "Off") +
    settingRows(preset.presentation) +
    (preset.dock.enabled
      ? settingRows(
          Object.fromEntries(
            Object.entries(preset.dock).filter(([key]) => !["enabled", "panels"].includes(key))
          ),
          "Dock"
        )
      : "")
  );
}

export function presetPanels(pack) {
  const preset = pack.items[0];
  const panels = [
    ...preset.workspace.panels.map((panel) => ({ panel, location: "" })),
    ...(preset.dock.enabled
      ? preset.dock.panels.map((panel) => ({ panel, location: "Dock" }))
      : []),
  ];
  const titleFor = (panel) =>
    panel.title || MODULE_CATALOG[panel.moduleId]?.title || panel.moduleId;
  const counts = new Map();
  for (const { panel, location } of panels) {
    const key = `${location}:${titleFor(panel)}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const seen = new Map();
  const heading = (panel, location) => {
    const title = titleFor(panel);
    const key = `${location}:${title}`;
    const index = (seen.get(key) ?? 0) + 1;
    seen.set(key, index);
    const suffix = counts.get(key) > 1 ? ` ${index}` : "";
    const context = [location, panel.title ? MODULE_CATALOG[panel.moduleId]?.title : ""]
      .filter(Boolean)
      .join(" · ");
    return `${escapeHtml(title + suffix)}${context ? ` <span>${escapeHtml(context)}</span>` : ""}`;
  };
  const profile = presetProfile(pack);
  return `<section class="preset-settings"><h2>Panel Settings</h2><p class="muted">Settings saved in this file. Omitted controls use PLVS defaults.</p>
    ${panels.map(({ panel, location }) => `<details class="preset-panel"><summary>${heading(panel, location)}</summary><dl>${settingRows(panel.controls)}${settingRows(panel.axes, "Axes")}${panel.pinnedSize ? settingRows(panel.pinnedSize, "Pinned Size") : ""}${panel.preferredWidthCssPx !== undefined ? settingRows({ preferredWidthCssPx: panel.preferredWidthCssPx }) : ""}</dl>${Object.keys(panel.controls ?? {}).length || Object.keys(panel.axes ?? {}).length ? "" : "<p>Default panel settings.</p>"}</details>`).join("")}
    </section>${profile ? `<section class="preset-profile"><h2>Included Loudness Profile</h2><h3>${escapeHtml(profile.name)}</h3>${profileDetails(profile)}</section>` : ""}`;
}
