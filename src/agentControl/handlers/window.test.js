import { describe, expect, it, vi } from "vitest";

import { createRevisionClock } from "../bridge/revisionClock.js";
import { planWindowResize } from "../windowControl.js";
import { windowHandlers } from "./window.js";

/** A 2x display with a 16 px tall title bar and 1 px side frames, in physical pixels. */
function geometry(overrides = {}) {
  return {
    viewport: { width: 1280, height: 720 },
    scale: 2,
    inner: { width: 2560, height: 1440 },
    outer: { width: 2562, height: 1474 },
    position: { x: 100, y: 80 },
    maximized: false,
    workArea: { width: 3840, height: 2100 },
    ...overrides,
  };
}

function context(method, params, windowControl) {
  const state = { windowControl };
  return /** @type {any} */ ({
    requestId: "request-1",
    request: { method, params },
    clock: createRevisionClock({ onWake: () => {} }),
    snap: state,
    live: () => state,
  });
}

describe("Window Control", () => {
  it("reports the window in CSS pixels", async () => {
    const response = await windowHandlers["window.inspect"].run(
      context(
        "window.inspect",
        {},
        { available: true, form: "normal", visible: true, readGeometry: async () => geometry() }
      )
    );

    expect(response.result).toEqual({
      revision: 0,
      form: "normal",
      visible: true,
      maximized: false,
      size: { width: 1280, height: 720 },
      devicePixelRatio: 2,
      workArea: { width: 1920, height: 1050 },
    });
  });

  it("applies the requested inner size at the current position through the bounds path", async () => {
    let current = geometry();
    const applyBounds = vi.fn(async (bounds) => {
      current = geometry({
        viewport: { width: bounds.width / 2, height: bounds.height / 2 },
        inner: { width: bounds.width, height: bounds.height },
      });
    });
    const response = await windowHandlers["window.resize"].run(
      context(
        "window.resize",
        { width: 1600, height: 900, expectedRevision: 0 },
        {
          available: true,
          form: "normal",
          visible: true,
          readGeometry: async () => current,
          applyBounds,
        }
      )
    );

    expect(applyBounds).toHaveBeenCalledWith({
      x: 100,
      y: 80,
      width: 3200,
      height: 1800,
      isMaximized: false,
    });
    expect(response.result).toMatchObject({ changed: true, size: { width: 1600, height: 900 } });
  });

  it("does nothing when the window already has the requested size", async () => {
    const applyBounds = vi.fn();
    const response = await windowHandlers["window.resize"].run(
      context(
        "window.resize",
        { width: 1280, height: 720, expectedRevision: 0 },
        {
          available: true,
          form: "normal",
          visible: true,
          readGeometry: async () => geometry(),
          applyBounds,
        }
      )
    );

    expect(applyBounds).not.toHaveBeenCalled();
    expect(response.result.changed).toBe(false);
  });

  it("refuses a size that would not fit instead of letting it be clamped", async () => {
    const applyBounds = vi.fn();
    await expect(
      windowHandlers["window.resize"].run(
        context(
          "window.resize",
          { width: 1920, height: 1050, expectedRevision: 0 },
          {
            available: true,
            form: "normal",
            visible: true,
            readGeometry: async () => geometry(),
            applyBounds,
          }
        )
      )
    ).rejects.toMatchObject({ reason: "windowSizeUnavailable" });
    expect(applyBounds).not.toHaveBeenCalled();
    expect(planWindowResize({ form: "dock" }, geometry(), { width: 800, height: 600 })).toEqual({
      refusal: "dockActive",
    });
  });

  it("hides through the tray intent and reports a refusal while busy", async () => {
    const state = { available: true, form: "normal", visible: true, hide: vi.fn() };
    state.hide.mockImplementation(async () => {
      state.visible = false;
    });
    const response = await windowHandlers["window.hide"].run(
      context("window.hide", { expectedRevision: 0 }, state)
    );
    expect(response.result).toEqual({ revision: 0, changed: true, form: "normal", visible: false });

    const busy = { available: true, form: "normal", visible: true, hide: async () => false };
    await expect(
      windowHandlers["window.hide"].run(context("window.hide", { expectedRevision: 0 }, busy))
    ).rejects.toMatchObject({ reason: "busy" });
  });

  it("requires the current revision before changing the window", async () => {
    await expect(
      windowHandlers["window.show"].run(
        context("window.show", { expectedRevision: 3 }, { available: true, show: vi.fn() })
      )
    ).rejects.toMatchObject({ reason: "revisionConflict" });
  });
});
