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
