/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { isTauri } from "./ipc/env.js";
import {
  enterDock,
  exitDock,
  listAudioDevices,
  previewAudioDevice,
  setDockAccessories,
  setDockReserveSpace,
} from "./ipc/commands.js";
import { pickMediaFile } from "./ipc/fileDialog.js";
import { emitTo } from "@tauri-apps/api/event";

const tauriEventHandlers = vi.hoisted(() => new Map());

// Default browser mode (isTauri -> false) keeps the mount deterministic; individual
// tests flip it to exercise the Tauri capture path against the mocked IPC surface.
vi.mock("./ipc/env.js", () => ({ isTauri: vi.fn(() => false) }));

// IPC surface: everything resolves benignly. Add exports here if the mount throws
// "No export named X" — keep resolutions inert, do not weaken assertions instead.
vi.mock("./ipc/commands.js", () => ({
  applyWindowBounds: vi.fn().mockResolvedValue(undefined),
  currentWindowBounds: vi.fn().mockResolvedValue({
    x: 10,
    y: 20,
    width: 800,
    height: 600,
    isMaximized: false,
  }),
  listAudioDevices: vi.fn().mockResolvedValue([]),
  previewAudioDevice: vi
    .fn()
    .mockResolvedValue({ sampleRateHz: 48000, channels: 2, label: "Mock" }),
  startAudioCapture: vi.fn().mockResolvedValue(undefined),
  stopAudioCapture: vi.fn().mockResolvedValue(undefined),
  setLoudnessWeights: vi.fn().mockResolvedValue(undefined),
  setDialogueGating: vi.fn().mockResolvedValue(undefined),
  setDialogueVadEngine: vi.fn().mockResolvedValue(undefined),
  ackFrames: vi.fn().mockResolvedValue(undefined),
  setAnalysisRequests: vi.fn().mockResolvedValue(undefined),
  startFileAnalysis: vi.fn().mockResolvedValue(undefined),
  stopFileAnalysis: vi.fn().mockResolvedValue(undefined),
  enterDock: vi.fn().mockResolvedValue(undefined),
  exitDock: vi.fn().mockResolvedValue(undefined),
  setDockReserveSpace: vi.fn().mockResolvedValue(undefined),
  setDockHeight: vi.fn(async ({ height }) => height),
  setDockAccessories: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    setAlwaysOnTop: vi.fn().mockResolvedValue(undefined),
    onCloseRequested: vi.fn().mockResolvedValue(() => {}),
    isVisible: vi.fn().mockResolvedValue(true),
    hide: vi.fn().mockResolvedValue(undefined),
    show: vi.fn().mockResolvedValue(undefined),
    setDecorations: vi.fn().mockResolvedValue(undefined),
    setShadow: vi.fn().mockResolvedValue(undefined),
    startDragging: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("@tauri-apps/api/tray", () => ({
  TrayIcon: {
    new: vi.fn().mockResolvedValue({
      close: vi.fn(),
      setMenu: vi.fn().mockResolvedValue(undefined),
      setIcon: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

vi.mock("@tauri-apps/api/menu", () => ({
  Menu: { new: vi.fn().mockResolvedValue({}) },
  MenuItem: { new: vi.fn().mockResolvedValue({}) },
  PredefinedMenuItem: { new: vi.fn().mockResolvedValue({}) },
}));

vi.mock("@tauri-apps/api/image", () => ({
  Image: { fromPath: vi.fn().mockResolvedValue({}) },
}));

vi.mock("@tauri-apps/api/path", () => ({
  resolveResource: vi.fn().mockResolvedValue("tray.png"),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tauri-apps/api/event", () => ({
  emitTo: vi.fn().mockResolvedValue(undefined),
  listen: vi.fn((eventName, handler) => {
    tauriEventHandlers.set(eventName, handler);
    return Promise.resolve(() => tauriEventHandlers.delete(eventName));
  }),
}));

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: vi.fn().mockResolvedValue(() => {}),
  }),
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  exit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tauri-apps/plugin-store", () => ({
  Store: {
    load: vi.fn().mockResolvedValue({
      get: vi.fn().mockResolvedValue(undefined),
      set: vi.fn().mockResolvedValue(undefined),
      save: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

vi.mock("./ipc/fileDialog.js", () => ({
  pickConfigurationProfileFile: vi.fn().mockResolvedValue(null),
  pickMediaFile: vi.fn().mockResolvedValue(null),
  saveConfigurationProfileFile: vi.fn().mockResolvedValue(null),
  saveFileAnalysisReportFile: vi.fn().mockResolvedValue(null),
}));

beforeEach(() => {
  cleanup();
  localStorage.clear();
  tauriEventHandlers.clear();
  delete window.__PLVS_INITIAL_STATE__;
  isTauri.mockReturnValue(false);
  listAudioDevices.mockResolvedValue([]);
  previewAudioDevice.mockResolvedValue({ sampleRateHz: 48000, channels: 2, label: "Mock" });
  emitTo.mockClear();
  enterDock.mockClear().mockResolvedValue(undefined);
  exitDock.mockClear().mockResolvedValue(undefined);
  setDockAccessories.mockClear().mockResolvedValue(undefined);
  setDockReserveSpace.mockClear().mockResolvedValue(undefined);
  pickMediaFile.mockResolvedValue(null);
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }));
  window.ResizeObserver =
    window.ResizeObserver ||
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    putImageData: vi.fn(),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("App smoke", () => {
  it("mounts the full app shell", async () => {
    const { default: App } = await import("./App.jsx");
    render(<App />);
    // Transport spine: if the derived Ready status and START button render, the
    // whole provider/workspace/panel tree mounted without throwing.
    expect(await screen.findByText("Ready")).toBeTruthy();
    expect(screen.getByRole("button", { name: /start/i })).toBeTruthy();
  });

  it("START click settles back to Ready without crashing (browser branch)", async () => {
    const { default: App } = await import("./App.jsx");
    render(<App />);
    const start = await screen.findByRole("button", { name: /^start$/i });
    fireEvent.click(start);
    // Click sets running=true; useAudioEngine's browser branch synchronously flips
    // it back off inside the engine effect. The transport must settle on START/Ready
    // — a wedged or crashed engine effect leaves STOP/a clock label behind.
    // (A deeper wiring assertion needs the Tauri branch, which would require mocking
    // the whole shell-API surface — deliberately out of scope for this safety net.)
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^start$/i })).toBeTruthy();
      expect(screen.getByText("Ready")).toBeTruthy();
    });
  });

  it("renders the footer status hierarchy", async () => {
    const { default: App } = await import("./App.jsx");
    render(<App />);
    await screen.findByRole("button", { name: /^start$/i });

    expect(screen.getByText("Device")).toBeTruthy();
    expect(screen.getByText("Not connected")).toBeTruthy();
    expect(screen.getByText("Ref")).toBeTruthy();
    expect(screen.getByText("Preset")).toBeTruthy();
  });

  it("uses the formatted default device label in the footer", async () => {
    isTauri.mockReturnValue(true);
    previewAudioDevice.mockResolvedValue({
      sampleRateHz: 48000,
      channels: 2,
      label: "Speakers (Realtek USB Audio)",
    });

    const { default: App } = await import("./App.jsx");
    render(<App />);

    expect(await screen.findByText("Realtek USB Audio")).toBeTruthy();
    expect(screen.queryByText("Speakers (Realtek USB Audio)")).toBeNull();
  });

  it("starts file analysis from the File source action and shows the summary surface", async () => {
    pickMediaFile.mockResolvedValue("C:\\mix.wav");

    const { default: App } = await import("./App.jsx");
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Source: Live" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "FILE" }));
    fireEvent.click(screen.getByRole("button", { name: "ANALYZE" }));

    expect(pickMediaFile).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("mix.wav")).toBeTruthy();
  });

  it("marks the active preset dirty after manual window bounds changes", async () => {
    isTauri.mockReturnValue(true);
    vi.spyOn(Date, "now").mockReturnValue(1_000);

    const { default: App } = await import("./App.jsx");
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Presets" }));
    fireEvent.change(screen.getByRole("textbox", { name: "New preset name" }), {
      target: { value: "Mix" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect((await screen.findAllByText("Mix")).length).toBeGreaterThan(0);
    await waitFor(() => expect(tauriEventHandlers.has("window-bounds-changed")).toBe(true));

    Date.now.mockReturnValue(3_000);
    tauriEventHandlers.get("window-bounds-changed")();

    expect((await screen.findAllByText("Mix *")).length).toBeGreaterThan(0);
  });

  it("reveals auto-hidden Focus View controls with Escape", async () => {
    const { default: App } = await import("./App.jsx");
    render(<App />);

    const viewsButton = await screen.findByRole("button", { name: "Views" });
    fireEvent.click(viewsButton);
    fireEvent.click(screen.getByRole("switch", { name: "Auto-hide Controls" }));
    fireEvent.pointerDown(document.body);

    expect(screen.queryByRole("button", { name: "Views" })).toBeNull();

    fireEvent.keyDown(document.body, { key: "Escape" });

    expect(screen.getByRole("button", { name: "Views" })).toBeTruthy();
  });

  it("does not toggle transport from Space", async () => {
    const { default: App } = await import("./App.jsx");
    render(<App />);
    await screen.findByRole("button", { name: /^start$/i });

    fireEvent.keyDown(document.body, { key: " ", code: "Space" });

    expect(screen.getByRole("button", { name: /^start$/i })).toBeTruthy();
    expect(screen.getByText("Ready")).toBeTruthy();
  });

  it("suppresses the native context menu after the shell mounts", async () => {
    const { default: App } = await import("./App.jsx");
    render(<App />);
    await screen.findByRole("button", { name: /^start$/i });

    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it("renders the dock strip (not the workspace header) when boot state is docked", async () => {
    isTauri.mockReturnValue(true);
    window.__PLVS_INITIAL_STATE__ = { dockState: { enabled: true, edge: "top" } };

    const { default: App } = await import("./App.jsx");
    render(<App />);

    // Docked form swaps the whole shell for the strip; the normal-form header
    // (Views control) is not mounted.
    expect(await screen.findByTestId("dock-strip")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Views" })).toBeNull();
  });

  it("applies monitor from a dock preset", async () => {
    isTauri.mockReturnValue(true);
    window.__PLVS_INITIAL_STATE__ = {
      dockState: { enabled: true, edge: "top", monitor: "\\\\.\\DISPLAY1", reserveSpace: true },
    };
    const { presetsStore } = await import("./persistence/index.js");
    presetsStore.patch({
      list: [
        {
          id: "dock-reserved",
          name: "Reserved",
          tree: { type: "leaf", tabs: ["spectrum"], activeTab: "spectrum" },
          panelsById: { spectrum: { id: "spectrum", moduleId: "spectrum" } },
          panelOrder: ["spectrum"],
          panelControlsById: {},
          dock: {
            enabled: true,
            edge: "top",
            monitor: "\\\\.\\DISPLAY2",
            reserveSpace: true,
            modules: ["level"],
          },
        },
      ],
      activeId: null,
      dirty: false,
    });

    const { default: App } = await import("./App.jsx");
    render(<App />);
    await waitFor(() => expect(tauriEventHandlers.has("dock-accessory://action")).toBe(true));

    await act(async () => {
      tauriEventHandlers.get("dock-accessory://action")({
        payload: {
          surface: "dock-editor",
          type: "apply-preset",
          revision: 1,
          payload: { presetId: "dock-reserved" },
        },
      });
    });

    await waitFor(() =>
      expect(enterDock).toHaveBeenCalledWith("top", true, "\\\\.\\DISPLAY2", undefined)
    );
    expect(setDockReserveSpace).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(presetsStore.read()).toMatchObject({ activeId: "dock-reserved", dirty: false })
    );
  });

  it("serializes rapid reserve toggles from the dock header", async () => {
    isTauri.mockReturnValue(true);
    window.__PLVS_INITIAL_STATE__ = {
      dockState: { enabled: true, edge: "bottom", reserveSpace: false },
    };
    let releaseFirst;
    setDockReserveSpace.mockImplementationOnce(
      () => new Promise((resolve) => (releaseFirst = resolve))
    );
    const { default: App } = await import("./App.jsx");
    render(<App />);
    await waitFor(() => expect(tauriEventHandlers.has("dock-accessory://action")).toBe(true));
    const dispatchToggle = (revision) =>
      tauriEventHandlers.get("dock-accessory://action")({
        payload: {
          surface: "dock-header",
          type: "toggle-reserve-space",
          revision,
          payload: {},
        },
      });

    await act(async () => {
      dispatchToggle(1);
      dispatchToggle(2);
      await Promise.resolve();
    });

    expect(setDockReserveSpace).toHaveBeenCalledTimes(1);
    expect(setDockReserveSpace).toHaveBeenLastCalledWith({ enabled: true, edge: "bottom" });

    releaseFirst();
    await waitFor(() => expect(setDockReserveSpace).toHaveBeenCalledTimes(2));
    expect(setDockReserveSpace).toHaveBeenLastCalledWith({ enabled: false, edge: "bottom" });
  });

  it("keeps the Dock header visible with actionable reserve-space errors", async () => {
    isTauri.mockReturnValue(true);
    window.__PLVS_INITIAL_STATE__ = {
      dockState: { enabled: true, edge: "bottom", reserveSpace: false },
    };
    setDockReserveSpace.mockRejectedValueOnce(new Error("ABM_NEW rejected registration"));
    const { default: App } = await import("./App.jsx");
    render(<App />);
    await waitFor(() => expect(tauriEventHandlers.has("dock-accessory://action")).toBe(true));

    act(() => {
      tauriEventHandlers.get("dock-accessory://action")({
        payload: {
          surface: "dock-header",
          type: "toggle-reserve-space",
          revision: 1,
          payload: {},
        },
      });
    });

    await waitFor(() =>
      expect(setDockAccessories).toHaveBeenCalledWith(
        expect.objectContaining({ headerVisible: true })
      )
    );
    await waitFor(() =>
      expect(
        emitTo.mock.calls.some(
          ([surface, eventName, snapshot]) =>
            surface === "dock-header" &&
            eventName === "dock-accessory://state" &&
            snapshot?.payload?.notice?.text ===
              "Could not reserve screen space. Dock remains an overlay." &&
            snapshot.payload.notice.details ===
              "Reserve screen space failed: ABM_NEW rejected registration"
        )
      ).toBe(true)
    );
  });

  it("restores the main window when Dock accessory controls cannot open", async () => {
    isTauri.mockReturnValue(true);
    window.__PLVS_INITIAL_STATE__ = {
      dockState: { enabled: true, edge: "bottom", reserveSpace: false },
    };
    setDockAccessories.mockRejectedValueOnce(new Error("dock editor position: access denied"));
    const { default: App } = await import("./App.jsx");
    render(<App />);

    await waitFor(() => expect(exitDock).toHaveBeenCalledOnce());
    expect(
      await screen.findByText("Dock controls could not open. The main window was restored.")
    ).toBeTruthy();
    expect(screen.queryByTestId("dock-strip")).toBeNull();
  });

  it("renders the normal shell (no dock strip) without dock boot state", async () => {
    const { default: App } = await import("./App.jsx");
    render(<App />);
    await screen.findByRole("button", { name: /^start$/i });

    expect(screen.queryByTestId("dock-strip")).toBeNull();
  });
});
