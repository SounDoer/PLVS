import { readPublicPanelControls } from "../workspace/panelControlDocument.js";
import { writeLocalRange } from "../workspace/axisViewports.js";
import { planPublicPanelControlPatch } from "../workspace/panelControlPatch.js";
import { createDockPanelId, DOCK_PANEL_MODULE_IDS } from "./dockLayout.js";
import {
  DEFAULT_DOCK_CONTROLS_BY_MODULE_ID,
  normalizeDockModuleControls,
  dockControlModuleIdForPanel,
} from "./dockModuleControls.js";
import { DOCK_MAX_PREFERRED_WIDTH } from "./dockPanelSizing.js";

const hasOwn = (value, /** @type {string} */ key) =>
  Object.prototype.hasOwnProperty.call(value, key);

const PUBLIC_DOCK_CONTROLS = Object.freeze({
  levelMeter: new Set([
    "mode",
    "readout",
    "orientation",
    "playbackMax",
    "floatingValue",
    "tpMaxMarker",
    "levelRangeDbfs",
    "loudnessRangeLufs",
    "barColors",
    "peakThresholdsDbfs",
    "rmsThresholdsDbfs",
  ]),
  loudness: new Set(["orientation", "layers", "loudnessRangeLufs", "grid"]),
  stats: new Set(["metrics"]),
  vectorscope: new Set(["channelPair", "mode", "persistenceMs", "maxHold"]),
  spectrum: new Set([
    "channel",
    "view",
    "maxMode",
    "grid",
    "peakLabels",
    "speedPercent",
    "tiltDbPerOctave",
    "octaveSmoothing",
    "levelRangeDb",
    "frequencyRangeHz",
    "linkFrequency",
  ]),
  spectrogram: new Set([
    "orientation",
    "channel",
    "mode",
    "threeD",
    "octaveSmoothing",
    "tiltDbPerOctave",
    "dbFloor",
    "frequencyRangeHz",
    "linkFrequency",
  ]),
  waveform: new Set(["orientation", "frequencyColor", "frequencyBandsHz", "centroid"]),
  "stereo-map": new Set([
    "grid",
    "mode",
    "channelPair",
    "maxHold",
    "speedPercent",
    "octaveSmoothing",
    "energyFadePercent",
    "colorBlendPercent",
    "monoLossFloorDb",
    "msRatioRangeDb",
    "frequencyRangeHz",
    "linkFrequency",
  ]),
});

/**
 * @param {string} code
 * @param {string} path
 * @param {string} message
 */
export function dockLayoutIssue(code, path, message) {
  return { code, path, message };
}

function dockWithControls(dock, panelId, controls) {
  return {
    ...dock,
    controlsByPanelId: { ...dock.controlsByPanelId, [panelId]: controls },
  };
}

/**
 * @param {string} panelId
 */
export function planDockPanelPatch(dock, panelId, patch, context = {}) {
  const panel = dock.panelsById?.[panelId];
  if (!panel)
    return {
      dock,
      changed: [],
      warnings: [],
      issues: [dockLayoutIssue("dockPanelNotFound", "$.panelId", "Dock panel was not found.")],
    };
  const allowed = PUBLIC_DOCK_CONTROLS[panel.moduleId];
  if (!allowed)
    return {
      dock,
      changed: [],
      warnings: [],
      issues: [
        dockLayoutIssue("controlsUnavailable", "$.panelId", "This Dock panel has no controls."),
      ],
    };
  const issues = Object.keys(patch)
    .filter((key) => !allowed.has(key))
    .map((key) => dockLayoutIssue("unknownControl", `$.${key}`, `Unknown Dock control: ${key}.`));
  if (issues.length > 0) return { dock, changed: [], warnings: [], issues };

  const dockModuleId = dockControlModuleIdForPanel(panel);
  const current = normalizeDockModuleControls(dockModuleId, dock.controlsByPanelId?.[panelId]);
  const corePatch = { ...patch };
  delete corePatch.readout;
  delete corePatch.frequencyRangeHz;
  delete corePatch.linkFrequency;
  const planned = planPublicPanelControlPatch(panel.moduleId, current, corePatch, context);
  if (planned.issues.length > 0) return { dock, changed: [], warnings: [], issues: planned.issues };
  // `planned.panelControls` holds only the core panel controls, so the Dock-only ones have to be
  // carried over explicitly: normalization falls back to their defaults when it cannot find them,
  // which would silently reset every Dock-only control the patch did not name.
  const next = normalizeDockModuleControls(dockModuleId, {
    ...planned.panelControls,
    readout: current.readout,
    showLabels: current.showLabels,
  });
  const extraIssues = [];
  if (hasOwn(patch, "linkFrequency") && typeof patch.linkFrequency !== "boolean")
    extraIssues.push(
      dockLayoutIssue("invalidType", "$.linkFrequency", "linkFrequency must be a boolean.")
    );
  if (hasOwn(patch, "readout")) {
    if (!["live", "truePeakMax", "playbackMax"].includes(patch.readout))
      extraIssues.push(dockLayoutIssue("invalidEnum", "$.readout", "readout is invalid."));
  }
  if (hasOwn(patch, "readout")) {
    const mode = planned.panelControls.levelMeterMode;
    const readout = hasOwn(patch, "readout") ? patch.readout : current.readout;
    if (
      (mode === "peak" && readout === "playbackMax") ||
      (mode !== "peak" && readout === "truePeakMax")
    )
      extraIssues.push(
        dockLayoutIssue("incompatibleControl", "$.readout", "readout is incompatible with mode.")
      );
    // `readout` aliases exactly one public switch per mode; naming both must agree.
    const [aliasKey, aliasValue] =
      mode === "peak"
        ? ["tpMaxMarker", readout === "truePeakMax"]
        : ["playbackMax", readout === "playbackMax"];
    if (hasOwn(patch, aliasKey) && patch[aliasKey] !== aliasValue)
      extraIssues.push(
        dockLayoutIssue("conflictingControls", "$.readout", `readout conflicts with ${aliasKey}.`)
      );
  }
  if (hasOwn(patch, "frequencyRangeHz")) {
    const range = patch.frequencyRangeHz;
    if (range && typeof range === "object" && !Array.isArray(range)) {
      for (const key of Object.keys(range)) {
        if (!new Set(["min", "max"]).has(key)) {
          extraIssues.push(
            dockLayoutIssue(
              "unknownControl",
              `$.frequencyRangeHz.${key}`,
              `Unknown range field: ${key}.`
            )
          );
        }
      }
    }
    if (
      !range ||
      typeof range !== "object" ||
      Array.isArray(range) ||
      !Number.isFinite(range.min) ||
      !Number.isFinite(range.max) ||
      range.min < 20 ||
      range.max > 20000 ||
      range.min >= range.max
    )
      extraIssues.push(
        dockLayoutIssue(
          "outOfRange",
          "$.frequencyRangeHz",
          "frequencyRangeHz must be within 20..20000."
        )
      );
  }
  if (extraIssues.length > 0) return { dock, changed: [], warnings: [], issues: extraIssues };
  if (hasOwn(patch, "readout")) {
    next.readout = patch.readout;
    if (next.levelMeterMode === "peak")
      next.levelMeterTpMaxMarker = patch.readout === "truePeakMax";
    else next.levelMeterPlaybackMax = patch.readout === "playbackMax";
  }
  if (hasOwn(patch, "linkFrequency")) {
    next.linkFrequencyViewport = patch.linkFrequency;
    if (current.linkFrequencyViewport && !patch.linkFrequency && context.sharedFrequencyViewport)
      Object.assign(
        next,
        writeLocalRange("frequency", panel.moduleId, context.sharedFrequencyViewport)
      );
  }
  if (hasOwn(patch, "frequencyRangeHz")) {
    const prefix =
      panel.moduleId === "spectrogram"
        ? "spectrogramY"
        : panel.moduleId === "stereo-map"
          ? "stereoMapX"
          : "spectrumX";
    next[`${prefix}MinFreq`] = patch.frequencyRangeHz.min;
    next[`${prefix}MaxFreq`] = patch.frequencyRangeHz.max;
  }
  const before = readDockPanelControls(panel, current, context);
  const after = readDockPanelControls(panel, next, context);
  const changed = Object.keys(after)
    .filter((key) => JSON.stringify(after[key]) !== JSON.stringify(before[key]))
    .map((key) => `dock.panels.${panelId}.controls.${key}`);
  return {
    dock: changed.length ? dockWithControls(dock, panelId, next) : dock,
    changed,
    warnings: planned.warnings,
    issues: [],
  };
}

/**
 * @param {string} panelId
 */
export function planDockPanelReset(dock, panelId, context = {}) {
  const panel = dock.panelsById?.[panelId];
  if (!panel)
    return {
      dock,
      changed: [],
      warnings: [],
      issues: [dockLayoutIssue("dockPanelNotFound", "$.panelId", "Dock panel was not found.")],
    };
  const moduleId = dockControlModuleIdForPanel(panel);
  const defaults = DEFAULT_DOCK_CONTROLS_BY_MODULE_ID[moduleId];
  if (!defaults)
    return {
      dock,
      changed: [],
      warnings: [],
      issues: [
        dockLayoutIssue("controlsUnavailable", "$.panelId", "This Dock panel has no controls."),
      ],
    };
  const currentPublic = readDockPanelControls(panel, dock.controlsByPanelId?.[panelId], context);
  const defaultPublic = readDockPanelControls(panel, defaults, context);
  const changed = Object.keys(defaultPublic)
    .filter((key) => JSON.stringify(currentPublic[key]) !== JSON.stringify(defaultPublic[key]))
    .map((key) => `dock.panels.${panelId}.controls.${key}`);
  return {
    dock: changed.length
      ? dockWithControls(dock, panelId, normalizeDockModuleControls(moduleId, defaults))
      : dock,
    changed,
    warnings: [],
    issues: [],
  };
}

export function compileDockLayout(dock, document, context = {}) {
  const issues = [];
  const warnings = [];
  if (
    !document ||
    typeof document !== "object" ||
    Array.isArray(document) ||
    !Array.isArray(document.panels)
  )
    return {
      dock,
      createdPanels: {},
      changed: [],
      warnings: [],
      issues: [dockLayoutIssue("invalidType", "$.panels", "panels must be an array.")],
    };
  for (const key of Object.keys(document))
    if (key !== "panels")
      issues.push(dockLayoutIssue("unknownField", `$.${key}`, `Unknown layout field: ${key}.`));
  const panelsById = {};
  const panelOrder = [];
  const panelSizesById = {};
  const controlsByPanelId = {};
  const createdPanels = {};
  const seenIds = new Set();
  const seenKeys = new Set();
  const reserved = { ...dock.panelsById };
  document.panels.forEach((entry, index) => {
    const path = `$.panels[${index}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      issues.push(dockLayoutIssue("invalidType", path, "Panel entry must be an object."));
      return;
    }
    const existing = typeof entry.panelId === "string" ? dock.panelsById?.[entry.panelId] : null;
    const isNew = hasOwn(entry, "key") || hasOwn(entry, "moduleId");
    const allowed = new Set(
      existing
        ? ["panelId", "customTitle", "width", "controls"]
        : ["key", "moduleId", "customTitle", "width", "controls"]
    );
    for (const key of Object.keys(entry))
      if (!allowed.has(key))
        issues.push(
          dockLayoutIssue("unknownField", `${path}.${key}`, `Unknown panel field: ${key}.`)
        );
    if ((existing && isNew) || (!existing && !isNew)) {
      issues.push(
        dockLayoutIssue(
          existing ? "ambiguousTarget" : "dockPanelNotFound",
          path,
          "Panel target is invalid."
        )
      );
      return;
    }
    let panel;
    if (existing) {
      if (seenIds.has(existing.id)) {
        issues.push(dockLayoutIssue("duplicatePanel", `${path}.panelId`, "Panel is duplicated."));
        return;
      }
      seenIds.add(existing.id);
      panel = { ...existing };
    } else {
      if (typeof entry.key !== "string" || !entry.key.trim() || seenKeys.has(entry.key)) {
        issues.push(
          dockLayoutIssue("invalidKey", `${path}.key`, "key must be unique and non-empty.")
        );
        return;
      }
      seenKeys.add(entry.key);
      if (!DOCK_PANEL_MODULE_IDS.includes(entry.moduleId)) {
        issues.push(dockLayoutIssue("unknownModule", `${path}.moduleId`, "Unknown Dock module."));
        return;
      }
      const id = createDockPanelId(entry.moduleId, reserved);
      panel = { id, moduleId: entry.moduleId };
      reserved[id] = panel;
      createdPanels[entry.key] = id;
    }
    if (hasOwn(entry, "customTitle")) {
      if (
        entry.customTitle !== null &&
        (typeof entry.customTitle !== "string" || !entry.customTitle.trim())
      )
        issues.push(
          dockLayoutIssue(
            "invalidTitle",
            `${path}.customTitle`,
            "customTitle must be null or non-empty."
          )
        );
      else if (entry.customTitle === null) delete panel.customTitle;
      else panel.customTitle = entry.customTitle.trim();
    }
    if (hasOwn(entry, "width")) {
      // Any finite width in range, not just an integer: dragging the strip stores fractional CSS
      // pixels, so requiring integers here rejected the very document `dock.inspect` reports.
      if (
        !Number.isFinite(entry.width) ||
        entry.width < 1 ||
        entry.width > DOCK_MAX_PREFERRED_WIDTH
      )
        issues.push(
          dockLayoutIssue("outOfRange", `${path}.width`, "width is outside the module constraints.")
        );
      else panelSizesById[panel.id] = entry.width;
    }
    const baseControls = existing ? dock.controlsByPanelId?.[panel.id] : undefined;
    const controlsValid =
      !hasOwn(entry, "controls") ||
      (entry.controls !== null &&
        typeof entry.controls === "object" &&
        !Array.isArray(entry.controls));
    if (!controlsValid) {
      issues.push(
        dockLayoutIssue("invalidType", `${path}.controls`, "controls must be a plain object.")
      );
    }
    const staged = {
      ...dock,
      panelsById: { ...dock.panelsById, [panel.id]: panel },
      controlsByPanelId: { ...dock.controlsByPanelId, [panel.id]: baseControls },
    };
    const planned = controlsValid
      ? planDockPanelPatch(staged, panel.id, entry.controls ?? {}, context)
      : { dock: staged, issues: [] };
    for (const problem of planned.issues)
      issues.push({ ...problem, path: `${path}.controls${problem.path.slice(1)}` });
    for (const warning of planned.warnings ?? []) {
      warnings.push({
        ...warning,
        path: `${path}.controls.${warning.path.replace(/^controls\./, "")}`,
      });
    }
    panelsById[panel.id] = panel;
    panelOrder.push(panel.id);
    if (planned.issues.length === 0)
      controlsByPanelId[panel.id] = planned.dock.controlsByPanelId[panel.id];
  });
  if (issues.length > 0) return { dock, createdPanels: {}, changed: [], warnings: [], issues };
  const projected = { ...dock, panelsById, panelOrder, panelSizesById, controlsByPanelId };
  const changed =
    JSON.stringify({ panelsById, panelOrder, panelSizesById, controlsByPanelId }) ===
    JSON.stringify({
      panelsById: dock.panelsById,
      panelOrder: dock.panelOrder,
      panelSizesById: dock.panelSizesById,
      controlsByPanelId: dock.controlsByPanelId,
    })
      ? []
      : ["dock.panels"];
  return { dock: projected, createdPanels, changed, warnings, issues: [] };
}

export function readDockPanelControls(panel, raw, context) {
  const dockModuleId = dockControlModuleIdForPanel(panel);
  const normalized = normalizeDockModuleControls(dockModuleId, raw);
  const all = readPublicPanelControls(panel.moduleId, normalized, context);
  if (panel.moduleId === "levelMeter")
    return {
      ...all,
      readout:
        normalized.levelMeterMode === "peak"
          ? normalized.levelMeterTpMaxMarker
            ? "truePeakMax"
            : "live"
          : normalized.levelMeterPlaybackMax
            ? "playbackMax"
            : "live",
    };
  if (panel.moduleId === "loudness") return all;
  if (panel.moduleId === "spectrum") {
    return {
      channel: all.channel,
      view: all.view,
      maxMode: all.maxMode,
      grid: all.grid,
      peakLabels: all.peakLabels,
      speedPercent: all.speedPercent,
      tiltDbPerOctave: all.tiltDbPerOctave,
      octaveSmoothing: all.octaveSmoothing,
      levelRangeDb: all.levelRangeDb,
      linkFrequency: normalized.linkFrequencyViewport,
      frequencyRangeHz: { min: normalized.spectrumXMinFreq, max: normalized.spectrumXMaxFreq },
    };
  }
  if (panel.moduleId === "spectrogram") {
    return {
      ...all,
      linkFrequency: normalized.linkFrequencyViewport,
      frequencyRangeHz: {
        min: normalized.spectrogramYMinFreq,
        max: normalized.spectrogramYMaxFreq,
      },
    };
  }
  if (panel.moduleId === "stereo-map") {
    return {
      grid: all.grid,
      mode: all.mode,
      channelPair: all.channelPair,
      maxHold: all.maxHold,
      speedPercent: all.speedPercent,
      octaveSmoothing: all.octaveSmoothing,
      energyFadePercent: all.energyFadePercent,
      colorBlendPercent: all.colorBlendPercent,
      monoLossFloorDb: all.monoLossFloorDb,
      msRatioRangeDb: all.msRatioRangeDb,
      linkFrequency: normalized.linkFrequencyViewport,
      frequencyRangeHz: { min: normalized.stereoMapXMinFreq, max: normalized.stereoMapXMaxFreq },
    };
  }
  return all;
}
