/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { act, render } from "@testing-library/react";
import { WorkspaceProvider, useWorkspaceStore } from "./WorkspaceContext.jsx";
import { DEFAULT_WORKSPACE_STATE } from "./constants.js";
import { presetsStore } from "../persistence/index.js";

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

  it("clears presets.activeId on manual setTree", () => {
    presetsStore.patch({ list: [{ id: "p1", name: "Preset" }], activeId: "p1" });
    const actions = renderActions();
    act(() => actions.setTree(leaf(["levelMeter"])));
    expect(presetsStore.read().activeId).toBeNull();
  });

  it("clears presets.activeId on manual moveTab", () => {
    presetsStore.patch({ list: [{ id: "p1", name: "Preset" }], activeId: "p1" });
    const actions = renderActions();
    act(() => actions.moveTab("levelMeter", { targetPath: [1, 0], zone: "tabs", tabIndex: 0 }));
    expect(presetsStore.read().activeId).toBeNull();
  });

  it("clears presets.activeId on manual addPanel", () => {
    presetsStore.patch({ list: [{ id: "p1", name: "Preset" }], activeId: "p1" });
    const actions = renderActions();
    act(() => actions.addPanel("levelMeter"));
    expect(presetsStore.read().activeId).toBeNull();
  });

  it("clears presets.activeId on manual resetWorkspace", () => {
    presetsStore.patch({ list: [{ id: "p1", name: "Preset" }], activeId: "p1" });
    const actions = renderActions();
    act(() => actions.resetWorkspace());
    expect(presetsStore.read().activeId).toBeNull();
  });

  it("clears presets.activeId on manual removePanel", () => {
    presetsStore.patch({ list: [{ id: "p1", name: "Preset" }], activeId: "p1" });
    const actions = renderActions();
    act(() => actions.removePanel("levelMeter"));
    expect(presetsStore.read().activeId).toBeNull();
  });

  it("clears presets.activeId on manual renamePanel", () => {
    presetsStore.patch({ list: [{ id: "p1", name: "Preset" }], activeId: "p1" });
    const actions = renderActions();
    act(() => actions.renamePanel("levelMeter", "Main Meter"));
    expect(presetsStore.read().activeId).toBeNull();
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
});
