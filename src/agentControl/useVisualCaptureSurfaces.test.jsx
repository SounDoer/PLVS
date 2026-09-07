/** @vitest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useVisualCaptureSurfaces } from "./useVisualCaptureSurfaces.js";

function mountedWorkspaceSurface() {
  const surface = document.createElement("main");
  surface.setAttribute("data-visual-capture-surface", "workspace");
  surface.setAttribute("data-visual-capture-ready", "true");
  surface.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    right: 500,
    bottom: 300,
    width: 500,
    height: 300,
  });
  document.body.append(surface);
  return surface;
}

describe("useVisualCaptureSurfaces", () => {
  beforeEach(() => {
    document.body.replaceChildren();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 500 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 300 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps resize observation dormant and disconnects owned subscriptions on unmount", () => {
    const surface = mountedWorkspaceSurface();
    const disconnect = vi.fn();
    const observe = vi.fn();
    const ResizeObserverStub = vi.fn(function ResizeObserverStub() {
      this.observe = observe;
      this.disconnect = disconnect;
    });
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    const { result, unmount } = renderHook(() =>
      useVisualCaptureSurfaces({ workspace: { panelsById: {} } })
    );

    expect(ResizeObserverStub).not.toHaveBeenCalled();
    act(() => result.current.subscribe({ kind: "workspace" }, vi.fn()));
    expect(observe).toHaveBeenCalledWith(surface);
    unmount();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("cancels settlement owned by an unmounted hook", async () => {
    mountedWorkspaceSurface().removeAttribute("data-visual-capture-ready");
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { ready: Promise.resolve() },
    });
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    const { result, unmount } = renderHook(() =>
      useVisualCaptureSurfaces({ workspace: { panelsById: {} } })
    );
    const pending = result.current.settle({ kind: "workspace" }, { getRevision: () => 0 });

    unmount();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});
