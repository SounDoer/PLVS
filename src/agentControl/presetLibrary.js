function issue(code, path, message) {
  return { code, path, message };
}

function invalid(presets, issues) {
  return { presets, changed: [], warnings: [], issues };
}

function summary(preset) {
  return { id: preset.id, name: preset.name };
}

export function planPresetRename(presets, presetId, name) {
  const preset = presets.list.find(({ id }) => id === presetId);
  if (!preset) {
    return invalid(presets, [
      issue("presetNotFound", "$.presetId", `Preset ${presetId} was not found.`),
    ]);
  }
  if (typeof name !== "string" || name.trim() === "") {
    return invalid(presets, [
      issue("invalidName", "$.name", "Preset name must contain non-whitespace text."),
    ]);
  }
  const trimmed = name.trim();
  if (trimmed === preset.name) {
    return { ...invalid(presets, []), preset: summary(preset) };
  }
  const renamed = { ...preset, name: trimmed };
  return {
    presets: {
      ...presets,
      list: presets.list.map((item) => (item.id === presetId ? renamed : item)),
    },
    changed: [`presets.${presetId}.name`],
    warnings: [],
    issues: [],
    preset: summary(renamed),
  };
}

export function planPresetDelete(presets, presetId) {
  const preset = presets.list.find(({ id }) => id === presetId);
  if (!preset) {
    return invalid(presets, [
      issue("presetNotFound", "$.presetId", `Preset ${presetId} was not found.`),
    ]);
  }
  const deletingActive = presets.activeId === presetId;
  return {
    presets: {
      list: presets.list.filter(({ id }) => id !== presetId),
      activeId: deletingActive ? null : presets.activeId,
      dirty: deletingActive ? false : presets.dirty === true,
    },
    changed: [
      "presets.library",
      ...(deletingActive ? ["presets.activeId"] : []),
      ...(deletingActive && presets.dirty === true ? ["presets.dirty"] : []),
    ],
    warnings: [],
    issues: [],
    deletedPreset: summary(preset),
  };
}

export function planPresetReorder(presets, presetIds) {
  const currentIds = presets.list.map(({ id }) => id);
  const valid =
    Array.isArray(presetIds) &&
    presetIds.every((id) => typeof id === "string") &&
    presetIds.length === currentIds.length &&
    new Set(presetIds).size === presetIds.length &&
    presetIds.every((id) => currentIds.includes(id));
  if (!valid) {
    return invalid(presets, [
      issue(
        "invalidPermutation",
        "$.presetIds",
        "presetIds must contain every current Preset ID exactly once."
      ),
    ]);
  }
  if (presetIds.every((id, index) => id === currentIds[index])) {
    return { ...invalid(presets, []), presetIds: currentIds };
  }
  const byId = new Map(presets.list.map((preset) => [preset.id, preset]));
  return {
    presets: { ...presets, list: presetIds.map((id) => byId.get(id)) },
    changed: ["presets.order"],
    warnings: [],
    issues: [],
    presetIds: [...presetIds],
  };
}
