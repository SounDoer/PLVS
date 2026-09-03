import { DEFAULT_PANEL_CONTROLS } from "../lib/panelControls.js";
import {
  AXIS_VIEWPORTS,
  axisKindsForModule,
  countLinkedParticipants,
  normalizeAxisViewport,
  readLocalRange,
  resolveAxisViewport,
  writeLocalRange,
} from "../workspace/axisViewports.js";

function issue(code, path, message) {
  return { code, path, message };
}

function publicRange(kindId, range) {
  return kindId === "frequency"
    ? { minHz: range.min, maxHz: range.max }
    : { windowSec: range.windowSec, offsetSec: range.offsetSec };
}

function internalRange(kindId, range) {
  return kindId === "frequency"
    ? { min: range.minHz, max: range.maxHz }
    : { windowSec: range.windowSec, offsetSec: range.offsetSec };
}

function leafNames(kindId) {
  return kindId === "frequency" ? ["minHz", "maxHz"] : ["windowSec", "offsetSec"];
}

function rangeEqual(kindId, left, right) {
  return leafNames(kindId).every(
    (key) => publicRange(kindId, left)[key] === publicRange(kindId, right)[key]
  );
}

function validateRange(kindId, value, context = {}) {
  const issues = [];
  const keys = kindId === "frequency" ? ["minHz", "maxHz"] : ["windowSec", "offsetSec"];
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return [issue("invalidType", "$.range", "range must be a plain object.")];
  }
  for (const key of Object.keys(value)) {
    if (!keys.includes(key))
      issues.push(issue("unknownField", `$.range.${key}`, `Unknown range field: ${key}.`));
  }
  for (const key of keys) {
    if (!Number.isFinite(value[key])) {
      issues.push(issue("invalidType", `$.range.${key}`, `${key} must be a finite number.`));
    }
  }
  if (issues.some(({ code }) => code === "invalidType")) return issues;

  if (kindId === "frequency") {
    if (
      value.minHz < 20 ||
      value.maxHz > 20000 ||
      value.minHz >= value.maxHz ||
      value.maxHz - value.minHz < 1
    ) {
      issues.push(
        issue("outOfRange", "$.range", "frequency range must satisfy 20 <= minHz < maxHz <= 20000.")
      );
    }
  } else {
    const maxWindowSec = Math.max(
      60,
      Number.isFinite(context.timeMaxWindowSec) ? context.timeMaxWindowSec : 60
    );
    const maxOffsetSec = Math.max(
      0,
      Number.isFinite(context.timeMaxOffsetSec) ? context.timeMaxOffsetSec : 0
    );
    if (
      value.windowSec < 5 ||
      value.windowSec > maxWindowSec ||
      value.offsetSec < 0 ||
      value.offsetSec > maxOffsetSec
    ) {
      issues.push(
        issue("outOfRange", "$.range", "time range is outside the currently available history.")
      );
    }
  }
  return issues;
}

function invalidPlan(workspace, issues) {
  return { workspace, changed: [], warnings: [], issues };
}

function withSharedRange(workspace, kindId, nextRange) {
  return {
    ...workspace,
    axisViewports: { ...workspace.axisViewports, [kindId]: nextRange },
  };
}

function withPanelControls(
  workspace,
  panelId,
  nextControls,
  axisViewports = workspace.axisViewports
) {
  return {
    ...workspace,
    axisViewports,
    panelControlsById: { ...workspace.panelControlsById, [panelId]: nextControls },
  };
}

export function buildAxisSchema(context = {}) {
  const timeMaximum = Math.max(
    60,
    Number.isFinite(context.timeMaxWindowSec) ? context.timeMaxWindowSec : 60
  );
  const offsetMaximum = Math.max(
    0,
    Number.isFinite(context.timeMaxOffsetSec) ? context.timeMaxOffsetSec : 0
  );
  return {
    frequency: {
      type: "object",
      title: "Frequency Axis",
      description: "Logarithmic frequency viewport shared by participating panels.",
      unit: "Hz",
      patchMode: "replace",
      default: { minHz: 20, maxHz: 20000 },
      required: ["minHz", "maxHz"],
      properties: {
        minHz: { type: "number", title: "Minimum", unit: "Hz", minimum: 20, maximum: 20000 },
        maxHz: { type: "number", title: "Maximum", unit: "Hz", minimum: 20, maximum: 20000 },
      },
      constraints: [
        { kind: "ordered", lower: "minHz", upper: "maxHz" },
        { kind: "minimumSpan", value: 1 },
      ],
      modules: Object.keys(AXIS_VIEWPORTS.frequency.members),
    },
    time: {
      type: "object",
      title: "Time Axis",
      description: "History viewport shared by participating panels.",
      unit: "s",
      patchMode: "replace",
      default: { windowSec: 60, offsetSec: 0 },
      required: ["windowSec", "offsetSec"],
      properties: {
        windowSec: { type: "number", title: "Window", unit: "s", minimum: 5, maximum: timeMaximum },
        offsetSec: {
          type: "number",
          title: "Offset",
          unit: "s",
          minimum: 0,
          maximum: offsetMaximum,
        },
      },
      modules: Object.keys(AXIS_VIEWPORTS.time.members),
    },
  };
}

export function buildAxisInspection(workspace) {
  return {
    shared: Object.fromEntries(
      Object.keys(AXIS_VIEWPORTS).map((kindId) => [
        kindId,
        publicRange(kindId, normalizeAxisViewport(kindId, workspace.axisViewports?.[kindId])),
      ])
    ),
    panels: workspace.panelOrder
      .filter((panelId) => axisKindsForModule(workspace.panelsById?.[panelId]?.moduleId).length > 0)
      .map((panelId) => {
        const moduleId = workspace.panelsById[panelId].moduleId;
        return {
          id: panelId,
          moduleId,
          axes: Object.fromEntries(
            axisKindsForModule(moduleId).map((kindId) => {
              const effective = resolveAxisViewport(workspace, panelId, kindId);
              return [
                kindId,
                {
                  linked: effective.linked,
                  source: effective.linked ? "workspace" : "panel",
                  range: publicRange(kindId, effective),
                  dormantLocalRange: publicRange(
                    kindId,
                    readLocalRange(kindId, moduleId, workspace.panelControlsById?.[panelId])
                  ),
                },
              ];
            })
          ),
        };
      }),
  };
}

export function planSharedAxisUpdate(workspace, kindId, range, context = {}) {
  if (!AXIS_VIEWPORTS[kindId]) {
    return invalidPlan(workspace, [
      issue("axisNotFound", "$.kind", `Unknown axis kind: ${kindId}.`),
    ]);
  }
  const issues = validateRange(kindId, range, context);
  if (issues.length > 0) return invalidPlan(workspace, issues);

  const current = normalizeAxisViewport(kindId, workspace.axisViewports?.[kindId]);
  const next = internalRange(kindId, range);
  const changed = leafNames(kindId)
    .filter((key) => publicRange(kindId, current)[key] !== range[key])
    .map((key) => `shared.${kindId}.${key}`);
  return {
    workspace: changed.length === 0 ? workspace : withSharedRange(workspace, kindId, next),
    changed,
    warnings: [],
    issues: [],
  };
}

export function planSharedAxisReset(workspace, kindId) {
  if (!AXIS_VIEWPORTS[kindId]) {
    return invalidPlan(workspace, [
      issue("axisNotFound", "$.kind", `Unknown axis kind: ${kindId}.`),
    ]);
  }
  return planSharedAxisUpdate(
    workspace,
    kindId,
    publicRange(kindId, normalizeAxisViewport(kindId, undefined)),
    { timeMaxWindowSec: 60, timeMaxOffsetSec: 0 }
  );
}

function validatePanelTarget(workspace, panelId, kindId) {
  if (!workspace.panelsById?.[panelId]) {
    return [issue("panelNotFound", "$.panelId", `Panel ${panelId} was not found.`)];
  }
  const moduleId = workspace.panelsById[panelId].moduleId;
  if (!AXIS_VIEWPORTS[kindId]) {
    return [issue("axisNotFound", "$.kind", `Unknown axis kind: ${kindId}.`)];
  }
  if (!AXIS_VIEWPORTS[kindId].members[moduleId]) {
    return [issue("axisUnavailable", "$.kind", `${moduleId} does not support the ${kindId} axis.`)];
  }
  return [];
}

export function planPanelAxisUpdate(workspace, panelId, kindId, patch, context = {}) {
  const targetIssues = validatePanelTarget(workspace, panelId, kindId);
  if (targetIssues.length > 0) return invalidPlan(workspace, targetIssues);
  const issues = [];
  if (patch === null || typeof patch !== "object" || Array.isArray(patch)) {
    return invalidPlan(workspace, [
      issue("invalidType", "$", "Axis patch must be a plain object."),
    ]);
  }
  for (const key of Object.keys(patch)) {
    if (key !== "linked" && key !== "range")
      issues.push(issue("unknownField", `$.${key}`, `Unknown axis field: ${key}.`));
  }
  if (!("linked" in patch) && !("range" in patch)) {
    issues.push(issue("missingField", "$", "Axis patch requires linked or range."));
  }
  if ("linked" in patch && typeof patch.linked !== "boolean") {
    issues.push(issue("invalidType", "$.linked", "linked must be a boolean."));
  }
  if ("range" in patch) issues.push(...validateRange(kindId, patch.range, context));

  const descriptor = AXIS_VIEWPORTS[kindId];
  const moduleId = workspace.panelsById[panelId].moduleId;
  const controls = workspace.panelControlsById[panelId];
  const currentlyLinked = controls[descriptor.linkKey] === true;
  const finallyLinked = typeof patch.linked === "boolean" ? patch.linked : currentlyLinked;
  if ("range" in patch && finallyLinked) {
    issues.push(
      issue("rangeWhileLinked", "$.range", "A local range cannot be supplied while linked.")
    );
  }
  if (issues.length > 0) return invalidPlan(workspace, issues);

  let nextControls = controls;
  let nextAxisViewports = workspace.axisViewports;
  const changed = [];
  const currentEffective = resolveAxisViewport(workspace, panelId, kindId);

  if (finallyLinked !== currentlyLinked) {
    changed.push(`panels.${panelId}.${kindId}.linked`);
    if (finallyLinked) {
      const hasGroup = countLinkedParticipants(workspace, kindId, panelId) > 0;
      if (!hasGroup) {
        const seed = normalizeAxisViewport(kindId, readLocalRange(kindId, moduleId, controls));
        if (
          !rangeEqual(
            kindId,
            normalizeAxisViewport(kindId, workspace.axisViewports?.[kindId]),
            seed
          )
        ) {
          nextAxisViewports = { ...workspace.axisViewports, [kindId]: seed };
          for (const key of leafNames(kindId)) changed.push(`shared.${kindId}.${key}`);
        }
      }
      nextControls = { ...controls, [descriptor.linkKey]: true };
    } else {
      nextControls = {
        ...controls,
        ...writeLocalRange(kindId, moduleId, normalizeAxisViewport(kindId, currentEffective)),
        [descriptor.linkKey]: false,
      };
    }
  }

  if ("range" in patch) {
    const desired = internalRange(kindId, patch.range);
    const before = currentlyLinked
      ? normalizeAxisViewport(kindId, currentEffective)
      : normalizeAxisViewport(kindId, readLocalRange(kindId, moduleId, controls));
    nextControls = { ...nextControls, ...writeLocalRange(kindId, moduleId, desired) };
    for (const key of leafNames(kindId)) {
      if (publicRange(kindId, before)[key] !== patch.range[key]) {
        changed.push(`panels.${panelId}.${kindId}.range.${key}`);
      }
    }
  }

  if (changed.length === 0) return invalidPlan(workspace, []);
  return {
    workspace: withPanelControls(workspace, panelId, nextControls, nextAxisViewports),
    changed,
    warnings: [],
    issues: [],
  };
}

export function planPanelAxisReset(workspace, panelId, kindId) {
  const targetIssues = validatePanelTarget(workspace, panelId, kindId);
  if (targetIssues.length > 0) return invalidPlan(workspace, targetIssues);
  const moduleId = workspace.panelsById[panelId].moduleId;
  const descriptor = AXIS_VIEWPORTS[kindId];
  const controls = workspace.panelControlsById[panelId];
  const defaultLocal = readLocalRange(kindId, moduleId, DEFAULT_PANEL_CONTROLS);
  const currentlyLinked = controls[descriptor.linkKey] === true;
  const currentLocal = readLocalRange(kindId, moduleId, controls);
  const changed = [];
  if (!currentlyLinked) changed.push(`panels.${panelId}.${kindId}.linked`);
  for (const key of leafNames(kindId)) {
    if (publicRange(kindId, currentLocal)[key] !== publicRange(kindId, defaultLocal)[key]) {
      changed.push(`panels.${panelId}.${kindId}.range.${key}`);
    }
  }
  if (changed.length === 0) return invalidPlan(workspace, []);

  let axisViewports = workspace.axisViewports;
  if (!currentlyLinked && countLinkedParticipants(workspace, kindId, panelId) === 0) {
    const currentShared = normalizeAxisViewport(kindId, workspace.axisViewports?.[kindId]);
    const seed = normalizeAxisViewport(kindId, defaultLocal);
    if (!rangeEqual(kindId, currentShared, seed)) {
      axisViewports = { ...axisViewports, [kindId]: seed };
      for (const key of leafNames(kindId)) changed.push(`shared.${kindId}.${key}`);
    }
  }
  const nextControls = {
    ...controls,
    ...writeLocalRange(kindId, moduleId, defaultLocal),
    [descriptor.linkKey]: true,
  };
  return {
    workspace: withPanelControls(workspace, panelId, nextControls, axisViewports),
    changed,
    warnings: [],
    issues: [],
  };
}
