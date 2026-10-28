/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { act, useState } from "react";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
const coordination = vi.hoisted(() => ({
  issue: vi.fn(),
  quitAll: vi.fn(),
}));
const { nativeHandle } = vi.hoisted(() => ({
  nativeHandle: (options) =>
    Object.assign(options, {
      setText: vi.fn(async (text) => {
        options.text = text;
      }),
      setEnabled: vi.fn(async (enabled) => {
        options.enabled = enabled;
      }),
      setChecked: vi.fn(async (checked) => {
        options.checked = checked;
      }),
      close: vi.fn(),
      insert: vi.fn(async (item, position) => {
        options.items.splice(position, 0, item);
      }),
      remove: vi.fn(async (item) => {
        options.items.splice(options.items.indexOf(item), 1);
      }),
    }),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("../runtime/coordination.js", () => ({
  issueInstanceCommand: (...args) => coordination.issue(...args),
  quitAllInstances: (...args) => coordination.quitAll(...args),
}));

vi.mock("@tauri-apps/api/tray", () => ({
  TrayIcon: {
    getById: vi.fn().mockResolvedValue(null),
    removeById: vi.fn().mockResolvedValue(undefined),
    new: vi.fn().mockResolvedValue({ setMenu: vi.fn(), close: vi.fn() }),
  },
}));
vi.mock("@tauri-apps/api/menu", () => ({
  Menu: { new: vi.fn(async (options) => nativeHandle(options)) },
  Submenu: {
    new: vi.fn(async (options) => nativeHandle(options)),
  },
  MenuItem: { new: vi.fn(async (options) => nativeHandle(options)) },
  CheckMenuItem: {
    new: vi.fn(async (options) => nativeHandle(options)),
  },
  PredefinedMenuItem: { new: vi.fn(async (options) => nativeHandle(options)) },
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
vi.mock("./useTaskbarColorScheme.js", () => ({ useTaskbarColorScheme: vi.fn(() => null) }));
// Intentionally NOT mocked: formatAudioDeviceLabel returns an object
// ({ primary, secondary, full }), and the real function must run so a test
// catches any attempt to use that object as a menu item's text.

import { closeTrayIcon, PLVS_TRAY_ID } from "../lib/trayIconLifecycle.js";
import { useTray } from "./useTray.js";
import { TrayIcon } from "@tauri-apps/api/tray";
import { Image } from "@tauri-apps/api/image";
import { Menu, MenuItem, CheckMenuItem, Submenu } from "@tauri-apps/api/menu";
import { resolveResource } from "@tauri-apps/api/path";
import { isMacOS } from "../lib/platform.js";
import { setCoordinatorRole } from "../lib/runtimeRole.js";
import { useTaskbarColorScheme } from "./useTaskbarColorScheme.js";

import { standIn } from "../testing/standIn.js";
const defaultProps = {
  running: false,
  windowVisible: true,
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
const menuItemOptions = () => vi.mocked(MenuItem.new).mock.calls.map(([o]) => o);
const checkItemOptions = () => vi.mocked(CheckMenuItem.new).mock.calls.map(([o]) => o);
const submenuOptions = () => vi.mocked(Submenu.new).mock.calls.map(([o]) => o);
const findText = (options, text) => options.find((o) => o.text === text);
const createdHandleForText = (factory, text) => {
  const index = factory.mock.calls.findIndex(([options]) => options.text === text);
  return index < 0 ? null : factory.mock.results[index].value;
};

function deferred() {
  /** @type {(value?: any) => void} */
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
    coordination.issue.mockResolvedValue();
    coordination.quitAll.mockResolvedValue();
    vi.mocked(isMacOS).mockReturnValue(false);
    vi.mocked(useTaskbarColorScheme).mockReturnValue(null);
    vi.mocked(resolveResource).mockImplementation(async (name) => `/fake/${name}`);
    vi.mocked(TrayIcon.getById).mockResolvedValue(null);
    vi.mocked(TrayIcon.removeById).mockResolvedValue(undefined);
    vi.mocked(TrayIcon.new).mockResolvedValue(standIn({ setMenu: vi.fn(), close: vi.fn() }));
  });

  afterEach(() => vi.clearAllMocks());

  it("creates TrayIcon with the loaded icon (dark theme)", async () => {
    renderHook(() => useTray(defaultProps));
    await act(async () => {});
    expect(resolveResource).toHaveBeenCalledWith("icons/tray-dark.png");
    expect(Image.fromPath).toHaveBeenCalledWith("/fake/icons/tray-dark.png");
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

  it("chooses the icon from the Windows taskbar mode, not the PLVS theme", async () => {
    vi.mocked(useTaskbarColorScheme).mockReturnValue("light");
    renderHook(() => useTray({ ...defaultProps, colorScheme: "dark" }));
    await act(async () => {});
    expect(useTaskbarColorScheme).toHaveBeenLastCalledWith(true);
    expect(resolveResource).toHaveBeenCalledWith("icons/tray-light.png");
    expect(resolveResource).not.toHaveBeenCalledWith("icons/tray-dark.png");
  });

  it("does not follow the taskbar on macOS, where the icon is a template image", async () => {
    vi.mocked(isMacOS).mockReturnValue(true);
    renderHook(() => useTray(defaultProps));
    await act(async () => {});
    expect(useTaskbarColorScheme).toHaveBeenLastCalledWith(false);
  });

  it("swaps the icon when the taskbar mode changes", async () => {
    const setIcon = vi.fn();
    vi.mocked(TrayIcon.new).mockResolvedValue(
      standIn({
        setMenu: vi.fn(),
        setIcon,
        close: vi.fn(),
      })
    );
    vi.mocked(useTaskbarColorScheme).mockReturnValue("dark");
    const { rerender } = renderHook(() => useTray(defaultProps));
    await act(async () => {});
    expect(setIcon).not.toHaveBeenCalled();

    vi.mocked(useTaskbarColorScheme).mockReturnValue("light");
    await act(async () => rerender());

    expect(Image.fromPath).toHaveBeenLastCalledWith("/fake/icons/tray-light.png");
    expect(setIcon).toHaveBeenCalledTimes(1);
  });

  it("applies a taskbar mode that arrives while the tray is being created", async () => {
    const setIcon = vi.fn();
    const pending = deferred();
    vi.mocked(TrayIcon.new).mockReturnValue(pending.promise);
    const { rerender } = renderHook(() => useTray(defaultProps));
    await act(async () => {});
    expect(resolveResource).toHaveBeenCalledWith("icons/tray-dark.png");

    vi.mocked(useTaskbarColorScheme).mockReturnValue("light");
    await act(async () => rerender());
    await act(async () => pending.resolve({ setMenu: vi.fn(), setIcon, close: vi.fn() }));

    expect(Image.fromPath).toHaveBeenLastCalledWith("/fake/icons/tray-light.png");
    expect(setIcon).toHaveBeenCalledTimes(1);
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

    menuItemOptions()
      .filter((item) => item.text === "Start")
      .at(-1)
      .action("start");

    expect(invoke).toHaveBeenCalledWith("runtime_route_instance_transport", {
      instanceId: "two",
      action: "start",
    });
  });

  it("shows or quits an explicit Source-named workbench and can quit the whole app", async () => {
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

    menuItemOptions()
      .find((item) => item.text === "Show")
      .action("show");
    menuItemOptions()
      .find((item) => item.text === "Quit Workbench")
      .action("quit");
    findText(menuItemOptions(), "Quit PLVS").action();

    expect(coordination.issue).toHaveBeenNthCalledWith(1, "one", "show", null);
    expect(coordination.issue).toHaveBeenNthCalledWith(2, "one", "quitInstance");
    expect(coordination.quitAll).toHaveBeenCalledTimes(1);
  });

  it("flattens the menu immediately after peer quit and ignores stale inventory reads", async () => {
    vi.useFakeTimers();
    try {
      window.__PLVS_INITIAL_STATE__ = { instanceId: "owner" };
      const owner = {
        instanceId: "owner",
        displayName: "Owner",
        captureStatus: "stopped",
        visible: true,
      };
      const peer = {
        instanceId: "peer",
        displayName: "Peer",
        captureStatus: "stopped",
        visible: true,
      };
      invoke.mockResolvedValue([owner, peer]);
      const { unmount } = renderHook(() => useTray(defaultProps));
      await act(async () => {});
      const trayAction = vi.mocked(TrayIcon.new).mock.calls[0][0].action;
      const stale = deferred();
      invoke.mockReturnValueOnce(stale.promise);
      trayAction(/** @type {Parameters<typeof trayAction>[0]} */ ({ type: "Enter" }));

      await act(async () => {
        findText(submenuOptions(), "Peer")
          .items.find((item) => item.text === "Quit Workbench")
          .action();
      });
      const rootTexts = () =>
        vi
          .mocked(Menu.new)
          .mock.calls.at(-1)[0]
          .items.map((item) => item.text)
          .filter(Boolean);
      expect(rootTexts()).not.toContain("Peer");
      expect(rootTexts()).toContain("Quit");

      await act(async () => {
        stale.resolve([owner, peer]);
      });
      expect(rootTexts()).not.toContain("Peer");
      // The acknowledgement precedes process exit. A fresh read can still contain its last
      // heartbeat, but opening the menu must not resurrect the acknowledged departure.
      await act(async () => {
        trayAction(
          /** @type {Parameters<typeof trayAction>[0]} */ ({
            type: "Click",
            button: "Right",
            buttonState: "Down",
          })
        );
      });
      expect(rootTexts()).not.toContain("Peer");
      invoke.mockResolvedValue([owner]);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(rootTexts()).not.toContain("Peer");
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a peer in the menu when quit is refused", async () => {
    window.__PLVS_INITIAL_STATE__ = { instanceId: "owner" };
    invoke.mockResolvedValue([
      { instanceId: "owner", displayName: "Owner", captureStatus: "stopped" },
      { instanceId: "peer", displayName: "Peer", captureStatus: "stopped" },
    ]);
    coordination.issue.mockRejectedValueOnce(new Error("An editor is open."));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      renderHook(() => useTray(defaultProps));
      await act(async () => {});
      await act(async () => {
        findText(submenuOptions(), "Peer")
          .items.find((item) => item.text === "Quit Workbench")
          .action();
      });
      const root = vi.mocked(Menu.new).mock.calls.at(-1)[0].items;
      expect(root.map((item) => item.text)).toContain("Peer");
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("refreshes external exits when the tray is entered without waiting for the heartbeat", async () => {
    window.__PLVS_INITIAL_STATE__ = { instanceId: "owner" };
    const owner = { instanceId: "owner", displayName: "Owner", captureStatus: "stopped" };
    invoke.mockResolvedValue([
      owner,
      { instanceId: "peer", displayName: "Peer", captureStatus: "stopped" },
    ]);
    renderHook(() => useTray(defaultProps));
    await act(async () => {});
    invoke.mockResolvedValue([owner]);
    const trayAction = vi.mocked(TrayIcon.new).mock.calls[0][0].action;
    await act(async () => {
      trayAction(/** @type {Parameters<typeof trayAction>[0]} */ ({ type: "Enter" }));
    });
    const root = vi.mocked(Menu.new).mock.calls.at(-1)[0].items;
    expect(root.map((item) => item.text)).not.toContain("Peer");
    expect(root.map((item) => item.text)).toContain("Quit");
  });

  it("creates TrayIcon with iconAsTemplate true", async () => {
    renderHook(() => useTray(defaultProps));
    await act(async () => {});
    expect(TrayIcon.new).toHaveBeenCalledWith(expect.objectContaining({ iconAsTemplate: true }));
  });

  it("removes any existing singleton tray before creating a new one", async () => {
    const existingClose = vi.fn();
    vi.mocked(TrayIcon.getById).mockResolvedValue(standIn({ close: existingClose }));
    renderHook(() => useTray(defaultProps));
    await act(async () => {});
    expect(TrayIcon.getById).toHaveBeenCalledWith(PLVS_TRAY_ID);
    expect(existingClose).toHaveBeenCalledTimes(1);
    expect(TrayIcon.removeById).toHaveBeenCalledWith(PLVS_TRAY_ID);
    expect(TrayIcon.new).toHaveBeenCalledWith(expect.objectContaining({ id: PLVS_TRAY_ID }));
  });

  it("toggles the window only when a macOS left click is released", async () => {
    vi.mocked(isMacOS).mockReturnValue(true);
    const onToggleWindow = vi.fn();
    renderHook(() => useTray({ ...defaultProps, onToggleWindow }));
    await act(async () => {});
    const trayOptions = vi.mocked(TrayIcon.new).mock.calls[0][0];

    expect(trayOptions.showMenuOnLeftClick).toBe(false);
    trayOptions.action(
      /** @type {Parameters<typeof trayOptions.action>[0]} */ ({
        type: "Click",
        button: "Left",
        buttonState: "Down",
      })
    );
    expect(onToggleWindow).not.toHaveBeenCalled();

    trayOptions.action(
      /** @type {Parameters<typeof trayOptions.action>[0]} */ ({
        type: "Click",
        button: "Left",
        buttonState: "Up",
      })
    );
    expect(onToggleWindow).toHaveBeenCalledOnce();
  });

  it("toggles the window only when a Windows left click is released", async () => {
    const onToggleWindow = vi.fn();
    renderHook(() => useTray({ ...defaultProps, onToggleWindow }));
    await act(async () => {});
    const trayOptions = vi.mocked(TrayIcon.new).mock.calls[0][0];

    expect(trayOptions.showMenuOnLeftClick).toBe(false);
    trayOptions.action(
      /** @type {Parameters<typeof trayOptions.action>[0]} */ ({
        type: "Click",
        button: "Left",
        buttonState: "Down",
      })
    );
    expect(onToggleWindow).not.toHaveBeenCalled();

    trayOptions.action(
      /** @type {Parameters<typeof trayOptions.action>[0]} */ ({
        type: "Click",
        button: "Left",
        buttonState: "Up",
      })
    );
    expect(onToggleWindow).toHaveBeenCalledOnce();
  });

  it("keeps the Show/Hide menu action wired to the latest window callback", async () => {
    vi.mocked(isMacOS).mockReturnValue(true);
    const firstToggleWindow = vi.fn();
    const secondToggleWindow = vi.fn();
    const { rerender } = renderHook(
      ({ onToggleWindow }) => useTray({ ...defaultProps, onToggleWindow }),
      { initialProps: { onToggleWindow: firstToggleWindow } }
    );
    await act(async () => {});
    const windowAction = findText(menuItemOptions(), "Hide").action;

    rerender({ onToggleWindow: secondToggleWindow });
    await act(async () => {});
    windowAction();

    expect(firstToggleWindow).not.toHaveBeenCalled();
    expect(secondToggleWindow).toHaveBeenCalledOnce();
  });

  it("includes Show/Hide on Windows without adding Pin items", async () => {
    renderHook(() => useTray(defaultProps));
    await act(async () => {});
    const texts = menuItemOptions().map((o) => o.text);
    expect(texts).toContain("Hide");
    expect(texts).not.toContain("Show");
    expect(texts).not.toContain("Pin Window");
    expect(texts).not.toContain("Unpin Window");
  });

  it.each([false, true])("keeps Show/Hide current with isMacOS=%s", async (isMac) => {
    vi.mocked(isMacOS).mockReturnValue(isMac);
    const setMenu = vi.fn();
    vi.mocked(TrayIcon.new).mockResolvedValue(standIn({ setMenu, close: vi.fn() }));
    const { rerender } = renderHook(
      ({ windowVisible }) => useTray({ ...defaultProps, windowVisible }),
      { initialProps: { windowVisible: true } }
    );
    await act(async () => {});
    expect(findText(menuItemOptions(), "Hide")).toBeTruthy();

    rerender({ windowVisible: false });
    await act(async () => {});
    expect(findText(menuItemOptions(), "Show")).toBeTruthy();
    expect(setMenu).not.toHaveBeenCalled();
  });

  it("delegates Quit to the app close workflow", async () => {
    const onQuit = vi.fn();
    renderHook(() => useTray({ ...defaultProps, onQuit }));
    await act(async () => {});

    findText(menuItemOptions(), "Quit").action();

    expect(onQuit).toHaveBeenCalledOnce();
  });

  it("keeps the same native Show/Hide action live through its own state changes", async () => {
    const toggle = vi.fn();
    const tray = { setMenu: vi.fn(), close: vi.fn() };
    vi.mocked(TrayIcon.new).mockResolvedValue(standIn(tray));
    renderHook(() => {
      const [visible, setVisible] = useState(true);
      useTray({
        ...defaultProps,
        windowVisible: visible,
        onToggleWindow: () => {
          toggle();
          setVisible((value) => !value);
        },
      });
    });
    await act(async () => {});
    const windowItem = findText(menuItemOptions(), "Hide");
    const attachedMenu = vi.mocked(TrayIcon.new).mock.calls[0][0].menu;
    await act(async () => windowItem.action());
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(windowItem.text).toBe("Show");
    await act(async () => windowItem.action());
    expect(toggle).toHaveBeenCalledTimes(2);
    expect(windowItem.text).toBe("Hide");
    expect(windowItem.close).not.toHaveBeenCalled();
    expect(Menu.new).toHaveBeenCalledTimes(1);
    expect(attachedMenu).toBe(await vi.mocked(Menu.new).mock.results[0].value);
    expect(tray.setMenu).not.toHaveBeenCalled();
  });

  it("preserves the native Quit action when inventories and update labels change", async () => {
    const onQuit = vi.fn();
    const setMenu = vi.fn();
    vi.mocked(TrayIcon.new).mockResolvedValue(standIn({ setMenu, close: vi.fn() }));
    const { rerender } = renderHook((props) => useTray({ ...defaultProps, onQuit, ...props }), {
      initialProps: { running: false, audioOutputs: [], updateMenu: null },
    });
    await act(async () => {});
    const quit = findText(menuItemOptions(), "Quit");
    rerender({
      running: true,
      audioOutputs: [{ id: "new-output", label: "New Output" }],
      updateMenu: { text: "Update Ready: v1.2.3…", enabled: true, action: vi.fn() },
    });
    await act(async () => {});
    await act(async () => quit.action());
    expect(onQuit).toHaveBeenCalledOnce();
    expect(quit.close).not.toHaveBeenCalled();
    expect(Menu.new).toHaveBeenCalledTimes(1);
    expect(setMenu).not.toHaveBeenCalled();
  });

  it("keeps a peer's first Show click live when its visibility changes during an open menu", async () => {
    window.__PLVS_INITIAL_STATE__ = { instanceId: "owner" };
    const owner = {
      instanceId: "owner",
      displayName: "Owner",
      captureStatus: "stopped",
      visible: true,
    };
    const peer = {
      instanceId: "peer",
      displayName: "Peer",
      captureStatus: "stopped",
      visible: true,
    };
    invoke.mockResolvedValue([owner, peer]);
    const setMenu = vi.fn();
    vi.mocked(TrayIcon.new).mockResolvedValue(standIn({ setMenu, close: vi.fn() }));
    renderHook(() => useTray(defaultProps));
    await act(async () => {});
    const windowItem = findText(submenuOptions(), "Peer").items.find(
      (item) => item.text === "Hide"
    );
    const trayAction = vi.mocked(TrayIcon.new).mock.calls[0][0].action;
    invoke.mockResolvedValue([owner, { ...peer, visible: false }]);
    await act(async () => {
      trayAction(/** @type {Parameters<typeof trayAction>[0]} */ ({ type: "Enter" }));
    });
    expect(windowItem.text).toBe("Show");
    await act(async () => windowItem.action());
    expect(coordination.issue).toHaveBeenCalledExactlyOnceWith("peer", "show", null);
    expect(windowItem.close).not.toHaveBeenCalled();
    expect(Menu.new).toHaveBeenCalledTimes(1);
    expect(setMenu).not.toHaveBeenCalled();
  });

  it("puts each workbench directly at the root with its complete controls one level below", async () => {
    window.__PLVS_INITIAL_STATE__ = { instanceId: "two" };
    invoke.mockResolvedValue([
      { instanceId: "one", displayName: "Spotify", captureStatus: "running", visible: false },
      { instanceId: "two", displayName: "VLC", captureStatus: "stopped", visible: true },
    ]);
    renderHook(() =>
      useTray({
        ...defaultProps,
        updateMenu: { text: "Check for Updates…", enabled: true, action: vi.fn() },
      })
    );
    await act(async () => {});
    const root = vi.mocked(Menu.new).mock.calls.at(-1)[0].items;
    expect(root.map((item) => item.text).filter(Boolean)).toEqual([
      "Spotify",
      "VLC",
      "Check for Updates…",
      "Quit PLVS",
    ]);
    expect(findText(submenuOptions(), "Workbenches")).toBeUndefined();
    const peer = findText(submenuOptions(), "Spotify");
    const owner = findText(submenuOptions(), "VLC");
    expect(peer.items.map((item) => item.text).filter(Boolean)).toEqual([
      "Show",
      "Stop",
      "Source: Output · Automatic",
      "Preset: Editing…",
      "Settings…",
      "Quit Workbench",
    ]);
    expect(owner.items.map((item) => item.text).filter(Boolean)).toEqual([
      "Hide",
      "Start",
      "Source: Output · Automatic",
      "Preset: None",
      "Settings…",
      "Quit Workbench",
    ]);
    expect(menuItemOptions().some((item) => item.text.startsWith("Workbench:"))).toBe(false);
  });

  it("routes a peer's Source, Preset, Settings and Hide to that peer", async () => {
    window.__PLVS_INITIAL_STATE__ = { instanceId: "owner" };
    invoke.mockResolvedValue([
      { instanceId: "owner", displayName: "Owner", captureStatus: "stopped", visible: true },
      {
        instanceId: "peer",
        displayName: "Peer",
        captureStatus: "running",
        visible: true,
        trayState: {
          audioOutputs: [{ id: "peer-output", label: "Peer Output" }],
          audioInputs: [],
          captureApplications: [],
          safeAudioDeviceId: "peer-output",
          defaultOutputLabel: "",
          sourceBusy: false,
          presetList: [{ id: "peer-preset", name: "Peer Preset" }],
          presetActiveId: "peer-preset",
          presetDirty: false,
          presetsBlocked: false,
        },
      },
    ]);
    renderHook(() => useTray(defaultProps));
    await act(async () => {});
    findText(checkItemOptions(), "Peer Output").action();
    findText(checkItemOptions(), "Peer Preset").action();
    const peer = findText(submenuOptions(), "Peer");
    peer.items.find((item) => item.text === "Settings…").action();
    peer.items.find((item) => item.text === "Hide").action();
    expect(coordination.issue.mock.calls).toEqual([
      ["peer", "selectSource", "peer-output"],
      ["peer", "applyPreset", "peer-preset"],
      ["peer", "settings", null],
      ["peer", "hide", null],
    ]);
    expect(defaultProps.onSelectSource).not.toHaveBeenCalled();
    expect(defaultProps.presets.apply).not.toHaveBeenCalled();
  });

  it("updates a peer's source selection and name in place without disconnecting its next action", async () => {
    vi.useFakeTimers();
    try {
      window.__PLVS_INITIAL_STATE__ = { instanceId: "owner" };
      const snapshot = {
        audioOutputs: [
          { id: "out-a", label: "Output A" },
          { id: "out-b", label: "Output B" },
        ],
        audioInputs: [],
        captureApplications: [],
        safeAudioDeviceId: "out-a",
        defaultOutputLabel: "",
        sourceBusy: false,
        presetList: [],
        presetActiveId: null,
        presetDirty: false,
        presetsBlocked: false,
      };
      let inventory = [
        { instanceId: "owner", displayName: "Owner", captureStatus: "stopped", visible: true },
        {
          instanceId: "peer",
          displayName: "Output A",
          captureStatus: "running",
          visible: true,
          trayState: snapshot,
        },
      ];
      invoke.mockImplementation((command) =>
        Promise.resolve(command === "runtime_list_instances" ? inventory : true)
      );
      const setMenu = vi.fn();
      vi.mocked(TrayIcon.new).mockResolvedValue(standIn({ setMenu, close: vi.fn() }));
      const { unmount } = renderHook(() => useTray(defaultProps));
      await act(async () => {});
      const outputA = await createdHandleForText(vi.mocked(CheckMenuItem.new), "Output A");
      const outputB = await createdHandleForText(vi.mocked(CheckMenuItem.new), "Output B");
      const parent = await createdHandleForText(vi.mocked(Submenu.new), "Output A");
      setMenu.mockClear();
      inventory = [
        inventory[0],
        {
          ...inventory[1],
          displayName: "Output B",
          trayState: { ...snapshot, safeAudioDeviceId: "out-b" },
        },
      ];
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(setMenu).not.toHaveBeenCalled();
      expect(outputA.setChecked).toHaveBeenLastCalledWith(false);
      expect(outputB.setChecked).toHaveBeenLastCalledWith(true);
      expect(parent.setText).toHaveBeenLastCalledWith("Output B");
      findText(checkItemOptions(), "Output A").action();
      expect(coordination.issue).toHaveBeenCalledWith("peer", "selectSource", "out-a");
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses current Settings/update actions and refuses stale actions during installation", async () => {
    const oldSettings = vi.fn();
    const newSettings = vi.fn();
    const oldUpdate = vi.fn();
    const newUpdate = vi.fn();
    const { rerender } = renderHook((props) => useTray({ ...defaultProps, ...props }), {
      initialProps: {
        onOpenSettings: oldSettings,
        updateMenu: { text: "Check for Updates…", enabled: true, action: oldUpdate },
        updateBusy: false,
      },
    });
    await act(async () => {});
    const settingsAction = findText(menuItemOptions(), "Settings…").action;
    const updateAction = findText(menuItemOptions(), "Check for Updates…").action;
    rerender({
      onOpenSettings: newSettings,
      updateMenu: { text: "Update Ready: v1.2.3…", enabled: true, action: newUpdate },
      updateBusy: false,
    });
    await act(async () => {});
    settingsAction();
    updateAction();
    expect(oldSettings).not.toHaveBeenCalled();
    expect(oldUpdate).not.toHaveBeenCalled();
    expect(newSettings).toHaveBeenCalledOnce();
    expect(newUpdate).toHaveBeenCalledOnce();
    expect(findText(menuItemOptions(), "Update Ready: v1.2.3…")).toBeTruthy();

    rerender({
      onOpenSettings: newSettings,
      updateMenu: { text: "Installing Update…", enabled: false, action: newUpdate },
      updateBusy: true,
    });
    await act(async () => {});
    settingsAction();
    updateAction();
    expect(newSettings).toHaveBeenCalledOnce();
    expect(newUpdate).toHaveBeenCalledOnce();
    expect(
      menuItemOptions()
        .filter((item) => item.text === "Settings…")
        .at(-1).enabled
    ).toBe(false);
    expect(findText(menuItemOptions(), "Installing Update…").enabled).toBe(false);
  });

  it("removes disabled update capabilities and refuses their old action", async () => {
    const action = vi.fn();
    const { rerender } = renderHook(({ updateMenu }) => useTray({ ...defaultProps, updateMenu }), {
      initialProps: { updateMenu: { text: "Check for Updates…", enabled: true, action } },
    });
    await act(async () => {});
    const staleAction = findText(menuItemOptions(), "Check for Updates…").action;
    rerender({ updateMenu: null });
    await act(async () => {});
    staleAction();
    expect(action).not.toHaveBeenCalled();
    const root = vi.mocked(Menu.new).mock.calls[0][0].items;
    expect(findText(root, "Check for Updates…")).toBeUndefined();
    expect(findText(menuItemOptions(), "Check for Updates…").close).toHaveBeenCalledOnce();
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
    expect(findText(checks, "Automatic")).toMatchObject({
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
    vi.mocked(TrayIcon.new).mockResolvedValue(standIn(tray));

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
    expect(headphonesHandle.checked).toBe(false);
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
    vi.mocked(TrayIcon.new).mockResolvedValue(standIn(tray));

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
    vi.mocked(TrayIcon.new).mockResolvedValue(standIn(tray));
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
    expect(findText(checkItemOptions(), "Automatic")).toMatchObject({
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

  it("drops the rejection from a click that beat the menu availability update", async () => {
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
    vi.mocked(isMacOS).mockReturnValue(true);
    const setMenu = vi.fn();
    const onToggleWindow = vi.fn();
    const onQuit = vi.fn();
    vi.mocked(TrayIcon.new).mockResolvedValue(standIn({ setMenu, close: vi.fn() }));
    const { rerender } = renderHook(
      ({ updateBusy }) => useTray({ ...defaultProps, onToggleWindow, onQuit, updateBusy }),
      { initialProps: { updateBusy: false } }
    );
    await act(async () => {});
    const staleQuit = findText(menuItemOptions(), "Quit").action;
    const staleToggleWindow = findText(menuItemOptions(), "Hide").action;

    rerender({ updateBusy: true });
    await act(async () => {});

    const items = menuItemOptions();
    const subs = submenuOptions();
    expect(findText(items, "Hide")).toMatchObject({ enabled: false });
    expect(findText(items, "Quit")).toMatchObject({ enabled: false });
    expect(findText(subs, "Preset: None")).toMatchObject({ enabled: false });
    // Start/Stop is never gated.
    expect(findText(items, "Start")).not.toMatchObject({ enabled: false });
    // Source submenu is never gated.
    expect(findText(subs, "Source: Output · Automatic")).not.toMatchObject({ enabled: false });
    expect(setMenu).not.toHaveBeenCalled();

    // Double-guard: stale gated callbacks are no-ops while busy.
    staleToggleWindow();
    expect(onToggleWindow).not.toHaveBeenCalled();
    staleQuit();
    expect(onQuit).not.toHaveBeenCalled();
  });

  it("closes an orphaned tray if effect is cancelled before TrayIcon.new resolves", async () => {
    let resolveTrayNew;
    const orphanClose = vi.fn();
    vi.mocked(TrayIcon.new).mockImplementation(
      () =>
        new Promise((res) => {
          resolveTrayNew = () => res(standIn({ setMenu: vi.fn(), close: orphanClose }));
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

  it("releases the retained native menu and item resources when the tray is disposed", async () => {
    const { unmount } = renderHook(() => useTray(defaultProps));
    await act(async () => {});
    const menu = await vi.mocked(Menu.new).mock.results[0].value;
    const handles = await Promise.all(
      [
        ...vi.mocked(MenuItem.new).mock.results,
        ...vi.mocked(CheckMenuItem.new).mock.results,
        ...vi.mocked(Submenu.new).mock.results,
      ].map((result) => result.value)
    );
    await act(async () => unmount());
    expect(menu.close).toHaveBeenCalledOnce();
    for (const handle of handles) expect(handle.close).toHaveBeenCalledOnce();
  });

  it("closes the singleton tray before a profile reload", async () => {
    const currentClose = vi.fn();
    const existingClose = vi.fn();
    vi.mocked(TrayIcon.new).mockResolvedValue(
      standIn({
        setMenu: vi.fn(),
        close: currentClose,
      })
    );
    vi.mocked(TrayIcon.getById).mockResolvedValue(standIn({ close: existingClose }));
    renderHook(() => useTray(defaultProps));
    await act(async () => {});
    await closeTrayIcon();
    expect(currentClose).toHaveBeenCalled();
    expect(existingClose).toHaveBeenCalled();
    expect(TrayIcon.removeById).toHaveBeenCalledWith(PLVS_TRAY_ID);
  });
});
