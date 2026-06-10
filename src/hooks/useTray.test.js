/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { act } from "react";

vi.mock("@tauri-apps/api/tray", () => ({
  TrayIcon: {
    new: vi.fn().mockResolvedValue({ setMenu: vi.fn(), close: vi.fn() }),
  },
}));
vi.mock("@tauri-apps/api/menu", () => ({
  Menu: { new: vi.fn().mockResolvedValue({}) },
  MenuItem: { new: vi.fn().mockResolvedValue({}) },
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
vi.mock("@tauri-apps/plugin-process", () => ({ exit: vi.fn() }));
vi.mock("../ipc/env.js", () => ({ isTauri: () => true }));

import { useTray } from "./useTray.js";
import { TrayIcon } from "@tauri-apps/api/tray";
import { Image } from "@tauri-apps/api/image";
import { resolveResource } from "@tauri-apps/api/path";

const defaultProps = {
  running: false,
  pinned: false,
  togglePin: vi.fn(),
  onStartClick: vi.fn(),
  deviceName: "Test Device",
  onToggleWindow: vi.fn(),
  colorScheme: "dark",
};

describe("useTray", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    TrayIcon.new.mockResolvedValue({ setMenu: vi.fn(), close: vi.fn() });
  });

  afterEach(() => vi.clearAllMocks());

  it("creates TrayIcon with the loaded icon (dark theme)", async () => {
    renderHook(() => useTray(defaultProps));
    await act(async () => {});
    expect(resolveResource).toHaveBeenCalledWith("icons/tray-dark.png");
    expect(Image.fromPath).toHaveBeenCalledWith("/fake/tray.png");
    expect(TrayIcon.new).toHaveBeenCalledWith(
      expect.objectContaining({ icon: { __type: "MockImage" } })
    );
  });

  it("creates TrayIcon with the light theme icon", async () => {
    renderHook(() => useTray({ ...defaultProps, colorScheme: "light" }));
    await act(async () => {});
    expect(resolveResource).toHaveBeenCalledWith("icons/tray-light.png");
    expect(Image.fromPath).toHaveBeenCalledWith("/fake/tray.png");
    expect(TrayIcon.new).toHaveBeenCalledWith(
      expect.objectContaining({ icon: { __type: "MockImage" } })
    );
  });

  it("creates TrayIcon with iconAsTemplate true", async () => {
    renderHook(() => useTray(defaultProps));
    await act(async () => {});
    expect(TrayIcon.new).toHaveBeenCalledWith(expect.objectContaining({ iconAsTemplate: true }));
  });

  it("closes an orphaned tray if effect is cancelled before TrayIcon.new resolves", async () => {
    // Simulate the StrictMode race: cleanup fires while TrayIcon.new is still pending.
    // The orphaned tray instance must be closed even though it was created after cancellation.
    let resolveTrayNew;
    const orphanClose = vi.fn();
    TrayIcon.new.mockImplementation(
      () =>
        new Promise((res) => {
          resolveTrayNew = () => res({ setMenu: vi.fn(), close: orphanClose });
        })
    );

    const { unmount } = renderHook(() => useTray(defaultProps));
    // Flush microtasks until TrayIcon.new is called (buildMenu, resolveResource,
    // Image.fromPath all resolve immediately; TrayIcon.new stays pending)
    await act(async () => {});
    // Unmount before TrayIcon.new resolves — simulates StrictMode cleanup
    unmount();
    // Now resolve the pending TrayIcon.new
    await act(async () => {
      resolveTrayNew();
    });

    expect(orphanClose).toHaveBeenCalledTimes(1);
  });
});
