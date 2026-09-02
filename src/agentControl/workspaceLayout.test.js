import { describe, expect, it } from "vitest";
import { normalizeAxisViewportsState } from "../workspace/axisViewports.js";
import { createDefaultPanelControls } from "../workspace/panelControlInstances.js";
import {
  MAX_LAYOUT_BYTES,
  MAX_LAYOUT_DEPTH,
  MAX_LAYOUT_PANELS,
  compileWorkspaceLayout,
  serializeWorkspaceLayout,
} from "./workspaceLayout.js";

function panel(id, moduleId = id, extra = {}) {
  return { id, moduleId, ...extra };
}

function workspace(overrides = {}) {
  const panelsById = {
    levelMeter: panel("levelMeter"),
    spectrum: panel("spectrum", "spectrum", { customTitle: "Main Spectrum", config: { bin: 4 } }),
    waveform: panel("waveform"),
    stats: panel("stats"),
  };
  return {
    tree: { type: "leaf", tabs: ["levelMeter"], activeTab: "levelMeter" },
    panelsById,
    panelOrder: Object.keys(panelsById),
    panelControlsById: Object.fromEntries(
      Object.keys(panelsById).map((id) => [id, createDefaultPanelControls()])
    ),
    pinnedPanelsById: { spectrum: { width: 320, height: 180 } },
    axisViewports: normalizeAxisViewportsState(),
    fullscreenId: "levelMeter",
    ...overrides,
  };
}

describe("serializeWorkspaceLayout", () => {
  it("serializes a single-tab leaf as an existing panel reference", () => {
    expect(serializeWorkspaceLayout(workspace())).toEqual({
      type: "panel",
      panelId: "levelMeter",
    });
  });

  it("serializes tabs in order and preserves the active panel", () => {
    const current = workspace({
      tree: {
        type: "leaf",
        tabs: ["spectrum", "waveform"],
        activeTab: "waveform",
      },
    });

    expect(serializeWorkspaceLayout(current)).toEqual({
      type: "tabs",
      active: "waveform",
      children: [
        { type: "panel", panelId: "spectrum" },
        { type: "panel", panelId: "waveform" },
      ],
    });
  });

  it("maps internal split directions and effective sizes to public weights", () => {
    const current = workspace({
      tree: {
        type: "split",
        direction: "h",
        sizes: [0.2, null, 0.3],
        children: [
          { type: "leaf", tabs: ["levelMeter"], activeTab: "levelMeter" },
          { type: "leaf", tabs: ["spectrum"], activeTab: "spectrum" },
          {
            type: "split",
            direction: "v",
            sizes: [null, null],
            children: [
              { type: "leaf", tabs: ["waveform"], activeTab: "waveform" },
              { type: "leaf", tabs: ["stats"], activeTab: "stats" },
            ],
          },
        ],
      },
    });

    const layout = serializeWorkspaceLayout(current);
    expect(layout.direction).toBe("horizontal");
    expect(layout.weights).toEqual([0.2, 0.5, 0.3]);
    expect(layout.children[2]).toMatchObject({ direction: "vertical" });
    expect(layout.children[2]).not.toHaveProperty("weights");
  });

  it("round-trips a production-like tree without leaking internal panel state", () => {
    const current = workspace({
      tree: {
        type: "split",
        direction: "h",
        sizes: [0.25, 0.75],
        children: [
          { type: "leaf", tabs: ["levelMeter"], activeTab: "levelMeter" },
          {
            type: "leaf",
            tabs: ["spectrum", "waveform"],
            activeTab: "spectrum",
          },
        ],
      },
    });

    const layout = serializeWorkspaceLayout(current);
    const result = compileWorkspaceLayout(layout, current);

    expect(serializeWorkspaceLayout(result.view)).toEqual(layout);
    expect(JSON.stringify(layout)).not.toMatch(/controls|config|pinned|fullscreen/);
    expect(result.view.panelsById.spectrum).toBe(current.panelsById.spectrum);
    expect(result.view.panelControlsById.spectrum).toEqual(current.panelControlsById.spectrum);
  });
});

describe("compileWorkspaceLayout", () => {
  it("creates panels deterministically, preserves reused state, and drops omitted panels", () => {
    const current = workspace({
      panelsById: {
        ...workspace().panelsById,
        "stereo-map": panel("stereo-map", "stereo-map"),
      },
      pinnedPanelsById: {
        spectrum: { width: 320, height: 180 },
        stats: { width: 100, height: 90 },
      },
    });
    const layout = {
      type: "split",
      direction: "horizontal",
      children: [
        { type: "panel", panelId: "spectrum" },
        {
          type: "tabs",
          active: "second",
          children: [
            { type: "panel", key: "first", moduleId: "stereo-map" },
            { type: "panel", key: "second", moduleId: "stereo-map", title: "Phase" },
          ],
        },
      ],
    };

    const result = compileWorkspaceLayout(layout, current);

    expect(result.createdPanels).toEqual({ first: "stereo-map-2", second: "stereo-map-3" });
    expect(result.view.panelOrder).toEqual(["spectrum", "stereo-map-2", "stereo-map-3"]);
    expect(result.view.tree.children[1]).toEqual({
      type: "leaf",
      tabs: ["stereo-map-2", "stereo-map-3"],
      activeTab: "stereo-map-3",
    });
    expect(result.view.panelsById.spectrum).toBe(current.panelsById.spectrum);
    expect(result.view.panelsById["stereo-map-3"]).toMatchObject({
      id: "stereo-map-3",
      moduleId: "stereo-map",
      customTitle: "Phase",
    });
    expect(result.view.panelsById).not.toHaveProperty("stats");
    expect(result.view.pinnedPanelsById).toEqual({
      spectrum: { width: 320, height: 180 },
    });
    expect(result.view.axisViewports).toEqual(current.axisViewports);
    expect(result.layout).toEqual(serializeWorkspaceLayout(result.view));
  });

  it.each([
    ["unknown node type", { type: "grid", children: [] }, "unknown_node_type", "$ .type"],
    [
      "unknown field",
      { type: "panel", panelId: "spectrum", controls: {} },
      "unknown_field",
      "$ .controls",
    ],
    [
      "too few split children",
      {
        type: "split",
        direction: "horizontal",
        children: [{ type: "panel", panelId: "spectrum" }],
      },
      "invalid_child_count",
      "$ .children",
    ],
    [
      "invalid direction",
      {
        type: "split",
        direction: "diagonal",
        children: [
          { type: "panel", panelId: "spectrum" },
          { type: "panel", panelId: "waveform" },
        ],
      },
      "invalid_direction",
      "$ .direction",
    ],
    [
      "weight count mismatch",
      {
        type: "split",
        direction: "horizontal",
        weights: [1],
        children: [
          { type: "panel", panelId: "spectrum" },
          { type: "panel", panelId: "waveform" },
        ],
      },
      "invalid_weights",
      "$ .weights",
    ],
    [
      "non-positive weight",
      {
        type: "split",
        direction: "horizontal",
        weights: [1, 0],
        children: [
          { type: "panel", panelId: "spectrum" },
          { type: "panel", panelId: "waveform" },
        ],
      },
      "invalid_weight",
      "$ .weights[1]",
    ],
    ["empty tabs", { type: "tabs", children: [] }, "invalid_child_count", "$ .children"],
    [
      "invalid active tab",
      {
        type: "tabs",
        active: "missing",
        children: [{ type: "panel", panelId: "spectrum" }],
      },
      "invalid_active",
      "$ .active",
    ],
    [
      "unknown existing panel",
      { type: "panel", panelId: "missing" },
      "unknown_panel",
      "$ .panelId",
    ],
    ["missing new panel key", { type: "panel", moduleId: "spectrum" }, "missing_key", "$ .key"],
    [
      "empty new panel key",
      { type: "panel", key: "  ", moduleId: "spectrum" },
      "invalid_key",
      "$ .key",
    ],
    [
      "unknown module",
      { type: "panel", key: "new", moduleId: "meter-9000" },
      "unknown_module",
      "$ .moduleId",
    ],
  ])("rejects %s", (_label, layout, reason, path) => {
    expect(() => compileWorkspaceLayout(layout, workspace())).toThrowError(
      expect.objectContaining({ reason, path: path.replace("$ ", "$") })
    );
  });

  it("rejects repeated existing panels", () => {
    const layout = {
      type: "tabs",
      children: [
        { type: "panel", panelId: "spectrum" },
        { type: "panel", panelId: "spectrum" },
      ],
    };
    expect(() => compileWorkspaceLayout(layout, workspace())).toThrowError(
      expect.objectContaining({ reason: "duplicate_panel", path: "$.children[1].panelId" })
    );
  });

  it("rejects duplicate keys and keys that conflict with referenced panel IDs", () => {
    const duplicate = {
      type: "tabs",
      children: [
        { type: "panel", key: "new", moduleId: "spectrum" },
        { type: "panel", key: "new", moduleId: "waveform" },
      ],
    };
    expect(() => compileWorkspaceLayout(duplicate, workspace())).toThrowError(
      expect.objectContaining({ reason: "duplicate_key", path: "$.children[1].key" })
    );

    const conflict = {
      type: "tabs",
      children: [
        { type: "panel", panelId: "spectrum" },
        { type: "panel", key: "spectrum", moduleId: "waveform" },
      ],
    };
    expect(() => compileWorkspaceLayout(conflict, workspace())).toThrowError(
      expect.objectContaining({ reason: "key_conflict", path: "$.children[1].key" })
    );
  });

  it("enforces depth, panel-count, and payload ceilings", () => {
    let deep = { type: "panel", key: "deep-panel", moduleId: "spectrum" };
    for (let index = 0; index < MAX_LAYOUT_DEPTH; index += 1) {
      deep = {
        type: "split",
        direction: "horizontal",
        children: [deep, { type: "panel", key: `depth-side-${index}`, moduleId: "waveform" }],
      };
    }
    expect(() => compileWorkspaceLayout(deep, workspace())).toThrowError(
      expect.objectContaining({ reason: "layout_too_deep" })
    );

    const tooManyPanels = {
      type: "tabs",
      children: Array.from({ length: MAX_LAYOUT_PANELS + 1 }, (_, index) => ({
        type: "panel",
        key: `panel-${index}`,
        moduleId: "spectrum",
      })),
    };
    expect(() => compileWorkspaceLayout(tooManyPanels, workspace())).toThrowError(
      expect.objectContaining({ reason: "too_many_panels" })
    );

    const oversized = {
      type: "panel",
      key: "new",
      moduleId: "spectrum",
      title: "x".repeat(MAX_LAYOUT_BYTES),
    };
    expect(() => compileWorkspaceLayout(oversized, workspace())).toThrowError(
      expect.objectContaining({ reason: "layout_too_large", path: "$" })
    );
  });

  it("does not mutate the request or current workspace", () => {
    const current = workspace();
    const layout = {
      type: "tabs",
      children: [
        { type: "panel", panelId: "spectrum" },
        { type: "panel", key: "new", moduleId: "waveform" },
      ],
    };
    const beforeWorkspace = structuredClone(current);
    const beforeLayout = structuredClone(layout);

    compileWorkspaceLayout(layout, current);

    expect(layout).toEqual(beforeLayout);
    expect(current).toEqual(beforeWorkspace);
  });
});
