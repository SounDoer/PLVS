import { buildPublicPresetSnapshot } from "../agentControl/presetSnapshot.js";
import { compileWorkspaceLayout, WorkspaceLayoutError } from "../agentControl/workspaceLayout.js";
import { planPublicPanelControlPatch } from "../agentControl/panelControlPatch.js";
import { compileDockLayout } from "../agentControl/dockControl.js";
import { DOCK_MAX_HEIGHT, DOCK_MIN_HEIGHT } from "../dock/dockSizing.js";
import { DEFAULT_FOCUS_VIEW, normalizeFocusView } from "../lib/focusView.js";
import { profileSelectionId } from "../lib/loudnessProfileCatalog.js";
import { createDefaultPanelControls } from "../workspace/panelControlInstances.js";
import { MODULE_CATALOG } from "../workspace/moduleCatalog.js";
import {
  AXIS_VIEWPORTS,
  axisKindsForModule,
  normalizeAxisViewportsState,
  writeLocalRange,
} from "../workspace/axisViewports.js";
import { normalizePinnedPanelsById } from "../workspace/reducer.js";
import { normalizePortableItemId, packIssue, prefixPackIssues } from "./packV2.js";

export const PORTABLE_PRESET_KIND = "plvs-preset";
export const PORTABLE_PRESET_FORMAT_VERSION = 1;
export const PORTABLE_PRESET_SEMANTICS_VERSION = 1;
export const MAX_PORTABLE_PRESET_NAME_LENGTH = 64;
export const MAX_PORTABLE_PANEL_TITLE_LENGTH = 128;

const TOP_FIELDS = new Set([
  "kind",
  "formatVersion",
  "semanticsVersion",
  "name",
  "workspace",
  "presentation",
  "dock",
  "loudnessProfile",
]);
const WORKSPACE_FIELDS = new Set(["layout", "panels"]);
const PANEL_FIELDS = new Set(["key", "moduleId", "title", "controls", "axes", "pinnedSize"]);
const PRESENTATION_FIELDS = new Set([
  "alwaysOnTop",
  "focusView",
  "panelOpacityPercent",
  "glassEnabled",
]);
const FOCUS_FIELDS = new Set(["autoHideControls", "compactPanels", "borderless"]);
const AXIS_FIELDS = Object.freeze({
  frequency: new Set(["linked", "minHz", "maxHz"]),
  time: new Set(["linked", "windowSec"]),
});
const LOUDNESS_FIELDS = new Set(["dependencyId"]);
const DOCK_DISABLED_FIELDS = new Set(["enabled"]);
const DOCK_ENABLED_FIELDS = new Set(["enabled", "edge", "reserveSpace", "heightCssPx", "panels"]);
const DOCK_PANEL_FIELDS = new Set(["key", "moduleId", "title", "preferredWidthCssPx", "controls"]);

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function collectUnknownFields(raw, allowed, path, issues) {
  if (!isPlainObject(raw)) return;
  for (const field of Object.keys(raw)) {
    if (!allowed.has(field)) {
      issues.push(packIssue("unknownField", `${path}.${field}`, `Unknown field: ${field}.`));
    }
  }
}

function booleanField(raw, key, path, issues) {
  if (typeof raw?.[key] !== "boolean") {
    issues.push(packIssue("invalidType", `${path}.${key}`, `${key} must be a boolean.`));
  }
}

function prefixPlannerIssues(issues, prefix) {
  return prefixPackIssues(issues, prefix);
}

export class PortablePresetError extends Error {
  constructor(issues) {
    super("The portable Preset document is invalid.");
    this.name = "PortablePresetError";
    this.code = "invalidPortablePreset";
    this.issues = issues;
  }
}

function portableLayout(node, idToKey) {
  if (!node) return null;
  if (node.type === "panel") return { type: "panel", key: idToKey.get(node.panelId) };
  if (node.type === "tabs") {
    return {
      type: "tabs",
      active: idToKey.get(node.active),
      children: node.children.map((child) => portableLayout(child, idToKey)),
    };
  }
  return {
    type: "split",
    direction: node.direction,
    ...(node.weights ? { weights: [...node.weights] } : {}),
    children: node.children.map((child) => portableLayout(child, idToKey)),
  };
}

function portableAxes(axes) {
  return Object.fromEntries(
    Object.entries(axes).map(([kindId, axis]) => [
      kindId,
      kindId === "frequency"
        ? {
            linked: axis.linked,
            minHz: axis.range.minHz,
            maxHz: axis.range.maxHz,
          }
        : { linked: axis.linked, windowSec: axis.range.windowSec },
    ])
  );
}

/** Converts one saved local Preset into the id-free portable authoring document. */
export function presetToPortable(raw, { loudnessProfiles = [] } = {}) {
  const snapshot = buildPublicPresetSnapshot(raw, { loudnessProfiles });
  if (!snapshot.name) {
    throw new PortablePresetError([
      packIssue("invalidName", "$.name", "name must contain non-whitespace text."),
    ]);
  }
  const profileId = snapshot.loudnessProfile.activeId;
  if (profileId !== null && !loudnessProfiles.some(({ id }) => id === profileId)) {
    throw new PortablePresetError([
      packIssue(
        "missingDependency",
        "$.loudnessProfile.dependencyId",
        "The selected Loudness Profile must be bundled with the Preset.",
        { dependencyId: profileId }
      ),
    ]);
  }

  const panelIds = snapshot.workspace.panels.map(({ id }) => id);
  const idToKey = new Map(panelIds.map((id, index) => [id, `panel-${index + 1}`]));
  const panels = snapshot.workspace.panels.map((panel) => {
    const storedPanel = raw.panelsById?.[panel.id];
    const pinned = raw.pinnedPanelsById?.[panel.id];
    return {
      key: idToKey.get(panel.id),
      moduleId: panel.moduleId,
      ...(storedPanel?.customTitle ? { title: storedPanel.customTitle } : {}),
      controls: panel.controls,
      axes: portableAxes(panel.axes),
      ...(pinned
        ? {
            pinnedSize: {
              widthCssPx: pinned.width,
              heightCssPx: pinned.height,
            },
          }
        : {}),
    };
  });

  const dock = snapshot.dock.enabled
    ? {
        enabled: true,
        edge: snapshot.dock.edge,
        reserveSpace: snapshot.dock.reserveSpace,
        heightCssPx: snapshot.dock.height,
        panels: snapshot.dock.panels.map((panel, index) => ({
          key: `dock-${index + 1}`,
          moduleId: panel.moduleId,
          ...(panel.customTitle ? { title: panel.customTitle } : {}),
          preferredWidthCssPx: panel.width,
          controls: panel.controls,
        })),
      }
    : { enabled: false };

  return validatePortablePreset({
    kind: PORTABLE_PRESET_KIND,
    formatVersion: PORTABLE_PRESET_FORMAT_VERSION,
    semanticsVersion: PORTABLE_PRESET_SEMANTICS_VERSION,
    name: snapshot.name,
    workspace: {
      layout: portableLayout(snapshot.workspace.layout, idToKey),
      panels,
    },
    presentation: {
      alwaysOnTop: snapshot.window.pinned,
      focusView: snapshot.window.focusView,
      panelOpacityPercent: snapshot.window.surfaceOpacity,
      glassEnabled: snapshot.window.glassEnabled,
    },
    dock,
    loudnessProfile: { dependencyId: profileId },
  });
}

function injectPanelDefinitions(node, panelsByKey, issues, path = "$.workspace.layout") {
  if (node === null) return null;
  if (!isPlainObject(node)) {
    issues.push(packIssue("invalidLayout", path, "A layout node must be an object."));
    return null;
  }
  if (node.type === "panel") {
    const panel = panelsByKey.get(node.key);
    if (!panel) {
      issues.push(packIssue("unknownPanelKey", `${path}.key`, "The layout key is not declared."));
      return null;
    }
    return {
      type: "panel",
      key: panel.key,
      moduleId: panel.moduleId,
      ...(panel.title ? { title: panel.title } : {}),
    };
  }
  if (node.type === "tabs") {
    return {
      ...node,
      children: Array.isArray(node.children)
        ? node.children.map((child, index) =>
            injectPanelDefinitions(child, panelsByKey, issues, `${path}.children[${index}]`)
          )
        : node.children,
    };
  }
  if (node.type === "split") {
    return {
      ...node,
      children: Array.isArray(node.children)
        ? node.children.map((child, index) =>
            injectPanelDefinitions(child, panelsByKey, issues, `${path}.children[${index}]`)
          )
        : node.children,
    };
  }
  issues.push(packIssue("invalidLayout", `${path}.type`, "Unknown layout node type."));
  return null;
}

function validatePanelDefinition(panel, index, issues) {
  const path = `$.workspace.panels[${index}]`;
  if (!isPlainObject(panel)) {
    issues.push(packIssue("invalidPanel", path, "A panel definition must be an object."));
    return;
  }
  collectUnknownFields(panel, PANEL_FIELDS, path, issues);
  if (!normalizePortableItemId(panel.key)) {
    issues.push(packIssue("invalidPanelKey", `${path}.key`, "key is invalid."));
  }
  if (!MODULE_CATALOG[panel.moduleId]) {
    issues.push(packIssue("unknownModule", `${path}.moduleId`, "moduleId is not supported."));
  }
  if (
    panel.title !== undefined &&
    (typeof panel.title !== "string" ||
      panel.title.trim() === "" ||
      Array.from(panel.title).length > MAX_PORTABLE_PANEL_TITLE_LENGTH)
  ) {
    issues.push(packIssue("invalidTitle", `${path}.title`, "title is invalid or too long."));
  }
  if (!isPlainObject(panel.controls)) {
    issues.push(packIssue("invalidControls", `${path}.controls`, "controls must be an object."));
  }
  if (!isPlainObject(panel.axes)) {
    issues.push(packIssue("invalidAxes", `${path}.axes`, "axes must be an object."));
  }
  if (panel.pinnedSize !== undefined) {
    const size = panel.pinnedSize;
    if (
      !isPlainObject(size) ||
      Object.keys(size).some((key) => !["widthCssPx", "heightCssPx"].includes(key)) ||
      !Number.isFinite(size.widthCssPx) ||
      size.widthCssPx < 0 ||
      !Number.isFinite(size.heightCssPx) ||
      size.heightCssPx < 0
    ) {
      issues.push(
        packIssue(
          "invalidPinnedSize",
          `${path}.pinnedSize`,
          "pinnedSize needs non-negative finite CSS dimensions."
        )
      );
    }
  }
}

function applyPortableAxes(view, panels, keyToId, issues) {
  const shared = {};
  for (const [index, panel] of panels.entries()) {
    const panelId = keyToId.get(panel.key);
    if (!panelId || !MODULE_CATALOG[panel.moduleId]) continue;
    const supported = new Set(axisKindsForModule(panel.moduleId));
    const axes = isPlainObject(panel.axes) ? panel.axes : {};
    for (const kindId of supported) {
      if (!Object.hasOwn(axes, kindId)) {
        issues.push(
          packIssue(
            "missingAxis",
            `$.workspace.panels[${index}].axes.${kindId}`,
            `The ${kindId} axis is required for this module.`
          )
        );
      }
    }
    for (const kindId of Object.keys(axes)) {
      const path = `$.workspace.panels[${index}].axes.${kindId}`;
      if (!supported.has(kindId) || !AXIS_FIELDS[kindId]) {
        issues.push(packIssue("unknownAxis", path, "This module does not support the axis."));
        continue;
      }
      const axis = axes[kindId];
      if (!isPlainObject(axis)) {
        issues.push(packIssue("invalidAxis", path, "The axis must be an object."));
        continue;
      }
      collectUnknownFields(axis, AXIS_FIELDS[kindId], path, issues);
      if (typeof axis.linked !== "boolean") {
        issues.push(packIssue("invalidType", `${path}.linked`, "linked must be a boolean."));
        continue;
      }
      let viewport;
      if (kindId === "frequency") {
        const descriptor = AXIS_VIEWPORTS.frequency;
        if (
          !Number.isFinite(axis.minHz) ||
          !Number.isFinite(axis.maxHz) ||
          axis.minHz < descriptor.absMin ||
          axis.maxHz > descriptor.absMax ||
          axis.maxHz - axis.minHz < descriptor.minSpan
        ) {
          issues.push(packIssue("invalidAxisRange", path, "The frequency range is invalid."));
          continue;
        }
        viewport = { min: axis.minHz, max: axis.maxHz };
      } else {
        const descriptor = AXIS_VIEWPORTS.time;
        if (!Number.isFinite(axis.windowSec) || axis.windowSec < descriptor.minWindowSec) {
          issues.push(packIssue("invalidAxisRange", path, "The time window is invalid."));
          continue;
        }
        viewport = { windowSec: axis.windowSec, offsetSec: 0 };
      }

      const descriptor = AXIS_VIEWPORTS[kindId];
      view.panelControlsById[panelId] = {
        ...view.panelControlsById[panelId],
        [descriptor.linkKey]: axis.linked,
        ...writeLocalRange(kindId, panel.moduleId, viewport),
      };
      if (axis.linked) {
        if (shared[kindId] && JSON.stringify(shared[kindId]) !== JSON.stringify(viewport)) {
          issues.push(
            packIssue(
              "inconsistentLinkedAxis",
              path,
              "Linked panels must request the same axis range."
            )
          );
        } else {
          shared[kindId] = viewport;
        }
      }
    }
  }
  view.axisViewports = normalizeAxisViewportsState({ ...view.axisViewports, ...shared });
}

function compileWorkspace(raw, hasLoudnessReference, issues) {
  if (!isPlainObject(raw)) {
    issues.push(packIssue("invalidWorkspace", "$.workspace", "workspace must be an object."));
    return null;
  }
  collectUnknownFields(raw, WORKSPACE_FIELDS, "$.workspace", issues);
  if (!Array.isArray(raw.panels)) {
    issues.push(packIssue("invalidPanels", "$.workspace.panels", "panels must be an array."));
    return null;
  }
  raw.panels.forEach((panel, index) => validatePanelDefinition(panel, index, issues));
  const panelsByKey = new Map();
  raw.panels.forEach((panel, index) => {
    if (!isPlainObject(panel) || typeof panel.key !== "string") return;
    if (panelsByKey.has(panel.key)) {
      issues.push(
        packIssue(
          "duplicatePanelKey",
          `$.workspace.panels[${index}].key`,
          `Duplicate panel key: ${panel.key}.`
        )
      );
    } else {
      panelsByKey.set(panel.key, panel);
    }
  });
  if (raw.layout === null) {
    if (raw.panels.length > 0) {
      issues.push(
        packIssue(
          "unusedPanel",
          "$.workspace.panels",
          "An empty layout cannot declare Workspace panels."
        )
      );
    }
    return {
      tree: null,
      panelsById: {},
      panelOrder: [],
      panelControlsById: {},
      pinnedPanelsById: {},
      axisViewports: normalizeAxisViewportsState(),
    };
  }

  const injected = injectPanelDefinitions(raw.layout, panelsByKey, issues);
  if (!injected || issues.length > 0) return null;
  let compiled;
  try {
    compiled = compileWorkspaceLayout(injected, {
      tree: null,
      panelsById: {},
      panelOrder: [],
      panelControlsById: {},
      pinnedPanelsById: {},
      axisViewports: normalizeAxisViewportsState(),
    });
  } catch (error) {
    if (!(error instanceof WorkspaceLayoutError)) throw error;
    issues.push(packIssue(error.reason, `$.workspace.layout${error.path.slice(1)}`, error.message));
    return null;
  }
  const keyToId = new Map(Object.entries(compiled.createdPanels));
  if (keyToId.size !== raw.panels.length) {
    const used = new Set(keyToId.keys());
    raw.panels.forEach((panel, index) => {
      if (isPlainObject(panel) && !used.has(panel.key)) {
        issues.push(
          packIssue(
            "unusedPanel",
            `$.workspace.panels[${index}].key`,
            "The panel is not present in the layout."
          )
        );
      }
    });
  }
  const view = { ...compiled.view, panelControlsById: { ...compiled.view.panelControlsById } };
  raw.panels.forEach((panel, index) => {
    const panelId = keyToId.get(panel.key);
    if (!panelId || !MODULE_CATALOG[panel.moduleId] || !isPlainObject(panel.controls)) return;
    const planned = planPublicPanelControlPatch(
      panel.moduleId,
      createDefaultPanelControls(),
      panel.controls,
      { hasLoudnessReference, channelCount: 8 }
    );
    if (planned.issues.length > 0) {
      issues.push(...prefixPlannerIssues(planned.issues, `$.workspace.panels[${index}].controls`));
    } else {
      view.panelControlsById[panelId] = planned.panelControls;
    }
  });
  applyPortableAxes(view, raw.panels, keyToId, issues);
  view.pinnedPanelsById = normalizePinnedPanelsById(
    view.panelsById,
    Object.fromEntries(
      raw.panels.flatMap((panel) => {
        const panelId = keyToId.get(panel.key);
        return panelId && panel.pinnedSize
          ? [
              [
                panelId,
                {
                  width: panel.pinnedSize.widthCssPx,
                  height: panel.pinnedSize.heightCssPx,
                },
              ],
            ]
          : [];
      })
    )
  );
  return view;
}

function compilePresentation(raw, issues) {
  const path = "$.presentation";
  if (!isPlainObject(raw)) {
    issues.push(packIssue("invalidPresentation", path, "presentation must be an object."));
    return null;
  }
  collectUnknownFields(raw, PRESENTATION_FIELDS, path, issues);
  booleanField(raw, "alwaysOnTop", path, issues);
  booleanField(raw, "glassEnabled", path, issues);
  if (!isPlainObject(raw.focusView)) {
    issues.push(packIssue("invalidFocusView", `${path}.focusView`, "focusView must be an object."));
  } else {
    collectUnknownFields(raw.focusView, FOCUS_FIELDS, `${path}.focusView`, issues);
    for (const key of FOCUS_FIELDS) booleanField(raw.focusView, key, `${path}.focusView`, issues);
  }
  if (
    !Number.isInteger(raw.panelOpacityPercent) ||
    raw.panelOpacityPercent < 0 ||
    raw.panelOpacityPercent > 100
  ) {
    issues.push(
      packIssue(
        "invalidOpacity",
        `${path}.panelOpacityPercent`,
        "panelOpacityPercent must be an integer from 0 through 100."
      )
    );
  }
  return {
    windowPinned: raw.alwaysOnTop === true,
    focusView: normalizeFocusView(raw.focusView ?? DEFAULT_FOCUS_VIEW),
    surfaceOpacity: raw.panelOpacityPercent,
    glassEnabled: raw.glassEnabled === true,
  };
}

function compileDock(raw, hasLoudnessReference, issues) {
  const path = "$.dock";
  if (!isPlainObject(raw) || typeof raw.enabled !== "boolean") {
    issues.push(packIssue("invalidDock", path, "dock must be a discriminated object."));
    return null;
  }
  collectUnknownFields(raw, raw.enabled ? DOCK_ENABLED_FIELDS : DOCK_DISABLED_FIELDS, path, issues);
  if (!raw.enabled) return { enabled: false };
  if (!["top", "bottom"].includes(raw.edge)) {
    issues.push(packIssue("invalidDockEdge", `${path}.edge`, "edge must be top or bottom."));
  }
  booleanField(raw, "reserveSpace", path, issues);
  if (
    !Number.isInteger(raw.heightCssPx) ||
    raw.heightCssPx < DOCK_MIN_HEIGHT ||
    raw.heightCssPx > DOCK_MAX_HEIGHT
  ) {
    issues.push(
      packIssue(
        "invalidDockHeight",
        `${path}.heightCssPx`,
        `heightCssPx must be an integer from ${DOCK_MIN_HEIGHT} through ${DOCK_MAX_HEIGHT}.`
      )
    );
  }
  if (!Array.isArray(raw.panels)) {
    issues.push(packIssue("invalidDockPanels", `${path}.panels`, "panels must be an array."));
    return null;
  }
  const document = {
    panels: raw.panels.map((panel, index) => {
      const panelPath = `${path}.panels[${index}]`;
      if (!isPlainObject(panel)) return panel;
      collectUnknownFields(panel, DOCK_PANEL_FIELDS, panelPath, issues);
      if (!normalizePortableItemId(panel.key)) {
        issues.push(packIssue("invalidDockPanelKey", `${panelPath}.key`, "key is invalid."));
      }
      if (
        panel.title !== undefined &&
        (typeof panel.title !== "string" ||
          panel.title.trim() === "" ||
          Array.from(panel.title).length > MAX_PORTABLE_PANEL_TITLE_LENGTH)
      ) {
        issues.push(
          packIssue("invalidTitle", `${panelPath}.title`, "title is invalid or too long.")
        );
      }
      return {
        key: panel.key,
        moduleId: panel.moduleId,
        ...(panel.title ? { customTitle: panel.title } : {}),
        width: panel.preferredWidthCssPx,
        controls: panel.controls,
      };
    }),
  };
  const base = { panelsById: {}, panelOrder: [], panelSizesById: {}, controlsByPanelId: {} };
  const planned = compileDockLayout(base, document, { hasLoudnessReference, channelCount: 8 });
  issues.push(...prefixPlannerIssues(planned.issues, path));
  if (planned.issues.length > 0) return null;
  return {
    enabled: true,
    edge: raw.edge,
    monitor: null,
    reserveSpace: raw.reserveSpace,
    height: raw.heightCssPx,
    panelsById: planned.dock.panelsById,
    panelOrder: planned.dock.panelOrder,
    panelSizesById: planned.dock.panelSizesById,
    controlsByPanelId: planned.dock.controlsByPanelId,
  };
}

function compilePortablePreset(raw, { resolveDependencyId = (id) => id } = {}) {
  if (!isPlainObject(raw)) {
    throw new PortablePresetError([
      packIssue("invalidDocument", "$", "A portable Preset must be a plain object."),
    ]);
  }
  const issues = [];
  collectUnknownFields(raw, TOP_FIELDS, "$", issues);
  if (raw.kind !== PORTABLE_PRESET_KIND) {
    issues.push(packIssue("invalidKind", "$.kind", `kind must be ${PORTABLE_PRESET_KIND}.`));
  }
  if (raw.formatVersion !== PORTABLE_PRESET_FORMAT_VERSION) {
    issues.push(
      packIssue(
        "unsupportedFormatVersion",
        "$.formatVersion",
        `formatVersion must be ${PORTABLE_PRESET_FORMAT_VERSION}.`
      )
    );
  }
  if (raw.semanticsVersion !== PORTABLE_PRESET_SEMANTICS_VERSION) {
    issues.push(
      packIssue(
        "unsupportedSemanticsVersion",
        "$.semanticsVersion",
        `semanticsVersion must be ${PORTABLE_PRESET_SEMANTICS_VERSION}.`
      )
    );
  }
  if (
    typeof raw.name !== "string" ||
    raw.name.trim() === "" ||
    Array.from(raw.name.trim()).length > MAX_PORTABLE_PRESET_NAME_LENGTH
  ) {
    issues.push(packIssue("invalidName", "$.name", "name is invalid or too long."));
  }
  if (!isPlainObject(raw.loudnessProfile)) {
    issues.push(
      packIssue("invalidLoudnessProfile", "$.loudnessProfile", "loudnessProfile must be an object.")
    );
  } else {
    collectUnknownFields(raw.loudnessProfile, LOUDNESS_FIELDS, "$.loudnessProfile", issues);
  }
  const dependencyId = raw.loudnessProfile?.dependencyId;
  if (dependencyId !== null && !normalizePortableItemId(dependencyId)) {
    issues.push(
      packIssue(
        "invalidDependencyId",
        "$.loudnessProfile.dependencyId",
        "dependencyId must be null or a safe Item ID."
      )
    );
  }
  const localProfileId = dependencyId === null ? null : resolveDependencyId(dependencyId);
  if (dependencyId !== null && !localProfileId) {
    issues.push(
      packIssue(
        "missingDependency",
        "$.loudnessProfile.dependencyId",
        "The Loudness Profile dependency is missing.",
        { dependencyId }
      )
    );
  }

  const hasLoudnessReference = dependencyId !== null;
  const workspace = compileWorkspace(raw.workspace, hasLoudnessReference, issues);
  const presentation = compilePresentation(raw.presentation, issues);
  const dock = compileDock(raw.dock, hasLoudnessReference, issues);
  if (issues.length > 0) throw new PortablePresetError(issues);

  const canonical = {
    kind: PORTABLE_PRESET_KIND,
    formatVersion: PORTABLE_PRESET_FORMAT_VERSION,
    semanticsVersion: PORTABLE_PRESET_SEMANTICS_VERSION,
    name: raw.name.trim(),
    workspace: structuredClone(raw.workspace),
    presentation: {
      alwaysOnTop: raw.presentation.alwaysOnTop,
      focusView: normalizeFocusView(raw.presentation.focusView),
      panelOpacityPercent: raw.presentation.panelOpacityPercent,
      glassEnabled: raw.presentation.glassEnabled,
    },
    dock: structuredClone(raw.dock),
    loudnessProfile: { dependencyId },
  };
  return {
    canonical,
    snapshot: {
      ...workspace,
      ...presentation,
      dock,
      loudnessProfileActive: localProfileId === null ? "off" : profileSelectionId(localProfileId),
    },
  };
}

/** Strictly validates and canonicalizes an id-free Portable Preset V1 document. */
export function validatePortablePreset(raw) {
  return compilePortablePreset(raw).canonical;
}

/** Converts a portable document into the stored Preset shape using caller-owned identities. */
export function portableToStoredPreset(raw, id, { resolveDependencyId } = {}) {
  if (!normalizePortableItemId(id)) {
    throw new PortablePresetError([
      packIssue("invalidPresetId", "$.id", "The destination Preset ID is invalid."),
    ]);
  }
  const { canonical, snapshot } = compilePortablePreset(raw, { resolveDependencyId });
  return { id, name: canonical.name, ...snapshot };
}

export function serializePortablePreset(raw) {
  function sortJson(value) {
    if (Array.isArray(value)) return value.map(sortJson);
    if (!isPlainObject(value)) return value;
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortJson(value[key])])
    );
  }
  return JSON.stringify(sortJson(validatePortablePreset(raw)));
}

export function assessPortablePresetCommunityPublication(raw, { dependencyIds = [] } = {}) {
  const available = new Set(dependencyIds);
  const { canonical } = compilePortablePreset(raw, {
    resolveDependencyId: (id) => (available.has(id) ? id : null),
  });
  return {
    document: canonical,
    compatibility: {
      moduleIds: [...new Set(canonical.workspace.panels.map(({ moduleId }) => moduleId))].sort(),
      dependencyIds:
        canonical.loudnessProfile.dependencyId === null
          ? []
          : [canonical.loudnessProfile.dependencyId],
      optionalCapabilities: [
        ...(canonical.dock.enabled ? ["dock"] : []),
        ...(canonical.dock.enabled && canonical.dock.reserveSpace ? ["dockReserveSpace"] : []),
        ...(canonical.presentation.glassEnabled ? ["glass"] : []),
      ],
    },
    communityPublication: { eligible: true, blockers: [] },
  };
}

export async function hashPortablePreset(raw) {
  const bytes = new TextEncoder().encode(serializePortablePreset(raw));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  const hex = [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  return `sha256:${hex}`;
}
