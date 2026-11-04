/** @vitest-environment jsdom */
import { useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDockSettingsWindow } from "./useDockSettingsWindow.js";
import { DockSettingsApp } from "./accessories/DockSettingsApp.jsx";
import { BlockingEditorsProvider } from "../hooks/BlockingEditorsContext.jsx";
import { UiNavigationProvider, useUiNavigation } from "../uiNavigation/UiNavigationContext.jsx";

const bus = vi.hoisted(() => ({
  state: new Set(),
  action: new Set(),
  ready: new Set(),
  invoke: vi.fn(),
}));
vi.mock("../ipc/env.js", () => ({ isTauri: () => true }));
vi.mock("../ipc/events.js", () => ({ onDockNativeGeometryChanged: async () => () => {} }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: bus.invoke }));
vi.mock("../ipc/dockAccessoryEvents.js", () => ({
  listenDockAccessoryState: async (callback) => {
    bus.state.add(callback);
    return () => bus.state.delete(callback);
  },
  listenDockAccessoryAction: async (callback) => {
    bus.action.add(callback);
    return () => bus.action.delete(callback);
  },
  listenDockAccessoryReady: async (callback) => {
    bus.ready.add(callback);
    return () => bus.ready.delete(callback);
  },
  emitDockAccessoryState: async (_surface, value) => {
    for (const callback of bus.state) callback(value);
  },
  emitDockAccessoryAction: async (value) => {
    for (const callback of bus.action) callback(value);
  },
  emitDockAccessoryReady: async (surface) => {
    for (const callback of bus.ready) callback({ surface });
  },
}));
vi.mock("../theme/themeRuntime.js", () => ({
  createThemePublication: () => null,
  isThemePublication: () => false,
  themeRuntime: { getSnapshot: () => null, subscribe: () => () => {} },
}));

beforeEach(() => {
  bus.state.clear();
  bus.action.clear();
  bus.ready.clear();
  bus.invoke.mockReset();
  bus.invoke.mockImplementation(async (command, values) =>
    command === "set_dock_settings_window" && values.visible ? { width: 800, height: 1000 } : null
  );
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  );
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

afterEach(() => vi.useRealTimers());

function setup() {
  const exported = vi.fn().mockResolvedValue("done");
  const reset = vi.fn();
  let navigation;
  function Owner() {
    const [open, setOpen] = useState(false);
    const [view, setView] = useState("settings");
    const [autostartEnabled, setAutostartEnabled] = useState(false);
    navigation = useUiNavigation();
    useDockSettingsWindow({
      enabled: true,
      active: open,
      session: `${view}-session`,
      view,
      edge: "top",
      openSection: () => setOpen(true),
      onDismiss: () => setOpen(false),
      model:
        view === "feedback"
          ? { content: "", email: "", status: "idle", onClose: () => setOpen(false) }
          : {
              onOpenFeedback: () => setView("feedback"),
              settingsOpen: open,
              setSettingsOpen: setOpen,
              appearance: "system",
              setAppearanceMode: vi.fn(),
              fixedThemeSelectValue: "plvs-dark",
              setFixedThemeIdFromPicker: vi.fn(),
              channelCount: 0,
              channelLabelTokens: [],
              channelLabelHasOverride: false,
              selectedLayoutId: null,
              setChannelLayout: vi.fn(),
              setChannelLabelToken: vi.fn(),
              resetChannelLabels: vi.fn(),
              appVersion: "0.24.1",
              autostartReady: true,
              autostartEnabled,
              setAutostartEnabled,
              onExportConfiguration: exported,
              onResetConfiguration: reset,
            },
    });
    return <button onClick={() => setOpen(true)}>Open Test Settings</button>;
  }
  const rendered = render(
    <BlockingEditorsProvider>
      <UiNavigationProvider>
        <Owner />
        <DockSettingsApp />
      </UiNavigationProvider>
    </BlockingEditorsProvider>
  );
  return { ...rendered, exported, reset, readUi: () => navigation.inspectUi() };
}

describe("Settings owner and accessory integration", () => {
  it("creates the window lazily and dispatches real shared controls through main", async () => {
    const view = setup();
    await waitFor(() => expect(bus.ready.size).toBe(1));
    expect(bus.invoke.mock.calls.some(([name]) => name === "prepare_dock_settings_window")).toBe(
      false
    );
    fireEvent.click(screen.getByRole("button", { name: "Open Test Settings" }));
    await screen.findByRole("dialog", { name: "Settings" });
    await waitFor(() =>
      expect(view.readUi().surfaces.some((s) => s.kind === "settings")).toBe(true)
    );
    fireEvent.click(screen.getByRole("switch", { name: "Open at Login" }));
    await waitFor(() =>
      expect(screen.getByRole("switch", { name: "Open at Login" }).getAttribute("data-state")).toBe(
        "checked"
      )
    );
    fireEvent.click(screen.getByRole("button", { name: "Export complete setup" }));
    await waitFor(() => expect(view.exported).toHaveBeenCalledWith());
    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Settings" })).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Open Test Settings" }));
    await screen.findByRole("dialog", { name: "Settings" });
    expect(
      bus.invoke.mock.calls.filter(([name]) => name === "prepare_dock_settings_window")
    ).toHaveLength(1);
  });
  it("removes the previous view registration when a child has no local surfaces", async () => {
    const view = setup();
    fireEvent.click(screen.getByRole("button", { name: "Open Test Settings" }));
    await screen.findByRole("dialog", { name: "Settings" });
    await waitFor(() =>
      expect(view.readUi().surfaces.some((s) => s.kind === "settings")).toBe(true)
    );
    fireEvent.click(screen.getByRole("button", { name: "Feedback" }));
    await screen.findByRole("dialog", { name: "Send feedback" });
    await waitFor(() =>
      expect(view.readUi().surfaces.some((s) => s.kind === "settings")).toBe(false)
    );
  });

  it("routes native close through the ordered Settings business action", async () => {
    const view = setup();
    fireEvent.click(screen.getByRole("button", { name: "Open Test Settings" }));
    await screen.findByRole("dialog", { name: "Settings" });
    await act(async () => {
      for (const callback of [...bus.action])
        callback({ surface: "dock-settings", type: "settings-dismiss", payload: {} });
    });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Settings" })).toBeNull());
    await waitFor(() => expect(view.readUi().surfaces).toEqual([]));
  });

  it("does not time out an acknowledged action while a native picker is waiting for the user", async () => {
    const view = setup();
    let finish;
    view.exported.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    fireEvent.click(screen.getByRole("button", { name: "Open Test Settings" }));
    await screen.findByRole("dialog", { name: "Settings" });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fireEvent.click(screen.getByRole("button", { name: "Export complete setup" }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12000);
    });
    expect(view.exported).toHaveBeenCalledOnce();
    expect(screen.queryByRole("alert")).toBeNull();
    await act(async () => {
      finish("cancelled");
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("reports nested reset confirmation and respects cancellation", async () => {
    const view = setup();
    fireEvent.click(screen.getByRole("button", { name: "Open Test Settings" }));
    await screen.findByRole("dialog", { name: "Settings" });
    fireEvent.click(screen.getByRole("button", { name: "Reset PLVS to default" }));
    await screen.findByRole("alertdialog");
    await waitFor(() =>
      expect(view.readUi().surfaces.some((s) => s.kind === "confirmation")).toBe(true)
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(view.readUi().surfaces.some((s) => s.kind === "confirmation")).toBe(false)
    );
    expect(view.reset).not.toHaveBeenCalled();
  });
});
