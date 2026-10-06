import { describe, expect, it, vi } from "vitest";

import { preparePanelSettingsNavigation } from "./panelSettingsNavigation.js";

const workspace = {
  tree: {
    type: "split",
    direction: "h",
    sizes: [null, null],
    children: [
      { type: "leaf", tabs: ["meter-a"], activeTab: "meter-a" },
      { type: "leaf", tabs: ["stats-a", "stats-b"], activeTab: "stats-a" },
    ],
  },
  panelsById: {
    "meter-a": { id: "meter-a", moduleId: "levelMeter" },
    "stats-a": { id: "stats-a", moduleId: "stats" },
    "stats-b": { id: "stats-b", moduleId: "stats" },
    detached: { id: "detached", moduleId: "stats" },
  },
  fullscreenId: null,
};

describe("preparePanelSettingsNavigation", () => {
  it("activates the exact hidden Panel instance through the Workspace action", () => {
    const setActiveTab = vi.fn();

    expect(
      preparePanelSettingsNavigation({
        panelId: "stats-b",
        windowForm: "normal",
        workspace,
        dockPanels: [],
        setActiveTab,
        openDockEditor: vi.fn(),
      })
    ).toEqual({ handled: false, presentation: "normal" });
    expect(setActiveTab).toHaveBeenCalledOnce();
    expect(setActiveTab).toHaveBeenCalledWith([1], "stats-b");
  });

  it("does not rewrite Workspace state when the exact Panel is already active", () => {
    const setActiveTab = vi.fn();

    expect(
      preparePanelSettingsNavigation({
        panelId: "meter-a",
        windowForm: "normal",
        workspace,
        dockPanels: [],
        setActiveTab,
        openDockEditor: vi.fn(),
      })
    ).toEqual({ handled: false, presentation: "normal" });
    expect(setActiveTab).not.toHaveBeenCalled();
  });

  it("targets only the fullscreen Panel and never exits fullscreen implicitly", () => {
    const setActiveTab = vi.fn();
    const fullscreenWorkspace = { ...workspace, fullscreenId: "stats-a" };

    expect(
      preparePanelSettingsNavigation({
        panelId: "stats-a",
        windowForm: "normal",
        workspace: fullscreenWorkspace,
        dockPanels: [],
        setActiveTab,
        openDockEditor: vi.fn(),
      })
    ).toEqual({ handled: false, presentation: "fullscreen" });
    expect(setActiveTab).not.toHaveBeenCalled();

    expect(() =>
      preparePanelSettingsNavigation({
        panelId: "stats-b",
        windowForm: "normal",
        workspace: fullscreenWorkspace,
        dockPanels: [],
        setActiveTab,
        openDockEditor: vi.fn(),
      })
    ).toThrowError(expect.objectContaining({ reason: "uiTargetNotVisible" }));
  });

  it("routes only a Dock Panel ID to the existing Dock editor action", () => {
    const openDockEditor = vi.fn();

    expect(
      preparePanelSettingsNavigation({
        panelId: "dock-stats",
        windowForm: "dock",
        workspace,
        dockPanels: [{ id: "dock-stats", moduleId: "stats" }],
        setActiveTab: vi.fn(),
        openDockEditor,
      })
    ).toEqual({ handled: true, presentation: "dock" });
    expect(openDockEditor).toHaveBeenCalledWith("module:dock-stats");

    expect(() =>
      preparePanelSettingsNavigation({
        panelId: "stats-a",
        windowForm: "dock",
        workspace,
        dockPanels: [{ id: "dock-stats", moduleId: "stats" }],
        setActiveTab: vi.fn(),
        openDockEditor,
      })
    ).toThrowError(expect.objectContaining({ reason: "uiTargetNotFound" }));
  });

  it("distinguishes a missing Panel from one outside the renderable tree", () => {
    const common = {
      windowForm: "normal",
      workspace,
      dockPanels: [],
      setActiveTab: vi.fn(),
      openDockEditor: vi.fn(),
    };

    expect(() => preparePanelSettingsNavigation({ ...common, panelId: "missing" })).toThrowError(
      expect.objectContaining({ reason: "uiTargetNotFound" })
    );
    expect(() => preparePanelSettingsNavigation({ ...common, panelId: "detached" })).toThrowError(
      expect.objectContaining({ reason: "uiTargetNotVisible" })
    );
  });
});
