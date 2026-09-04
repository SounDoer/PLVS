import { dockHeightMode, DOCK_MAX_HEIGHT, DOCK_MIN_HEIGHT } from "../dock/dockSizing.js";
import { DOCK_PANEL_MODULE_IDS } from "../dock/dockLayout.js";
import {
  normalizeDockModuleControls,
  dockControlModuleIdForPanel,
} from "../dock/dockModuleControls.js";
import { getDockPanelSizing } from "../dock/dockPanelSizing.js";
import { MODULE_CATALOG } from "../workspace/moduleCatalog.js";
import { readPublicPanelAnalysis } from "./panelAnalysis.js";
import { readPublicPanelControls } from "./panelControls.js";

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
      ...all,
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
      return {
        moduleId,
        title: MODULE_CATALOG[moduleId]?.title || "Transport",
        width: {
          min: sizing.minWidth,
          default: sizing.defaultWidth,
          maxPreferred: sizing.maxPreferredWidth,
          growth: sizing.growthPolicy,
        },
      };
    }),
    layoutSchema: {
      type: "object",
      required: ["panels"],
      additionalProperties: false,
    },
  };
}
