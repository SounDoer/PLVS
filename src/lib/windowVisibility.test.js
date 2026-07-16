/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { hideAppWindow, toggleAppWindow } from "./windowVisibility.js";

function fakeWindow(visible) {
  return {
    isVisible: vi.fn(async () => visible),
    hide: vi.fn(async () => {}),
    show: vi.fn(async () => {}),
    setSkipTaskbar: vi.fn(async () => {}),
    setFocus: vi.fn(async () => {}),
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
});
