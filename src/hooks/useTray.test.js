/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { act, useState } from "react";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

vi.mock("@tauri-apps/api/tray", () => ({
  TrayIcon: {
    getById: vi.fn().mockResolvedValue(null),
    removeById: vi.fn().mockResolvedValue(undefined),
    new: vi.fn().mockResolvedValue({ setMenu: vi.fn(), close: vi.fn() }),
  },
}));
vi.mock("@tauri-apps/api/menu", () => ({
  Menu: { new: vi.fn().mockResolvedValue({}) },
  Submenu: {
    new: vi.fn(async () => ({ setText: vi.fn(), setEnabled: vi.fn() })),
  },
  MenuItem: { new: vi.fn().mockResolvedValue({}) },
  CheckMenuItem: {
    new: vi.fn(async () => ({ setChecked: vi.fn(), setText: vi.fn(), setEnabled: vi.fn() })),
  },
  PredefinedMenuItem: { new: vi.fn().mockResolvedValue({}) },
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ isVisible: vi.fn().mockResolvedValue(true) }),
}));
vi.mock("@tauri-apps/api/image", () => ({
  Image: { fromPath: vi.fn().mockResolvedValue({ __type: "MockImage" }) },
}));
vi.mock("@tauri-apps/api/path", () => ({
  resolveResource: vi.fn().mockResolvedValue("/fake/tray.png"),
}));
vi.mock("../ipc/env.js", () => ({ isTauri: () => true }));
vi.mock("../lib/platform.js", () => ({ isMacOS: vi.fn(() => false) }));
// Intentionally NOT mocked: formatAudioDeviceLabel returns an object
// ({ primary, secondary, full }), and the real function must run so a test
// catches any attempt to use that object as a menu item's text.

import { closeTrayIcon, PLVS_TRAY_ID } from "../lib/trayIconLifecycle.js";
import { useTray } from "./useTray.js";
import { TrayIcon } from "@tauri-apps/api/tray";
import { Image } from "@tauri-apps/api/image";
import { MenuItem, CheckMenuItem, Submenu } from "@tauri-apps/api/menu";
import { resolveResource } from "@tauri-apps/api/path";
import { isMacOS } from "../lib/platform.js";
import { setCoordinatorRole } from "../lib/runtimeRole.js";

const defaultProps = {
  running: false,
  onStartClick: vi.fn(),
  onToggleWindow: vi.fn(),
  onQuit: vi.fn(),
  colorScheme: "dark",
  updateBusy: false,
  audioOutputs: [],
  audioInputs: [],
  captureApplications: [],
  safeAudioDeviceId: "default",
  defaultOutputLabel: "",
  onSelectSource: vi.fn(),
  presets: { list: [], activeId: null, dirty: false, apply: vi.fn() },
};

// Collects the options object passed to every top-level MenuItem.new call.
const menuItemOptions = () => MenuItem.new.mock.calls.map(([o]) => o);
const checkItemOptions = () => CheckMenuItem.new.mock.calls.map(([o]) => o);
const submenuOptions = () => Submenu.new.mock.calls.map(([o]) => o);
const findText = (options, text) => options.find((o) => o.text === text);
const createdHandleForText = (factory, text) => {
  const index = factory.mock.calls.findIndex(([options]) => options.text === text);
  return index < 0 ? null : factory.mock.results[index].value;
};

function deferred() {
  let resolve;
  const promise = new Promise((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe("useTray", () => {
  beforeEach(() => {
    delete window.__PLVS_INITIAL_STATE__;
    setCoordinatorRole(undefined);
    vi.clearAllMocks();
    invoke.mockResolvedValue([]);
    isMacOS.mockReturnValue(false);
    TrayIcon.getById.mockResolvedValue(null);
    TrayIcon.removeById.mockResolvedValue(undefined);
    TrayIcon.new.mockResolvedValue({ setMenu: vi.fn(), close: vi.fn() });
  });

  afterEach(() => vi.clearAllMocks());

  it("creates TrayIcon with the loaded icon (dark theme)", async () => {
    renderHook(() => useTray(defaultProps));
    await act(async () => {});
    expect(resolveResource).toHaveBeenCalledWith("icons/tray-dark.png");
    expect(Image.fromPath).toHaveBeenCalledWith("/fake/tray.png");
    expect(TrayIcon.new).toHaveBeenCalledWith(
      expect.objectContaining({ id: PLVS_TRAY_ID, icon: { __type: "MockImage" } })
    );
  });

  it("does not create or remove the singleton Tray in a participant instance", async () => {
    window.__PLVS_INITIAL_STATE__ = { isCoordinator: false };
    renderHook(() => useTray(defaultProps));

    await act(async () => {});
    expect(TrayIcon.new).not.toHaveBeenCalled();
    expect(TrayIcon.removeById).not.toHaveBeenCalled();
  });

  it("creates the singleton Tray when a running participant becomes coordinator", async () => {
    window.__PLVS_INITIAL_STATE__ = { isCoordinator: false };
    const { unmount } = renderHook(() => useTray(defaultProps));
    await act(async () => {});
    expect(TrayIcon.new).not.toHaveBeenCalled();

    await act(async () => setCoordinatorRole(true));

    expect(TrayIcon.new).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("creates TrayIcon with the light theme icon", async () => {
    renderHook(() => useTray({ ...defaultProps, colorScheme: "light" }));
    await act(async () => {});
    expect(resolveResource).toHaveBeenCalledWith("icons/tray-light.png");
    expect(TrayIcon.new).toHaveBeenCalledWith(
      expect.objectContaining({ icon: { __type: "MockImage" } })
    );
  });

  it("lists Source-named workbenches and routes Start or Stop to the selected instance", async () => {
    invoke.mockImplementation((command) => {
      if (command === "runtime_list_instances") {
        return Promise.resolve([
          { instanceId: "one", displayName: "Spotify", captureStatus: "running" },
          { instanceId: "two", displayName: "VLC", captureStatus: "stopped" },
        ]);
      }
      return Promise.resolve(true);
    });
    renderHook(() => useTray(defaultProps));
    await act(async () => {});
    await act(async () => {});

    findText(menuItemOptions(), "VLC — Start").action();

    expect(invoke).toHaveBeenCalledWith("runtime_route_instance_transport", {
      instanceId: "two",
      action: "start",
    });
  });

  it("creates TrayIcon with iconAsTemplate true", async () => {
    renderHook(() => useTray(defaultProps));
    await act(async () => {});
    expect(TrayIcon.new).toHaveBeenCalledWith(expect.objectContaining({ iconAsTemplate: true }));
  });

  it("removes any existing singleton tray before creating a new one", async () => {
    const existingClose = vi.fn();
    TrayIcon.getById.mockResolvedValue({ close: existingClose });
    renderHook(() => useTray(defaultProps));
    await act(async () => {});
    expect(TrayIcon.getById).toHaveBeenCalledWith(PLVS_TRAY_ID);
    expect(existingClose).toHaveBeenCalledTimes(1);
    expect(TrayIcon.removeById).toHaveBeenCalledWith(PLVS_TRAY_ID);
    expect(TrayIcon.new).toHaveBeenCalledWith(expect.objectContaining({ id: PLVS_TRAY_ID }));
  });

  it("keeps the tray click action wired to the latest window toggle callback", async () => {
    const firstToggleWindow = vi.fn();
    const secondToggleWindow = vi.fn();
    const { rerender } = renderHook(
      ({ onToggleWindow }) => useTray({ ...defaultProps, onToggleWindow }),
      { initialProps: { onToggleWindow: firstToggleWindow } }
    );
    await act(async () => {});
    const trayAction = TrayIcon.new.mock.calls[0][0].action;
    rerender({ onToggleWindow: secondToggleWindow });
    await act(async () => {});
    trayAction({ type: "Click", button: "Left" });
    expect(firstToggleWindow).not.toHaveBeenCalled();
    expect(secondToggleWindow).toHaveBeenCalledTimes(1);
  });

  it("omits Show/Hide and Pin items on Windows", async () => {
    renderHook(() => useTray(defaultProps));
    await act(async () => {});
    const texts = menuItemOptions().map((o) => o.text);
    expect(texts).not.toContain("Hide Window");
    expect(texts).not.toContain("Show Window");
    expect(texts).not.toContain("Pin Window");
    expect(texts).not.toContain("Unpin Window");
  });

  it("includes a platform Show/Hide item on macOS", async () => {
    isMacOS.mockReturnValue(true);
    renderHook(() => useTray(defaultProps));
    await act(async () => {});
    // isVisible mock resolves true -> "Hide Window"
    expect(findText(menuItemOptions(), "Hide Window")).toBeTruthy();
  });

  it("delegates Quit to the app close workflow", async () => {
    const onQuit = vi.fn();
    renderHook(() => useTray({ ...defaultProps, onQuit }));
    await act(async () => {});

    findText(menuItemOptions(), "Quit").action();

    expect(onQuit).toHaveBeenCalledOnce();
  });

  it("builds the Source submenu with the current source type labelled and checked", async () => {
    const onSelectSource = vi.fn();
    renderHook(() =>
      useTray({
        ...defaultProps,
        onSelectSource,
        safeAudioDeviceId: "mic-1",
        audioOutputs: [{ id: "out-1", label: "Speakers", isSystemOutputMonitor: true }],
        audioInputs: [{ id: "mic-1", label: "USB Mic" }],
      })
    );
    await act(async () => {});

    // Parent label reflects the selected source and its type.
    expect(findText(submenuOptions(), "Source: Input · USB Mic")).toBeTruthy();

    // Group headers present (disabled MenuItems).
    const headers = menuItemOptions();
    expect(findText(headers, "Output")).toMatchObject({ enabled: false });
    expect(findText(headers, "Input")).toMatchObject({ enabled: false });

    // The selected device's CheckMenuItem is checked; Automatic is not.
    const checks = checkItemOptions();
    expect(findText(checks, "USB Mic")).toMatchObject({ checked: true });
    expect(findText(checks, "Automatic (default system output)")).toMatchObject({
      checked: false,
    });

    // Clicking a device forwards its id.
    findText(checks, "Speakers").action();
    expect(onSelectSource).toHaveBeenCalledWith("out-1");
  });

  it("updates a tray source selection in place so the next source action stays live", async () => {
    const tray = { setMenu: vi.fn(), close: vi.fn() };
    const audioOutputs = [
      { id: "out-1", label: "Speakers", isSystemOutputMonitor: true },
      { id: "out-2", label: "Headphones", isSystemOutputMonitor: true },
    ];
    TrayIcon.new.mockResolvedValue(tray);

    const { result } = renderHook(() => {
      const [selectedId, setSelectedId] = useState("default");
      useTray({
        ...defaultProps,
        safeAudioDeviceId: selectedId,
        audioOutputs,
        onSelectSource: setSelectedId,
      });
      return selectedId;
    });
    await act(async () => {});

    const speakers = findText(checkItemOptions(), "Speakers");
    const headphones = findText(checkItemOptions(), "Headphones");
    const speakersHandle = await createdHandleForText(CheckMenuItem.new, "Speakers");
    const headphonesHandle = await createdHandleForText(CheckMenuItem.new, "Headphones");
    const sourceHandle = await createdHandleForText(Submenu.new, "Source: Output · Automatic");
    tray.setMenu.mockClear();

    await act(async () => speakers.action());
    expect(result.current).toBe("out-1");
    expect(tray.setMenu).not.toHaveBeenCalled();
    expect(speakersHandle.setChecked).toHaveBeenLastCalledWith(true);
    expect(headphonesHandle.setChecked).toHaveBeenLastCalledWith(false);
    expect(sourceHandle.setText).toHaveBeenLastCalledWith("Source: Output · Speakers");

    await act(async () => headphones.action());
    expect(result.current).toBe("out-2");
    expect(tray.setMenu).not.toHaveBeenCalled();
    expect(speakersHandle.setChecked).toHaveBeenLastCalledWith(false);
    expect(headphonesHandle.setChecked).toHaveBeenLastCalledWith(true);
    expect(sourceHandle.setText).toHaveBeenLastCalledWith("Source: Output · Headphones");
  });

  it("keeps the tray menu attached when an equivalent application inventory refreshes", async () => {
    const tray = { setMenu: vi.fn(), close: vi.fn() };
    const application = {
      id: "app-00112233445566778899aabbccddeeff",
      label: "VLC",
      processId: 4321,
      processIds: [4321],
    };
    TrayIcon.new.mockResolvedValue(tray);

    const { rerender } = renderHook(
      ({ captureApplications }) =>
        useTray({
          ...defaultProps,
          safeAudioDeviceId: application.id,
          captureApplications,
        }),
      { initialProps: { captureApplications: [application] } }
    );
    await act(async () => {});
    tray.setMenu.mockClear();

    rerender({
      captureApplications: [
        { ...application, processId: 9876, processIds: [9876], windowTitle: "next.wav - VLC" },
      ],
    });
    await act(async () => {});

    expect(tray.setMenu).not.toHaveBeenCalled();
  });

  it("serializes source availability updates when native menu calls finish out of order", async () => {
    const tray = { setMenu: vi.fn(), close: vi.fn() };
    TrayIcon.new.mockResolvedValue(tray);
    const { rerender } = renderHook(({ sourceBusy }) => useTray({ ...defaultProps, sourceBusy }), {
      initialProps: { sourceBusy: false },
    });
    await act(async () => {});

    const sourceHandle = await createdHandleForText(Submenu.new, "Source: Output · Automatic");
    const delayedDisable = deferred();
    let nativeEnabled = true;
    sourceHandle.setEnabled.mockImplementation((enabled) => {
      if (!enabled) {
        return delayedDisable.promise.then(() => {
          nativeEnabled = false;
        });
      }
      nativeEnabled = true;
      return Promise.resolve();
    });
    tray.setMenu.mockClear();

    rerender({ sourceBusy: true });
    await act(async () => {});
    expect(tray.setMenu).not.toHaveBeenCalled();
    expect(sourceHandle.setEnabled).toHaveBeenLastCalledWith(false);

    rerender({ sourceBusy: false });
    await act(async () => {});
    delayedDisable.resolve();
    await act(async () => {});

    expect(tray.setMenu).not.toHaveBeenCalled();
    expect(sourceHandle.setEnabled).toHaveBeenLastCalledWith(true);
    expect(nativeEnabled).toBe(true);
  });

  it("renders device labels as strings via the real formatter", async () => {
    renderHook(() =>
      useTray({
        ...defaultProps,
        safeAudioDeviceId: "out-1",
        audioOutputs: [
          { id: "out-1", label: "Speakers (Realtek) — 2ch 48000Hz", isSystemOutputMonitor: true },
        ],
      })
    );
    await act(async () => {});
    // Compact single-line form: primary + (secondary), dropping the format tail.
    expect(findText(submenuOptions(), "Source: Output · Speakers (Realtek)")).toBeTruthy();
    const speakers = findText(checkItemOptions(), "Speakers (Realtek)");
    expect(speakers).toBeTruthy();
    expect(typeof speakers.text).toBe("string");
  });

  it("labels the Source parent as automatic output and checks it when default is selected", async () => {
    renderHook(() =>
      useTray({ ...defaultProps, safeAudioDeviceId: "default", defaultOutputLabel: "" })
    );
    await act(async () => {});
    expect(findText(submenuOptions(), "Source: Output · Automatic")).toBeTruthy();
    expect(findText(checkItemOptions(), "Automatic (default system output)")).toMatchObject({
      checked: true,
    });
  });

  it("uses the resolved default output label in the Source parent when available", async () => {
    renderHook(() =>
      useTray({ ...defaultProps, safeAudioDeviceId: "default", defaultOutputLabel: "Realtek" })
    );
    await act(async () => {});
    expect(findText(submenuOptions(), "Source: Output · Realtek")).toBeTruthy();
  });

  it("lists and selects applications as sources", async () => {
    const onSelectSource = vi.fn();
    const application = {
      id: "app-00112233445566778899aabbccddeeff",
      label: "VLC",
    };
    renderHook(() =>
      useTray({
        ...defaultProps,
        onSelectSource,
        safeAudioDeviceId: application.id,
        captureApplications: [application],
      })
    );
    await act(async () => {});

    expect(findText(submenuOptions(), "Source: Application · VLC")).toBeTruthy();
    expect(findText(menuItemOptions(), "Applications")).toMatchObject({ enabled: false });
    const appItem = findText(checkItemOptions(), "VLC");
    expect(appItem).toMatchObject({ checked: true });
    appItem.action();
    expect(onSelectSource).toHaveBeenCalledWith(application.id);
  });

  it("builds the Presets submenu with the active preset checked and dirty marked", async () => {
    const apply = vi.fn();
    renderHook(() =>
      useTray({
        ...defaultProps,
        presets: {
          list: [
            { id: "p1", name: "Mixing" },
            { id: "p2", name: "Mastering" },
          ],
          activeId: "p2",
          dirty: true,
          apply,
        },
      })
    );
    await act(async () => {});
    const checks = checkItemOptions();
    expect(findText(checks, "Mixing")).toMatchObject({ checked: false });
    expect(findText(checks, "Mastering (modified)")).toMatchObject({ checked: true });
    findText(checks, "Mixing").action();
    expect(apply).toHaveBeenCalledWith("p1");
  });

  it("disables the Presets submenu while a blocking editor is open", async () => {
    const apply = vi.fn();
    renderHook(() =>
      useTray({
        ...defaultProps,
        presets: {
          list: [{ id: "p1", name: "Mixing" }],
          activeId: "p1",
          dirty: false,
          blocked: true,
          apply,
        },
      })
    );
    await act(async () => {});

    // The tray has nowhere to put a caption, so the parent carries the reason.
    expect(findText(submenuOptions(), "Preset: Editing…")).toBeTruthy();
    expect(findText(checkItemOptions(), "Mixing")).toMatchObject({ enabled: false });
  });

  it("drops the rejection from a click that beat the menu rebuild", async () => {
    const blocked = Object.assign(new Error("Finish or cancel the active editor first."), {
      code: "editorActive",
    });
    const apply = vi.fn(() => Promise.reject(blocked));
    renderHook(() =>
      useTray({
        ...defaultProps,
        presets: { list: [{ id: "p1", name: "Mixing" }], activeId: null, dirty: false, apply },
      })
    );
    await act(async () => {});

    // The controller refuses it; an unhandled rejection is not a way to report that.
    expect(() => findText(checkItemOptions(), "Mixing").action()).not.toThrow();
    await act(async () => {});
    expect(apply).toHaveBeenCalledWith("p1");
  });

  it("shows a disabled No presets item when the list is empty", async () => {
    renderHook(() => useTray(defaultProps));
    await act(async () => {});
    expect(findText(menuItemOptions(), "No presets")).toMatchObject({ enabled: false });
  });

  it("shows the active preset name on the Presets parent, marking dirty and falling back to None", async () => {
    // No active preset -> None.
    const { rerender } = renderHook((props) => useTray(props), {
      initialProps: defaultProps,
    });
    await act(async () => {});
    expect(findText(submenuOptions(), "Preset: None")).toBeTruthy();

    // Active + dirty -> "<name> (modified)".
    rerender({
      ...defaultProps,
      presets: {
        list: [
          { id: "p1", name: "Mixing" },
          { id: "p2", name: "Mastering" },
        ],
        activeId: "p2",
        dirty: true,
        apply: vi.fn(),
      },
    });
    await act(async () => {});
    expect(findText(submenuOptions(), "Preset: Mastering (modified)")).toBeTruthy();
  });

  it("disables Presets and Quit but not Start/Stop or Source while updating (macOS)", async () => {
    isMacOS.mockReturnValue(true);
    const setMenu = vi.fn();
    const onToggleWindow = vi.fn();
    const onQuit = vi.fn();
    TrayIcon.new.mockResolvedValue({ setMenu, close: vi.fn() });
    const { rerender } = renderHook(
      ({ updateBusy }) => useTray({ ...defaultProps, onToggleWindow, onQuit, updateBusy }),
      { initialProps: { updateBusy: false } }
    );
    await act(async () => {});
    const trayAction = TrayIcon.new.mock.calls[0][0].action;
    const staleQuit = findText(menuItemOptions(), "Quit").action;
    MenuItem.new.mockClear();
    Submenu.new.mockClear();

    rerender({ updateBusy: true });
    await act(async () => {});

    const items = menuItemOptions();
    const subs = submenuOptions();
    expect(findText(items, "Hide Window")).toMatchObject({ enabled: false });
    expect(findText(items, "Quit")).toMatchObject({ enabled: false });
    expect(findText(subs, "Preset: None")).toMatchObject({ enabled: false });
    // Start/Stop is never gated.
    expect(findText(items, "Start")).not.toMatchObject({ enabled: false });
    // Source submenu is never gated.
    expect(findText(subs, "Source: Output · Automatic")).not.toMatchObject({ enabled: false });
    expect(setMenu).toHaveBeenCalled();

    // Double-guard: stale gated callbacks are no-ops while busy.
    trayAction({ type: "Click", button: "Left" });
    expect(onToggleWindow).not.toHaveBeenCalled();
    staleQuit();
    expect(onQuit).not.toHaveBeenCalled();
  });

  it("closes an orphaned tray if effect is cancelled before TrayIcon.new resolves", async () => {
    let resolveTrayNew;
    const orphanClose = vi.fn();
    TrayIcon.new.mockImplementation(
      () =>
        new Promise((res) => {
          resolveTrayNew = () => res({ setMenu: vi.fn(), close: orphanClose });
        })
    );
    const { unmount } = renderHook(() => useTray(defaultProps));
    await act(async () => {});
    unmount();
    await act(async () => {
      resolveTrayNew();
    });
    expect(orphanClose).toHaveBeenCalledTimes(1);
  });

  it("closes the singleton tray before a profile reload", async () => {
    const currentClose = vi.fn();
    const existingClose = vi.fn();
    TrayIcon.new.mockResolvedValue({ setMenu: vi.fn(), close: currentClose });
    TrayIcon.getById.mockResolvedValue({ close: existingClose });
    renderHook(() => useTray(defaultProps));
    await act(async () => {});
    await closeTrayIcon();
    expect(currentClose).toHaveBeenCalled();
    expect(existingClose).toHaveBeenCalled();
    expect(TrayIcon.removeById).toHaveBeenCalledWith(PLVS_TRAY_ID);
  });
});
