import { buildSpectrumChannelOptions } from "../math/spectrumChannelOptions.js";
import { resolveEffectiveChannelControls } from "../analysis/effectiveChannels.js";
import { sameValue } from "../lib/presetDivergence.js";

const CHANNEL_CONTROL_KEYS = ["spectrumChannel", "vectorscopePair", "stereoMapPair"];

/**
 * @param {string} code
 * @param {string} path
 * @param {string} message
 */
function issue(code, path, message) {
  return { code, path, message };
}

function snapshotOf(preset) {
  const { id: _id, name: _name, ...snapshot } = preset;
  return snapshot;
}

/** @type {[string, string[]][]} */
const SNAPSHOT_GROUPS = [
  [
    "workspace",
    ["tree", "panelsById", "panelOrder", "panelControlsById", "pinnedPanelsById", "axisViewports"],
  ],
  [
    "window",
    [
      "windowBounds",
      "windowPinned",
      "focusView",
      "panelPresentation",
      "surfaceOpacity",
      "glassEnabled",
    ],
  ],
  ["dock", ["dock"]],
  ["loudnessProfile", ["loudnessProfileActive"]],
];

/**
 * @param {string} selection
 */
function savedProfileId(selection) {
  return typeof selection === "string" && selection.startsWith("profile:")
    ? selection.slice("profile:".length)
    : null;
}

function physicalBounds(bounds) {
  if (!bounds) return undefined;
  const { x, y, width, height, isMaximized } = bounds;
  return { x, y, width, height, isMaximized: isMaximized === true };
}

export function presetFailureChanges(before, after, beforePreset, afterPreset) {
  const beforeBounds = physicalBounds(before.windowBounds);
  const afterBounds = physicalBounds(after.windowBounds);
  const changed = SNAPSHOT_GROUPS.filter(([, keys]) =>
    keys.some((key) =>
      key === "windowBounds"
        ? beforeBounds && afterBounds && !sameValue(beforeBounds, afterBounds)
        : !sameValue(before[key], after[key])
    )
  ).map(([path]) => path);
  if (beforePreset.activeId !== afterPreset.activeId) changed.push("presets.activeId");
  if (beforePreset.dirty !== afterPreset.dirty) changed.push("presets.dirty");
  return changed;
}

export function planPresetApplyResources(preset, context = {}) {
  const warnings = [];
  const issues = [];
  const effectivePreset = structuredClone(preset);
  const profileId = savedProfileId(preset.loudnessProfileActive);
  if (profileId !== null && !(context.loudnessProfiles ?? []).some(({ id }) => id === profileId)) {
    warnings.push({
      code: "loudnessProfileUnavailable",
      path: "$.loudnessProfileActive",
      requested: profileId,
      effective: null,
    });
    effectivePreset.loudnessProfileActive = "off";
  }

  if (preset.dock?.enabled === true) {
    if (context.dockSupported !== true) {
      warnings.push({
        code: "dockUnsupported",
        path: "$.dock.enabled",
        requested: true,
        effective: false,
      });
      effectivePreset.dock = { ...effectivePreset.dock, enabled: false };
    } else {
      const monitors = Array.isArray(context.monitors) ? context.monitors : [];
      const requested = typeof preset.dock.monitor === "string" ? preset.dock.monitor : null;
      const requestedAvailable = requested !== null && monitors.some(({ id }) => id === requested);
      if (requested !== null && !requestedAvailable && monitors.length > 0) {
        const effective =
          monitors.find(({ id }) => id === context.fallbackMonitor)?.id ?? monitors[0].id;
        warnings.push({
          code: "dockMonitorUnavailable",
          path: "$.dock.monitor",
          requested,
          effective,
        });
        effectivePreset.dock.monitor = effective;
      } else if (
        requested !== null &&
        !requestedAvailable &&
        context.monitorInventoryReady === true
      ) {
        issues.push(
          issue("monitorUnavailable", "$.dock.monitor", "No monitor is available for Dock.")
        );
      }
      if (preset.dock.reserveSpace === true && context.reserveSpaceSupported === false) {
        warnings.push({
          code: "dockReserveSpaceUnsupported",
          path: "$.dock.reserveSpace",
          requested: true,
          effective: false,
        });
        effectivePreset.dock.reserveSpace = false;
      }
      const preferredWidth = Object.values(preset.dock.panelSizesById ?? {}).reduce(
        (sum, width) => sum + (Number.isFinite(width) ? width : 0),
        0
      );
      if (
        Number.isFinite(context.availableDockWidthCssPx) &&
        preferredWidth > context.availableDockWidthCssPx
      ) {
        warnings.push({
          code: "dockPreferredWidthConstrained",
          path: "$.dock.panelSizesById",
          requested: preferredWidth,
          effective: context.availableDockWidthCssPx,
        });
      }
    }
  }
  if (!effectivePreset.dock?.enabled && preset.windowBounds && context.resolvedWindowBounds) {
    const requested = physicalBounds(preset.windowBounds);
    const effective = physicalBounds(context.resolvedWindowBounds);
    if (!sameValue(effective, requested)) {
      warnings.push({
        code: "windowBoundsAdjusted",
        path: "$.windowBounds",
        requested,
        effective,
      });
    }
  }

  if (preset.glassEnabled === true && context.glassSupported === false) {
    warnings.push({
      code: "glassUnsupported",
      path: "$.glassEnabled",
      requested: true,
      effective: false,
    });
    effectivePreset.glassEnabled = false;
  }

  if (Number.isInteger(context.channelCount) && context.channelCount > 0) {
    // Channel selections are applied as saved: a narrower topology only changes what the panel
    // analyses (`resolveEffectiveChannelControls`), so the request returns with a wider source.
    const topology = {
      channelCount: context.channelCount,
      spectrumChannelOptions: buildSpectrumChannelOptions(
        context.channelCount,
        context.channelLabels ?? []
      ),
      peakLabelContext: context.peakLabelContext ?? {},
    };
    const containers = [
      {
        panelOrder: effectivePreset.panelOrder ?? [],
        panelsById: effectivePreset.panelsById ?? {},
        controlsById: effectivePreset.panelControlsById ?? {},
        path: "$.panelControlsById",
      },
      {
        panelOrder: effectivePreset.dock?.panelOrder ?? [],
        panelsById: effectivePreset.dock?.panelsById ?? {},
        controlsById: effectivePreset.dock?.controlsByPanelId ?? {},
        path: "$.dock.controlsByPanelId",
      },
    ];
    for (const container of containers) {
      for (const panelId of container.panelOrder) {
        const moduleId = container.panelsById[panelId]?.moduleId;
        const requestedControls = container.controlsById[panelId];
        if (!moduleId || !requestedControls) continue;
        const { controls, unavailable } = resolveEffectiveChannelControls(
          moduleId,
          requestedControls,
          topology
        );
        if (!unavailable) continue;
        const controlKey = CHANNEL_CONTROL_KEYS.find(
          (key) => controls[key] !== requestedControls[key]
        );
        warnings.push({
          code: "channelSelectionAdapted",
          path: `${container.path}.${panelId}.${controlKey}`,
          requested: requestedControls[controlKey],
          effective: controls[controlKey],
        });
      }
    }
  }

  return { preset: effectivePreset, issues, warnings };
}

/**
 * @param {string} name
 */
export function planPresetSave(presets, name, snapshot, allocatedId = null) {
  if (typeof name !== "string" || name.trim() === "") {
    return {
      presets,
      changed: [],
      warnings: [],
      issues: [issue("invalidName", "$.name", "Preset name must contain non-whitespace text.")],
    };
  }
  const trimmed = name.trim();
  const changed = [
    "presets.library",
    "presets.activeId",
    ...(presets.dirty === true ? ["presets.dirty"] : []),
  ];
  if (allocatedId === null) {
    return {
      presets,
      changed,
      warnings: [],
      issues: [],
      preset: { id: null, name: trimmed },
      presetState: { activeId: null, dirty: false },
    };
  }
  const preset = { id: allocatedId, name: trimmed, ...snapshot };
  return {
    presets: {
      list: [...presets.list, preset],
      activeId: allocatedId,
      dirty: false,
    },
    changed,
    warnings: [],
    issues: [],
    preset: { id: allocatedId, name: trimmed },
    presetState: { activeId: allocatedId, dirty: false },
  };
}

/**
 * @param {string} presetId
 */
export function planPresetUpdate(presets, presetId, snapshot) {
  const existing = presets.list.find(({ id }) => id === presetId);
  if (!existing) {
    return {
      presets,
      changed: [],
      warnings: [],
      issues: [issue("presetNotFound", "$.presetId", `Preset ${presetId} was not found.`)],
    };
  }
  const snapshotChanged = !sameValue(snapshotOf(existing), snapshot);
  const changed = [
    ...(snapshotChanged ? [`presets.${presetId}.snapshot`] : []),
    ...(presets.activeId !== presetId ? ["presets.activeId"] : []),
    ...(presets.dirty === true ? ["presets.dirty"] : []),
  ];
  if (changed.length === 0) {
    return {
      presets,
      changed,
      warnings: [],
      issues: [],
      preset: { id: existing.id, name: existing.name },
      presetState: { activeId: presetId, dirty: false },
    };
  }
  const updated = { id: existing.id, name: existing.name, ...snapshot };
  return {
    presets: {
      list: presets.list.map((preset) => (preset.id === presetId ? updated : preset)),
      activeId: presetId,
      dirty: false,
    },
    changed,
    warnings: [],
    issues: [],
    preset: { id: existing.id, name: existing.name },
    presetState: { activeId: presetId, dirty: false },
  };
}

/**
 * @param {any} presets
 * @param {string} presetId
 * @param {any} currentSnapshot
 * @param {{
 *   targetPreset?: import("../workspace/types.js").Preset,
 *   resolvedWindowBounds?: import("../workspace/types.js").Preset["windowBounds"],
 * }} [options]
 */
export function planPresetApply(
  presets,
  presetId,
  currentSnapshot,
  { targetPreset, resolvedWindowBounds } = {}
) {
  const savedPreset = presets.list.find(({ id }) => id === presetId);
  const preset = targetPreset?.id === presetId ? targetPreset : savedPreset;
  if (!preset) {
    return {
      presets,
      changed: [],
      warnings: [],
      issues: [issue("presetNotFound", "$.presetId", `Preset ${presetId} was not found.`)],
    };
  }
  const targetSnapshot = snapshotOf(preset);
  const plannedBounds = preset.dock?.enabled
    ? undefined
    : physicalBounds(resolvedWindowBounds ?? targetSnapshot.windowBounds);
  const currentBounds = physicalBounds(currentSnapshot.windowBounds);
  const sceneChanges = SNAPSHOT_GROUPS.filter(([, keys]) =>
    keys.some((key) =>
      key === "windowBounds"
        ? plannedBounds && !sameValue(plannedBounds, currentBounds)
        : !sameValue(targetSnapshot[key], currentSnapshot[key])
    )
  ).map(([path]) => path);
  const changed = [
    ...sceneChanges,
    ...(presets.activeId !== presetId ? ["presets.activeId"] : []),
    ...(presets.dirty === true ? ["presets.dirty"] : []),
  ];
  return {
    presets: changed.length === 0 ? presets : { ...presets, activeId: presetId, dirty: false },
    changed,
    warnings: [],
    issues: [],
    applyScene: sceneChanges.length > 0,
    preset: { id: preset.id, name: preset.name },
    presetState: { activeId: presetId, dirty: false },
  };
}
