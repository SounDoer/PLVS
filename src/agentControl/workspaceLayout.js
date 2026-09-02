import { normalizeAxisViewportsState } from "../workspace/axisViewports.js";
import { MODULE_CATALOG } from "../workspace/moduleCatalog.js";
import {
  createDefaultPanelControls,
  normalizePanelControlsById,
} from "../workspace/panelControlInstances.js";
import { createPanel } from "../workspace/panelInstances.js";
import { normalizePinnedPanelsById } from "../workspace/reducer.js";

export const MAX_LAYOUT_BYTES = 256 * 1024;
export const MAX_LAYOUT_DEPTH = 32;
export const MAX_LAYOUT_PANELS = 64;

const MIN_PUBLIC_WEIGHT = 0.000001;

export class WorkspaceLayoutError extends Error {
  constructor(reason, path, message) {
    super(message);
    this.name = "WorkspaceLayoutError";
    this.reason = reason;
    this.path = path;
  }
}

function fail(reason, path, message) {
  throw new WorkspaceLayoutError(reason, path, message);
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertObject(value, path) {
  if (!isPlainObject(value)) {
    fail("invalid_node", path, "Layout nodes must be plain objects.");
  }
}

function assertKnownFields(node, allowed, path) {
  for (const key of Object.keys(node)) {
    if (!allowed.has(key)) {
      fail("unknown_field", `${path}.${key}`, `Unknown layout field: ${key}.`);
    }
  }
}

function effectivePublicWeights(sizes, childCount) {
  if (!Array.isArray(sizes) || sizes.length !== childCount) return undefined;
  if (sizes.every((size) => size === null)) return undefined;

  const fixedTotal = sizes.reduce(
    (total, size) => (Number.isFinite(size) && size > 0 ? total + size : total),
    0
  );
  const flexibleCount = sizes.filter((size) => size === null).length;
  const flexibleWeight =
    flexibleCount > 0 && fixedTotal < 1 ? (1 - fixedTotal) / flexibleCount : MIN_PUBLIC_WEIGHT;

  const weights = sizes.map((size) => {
    if (size === null) return flexibleWeight;
    return Number.isFinite(size) && size > 0 ? size : MIN_PUBLIC_WEIGHT;
  });

  return weights.every((weight) => weight === weights[0]) ? undefined : weights;
}

function serializeNode(node) {
  if (node.type === "leaf") {
    if (node.tabs.length === 1) {
      return { type: "panel", panelId: node.tabs[0] };
    }
    return {
      type: "tabs",
      active: node.tabs.includes(node.activeTab) ? node.activeTab : node.tabs[0],
      children: node.tabs.map((panelId) => ({ type: "panel", panelId })),
    };
  }

  const weights = effectivePublicWeights(node.sizes, node.children.length);
  return {
    type: "split",
    direction: node.direction === "h" ? "horizontal" : "vertical",
    ...(weights ? { weights } : {}),
    children: node.children.map(serializeNode),
  };
}

export function serializeWorkspaceLayout(workspace) {
  return serializeNode(workspace.tree);
}

function measurePayload(layout) {
  let serialized;
  try {
    serialized = JSON.stringify(layout);
  } catch {
    fail("invalid_document", "$", "Layout must be JSON serializable.");
  }
  if (serialized === undefined) {
    fail("invalid_document", "$", "Layout must be a JSON document.");
  }
  if (new TextEncoder().encode(serialized).byteLength > MAX_LAYOUT_BYTES) {
    fail("layout_too_large", "$", `Layout exceeds the ${MAX_LAYOUT_BYTES}-byte limit.`);
  }
}

function normalizeWeights(weights, childCount, path) {
  if (weights === undefined) return Array.from({ length: childCount }, () => null);
  if (!Array.isArray(weights) || weights.length !== childCount) {
    fail("invalid_weights", path, "Split weights must contain exactly one value per child.");
  }

  weights.forEach((weight, index) => {
    if (!Number.isFinite(weight) || weight <= 0) {
      fail("invalid_weight", `${path}[${index}]`, "Split weights must be finite and positive.");
    }
  });

  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return weights.map((weight) => weight / total);
}

export function compileWorkspaceLayout(layout, workspace) {
  measurePayload(layout);

  const currentPanels = workspace?.panelsById ?? {};
  const allocationPanels = { ...currentPanels };
  const panelsById = {};
  const panelOrder = [];
  const createdPanels = {};
  const usedPanelIds = new Set();
  const usedKeys = new Map();
  let panelCount = 0;

  function countPanel(path) {
    panelCount += 1;
    if (panelCount > MAX_LAYOUT_PANELS) {
      fail("too_many_panels", path, `Layout exceeds the ${MAX_LAYOUT_PANELS}-panel limit.`);
    }
  }

  function compilePanel(node, path, depth) {
    if (depth > MAX_LAYOUT_DEPTH) {
      fail("layout_too_deep", path, `Layout exceeds the depth limit of ${MAX_LAYOUT_DEPTH}.`);
    }
    assertObject(node, path);
    if (node.type !== "panel") {
      fail("invalid_tabs_child", `${path}.type`, "Tabs children must be panel nodes.");
    }
    countPanel(path);

    const hasPanelId = Object.prototype.hasOwnProperty.call(node, "panelId");
    if (hasPanelId) {
      assertKnownFields(node, new Set(["type", "panelId"]), path);
      if (typeof node.panelId !== "string" || node.panelId.trim() === "") {
        fail("missing_panel_id", `${path}.panelId`, "Existing panels require a panelId.");
      }
      if (!currentPanels[node.panelId]) {
        fail("unknown_panel", `${path}.panelId`, `Unknown panelId: ${node.panelId}.`);
      }
      if (usedPanelIds.has(node.panelId)) {
        fail("duplicate_panel", `${path}.panelId`, `Panel ${node.panelId} is used more than once.`);
      }
      if (usedKeys.has(node.panelId)) {
        fail(
          "key_conflict",
          usedKeys.get(node.panelId),
          `New-panel key conflicts with panelId ${node.panelId}.`
        );
      }

      usedPanelIds.add(node.panelId);
      panelsById[node.panelId] = currentPanels[node.panelId];
      panelOrder.push(node.panelId);
      return { panelId: node.panelId, reference: node.panelId };
    }

    assertKnownFields(node, new Set(["type", "key", "moduleId", "title"]), path);
    if (!Object.prototype.hasOwnProperty.call(node, "key")) {
      fail("missing_key", `${path}.key`, "New panels require a key.");
    }
    if (typeof node.key !== "string" || node.key.trim() === "") {
      fail("invalid_key", `${path}.key`, "New-panel keys must be non-empty strings.");
    }
    if (usedKeys.has(node.key)) {
      fail("duplicate_key", `${path}.key`, `New-panel key ${node.key} is used more than once.`);
    }
    if (usedPanelIds.has(node.key)) {
      fail("key_conflict", `${path}.key`, `New-panel key conflicts with panelId ${node.key}.`);
    }
    if (typeof node.moduleId !== "string" || !MODULE_CATALOG[node.moduleId]) {
      fail("unknown_module", `${path}.moduleId`, `Unknown moduleId: ${String(node.moduleId)}.`);
    }
    if (node.title !== undefined && typeof node.title !== "string") {
      fail("invalid_title", `${path}.title`, "Panel title must be a string.");
    }

    usedKeys.set(node.key, `${path}.key`);
    const created = createPanel(node.moduleId, allocationPanels, { customTitle: node.title });
    allocationPanels[created.id] = created;
    panelsById[created.id] = created;
    panelOrder.push(created.id);
    createdPanels[node.key] = created.id;
    return { panelId: created.id, reference: node.key };
  }

  function compileNode(node, path, depth) {
    if (depth > MAX_LAYOUT_DEPTH) {
      fail("layout_too_deep", path, `Layout exceeds the depth limit of ${MAX_LAYOUT_DEPTH}.`);
    }
    assertObject(node, path);

    if (node.type === "panel") {
      const compiled = compilePanel(node, path, depth);
      return { type: "leaf", tabs: [compiled.panelId], activeTab: compiled.panelId };
    }

    if (node.type === "tabs") {
      assertKnownFields(node, new Set(["type", "active", "children"]), path);
      if (!Array.isArray(node.children) || node.children.length === 0) {
        fail("invalid_child_count", `${path}.children`, "Tabs require at least one child.");
      }
      if (node.active !== undefined && typeof node.active !== "string") {
        fail("invalid_active", `${path}.active`, "Tabs active must name a child.");
      }

      const compiledChildren = node.children.map((child, index) =>
        compilePanel(child, `${path}.children[${index}]`, depth + 1)
      );
      const activeChild =
        node.active === undefined
          ? compiledChildren[0]
          : compiledChildren.find((child) => child.reference === node.active);
      if (!activeChild) {
        fail("invalid_active", `${path}.active`, "Tabs active must name one of its children.");
      }
      return {
        type: "leaf",
        tabs: compiledChildren.map((child) => child.panelId),
        activeTab: activeChild.panelId,
      };
    }

    if (node.type === "split") {
      assertKnownFields(node, new Set(["type", "direction", "weights", "children"]), path);
      if (!Array.isArray(node.children) || node.children.length < 2) {
        fail("invalid_child_count", `${path}.children`, "Splits require at least two children.");
      }
      if (node.direction !== "horizontal" && node.direction !== "vertical") {
        fail(
          "invalid_direction",
          `${path}.direction`,
          "Split direction must be horizontal or vertical."
        );
      }
      const sizes = normalizeWeights(node.weights, node.children.length, `${path}.weights`);
      return {
        type: "split",
        direction: node.direction === "horizontal" ? "h" : "v",
        sizes,
        children: node.children.map((child, index) =>
          compileNode(child, `${path}.children[${index}]`, depth + 1)
        ),
      };
    }

    fail("unknown_node_type", `${path}.type`, `Unknown layout node type: ${String(node.type)}.`);
  }

  const tree = compileNode(layout, "$", 1);
  const panelControlsById = normalizePanelControlsById(panelsById, workspace?.panelControlsById);
  for (const panelId of Object.values(createdPanels)) {
    panelControlsById[panelId] = createDefaultPanelControls();
  }

  const view = {
    tree,
    panelsById,
    panelOrder,
    panelControlsById,
    pinnedPanelsById: normalizePinnedPanelsById(panelsById, workspace?.pinnedPanelsById),
    axisViewports: normalizeAxisViewportsState(workspace?.axisViewports),
    fullscreenId: null,
  };

  return {
    view,
    layout: serializeWorkspaceLayout(view),
    createdPanels,
  };
}
