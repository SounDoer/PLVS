/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { hideAppWindow, showAppWindow, toggleAppWindow } from "./windowVisibility.js";

function fakeWindow(visible) {
  return {
    isVisible: vi.fn(async () => visible),
    hide: vi.fn(async () => {}),
    show: vi.fn(async () => {}),
    setSkipTaskbar: vi.fn(async () => {}),
    setFocus: vi.fn(async () => {}),
    unminimize: vi.fn(async () => {}),
  };
}

describe("window visibility", () => {
  it("suspends the complete Dock instead of hiding only main", async () => {
    const window = fakeWindow(true);
    const suspendDock = vi.fn(async () => {});

    await hideAppWindow({ docked: true, window, suspendDock });

    expect(suspendDock).toHaveBeenCalledOnce();
    expect(window.hide).not.toHaveBeenCalled();
  });

  it("resumes the complete Dock from tray without normal-window mutations", async () => {
    const window = fakeWindow(false);
    const resumeDock = vi.fn(async () => {});

    await toggleAppWindow({ docked: true, window, resumeDock, suspendDock: vi.fn() });

    expect(resumeDock).toHaveBeenCalledOnce();
    expect(window.show).not.toHaveBeenCalled();
    expect(window.setSkipTaskbar).not.toHaveBeenCalled();
  });

  it("raises an already visible workbench instead of leaving it behind other windows", async () => {
    const window = fakeWindow(true);

    await showAppWindow({ docked: false, window, resumeDock: vi.fn() });

    expect(window.unminimize).toHaveBeenCalledOnce();
    expect(window.setFocus).toHaveBeenCalledOnce();
    expect(window.hide).not.toHaveBeenCalled();
  });

  it("leaves a visible Dock strip in place when asked to show it", async () => {
    const window = fakeWindow(true);
    const resumeDock = vi.fn(async () => {});

    await showAppWindow({ docked: true, window, resumeDock });

    expect(resumeDock).not.toHaveBeenCalled();
    expect(window.setFocus).not.toHaveBeenCalled();
  });

  it("shows a hidden workbench from the tray", async () => {
    const window = fakeWindow(false);

    await showAppWindow({ docked: false, window, resumeDock: vi.fn() });

    expect(window.show).toHaveBeenCalledOnce();
    expect(window.setSkipTaskbar).toHaveBeenCalledWith(false);
    expect(window.setFocus).toHaveBeenCalledOnce();
  });
});
