function issue(code, path, message) {
  return { code, path, message };
}

function snapshotOf(preset) {
  const { id: _id, name: _name, ...snapshot } = preset;
  return snapshot;
}

const SNAPSHOT_GROUPS = [
  [
    "workspace",
    ["tree", "panelsById", "panelOrder", "panelControlsById", "pinnedPanelsById", "axisViewports"],
  ],
  ["window", ["windowBounds", "windowPinned", "focusView", "panelOpacity", "glassEnabled"]],
  ["dock", ["dock"]],
  ["loudnessProfile", ["loudnessProfileActive"]],
];

function groupChanged(target, current, keys) {
  return keys.some((key) => JSON.stringify(target[key]) !== JSON.stringify(current[key]));
}

function savedProfileId(selection) {
  return typeof selection === "string" && selection.startsWith("profile:")
    ? selection.slice("profile:".length)
    : null;
}

function overlapArea(bounds, monitor) {
  const x = Math.max(
    0,
    Math.min(bounds.x + bounds.width, monitor.x + monitor.width) - Math.max(bounds.x, monitor.x)
  );
  const y = Math.max(
    0,
    Math.min(bounds.y + bounds.height, monitor.y + monitor.height) - Math.max(bounds.y, monitor.y)
  );
  return x * y;
}

function adjustedWindowBounds(bounds, monitors) {
  if (!bounds || !Array.isArray(monitors) || monitors.length === 0) return bounds;
  const first = monitors[0];
  const unusable =
    bounds.width < 320 || bounds.height < 240 || bounds.x <= -32000 || bounds.y <= -32000;
  if (unusable) {
    const width = Math.min(1180, Math.max(first.width, 320));
    const height = Math.min(860, Math.max(first.height, 240));
    return {
      ...bounds,
      x: first.x + Math.max(Math.trunc((first.width - width) / 2), 0),
      y: first.y + Math.max(Math.trunc((first.height - height) / 2), 0),
      width,
      height,
    };
  }
  const visible = Math.max(...monitors.map((monitor) => overlapArea(bounds, monitor)));
  if (visible * 8 >= bounds.width * bounds.height) return bounds;
  return {
    ...bounds,
    x: first.x + Math.max(Math.trunc((first.width - bounds.width) / 2), 0),
    y: first.y + Math.max(Math.trunc((first.height - bounds.height) / 2), 0),
  };
}

export function planPresetApplyResources(preset, context = {}) {
  const warnings = [];
  const issues = [];
  const profileId = savedProfileId(preset.loudnessProfileActive);
  if (profileId !== null && !(context.loudnessProfiles ?? []).some(({ id }) => id === profileId)) {
    warnings.push({ code: "loudnessProfileUnavailable", requested: profileId, effective: null });
  }

  if (preset.dock?.enabled === true) {
    if (context.dockSupported !== true) {
      warnings.push({ code: "dockUnsupported", requested: true, effective: false });
    } else {
      const monitors = Array.isArray(context.monitors) ? context.monitors : [];
      const requested = typeof preset.dock.monitor === "string" ? preset.dock.monitor : null;
      const requestedAvailable = requested !== null && monitors.some(({ id }) => id === requested);
      if (requested !== null && !requestedAvailable && monitors.length > 0) {
        const effective =
          monitors.find(({ id }) => id === context.fallbackMonitor)?.id ?? monitors[0].id;
        warnings.push({ code: "dockMonitorUnavailable", requested, effective });
      } else if (
        requested !== null &&
        !requestedAvailable &&
        context.monitorInventoryReady === true
      ) {
        issues.push(
          issue("monitorUnavailable", "$.dock.monitor", "No monitor is available for Dock.")
        );
      }
    }
  } else if (preset.windowBounds) {
    const effective = adjustedWindowBounds(preset.windowBounds, context.monitorRects);
    if (JSON.stringify(effective) !== JSON.stringify(preset.windowBounds)) {
      warnings.push({
        code: "windowBoundsAdjusted",
        requested: preset.windowBounds,
        effective,
      });
    }
  }
  return { issues, warnings };
}

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
  const snapshotChanged = JSON.stringify(snapshotOf(existing)) !== JSON.stringify(snapshot);
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

export function planPresetApply(presets, presetId, currentSnapshot) {
  const preset = presets.list.find(({ id }) => id === presetId);
  if (!preset) {
    return {
      presets,
      changed: [],
      warnings: [],
      issues: [issue("presetNotFound", "$.presetId", `Preset ${presetId} was not found.`)],
    };
  }
  const targetSnapshot = snapshotOf(preset);
  const sceneChanges = SNAPSHOT_GROUPS.filter(([, keys]) =>
    groupChanged(targetSnapshot, currentSnapshot, keys)
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
