function sampleForProperty(entry, name, schema) {
  const fixed = {
    afterGeneration: 0,
    afterRevision: entry.id === "app.wait" ? 1 : 0,
    configuration: {},
    deviceId: "default",
    document: {},
    expectedGeneration: 1,
    expectedRevision: 0,
    kind: "frequency",
    layout: entry.id === "dock.layout.apply" ? { panels: [] } : {},
    moduleId: "spectrum",
    name: "Name",
    pack: { app: "PLVS" },
    panelId: "spectrum",
    patch: entry.id === "axis.panel.update" ? { linked: false } : {},
    path: "C:\\audio\\mix.wav",
    presetId: "preset-1",
    presetIds: ["preset-1"],
    profileId: entry.id === "loudnessProfile.select" ? "off" : "profile-1",
    profileIds: [],
    range: { minHz: 200, maxHz: 5000 },
    recordingId: `rec-${"a".repeat(32)}`,
    sessionId: "file-1",
    target: { kind: "main" },
    themeId: "custom-1",
    themeIds: [],
    timeoutMs: 100,
  };
  if (Object.hasOwn(fixed, name)) return structuredClone(fixed[name]);
  if (schema.default !== undefined) return structuredClone(schema.default);
  if (schema.enum) return structuredClone(schema.enum[0]);
  if (schema.type === "boolean") return false;
  if (schema.type === "integer" || schema.type === "number") return schema.minimum ?? 0;
  if (schema.type === "array") return [];
  if (schema.type === "object" || schema.schemaRef) return {};
  return "fixture";
}

export function canonicalManifestParams(entry) {
  const params = {};
  for (const name of entry.wireParams.required) {
    params[name] = sampleForProperty(entry, name, entry.wireParams.properties[name]);
  }
  if (entry.dryRun) params.dryRun = true;
  return params;
}
