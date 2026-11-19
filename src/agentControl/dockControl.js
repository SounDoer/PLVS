import { readLocalRange } from "../workspace/axisViewports.js";
import { readPersistedInterfaceSize } from "../preferences/interfaceSize.js";
import { DOCK_DEFAULT_HEIGHT, DOCK_MAX_HEIGHT, DOCK_MIN_HEIGHT } from "../dock/dockSizing.js";
import { firstRunDockState } from "../dock/firstRunDock.js";
import { DOCK_PANEL_MODULE_IDS } from "../dock/dockLayout.js";
import {
  DEFAULT_DOCK_CONTROLS_BY_MODULE_ID,
  normalizeDockModuleControls,
  dockControlModuleIdForPanel,
} from "../dock/dockModuleControls.js";
import { getDockPanelSizing } from "../dock/dockPanelSizing.js";
import { settingsStore } from "../persistence/index.js";
import { normalizePanelPresentation } from "../lib/panelPresentation.js";
import { MODULE_CATALOG } from "../workspace/moduleCatalog.js";
import { readPublicPanelAnalysis } from "./panelAnalysis.js";
import { buildPublicPanelControlSchema } from "./panelControlSchema.js";
import { dockLayoutIssue as issue, readDockPanelControls } from "../dock/dockLayoutDocument.js";

function panelSizing(dock, panel, context) {
  return getDockPanelSizing(
    panel.moduleId,
    readPersistedInterfaceSize(),
    !normalizePanelPresentation(settingsStore.read().panelPresentation).dock.hideAxesAndLabels,
    {
      controls: dock.controlsByPanelId?.[panel.id],
      channelCount: context.channelCount,
      height: dock.height,
    }
  );
}
/**
 * The Dock modules editor's Reset Layout: the first-run modules, order, widths and controls, and
 * the default height when the strip is showing. Edge, monitor and space reservation are kept.
 * Outside Dock there is no strip to resize, so the saved height is kept, as it would be by the
 * button's own height step.
 */
export function planDockLayoutReset(dock) {
  const { layout, controlsByPanelId } = firstRunDockState();
  const panels = {
    panelsById: layout.panelsById,
    panelOrder: layout.panelOrder,
    panelSizesById: layout.panelSizesById,
    controlsByPanelId,
  };
  const height = dock.enabled === true ? DOCK_DEFAULT_HEIGHT : dock.height;
  const changed = [
    ...(JSON.stringify(panels) ===
    JSON.stringify({
      panelsById: dock.panelsById,
      panelOrder: dock.panelOrder,
      panelSizesById: dock.panelSizesById,
      controlsByPanelId: dock.controlsByPanelId,
    })
      ? []
      : ["dock.panels"]),
    ...(height === dock.height ? [] : ["dock.height"]),
  ];
  return { dock: { ...dock, ...panels, height }, changed, warnings: [], issues: [] };
}

function dockControlSchema(panel, raw, context, includeCurrent = false) {
  const dockModuleId = dockControlModuleIdForPanel(panel);
  const normalized = normalizeDockModuleControls(dockModuleId, raw);
  const current = readDockPanelControls(panel, normalized, context);
  const defaultControls = readDockPanelControls(
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
    linkFrequency: {
      type: "boolean",
      title: "Link Frequency",
      description: "Use the shared Workspace frequency viewport.",
      default: true,
      effective: true,
    },
    frequencyRangeHz: {
      type: "object",
      title: "Frequency Range",
      description: "Stored local frequency range; dormant while Link Frequency is enabled.",
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
    aboveFullScreen: dock.aboveFullScreen !== false,
    height: dock.height,
    suspended: dock.suspended === true,
    panels: (dock.panelOrder ?? []).flatMap((panelId) => {
      const panel = dock.panelsById?.[panelId];
      if (!panel) return [];
      const sizing = panelSizing(dock, panel, context);
      const customTitle = panel.customTitle ?? null;
      const controls = normalizeDockModuleControls(
        dockControlModuleIdForPanel(panel),
        dock.controlsByPanelId?.[panel.id]
      );
      const localFrequency = readLocalRange("frequency", panel.moduleId, controls);
      const frequencyAxis = localFrequency
        ? {
            linked: controls.linkFrequencyViewport,
            range: controls.linkFrequencyViewport
              ? (context.sharedFrequencyViewport ?? localFrequency)
              : localFrequency,
          }
        : null;
      return [
        {
          id: panel.id,
          moduleId: panel.moduleId,
          title: customTitle || MODULE_CATALOG[panel.moduleId]?.title || "Transport",
          customTitle,
          width: dock.panelSizesById?.[panel.id] ?? sizing.defaultWidth,
          widthMode: dock.panelSizesById?.[panel.id] == null ? "automatic" : "preferred",
          controls: readDockPanelControls(panel, dock.controlsByPanelId?.[panel.id], context),
          ...(frequencyAxis ? { axes: { frequency: frequencyAxis } } : {}),
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
      writable: dock.supported === true && ["windows", "macos", "linux"].includes(context.platform),
      reason:
        dock.supported === true && ["windows", "macos", "linux"].includes(context.platform)
          ? null
          : "platformUnsupported",
    },
    aboveFullScreen: {
      writable: dock.supported === true && ["windows", "macos"].includes(context.platform),
      reason: ["windows", "macos"].includes(context.platform) ? null : "platformUnsupported",
    },
    height: { type: "integer", min: DOCK_MIN_HEIGHT, max: DOCK_MAX_HEIGHT, unit: "cssPx" },
    edges: ["top", "bottom"],
    monitors: Array.isArray(context.monitors) ? context.monitors : [],
    modules: DOCK_PANEL_MODULE_IDS.map((moduleId) => {
      const panel = { id: moduleId, moduleId };
      const sizing = panelSizing({ ...dock, controlsByPanelId: {} }, panel, context);
      const defaults = DEFAULT_DOCK_CONTROLS_BY_MODULE_ID[dockControlModuleIdForPanel(panel)];
      return {
        moduleId,
        title: MODULE_CATALOG[moduleId]?.title || "Transport",
        width: {
          min: sizing.minWidth,
          preferredMin: 1,
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

/**
 * @param {string} method
 */
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
  const entryBlockers = context.readDockEntryBlockingEditors?.() ?? context.activeEditors ?? [];
  if (entryBlockers.length > 0)
    return {
      dock,
      changed: [],
      warnings: [],
      effects: [],
      issues: [],
      refusal: { code: "editorActive", editors: entryBlockers },
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
  if (
    params.reserveSpace !== undefined &&
    !["windows", "macos", "linux"].includes(context.platform)
  )
    return {
      dock,
      changed: [],
      warnings: [],
      effects: [],
      refusal: null,
      issues: [
        issue(
          "controlUnavailable",
          "$.reserveSpace",
          "reserveSpace requires a supported Dock window backend."
        ),
      ],
    };
  if (params.aboveFullScreen !== undefined && !["windows", "macos"].includes(context.platform))
    return {
      dock,
      changed: [],
      warnings: [],
      effects: [],
      refusal: null,
      issues: [
        issue(
          "controlUnavailable",
          "$.aboveFullScreen",
          "aboveFullScreen is available only on Windows and macOS."
        ),
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
    aboveFullScreen: params.aboveFullScreen ?? dock.aboveFullScreen !== false,
    height: params.height ?? dock.height,
    suspended: false,
  };
  // A record that predates aboveFullScreen reads as on, so it is not a change.
  const current = { ...dock, aboveFullScreen: dock.aboveFullScreen !== false };
  const changed = ["enabled", "edge", "monitor", "reserveSpace", "aboveFullScreen", "height"]
    .filter((key) => projected[key] !== current[key])
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

/**
 * Reconcile the native Dock form with the requested projection.
 *
 * Windows permits one reservation per monitor edge; macOS permits one avoidance owner per display.
 * Native Dock entry therefore
 * resolves a losing contender to an overlay instead of failing the whole transition. Agent Control
 * must observe that effective state and report the downgrade rather than waiting for the impossible
 * requested state until `commitNotObserved`.
 */
export function reconcileDockExecution(planned, effectiveDock) {
  if (!effectiveDock || typeof effectiveDock !== "object") return planned;
  const warnings = [...planned.warnings];
  if (planned.dock.height !== effectiveDock.height) {
    warnings.push({
      code: "dockHeightFitted",
      requested: planned.dock.height,
      effective: effectiveDock.height,
    });
  }
  if (planned.dock.reserveSpace === true && effectiveDock.reserveSpace === false) {
    warnings.push({
      code: "dockReservationConflict",
      requested: true,
      effective: false,
    });
  }
  return { ...planned, dock: effectiveDock, warnings };
}

/**
 * @param {string} panelId
 */
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
  const sizing = panelSizing(dock, panel, context);
  return {
    panel,
    width: {
      min: sizing.minWidth,
      preferredMin: 1,
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
