import { isAbsolute, normalize, sep } from "node:path";

const SCENARIO_FIELDS = new Set(["id", "durable", "ui", "screenshot", "touches"]);
const UI_TARGETS = Object.freeze({
  settings: { method: "ui.show.settings", fields: new Set(["kind", "section"]) },
  panelSettings: { method: "ui.show.panelSettings", fields: new Set(["kind", "panelId"]) },
  themeEditor: {
    method: "ui.show.themeEditor",
    fields: new Set(["kind", "mode", "themeId", "page"]),
  },
  loudnessProfileEditor: {
    method: "ui.show.loudnessProfileEditor",
    fields: new Set(["kind", "mode", "profileId"]),
  },
  feedback: { method: "ui.show.feedback", fields: new Set(["kind"]) },
});
const DURABLE_FIELDS = Object.freeze({
  view: new Set(["pinned", "focusView", "surfaceOpacity", "glassEnabled"]),
  settings: new Set([
    "openAtLogin",
    "closeBehavior",
    "clearShortcut",
    "interfaceSize",
    "historyRetentionSec",
    "dialogueVadEngine",
    "channelLabels",
  ]),
});
const SCREENSHOT_TARGETS = new Set(["main", "workspace", "panel", "dock-header", "dock-editor"]);

function plain(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeRelativeOutput(value) {
  if (typeof value !== "string" || value === "" || isAbsolute(value)) return false;
  const normalized = normalize(value);
  return normalized !== ".." && !normalized.startsWith(`..${sep}`);
}

function unknownFields(value, allowed) {
  return plain(value) ? Object.keys(value).filter((key) => !allowed.has(key)) : [];
}

export function validateWalkthroughManifest(manifest) {
  const issues = [];
  if (!plain(manifest) || manifest.version !== 1) issues.push("$.version must be 1.");
  if (unknownFields(manifest, new Set(["version", "workbench", "scenarios"])).length > 0)
    issues.push("$ contains an unknown field.");
  if (!plain(manifest?.workbench) || typeof manifest.workbench.instanceId !== "string")
    issues.push("$.workbench.instanceId is required.");
  if (unknownFields(manifest?.workbench, new Set(["instanceId"])).length > 0)
    issues.push("$.workbench contains an unknown field.");
  if (!Array.isArray(manifest?.scenarios) || manifest.scenarios.length === 0)
    issues.push("$.scenarios must be a non-empty array.");
  if (manifest?.scenarios?.length > 32) issues.push("$.scenarios is limited to 32 entries.");
  const ids = new Set();
  for (const [index, scenario] of (manifest?.scenarios ?? []).entries()) {
    const path = `$.scenarios[${index}]`;
    if (!plain(scenario)) {
      issues.push(`${path} must be an object.`);
      continue;
    }
    if (unknownFields(scenario, SCENARIO_FIELDS).length > 0)
      issues.push(`${path} contains an unknown field.`);
    if (typeof scenario.id !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(scenario.id))
      issues.push(`${path}.id is invalid.`);
    else if (ids.has(scenario.id)) issues.push(`${path}.id is duplicated.`);
    else ids.add(scenario.id);

    const target = UI_TARGETS[scenario.ui?.kind];
    if (!target || unknownFields(scenario.ui, target?.fields ?? new Set()).length > 0) {
      issues.push(`${path}.ui must be one supported semantic UI target.`);
    }
    if (scenario.ui?.kind === "settings" && typeof scenario.ui.section !== "string")
      issues.push(`${path}.ui.section is required.`);
    if (scenario.ui?.kind === "panelSettings" && typeof scenario.ui.panelId !== "string")
      issues.push(`${path}.ui.panelId is required.`);
    if (
      scenario.ui?.kind === "themeEditor" &&
      !["create", "edit", "customize", "duplicate"].includes(scenario.ui.mode)
    )
      issues.push(`${path}.ui.mode is invalid.`);
    if (
      scenario.ui?.kind === "loudnessProfileEditor" &&
      !["create", "edit"].includes(scenario.ui.mode)
    )
      issues.push(`${path}.ui.mode is invalid.`);

    if (!plain(scenario.screenshot) || !SCREENSHOT_TARGETS.has(scenario.screenshot.target))
      issues.push(`${path}.screenshot.target is invalid.`);
    if (
      unknownFields(scenario.screenshot, new Set(["target", "panelId", "output"])).length > 0
    )
      issues.push(`${path}.screenshot contains an unknown field.`);
    if (!safeRelativeOutput(scenario.screenshot?.output))
      issues.push(`${path}.screenshot.output must be a contained relative path.`);
    if (
      scenario.screenshot?.target === "panel" &&
      typeof scenario.screenshot.panelId !== "string"
    )
      issues.push(`${path}.screenshot.panelId is required.`);

    const declaredTouches = new Set(scenario.touches ?? []);
    const actualTouches = new Set();
    if (!Array.isArray(scenario.durable) || !Array.isArray(scenario.touches)) {
      issues.push(`${path}.durable and .touches must be arrays.`);
      continue;
    }
    for (const [stepIndex, step] of scenario.durable.entries()) {
      const stepPath = `${path}.durable[${stepIndex}]`;
      if (
        !plain(step) ||
        unknownFields(step, new Set(["family", "patch"])).length > 0 ||
        !DURABLE_FIELDS[step.family] ||
        !plain(step.patch)
      ) {
        issues.push(`${stepPath} is not a supported durable patch.`);
        continue;
      }
      for (const key of Object.keys(step.patch)) {
        if (!DURABLE_FIELDS[step.family].has(key))
          issues.push(`${stepPath}.patch.${key} is not public.`);
        actualTouches.add(`${step.family}.${key}`);
      }
    }
    if (
      declaredTouches.size !== actualTouches.size ||
      [...actualTouches].some((touch) => !declaredTouches.has(touch))
    )
      issues.push(`${path}.touches must exactly declare the durable patch fields.`);
  }
  return issues;
}

export function requiredWalkthroughMethods(manifest) {
  const methods = new Set(["app.capabilities", "app.inspect", "ui.inspect", "visual.screenshot"]);
  for (const scenario of manifest.scenarios) {
    methods.add(UI_TARGETS[scenario.ui.kind].method);
    methods.add(["settings", "panelSettings"].includes(scenario.ui.kind) ? "ui.close" : "ui.cancel");
    for (const step of scenario.durable) {
      methods.add(`${step.family}.inspect`);
      methods.add(`${step.family}.update`);
    }
  }
  return [...methods];
}

export function assertWalkthroughStart(manifest, capabilities, ui) {
  const missing = requiredWalkthroughMethods(manifest).filter(
    (method) => !capabilities.methods?.includes(method)
  );
  if (missing.length > 0) throw new Error(`Missing Agent Control methods: ${missing.join(", ")}.`);
  if (ui.activeBlockingEditors?.length > 0)
    throw new Error(`A blocking editor is already open: ${ui.activeBlockingEditors.join(", ")}.`);
  const event = ui.surfaces?.find((surface) => surface.origin === "event");
  if (event) throw new Error(`A real event decision is already open: ${event.kind}.`);
  const nested = ui.surfaces?.find((surface) => surface.origin === "nested");
  if (nested) throw new Error(`A nested decision is already open: ${nested.kind}.`);
  if (ui.surfaces?.length > 0)
    throw new Error(`A UI surface is already open: ${ui.surfaces[0].kind}.`);
}

export function buildRestorationLedger(manifest, snapshots) {
  const entries = [];
  const seen = new Set();
  for (const scenario of [...manifest.scenarios].reverse()) {
    for (const step of [...scenario.durable].reverse()) {
      const patch = {};
      for (const key of Object.keys(step.patch).reverse()) {
        const identity = `${step.family}.${key}`;
        if (seen.has(identity)) continue;
        seen.add(identity);
        patch[key] = structuredClone(snapshots[step.family]?.[key]);
      }
      if (Object.keys(patch).length > 0) {
        entries.push({ family: step.family, patch, verify: structuredClone(patch) });
      }
    }
  }
  return entries;
}

export function uiShowArguments(ui) {
  if (ui.kind === "settings") return ["ui", "show", "settings", "--section", ui.section];
  if (ui.kind === "panelSettings")
    return ["ui", "show", "panel-settings", "--panel-id", ui.panelId];
  if (ui.kind === "themeEditor") {
    const args = ["ui", "show", "theme-editor", "--mode", ui.mode];
    if (ui.themeId) args.push("--theme-id", ui.themeId);
    if (ui.page) args.push("--page", ui.page);
    return args;
  }
  if (ui.kind === "loudnessProfileEditor") {
    const args = ["ui", "show", "loudness-profile-editor", "--mode", ui.mode];
    if (ui.profileId) args.push("--profile-id", ui.profileId);
    return args;
  }
  return ["ui", "show", "feedback"];
}
