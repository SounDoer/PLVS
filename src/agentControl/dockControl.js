import { dockHeightMode, DOCK_MAX_HEIGHT, DOCK_MIN_HEIGHT } from "../dock/dockSizing.js";
import { createDockPanelId, DOCK_PANEL_MODULE_IDS } from "../dock/dockLayout.js";
import {
  DEFAULT_DOCK_CONTROLS_BY_MODULE_ID,
  normalizeDockModuleControls,
  dockControlModuleIdForPanel,
} from "../dock/dockModuleControls.js";
import { getDockPanelSizing } from "../dock/dockPanelSizing.js";
import { MODULE_CATALOG } from "../workspace/moduleCatalog.js";
import { readPublicPanelAnalysis } from "./panelAnalysis.js";
import { buildPublicPanelControlSchema } from "./panelControlSchema.js";
import { readPublicPanelControls } from "./panelControls.js";
import { planPublicPanelControlPatch } from "./panelControlPatch.js";

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const PUBLIC_DOCK_CONTROLS = Object.freeze({
  levelMeter: new Set(["mode", "readout", "showLabels"]),
  loudness: new Set(["layers", "loudnessRangeLufs", "showReadouts"]),
  stats: new Set(["metrics"]),
  vectorscope: new Set(["channelPair", "mode", "maxHold"]),
  spectrum: new Set([
    "channel",
    "view",
    "maxMode",
    "speedPercent",
    "tiltDbPerOctave",
    "octaveSmoothing",
    "levelRangeDb",
    "frequencyRangeHz",
  ]),
  spectrogram: new Set(["channel", "tiltDbPerOctave", "dbFloor", "frequencyRangeHz"]),
  waveform: new Set(["frequencyColor", "frequencyBandsHz", "centroid"]),
  "stereo-map": new Set([
    "mode",
    "channelPair",
    "maxHold",
    "speedPercent",
    "octaveSmoothing",
    "monoLossFloorDb",
    "msRatioRangeDb",
    "frequencyRangeHz",
  ]),
});

function issue(code, path, message) {
  return { code, path, message };
}

function dockWithControls(dock, panelId, controls) {
  return {
    ...dock,
    controlsByPanelId: { ...dock.controlsByPanelId, [panelId]: controls },
  };
}

export function planDockPanelPatch(dock, panelId, patch, context = {}) {
  const panel = dock.panelsById?.[panelId];
  if (!panel)
    return {
      dock,
      changed: [],
      warnings: [],
      issues: [issue("dockPanelNotFound", "$.panelId", "Dock panel was not found.")],
    };
  const allowed = PUBLIC_DOCK_CONTROLS[panel.moduleId];
  if (!allowed)
    return {
      dock,
      changed: [],
      warnings: [],
      issues: [issue("controlsUnavailable", "$.panelId", "This Dock panel has no controls.")],
    };
  const issues = Object.keys(patch)
    .filter((key) => !allowed.has(key))
    .map((key) => issue("unknownControl", `$.${key}`, `Unknown Dock control: ${key}.`));
  if (issues.length > 0) return { dock, changed: [], warnings: [], issues };

  const dockModuleId = dockControlModuleIdForPanel(panel);
  const current = normalizeDockModuleControls(dockModuleId, dock.controlsByPanelId?.[panelId]);
  const corePatch = { ...patch };
  delete corePatch.readout;
  delete corePatch.showLabels;
  delete corePatch.showReadouts;
  delete corePatch.frequencyRangeHz;
  const planned = planPublicPanelControlPatch(panel.moduleId, current, corePatch, context);
  if (planned.issues.length > 0) return { dock, changed: [], warnings: [], issues: planned.issues };
  const next = normalizeDockModuleControls(dockModuleId, planned.panelControls);
  const extraIssues = [];
  if (hasOwn(patch, "showLabels") && typeof patch.showLabels !== "boolean")
    extraIssues.push(issue("invalidType", "$.showLabels", "showLabels must be a boolean."));
  if (hasOwn(patch, "showReadouts") && typeof patch.showReadouts !== "boolean")
    extraIssues.push(issue("invalidType", "$.showReadouts", "showReadouts must be a boolean."));
  if (hasOwn(patch, "readout")) {
    if (!["live", "truePeakMax", "playbackMax"].includes(patch.readout))
      extraIssues.push(issue("invalidEnum", "$.readout", "readout is invalid."));
  }
  if (hasOwn(patch, "readout") || hasOwn(patch, "mode")) {
    const mode = planned.panelControls.levelMeterMode;
    const readout = hasOwn(patch, "readout") ? patch.readout : current.readout;
    if (
      (mode === "peak" && readout === "playbackMax") ||
      (mode !== "peak" && readout === "truePeakMax")
    )
      extraIssues.push(
        issue("incompatibleControl", "$.readout", "readout is incompatible with mode.")
      );
  }
  if (hasOwn(patch, "frequencyRangeHz")) {
    const range = patch.frequencyRangeHz;
    if (range && typeof range === "object" && !Array.isArray(range)) {
      for (const key of Object.keys(range)) {
        if (!new Set(["min", "max"]).has(key)) {
          extraIssues.push(
            issue("unknownControl", `$.frequencyRangeHz.${key}`, `Unknown range field: ${key}.`)
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
        issue("outOfRange", "$.frequencyRangeHz", "frequencyRangeHz must be within 20..20000.")
      );
  }
  if (extraIssues.length > 0) return { dock, changed: [], warnings: [], issues: extraIssues };
  if (hasOwn(patch, "readout")) next.readout = patch.readout;
  if (hasOwn(patch, "showLabels")) next.showLabels = patch.showLabels;
  if (hasOwn(patch, "showReadouts")) next.showReadouts = patch.showReadouts;
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
  const before = publicControls(panel, current, context);
  const after = publicControls(panel, next, context);
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

export function planDockPanelReset(dock, panelId, context = {}) {
  const panel = dock.panelsById?.[panelId];
  if (!panel)
    return {
      dock,
      changed: [],
      warnings: [],
      issues: [issue("dockPanelNotFound", "$.panelId", "Dock panel was not found.")],
    };
  const moduleId = dockControlModuleIdForPanel(panel);
  const defaults = DEFAULT_DOCK_CONTROLS_BY_MODULE_ID[moduleId];
  if (!defaults)
    return {
      dock,
      changed: [],
      warnings: [],
      issues: [issue("controlsUnavailable", "$.panelId", "This Dock panel has no controls.")],
    };
  const currentPublic = publicControls(panel, dock.controlsByPanelId?.[panelId], context);
  const defaultPublic = publicControls(panel, defaults, context);
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
      issues: [issue("invalidType", "$.panels", "panels must be an array.")],
    };
  for (const key of Object.keys(document))
    if (key !== "panels")
      issues.push(issue("unknownField", `$.${key}`, `Unknown layout field: ${key}.`));
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
      issues.push(issue("invalidType", path, "Panel entry must be an object."));
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
        issues.push(issue("unknownField", `${path}.${key}`, `Unknown panel field: ${key}.`));
    if ((existing && isNew) || (!existing && !isNew)) {
      issues.push(
        issue(existing ? "ambiguousTarget" : "dockPanelNotFound", path, "Panel target is invalid.")
      );
      return;
    }
    let panel;
    if (existing) {
      if (seenIds.has(existing.id)) {
        issues.push(issue("duplicatePanel", `${path}.panelId`, "Panel is duplicated."));
        return;
      }
      seenIds.add(existing.id);
      panel = { ...existing };
    } else {
      if (typeof entry.key !== "string" || !entry.key.trim() || seenKeys.has(entry.key)) {
        issues.push(issue("invalidKey", `${path}.key`, "key must be unique and non-empty."));
        return;
      }
      seenKeys.add(entry.key);
      if (!DOCK_PANEL_MODULE_IDS.includes(entry.moduleId)) {
        issues.push(issue("unknownModule", `${path}.moduleId`, "Unknown Dock module."));
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
          issue("invalidTitle", `${path}.customTitle`, "customTitle must be null or non-empty.")
        );
      else if (entry.customTitle === null) delete panel.customTitle;
      else panel.customTitle = entry.customTitle.trim();
    }
    const sizing = getDockPanelSizing(panel.moduleId);
    if (hasOwn(entry, "width")) {
      if (
        !Number.isInteger(entry.width) ||
        entry.width < sizing.minWidth ||
        entry.width > sizing.maxPreferredWidth
      )
        issues.push(
          issue("outOfRange", `${path}.width`, "width is outside the module constraints.")
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
      issues.push(issue("invalidType", `${path}.controls`, "controls must be a plain object."));
    }
    const staged = {
      ...dock,
      panelsById: { ...dock.panelsById, [panel.id]: panel },
      controlsByPanelId: { ...dock.controlsByPanelId, [panel.id]: baseControls },
    };
    const emptyControlLessPanel =
      panel.moduleId === "transport" && Object.keys(entry.controls ?? {}).length === 0;
    const planned = emptyControlLessPanel
      ? { dock: staged, issues: [], warnings: [] }
      : controlsValid
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
    if (planned.issues.length === 0 && panel.moduleId !== "transport")
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

function publicControls(panel, raw, context) {
  if (panel.moduleId === "transport") return {};
  const dockModuleId = dockControlModuleIdForPanel(panel);
  const normalized = normalizeDockModuleControls(dockModuleId, raw);
  const all = readPublicPanelControls(panel.moduleId, normalized, context);
  if (panel.moduleId === "levelMeter") {
    return { mode: all.mode, readout: normalized.readout, showLabels: normalized.showLabels };
  }
  if (panel.moduleId === "loudness") return { ...all, showReadouts: normalized.showReadouts };
  if (panel.moduleId === "spectrum") {
    return {
      channel: all.channel,
      view: all.view,
      maxMode: all.maxMode,
      speedPercent: all.speedPercent,
      tiltDbPerOctave: all.tiltDbPerOctave,
      octaveSmoothing: all.octaveSmoothing,
      levelRangeDb: all.levelRangeDb,
      frequencyRangeHz: { min: normalized.spectrumXMinFreq, max: normalized.spectrumXMaxFreq },
    };
  }
  if (panel.moduleId === "spectrogram") {
    return {
      channel: all.channel,
      tiltDbPerOctave: all.tiltDbPerOctave,
      dbFloor: all.dbFloor,
      frequencyRangeHz: {
        min: normalized.spectrogramYMinFreq,
        max: normalized.spectrogramYMaxFreq,
      },
    };
  }
  if (panel.moduleId === "stereo-map") {
    return {
      ...all,
      frequencyRangeHz: { min: normalized.stereoMapXMinFreq, max: normalized.stereoMapXMaxFreq },
    };
  }
  return all;
}

function dockControlSchema(panel, raw, context, includeCurrent = false) {
  if (panel.moduleId === "transport") return {};
  const dockModuleId = dockControlModuleIdForPanel(panel);
  const normalized = normalizeDockModuleControls(dockModuleId, raw);
  const current = publicControls(panel, normalized, context);
  const defaultControls = publicControls(
    panel,
    DEFAULT_DOCK_CONTROLS_BY_MODULE_ID[dockModuleId],
    context
  );
  const base = buildPublicPanelControlSchema(panel.moduleId, normalized, context).properties;
  const extras = {
    readout: {
      type: "string",
      title: "Readout",
      description: "Value shown beside the meter.",
      default: defaultControls.readout,
      options:
        normalized.levelMeterMode === "peak" ? ["live", "truePeakMax"] : ["live", "playbackMax"],
      effective: true,
    },
    showLabels: {
      type: "boolean",
      title: "Show Labels",
      description: "Show meter scale labels.",
      default: defaultControls.showLabels,
      effective: true,
    },
    showReadouts: {
      type: "boolean",
      title: "Show Readouts",
      description: "Show loudness value readouts.",
      default: defaultControls.showReadouts,
      effective: true,
    },
    frequencyRangeHz: {
      type: "object",
      title: "Frequency Range",
      description: "Stored frequency minimum and maximum.",
      unit: "Hz",
      default: defaultControls.frequencyRangeHz,
      patchMode: "replace",
      required: ["min", "max"],
      properties: {
        min: { type: "number", title: "Minimum", minimum: 20, maximum: 20000 },
        max: { type: "number", title: "Maximum", minimum: 20, maximum: 20000 },
      },
      constraints: [{ kind: "ordered", lower: "min", upper: "max" }],
      effective: true,
    },
  };
  return Object.fromEntries(
    Object.keys(current).map((key) => [
      key,
      {
        ...(base[key] ?? extras[key]),
        ...(includeCurrent ? { current: current[key] } : {}),
      },
    ])
  );
}

function panelAnalysis(dock, panel, context) {
  if (panel.moduleId === "transport") return { status: "notApplicable" };
  const workspace = {
    panelsById: { [panel.id]: panel },
    panelControlsById: { [panel.id]: dock.controlsByPanelId?.[panel.id] },
  };
  const analysis = readPublicPanelAnalysis(workspace, panel.id, context);
  return Object.keys(analysis).length > 0 ? analysis : { status: "active" };
}

export function buildDockSnapshot(dock, context = {}) {
  return {
    supported: dock.supported === true,
    enabled: dock.enabled === true,
    edge: dock.edge === "top" ? "top" : "bottom",
    monitor: typeof dock.monitor === "string" ? dock.monitor : null,
    reserveSpace: dock.reserveSpace === true,
    height: dock.height,
    heightMode: dockHeightMode(dock.height),
    suspended: dock.suspended === true,
    panels: (dock.panelOrder ?? []).flatMap((panelId) => {
      const panel = dock.panelsById?.[panelId];
      if (!panel) return [];
      const sizing = getDockPanelSizing(panel.moduleId);
      const customTitle = panel.customTitle ?? null;
      return [
        {
          id: panel.id,
          moduleId: panel.moduleId,
          title: customTitle || MODULE_CATALOG[panel.moduleId]?.title || "Transport",
          customTitle,
          width: dock.panelSizesById?.[panel.id] ?? sizing.defaultWidth,
          controls: publicControls(panel, dock.controlsByPanelId?.[panel.id], context),
          analysis: panelAnalysis(dock, panel, context),
        },
      ];
    }),
  };
}

export function buildDockDescription(dock, context = {}) {
  return {
    supported: dock.supported === true,
    reserveSpace: {
      writable: dock.supported === true && context.platform === "windows",
      reason: context.platform === "windows" ? null : "platformUnsupported",
    },
    height: { type: "integer", min: DOCK_MIN_HEIGHT, max: DOCK_MAX_HEIGHT, unit: "cssPx" },
    edges: ["top", "bottom"],
    monitors: Array.isArray(context.monitors) ? context.monitors : [],
    modules: DOCK_PANEL_MODULE_IDS.map((moduleId) => {
      const sizing = getDockPanelSizing(moduleId);
      const panel = { id: moduleId, moduleId };
      const defaults = DEFAULT_DOCK_CONTROLS_BY_MODULE_ID[dockControlModuleIdForPanel(panel)];
      return {
        moduleId,
        title: MODULE_CATALOG[moduleId]?.title || "Transport",
        width: {
          min: sizing.minWidth,
          default: sizing.defaultWidth,
          maxPreferred: sizing.maxPreferredWidth,
          growth: sizing.growthPolicy,
        },
        controls: dockControlSchema(panel, defaults, context),
      };
    }),
    layoutSchema: {
      type: "object",
      required: ["panels"],
      additionalProperties: false,
    },
  };
}

export function dockStateSignature(dock) {
  if (!dock) return "null";
  const { suspended: _suspended, ...scene } = dock;
  return JSON.stringify(scene);
}

export function planDockFormMutation(dock, method, params = {}, context = {}) {
  if (dock.supported !== true) {
    return {
      dock,
      changed: [],
      warnings: [],
      effects: [],
      issues: [],
      refusal: { code: "controlUnavailable" },
    };
  }
  if (method === "dock.exit") {
    return {
      dock: dock.enabled ? { ...dock, enabled: false, suspended: false } : dock,
      changed: dock.enabled ? ["dock.enabled"] : [],
      warnings: [],
      effects: dock.enabled ? ["restoreWindowForm"] : [],
      issues: [],
      refusal: null,
    };
  }
  if (context.sourceMode === "file")
    return {
      dock,
      changed: [],
      warnings: [],
      effects: [],
      issues: [],
      refusal: { code: "fileModeActive" },
    };
  if ((context.activeEditors ?? []).length > 0)
    return {
      dock,
      changed: [],
      warnings: [],
      effects: [],
      issues: [],
      refusal: { code: "editorActive", editors: context.activeEditors },
    };
  if (context.transitioning === true)
    return {
      dock,
      changed: [],
      warnings: [],
      effects: [],
      issues: [],
      refusal: { code: "transitionInProgress" },
    };
  if (params.reserveSpace !== undefined && context.platform !== "windows")
    return {
      dock,
      changed: [],
      warnings: [],
      effects: [],
      refusal: null,
      issues: [
        issue("controlUnavailable", "$.reserveSpace", "reserveSpace is available only on Windows."),
      ],
    };
  if (
    params.monitor !== undefined &&
    Array.isArray(context.monitors) &&
    (context.monitors.length > 0 || context.monitorInventoryReady === true) &&
    !context.monitors.some(({ id }) => id === params.monitor)
  )
    return {
      dock,
      changed: [],
      warnings: [],
      effects: [],
      refusal: null,
      issues: [issue("monitorNotFound", "$.monitor", "Monitor was not found.")],
    };
  const monitors = Array.isArray(context.monitors) ? context.monitors : [];
  const savedMonitorAvailable =
    typeof dock.monitor === "string" && monitors.some(({ id }) => id === dock.monitor);
  const fallbackMonitor =
    monitors.find(({ id }) => id === context.fallbackMonitor)?.id ?? monitors[0]?.id ?? null;
  const monitor =
    params.monitor ??
    (monitors.length > 0 && !savedMonitorAvailable ? fallbackMonitor : dock.monitor);
  const warnings =
    params.monitor === undefined &&
    typeof dock.monitor === "string" &&
    monitors.length > 0 &&
    !savedMonitorAvailable
      ? [{ code: "monitorFallback", requested: dock.monitor, effective: monitor }]
      : [];
  const projected = {
    ...dock,
    enabled: true,
    edge: params.edge ?? dock.edge,
    monitor,
    reserveSpace: params.reserveSpace ?? dock.reserveSpace,
    height: params.height ?? dock.height,
    suspended: false,
  };
  const changed = ["enabled", "edge", "monitor", "reserveSpace", "height"]
    .filter((key) => projected[key] !== dock[key])
    .map((key) => `dock.${key}`);
  return {
    dock: projected,
    changed,
    warnings,
    effects: changed.length ? ["applyDockWindowForm"] : [],
    issues: [],
    refusal: null,
  };
}

export function buildDockPanelDescription(dock, panelId, context = {}) {
  const snapshot = buildDockSnapshot(dock, context);
  const panel = snapshot.panels.find(({ id }) => id === panelId);
  if (!panel)
    return { issue: issue("dockPanelNotFound", "$.panelId", "Dock panel was not found.") };
  if (Object.keys(panel.controls).length === 0) {
    return {
      issue: issue("controlsUnavailable", "$.panelId", "This Dock panel has no controls."),
    };
  }
  const sizing = getDockPanelSizing(panel.moduleId);
  return {
    panel,
    width: {
      min: sizing.minWidth,
      default: sizing.defaultWidth,
      maxPreferred: sizing.maxPreferredWidth,
      growth: sizing.growthPolicy,
    },
    schema: dockControlSchema(
      dock.panelsById[panelId],
      dock.controlsByPanelId?.[panelId],
      context,
      true
    ),
  };
}
