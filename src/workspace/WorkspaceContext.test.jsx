/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import { WorkspaceProvider, useWorkspaceStore } from "./WorkspaceContext.jsx";
import { DEFAULT_WORKSPACE_STATE } from "./constants.js";
import { presetsStore, workspaceStore } from "../persistence/index.js";

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

/** @returns {import("./types.js").LeafNode} */
function leaf(tabs, activeTab = tabs[0]) {
  return { type: "leaf", tabs: [...tabs], activeTab };
}

/** @returns {import("./types.js").SplitNode} */
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
    /** @type {any} */
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
    /** @type {any} */
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
    /** @type {any} */
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
    /** @type {any} */
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

describe("WorkspaceContext workspace replacement", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  function renderActions() {
    let actions = null;
    render(
      <WorkspaceProvider>
        <ActionsProbe onActions={(a) => (actions = a)} />
      </WorkspaceProvider>
    );
    return actions;
  }

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

  it("replaces an externally supplied workspace in one state transition", () => {
    const persistedPatch = vi.spyOn(workspaceStore, "patchCoalesced");
    const snapshots = [];
    /** @type {any} */
    let actions = null;
    render(
      <WorkspaceProvider>
        <ActionsProbe
          onActions={(next) => {
            actions = next;
            snapshots.push(next.state);
          }}
        />
      </WorkspaceProvider>
    );
    persistedPatch.mockClear();

    const view = {
      ...DEFAULT_WORKSPACE_STATE,
      tree: leaf(["spectrum"]),
      panelOrder: ["spectrum"],
      panelsById: { spectrum: DEFAULT_WORKSPACE_STATE.panelsById.spectrum },
      panelControlsById: {
        spectrum: DEFAULT_WORKSPACE_STATE.panelControlsById.spectrum,
      },
    };
    const beforeCount = snapshots.length;

    act(() => actions.replaceWorkspace(view));

    expect(snapshots).toHaveLength(beforeCount + 1);
    expect(actions.state.tree).toEqual(view.tree);
    expect(persistedPatch).toHaveBeenCalledTimes(1);
    expect(persistedPatch).toHaveBeenCalledWith(
      expect.objectContaining({ tree: view.tree, panelOrder: ["spectrum"] })
    );
  });

  it("settles persistence waiters only after panel controls have been enqueued", async () => {
    /** @type {any} */
    let actions = null;
    render(
      <WorkspaceProvider>
        <ActionsProbe onActions={(next) => (actions = next)} />
      </WorkspaceProvider>
    );
    const nextControls = {
      ...actions.state.panelControlsById.levelMeter,
      levelMeterMode: "rms",
    };
    const target = {
      ...actions.state,
      panelControlsById: {
        ...actions.state.panelControlsById,
        levelMeter: nextControls,
      },
    };
    let settled = false;

    void actions.waitForWorkspacePersistenceEnqueue(target).then(() => (settled = true));
    await Promise.resolve();

    expect(settled).toBe(false);
    act(() => actions.setPanelControlsForPanel("levelMeter", nextControls));
    await waitFor(() => expect(settled).toBe(true));
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
