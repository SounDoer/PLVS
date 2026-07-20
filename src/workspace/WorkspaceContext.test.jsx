/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { act, render } from "@testing-library/react";
import { WorkspaceProvider, useWorkspaceStore } from "./WorkspaceContext.jsx";
import { DEFAULT_WORKSPACE_STATE } from "./constants.js";
import { presetsStore, settingsStore, workspaceStore } from "../persistence/index.js";

function Probe({ onState }) {
  const { state } = useWorkspaceStore();
  onState(state);
  return null;
}

function ActionsProbe({ onActions }) {
  const actions = useWorkspaceStore();
  onActions(actions);
  return null;
}

function leaf(tabs, activeTab = tabs[0]) {
  return { type: "leaf", tabs: [...tabs], activeTab };
}

function split(direction, children, sizes) {
  return { type: "split", direction, children, sizes: sizes ?? children.map(() => null) };
}

describe("WorkspaceContext fullscreenId", () => {
  afterEach(() => localStorage.clear());

  it("never restores fullscreenId from storage", () => {
    localStorage.setItem(
      "plvs:workspace",
      JSON.stringify({ ...DEFAULT_WORKSPACE_STATE, fullscreenId: "levelMeter" })
    );
    let captured = null;
    render(
      <WorkspaceProvider>
        <Probe onState={(s) => (captured = s)} />
      </WorkspaceProvider>
    );
    expect(captured.fullscreenId).toBeNull();
  });

  it("restores pinned panel sizes from storage", () => {
    localStorage.setItem(
      "plvs:workspace",
      JSON.stringify({
        ...DEFAULT_WORKSPACE_STATE,
        pinnedPanelsById: { spectrum: { width: 640, height: 260 } },
      })
    );
    let captured = null;
    render(
      <WorkspaceProvider>
        <Probe onState={(s) => (captured = s)} />
      </WorkspaceProvider>
    );
    expect(captured.pinnedPanelsById).toEqual({ spectrum: { width: 640, height: 260 } });
  });

  it("normalizes older stored workspaces without pinned panel sizes", () => {
    const { pinnedPanelsById: _pinnedPanelsById, ...legacyState } = DEFAULT_WORKSPACE_STATE;
    localStorage.setItem("plvs:workspace", JSON.stringify(legacyState));
    let captured = null;
    render(
      <WorkspaceProvider>
        <Probe onState={(s) => (captured = s)} />
      </WorkspaceProvider>
    );
    expect(captured.pinnedPanelsById).toEqual({});
  });
});

describe("WorkspaceContext initState unknown module guard", () => {
  afterEach(() => localStorage.clear());

  it("resets to defaults when persisted workspace references an unknown moduleId", () => {
    localStorage.setItem(
      "plvs:workspace",
      JSON.stringify({
        ...DEFAULT_WORKSPACE_STATE,
        panelsById: {
          ...DEFAULT_WORKSPACE_STATE.panelsById,
          loudnessStats: { id: "loudnessStats", moduleId: "loudnessStats" },
        },
        panelOrder: [...DEFAULT_WORKSPACE_STATE.panelOrder, "loudnessStats"],
      })
    );
    let captured = null;
    render(
      <WorkspaceProvider>
        <Probe onState={(s) => (captured = s)} />
      </WorkspaceProvider>
    );
    expect(captured.tree).toEqual(DEFAULT_WORKSPACE_STATE.tree);
    expect(captured.panelsById).toEqual(DEFAULT_WORKSPACE_STATE.panelsById);
  });
});

describe("WorkspaceContext active preset divergence", () => {
  afterEach(() => localStorage.clear());

  function renderActions() {
    let actions = null;
    render(
      <WorkspaceProvider>
        <ActionsProbe onActions={(a) => (actions = a)} />
      </WorkspaceProvider>
    );
    return actions;
  }

  it("marks presets dirty on manual setTree", () => {
    presetsStore.patch({ list: [{ id: "p1", name: "Preset" }], activeId: "p1" });
    const actions = renderActions();
    act(() => actions.setTree(leaf(["levelMeter"])));
    expect(presetsStore.read().activeId).toBe("p1");
    expect(presetsStore.read().dirty).toBe(true);
  });

  it("marks presets dirty on manual moveTab", () => {
    presetsStore.patch({ list: [{ id: "p1", name: "Preset" }], activeId: "p1" });
    const actions = renderActions();
    act(() => actions.moveTab("levelMeter", { targetPath: [1, 0], zone: "tabs", tabIndex: 0 }));
    expect(presetsStore.read().activeId).toBe("p1");
    expect(presetsStore.read().dirty).toBe(true);
  });

  it("marks presets dirty on manual addPanel", () => {
    presetsStore.patch({ list: [{ id: "p1", name: "Preset" }], activeId: "p1" });
    const actions = renderActions();
    act(() => actions.addPanel("levelMeter"));
    expect(presetsStore.read().activeId).toBe("p1");
    expect(presetsStore.read().dirty).toBe(true);
  });

  it("marks presets dirty on manual resetWorkspace", () => {
    presetsStore.patch({ list: [{ id: "p1", name: "Preset" }], activeId: "p1" });
    const actions = renderActions();
    act(() => actions.resetWorkspace());
    expect(presetsStore.read().activeId).toBe("p1");
    expect(presetsStore.read().dirty).toBe(true);
  });

  it("marks presets dirty on manual removePanel", () => {
    presetsStore.patch({ list: [{ id: "p1", name: "Preset" }], activeId: "p1" });
    const actions = renderActions();
    act(() => actions.removePanel("levelMeter"));
    expect(presetsStore.read().activeId).toBe("p1");
    expect(presetsStore.read().dirty).toBe(true);
  });

  it("marks presets dirty on manual renamePanel", () => {
    presetsStore.patch({ list: [{ id: "p1", name: "Preset" }], activeId: "p1" });
    const actions = renderActions();
    act(() => actions.renamePanel("levelMeter", "Main Meter"));
    expect(presetsStore.read().activeId).toBe("p1");
    expect(presetsStore.read().dirty).toBe(true);
  });

  it("marks presets dirty on manual panel pin changes", () => {
    presetsStore.patch({ list: [{ id: "p1", name: "Preset" }], activeId: "p1" });
    const actions = renderActions();
    act(() => actions.setPanelPinned("spectrum", { width: 640, height: 260 }));
    expect(presetsStore.read().activeId).toBe("p1");
    expect(presetsStore.read().dirty).toBe(true);
  });

  it("marks presets dirty when one panel instance is reset", () => {
    presetsStore.patch({ list: [{ id: "p1", name: "Preset" }], activeId: "p1" });
    const actions = renderActions();
    act(() => actions.resetPanelControlsForPanel("levelMeter"));
    expect(presetsStore.read().activeId).toBe("p1");
    expect(presetsStore.read().dirty).toBe(true);
  });

  it("does not clear presets.activeId when applying setView", () => {
    presetsStore.patch({ list: [{ id: "p1", name: "Preset" }], activeId: "p1" });
    const actions = renderActions();
    act(() =>
      actions.setView({
        tree: split("h", [leaf(["levelMeter"]), leaf(["loudness"])]),
        panelsById: DEFAULT_WORKSPACE_STATE.panelsById,
        panelOrder: DEFAULT_WORKSPACE_STATE.panelOrder,
        panelControlsById: DEFAULT_WORKSPACE_STATE.panelControlsById,
      })
    );
    expect(presetsStore.read().activeId).toBe("p1");
  });

  it("does not overwrite a Dock preset applied alongside the main workspace view", () => {
    const previousDock = {
      panelOrder: ["levelMeter", "stats"],
      panelSizesById: { levelMeter: 180, stats: 240 },
    };
    const presetDock = {
      panelOrder: ["stats", "levelMeter"],
      panelSizesById: { stats: 300, levelMeter: 200 },
    };
    localStorage.setItem(
      "plvs:workspace",
      JSON.stringify({ ...DEFAULT_WORKSPACE_STATE, dock: previousDock })
    );
    const actions = renderActions();

    act(() => {
      workspaceStore.patch({ dock: presetDock });
      actions.setView({
        tree: DEFAULT_WORKSPACE_STATE.tree,
        panelsById: DEFAULT_WORKSPACE_STATE.panelsById,
        panelOrder: DEFAULT_WORKSPACE_STATE.panelOrder,
        panelControlsById: DEFAULT_WORKSPACE_STATE.panelControlsById,
      });
    });

    expect(actions.state.dock).toBeUndefined();
    expect(workspaceStore.read().dock).toEqual(presetDock);
  });
});
