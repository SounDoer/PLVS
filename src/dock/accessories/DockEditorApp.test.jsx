/** @vitest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { settingsStore } from "../../persistence/index.js";
import {
  DockEditorApp,
  measureDockEditorContent,
  measureSelectMenuRoom,
} from "./DockEditorApp.jsx";
import { standIn } from "../../testing/standIn.js";

const { action, client } = vi.hoisted(() => ({
  action: vi.fn(),
  client: {
    payload: null,
    action: null,
  },
}));

const PRESETS_PAYLOAD = {
  view: "presets",
  panels: [],
  panelsById: {},
  panelOrder: [],
  controlsByPanelId: {},
  presets: { list: [], activeId: null, dirty: false },
};

vi.mock("./useAccessoryClient.js", () => ({
  useAccessoryClient: () => client,
}));

describe("DockEditorApp window behavior", () => {
  it("routes status actions through the main window and keeps read-only details dismissible", () => {
    client.payload = {
      ...PRESETS_PAYLOAD,
      view: "status",
      statusItems: [
        {
          id: "update",
          kind: "update",
          text: "Update Available",
          details: "Version 1",
          action: "update",
        },
      ],
    };
    render(<DockEditorApp />);
    fireEvent.click(screen.getByRole("button", { name: "View Update Details" }));
    expect(measureDockEditorContent(screen.getByTestId("dock-editor"))).not.toBeNull();
    expect(screen.getAllByText("Status")).toHaveLength(1);
    expect(action).toHaveBeenCalledWith("status-action", { action: "update" });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(action).toHaveBeenCalledWith("close-editor");
  });
  beforeEach(() => {
    action.mockClear();
    client.payload = PRESETS_PAYLOAD;
    client.action = action;
  });

  it("closes when the accessory window loses focus", async () => {
    render(<DockEditorApp />);

    fireEvent(window, new Event("blur"));

    await waitFor(() =>
      expect(action).toHaveBeenCalledWith("close-editor", { view: "presets", reason: "blur" })
    );
  });

  it("closes when a transparent viewport remainder is clicked", () => {
    render(<DockEditorApp />);

    fireEvent.pointerDown(document.body);

    expect(action).toHaveBeenCalledWith("close-editor");
  });

  it("keeps the editor open when interacting with a floating settings selector", () => {
    client.payload = {
      ...PRESETS_PAYLOAD,
      view: "module:levelMeter",
      panelsById: { levelMeter: { id: "levelMeter", moduleId: "levelMeter" } },
      panelOrder: ["levelMeter"],
      controlsByPanelId: {
        levelMeter: { levelMeterMode: "peak", readout: "live", showLabels: true },
      },
    };
    render(<DockEditorApp />);
    const trigger = screen.getByRole("combobox", { name: "level meter mode" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const option = screen.getByRole("option", { name: "Momentary" });
    fireEvent.pointerDown(option);
    expect(action).not.toHaveBeenCalledWith("close-editor");
    fireEvent.keyDown(option, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(action).not.toHaveBeenCalledWith("close-editor");
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(action).toHaveBeenCalledWith("close-editor");
  });

  it.each([
    ["Top", "set-edge", { edge: "top" }],
    ["Off", "restore-window", undefined],
  ])(
    "dispatches Dock %s on pointer selection without closing the editor first",
    (label, type, payload) => {
      client.payload = { ...PRESETS_PAYLOAD, view: "views", edge: "bottom" };
      render(<DockEditorApp />);
      fireEvent.keyDown(screen.getByRole("combobox", { name: "Dock position" }), {
        key: "ArrowDown",
      });
      const option = screen.getByRole("option", { name: label });
      fireEvent.pointerDown(option);
      fireEvent.pointerUp(option);
      fireEvent.click(option);
      expect(action).not.toHaveBeenCalledWith("close-editor");
      if (payload) expect(action).toHaveBeenCalledWith(type, payload);
      else expect(action).toHaveBeenCalledWith(type);
    }
  );

  it("does not close on focus loss during an active editor drag", () => {
    render(<DockEditorApp />);
    const editor = screen.getByTestId("dock-editor");

    fireEvent.pointerDown(editor);
    fireEvent(window, new Event("blur"));
    fireEvent.pointerUp(window);

    expect(action).not.toHaveBeenCalledWith("close-editor");
  });

  it("measures intrinsic content instead of an expanded scroll viewport", () => {
    render(<DockEditorApp />);
    const root = screen.getByTestId("dock-editor");
    const shell = root.querySelector("[data-dock-editor-shell]");
    const scroll = root.querySelector("[data-dock-editor-scroll]");
    const content = root.querySelector("[data-dock-editor-content]");
    const header = shell.querySelector("header");
    Object.defineProperties(root, { scrollWidth: { configurable: true, value: 238 } });
    Object.defineProperties(shell, { scrollWidth: { configurable: true, value: 238 } });
    Object.defineProperties(scroll, { scrollHeight: { configurable: true, value: 640 } });
    Object.defineProperties(content, {
      scrollWidth: { configurable: true, value: 238 },
      scrollHeight: { configurable: true, value: 129 },
    });
    Object.defineProperties(header, { offsetHeight: { configurable: true, value: 40 } });

    expect(measureDockEditorContent(root)).toEqual({ width: 240, height: 171 });
  });

  it("includes settings surface padding in its intrinsic height", () => {
    client.payload = {
      ...PRESETS_PAYLOAD,
      view: "module:levelMeter",
      panelsById: { levelMeter: { id: "levelMeter", moduleId: "levelMeter" } },
      panelOrder: ["levelMeter"],
      controlsByPanelId: {
        levelMeter: { levelMeterMode: "peak", readout: "live", showLabels: true },
      },
    };
    render(<DockEditorApp />);
    const root = screen.getByTestId("dock-editor");
    const shell = root.querySelector("[data-dock-editor-shell]");
    const content = root.querySelector("[data-dock-editor-content]");
    const header = shell.querySelector("header");
    root.style.paddingTop = "4px";
    root.style.paddingBottom = "4px";
    root.style.borderTopWidth = "1px";
    root.style.borderBottomWidth = "1px";
    root.style.borderTopStyle = "solid";
    root.style.borderBottomStyle = "solid";
    Object.defineProperties(root, { scrollWidth: { configurable: true, value: 190 } });
    Object.defineProperties(shell, { scrollWidth: { configurable: true, value: 190 } });
    Object.defineProperties(content, {
      scrollWidth: { configurable: true, value: 190 },
      scrollHeight: { configurable: true, value: 80 },
    });
    Object.defineProperties(header, { offsetHeight: { configurable: true, value: 28 } });

    expect(measureDockEditorContent(root)).toEqual({ width: 192, height: 118 });
  });

  it.each([
    ["top", 348],
    ["bottom", 360],
  ])("keeps room for select menus on the far side of a %s Dock", async (edge, room) => {
    // jsdom has none, and an open select scrolls its selected option into view.
    HTMLElement.prototype.scrollIntoView = vi.fn();
    client.payload = {
      ...PRESETS_PAYLOAD,
      edge,
      view: "module:levelMeter",
      panelsById: { levelMeter: { id: "levelMeter", moduleId: "levelMeter" } },
      panelOrder: ["levelMeter"],
      controlsByPanelId: {
        levelMeter: { levelMeterMode: "peak", readout: "live", showLabels: true },
      },
    };
    render(<DockEditorApp />);
    const root = screen.getByTestId("dock-editor");
    const rect = (top, bottom) => standIn({ top, bottom, left: 0, right: 200, width: 200 });
    vi.spyOn(root, "getBoundingClientRect").mockReturnValue(rect(0, 120));
    for (const trigger of screen.getAllByRole("combobox")) {
      vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue(rect(40, 68));
    }

    // The tallest menu is 24rem = 384, plus a 16 margin; 52 is free below the triggers, 40 above.
    expect(measureSelectMenuRoom(root, edge)).toBe(room);

    // Opening a menu must not ask for another window size: a resize would close it again.
    const resizes = () => action.mock.calls.filter(([type]) => type === "resize-editor").length;
    const nextFrame = () =>
      act(async () => {
        await new Promise((resolve) => requestAnimationFrame(resolve));
      });
    await waitFor(() => expect(resizes()).toBeGreaterThan(0));
    await nextFrame();
    const settled = resizes();
    fireEvent.keyDown(screen.getByRole("combobox", { name: "level meter mode" }), {
      key: "ArrowDown",
    });
    expect(screen.getByRole("listbox")).toBeTruthy();
    await nextFrame();
    expect(resizes()).toBe(settled);
  });

  it("keeps no menu room for an editor without selects", () => {
    render(<DockEditorApp />);

    expect(measureSelectMenuRoom(screen.getByTestId("dock-editor"), "bottom")).toBe(0);
  });

  it("publishes intrinsic size again when the same editor is reopened", async () => {
    const { rerender } = render(<DockEditorApp />);
    await waitFor(() =>
      expect(action.mock.calls.filter(([type]) => type === "resize-editor")).toHaveLength(1)
    );

    client.payload = { ...PRESETS_PAYLOAD, view: null };
    rerender(<DockEditorApp />);
    client.payload = PRESETS_PAYLOAD;
    rerender(<DockEditorApp />);

    await waitFor(() =>
      expect(action.mock.calls.filter(([type]) => type === "resize-editor")).toHaveLength(2)
    );
    expect(action).toHaveBeenLastCalledWith(
      "resize-editor",
      expect.objectContaining({ view: "presets" })
    );
  });

  it("publishes the initial size even when a hidden webview receives no animation frame", () => {
    const animationFrame = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);

    render(<DockEditorApp />);

    expect(action).toHaveBeenCalledWith(
      "resize-editor",
      expect.objectContaining({ view: "presets" })
    );
    animationFrame.mockRestore();
  });

  it("publishes size for a replacement editor even when its dimensions match", () => {
    const { rerender } = render(<DockEditorApp />);
    action.mockClear();

    client.payload = { ...PRESETS_PAYLOAD, view: "modules" };
    rerender(<DockEditorApp />);

    expect(action).toHaveBeenCalledWith(
      "resize-editor",
      expect.objectContaining({ view: "modules" })
    );
  });

  it("renders loudness module settings without a host LoudnessProfileProvider", () => {
    client.payload = {
      ...PRESETS_PAYLOAD,
      view: "module:loudness",
      panelsById: { loudness: { id: "loudness", moduleId: "loudness" } },
      panelOrder: ["loudness"],
      controlsByPanelId: {
        loudness: {
          showReadouts: true,
          loudnessHistoryVisibleLayerIds: ["short"],
          loudnessYMinDb: -36,
          loudnessYMaxDb: -6,
        },
      },
    };

    render(<DockEditorApp />);

    expect(screen.getByText("Loudness Range")).toBeTruthy();
  });

  it("leaves Loudness Profile seeding to the main window on a cold store", async () => {
    settingsStore.reset();
    client.payload = {
      ...PRESETS_PAYLOAD,
      view: "module:loudness",
      panelsById: { loudness: { id: "loudness", moduleId: "loudness" } },
      panelOrder: ["loudness"],
      controlsByPanelId: { loudness: { loudnessHistoryVisibleLayerIds: ["short"] } },
    };

    render(<DockEditorApp />);
    await act(async () => {});

    expect(settingsStore.read().loudnessProfiles).toBeUndefined();
  });

  it("switches Loudness Profiles through the main window without library management", () => {
    client.payload = {
      ...PRESETS_PAYLOAD,
      view: "loudness-profile",
      loudnessProfile: {
        active: "off",
        profiles: [
          { id: "a", name: "Broadcast" },
          { id: "b", name: "Streaming" },
        ],
        draftBlocksLibraryActions: false,
      },
    };

    render(<DockEditorApp />);

    expect(screen.getByText("Loudness Profile")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add Loudness Profile" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit Broadcast rules" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Use Streaming" }));
    expect(action).toHaveBeenCalledWith("select-loudness-profile", { selection: "profile:b" });

    fireEvent.click(screen.getByRole("button", { name: "Use no Loudness Profile" }));
    expect(action).toHaveBeenCalledWith("select-loudness-profile", { selection: "off" });
  });

  it("forwards module row hover to the main dock window", () => {
    client.payload = {
      ...PRESETS_PAYLOAD,
      view: "modules",
      panels: [{ id: "spectrum", moduleId: "spectrum" }],
      panelsById: { spectrum: { id: "spectrum", moduleId: "spectrum" } },
      panelOrder: ["spectrum"],
    };

    render(<DockEditorApp />);
    const row = screen.getByTestId("dock-panel-row-spectrum");
    fireEvent.mouseEnter(row);
    fireEvent.mouseLeave(row);

    expect(action).toHaveBeenCalledWith("hover-module", { panelId: "spectrum" });
    expect(action).toHaveBeenCalledWith("hover-module", { panelId: null });
  });
});
