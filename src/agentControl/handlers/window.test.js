import { describe, expect, it, vi } from "vitest";

import { createRevisionClock } from "../bridge/revisionClock.js";
import { planWindowMove, planWindowResize, windowPositionSettled } from "../windowControl.js";
import { windowHandlers } from "./window.js";

/** Windows-style desktop: one physical space, so desktop units per CSS px equal the scale. */
const MAIN = {
  id: "Main",
  scale: 2,
  unitsPerCss: 2,
  origin: { x: 0, y: 50 },
  workArea: { x: 0, y: 50, width: 3840, height: 2100 },
};

/** A 2x display with a 16 px tall title bar and 1 px side frames, in physical pixels. */
function geometry(overrides = {}) {
  return {
    viewport: { width: 1280, height: 720 },
    scale: 2,
    inner: { width: 2560, height: 1440 },
    outer: { width: 2562, height: 1474 },
    position: { x: 100, y: 80 },
    maximized: false,
    minimized: false,
    monitor: MAIN,
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
        {
          available: true,
          form: "normal",
          visible: true,
          readGeometry: async () => geometry(),
          readMonitors: async () => [geometry().monitor],
        }
      )
    );

    expect(response.result).toEqual({
      revision: 0,
      form: "normal",
      visible: true,
      maximized: false,
      minimized: false,
      monitor: "Main",
      position: { x: 50, y: 15 },
      size: { width: 1280, height: 720 },
      devicePixelRatio: 2,
      workArea: { width: 1920, height: 1050 },
      monitors: [{ id: "Main", workArea: { width: 1920, height: 1050 } }],
    });
  });

  it("reports unavailable position and minimized state on native Wayland", async () => {
    const control = {
      available: true,
      form: "normal",
      visible: true,
      moveAvailable: false,
      minimizeAvailable: false,
      minimize: vi.fn(),
      readGeometry: async () => geometry(),
      moveTo: vi.fn(),
    };
    const inspected = await windowHandlers["window.inspect"].run(
      context("window.inspect", {}, control)
    );
    expect(inspected.result).toMatchObject({ monitor: "Main", position: null, minimized: null });
    await expect(
      windowHandlers["window.move"].run(
        context("window.move", { monitor: "Main", x: 16, y: 16, expectedRevision: 0 }, control)
      )
    ).rejects.toMatchObject({ reason: "controlUnavailable" });
    expect(control.moveTo).not.toHaveBeenCalled();
    await expect(
      windowHandlers["window.minimize"].run(
        context("window.minimize", { expectedRevision: 0 }, control)
      )
    ).rejects.toMatchObject({ reason: "controlUnavailable" });
    expect(control.minimize).not.toHaveBeenCalled();
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

  it("converts WebView sizes to native sizes when the title bar occupies the native content area", () => {
    const state = { form: "normal" };
    const framed = geometry({
      inner: { width: 2560, height: 1504 },
      outer: { width: 2560, height: 1504 },
    });
    expect(planWindowResize(state, framed, { width: 1184, height: 672 })).toMatchObject({
      bounds: { width: 2368, height: 1408 },
    });
    expect(planWindowMove(state, framed, [MAIN], { monitor: "Main", x: 40, y: 40 })).toMatchObject({
      target: { width: 1280, height: 752 },
    });
    expect(planWindowMove(state, framed, [MAIN], { monitor: "Main", x: 40, y: 320 })).toMatchObject(
      {
        refusal: "windowPositionUnavailable",
      }
    );
  });

  it("passes WebView size to GTK while fitting the decorated window", () => {
    const state = { form: "normal" };
    const gtk = geometry({
      sizeSetterUsesViewport: true,
      scale: 1,
      viewport: { width: 1280, height: 800 },
      inner: { width: 1332, height: 889 },
      outer: { width: 1332, height: 889 },
      workArea: { width: 1600, height: 1000 },
    });
    const request = { width: 1184, height: 704 };
    expect(planWindowResize(state, gtk, request)).toMatchObject({ bounds: request });
    expect(planWindowResize(state, gtk, { ...request, height: 950 })).toMatchObject({
      refusal: "windowSizeUnavailable",
    });
    const monitor = {
      ...MAIN,
      scale: 1,
      workArea: { ...MAIN.workArea, width: 1600, height: 1000 },
    };
    expect(planWindowMove(state, gtk, [monitor], { monitor: "Main", x: 10, y: 10 })).toMatchObject({
      target: gtk.viewport,
    });
    expect(planWindowMove(state, gtk, [monitor], { monitor: "Main", x: 10, y: 150 })).toMatchObject(
      {
        refusal: "windowPositionUnavailable",
      }
    );
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

  const SIDE = {
    id: "Side",
    scale: 1,
    unitsPerCss: 1,
    origin: { x: 3840, y: 0 },
    workArea: { x: 3840, y: 0, width: 1920, height: 1040 },
  };

  it.each([
    ["window.resize", { width: 1280, height: 720 }],
    ["window.move", { monitor: "Main", x: 50, y: 15 }],
  ])("refuses %s in Dock even when its geometry already matches", async (method, params) => {
    const readGeometry = vi.fn(async () => geometry());
    const state = { available: true, form: "dock", visible: true, readGeometry };
    await expect(
      windowHandlers[method].run(context(method, { ...params, expectedRevision: 0 }, state))
    ).rejects.toMatchObject({ reason: "dockActive" });
    expect(readGeometry).not.toHaveBeenCalled();
  });

  it.each([
    ["window.resize", { width: 1200, height: 640 }],
    ["window.move", { monitor: "Main", x: 80, y: 32 }],
    ["window.maximize", {}],
    ["window.unmaximize", {}],
    ["window.minimize", {}],
  ])("rechecks the revision for %s after reading geometry", async (method, params) => {
    const mutate = vi.fn();
    const state = {
      available: true,
      form: "normal",
      visible: true,
      applyBounds: mutate,
      moveTo: mutate,
      maximize: mutate,
      unmaximize: mutate,
      minimize: mutate,
      readGeometry: async () => {
        state.form = "dock";
        ctx.clock.bumpWorkspace();
        return geometry({ maximized: method === "window.unmaximize" });
      },
    };
    const ctx = context(method, { ...params, expectedRevision: 0 }, state);
    const batch = ctx.clock.beginBatch();
    await expect(windowHandlers[method].run(ctx)).rejects.toMatchObject({
      reason: "revisionConflict",
    });
    expect(mutate).not.toHaveBeenCalled();
    ctx.clock.endBatch(batch);
  });

  it("rechecks Dock after reading monitors even before the revision observer runs", async () => {
    const moveTo = vi.fn();
    const state = {
      available: true,
      form: "normal",
      visible: true,
      moveTo,
      readGeometry: async () => geometry(),
      readMonitors: async () => {
        state.form = "dock";
        return [MAIN];
      },
    };
    await expect(
      windowHandlers["window.move"].run(
        context("window.move", { monitor: "Main", x: 80, y: 32, expectedRevision: 0 }, state)
      )
    ).rejects.toMatchObject({ reason: "dockActive" });
    expect(moveTo).not.toHaveBeenCalled();
  });

  it("moves the window to an offset on another monitor, keeping its CSS size", async () => {
    let current = geometry();
    const moveTo = vi.fn(async (target) => {
      const position = { x: SIDE.origin.x + target.x, y: SIDE.origin.y + target.y };
      current = geometry({
        scale: 1,
        viewport: { width: target.width, height: target.height },
        inner: { width: target.width, height: target.height },
        outer: { width: target.width + 1, height: target.height + 17 },
        position,
        origin: position,
        monitor: SIDE,
      });
    });
    const rememberPosition = vi.fn(async () => {
      expect(current.position).toEqual({ x: 3940, y: 40 });
    });
    const response = await windowHandlers["window.move"].run(
      context(
        "window.move",
        { monitor: "Side", x: 100, y: 40, expectedRevision: 0 },
        {
          available: true,
          form: "normal",
          visible: true,
          readGeometry: async () => current,
          readMonitors: async () => [MAIN, SIDE],
          moveTo,
          rememberPosition,
        }
      )
    );
    expect(rememberPosition).toHaveBeenCalledOnce();
    expect(moveTo).toHaveBeenCalledWith({
      monitor: "Side",
      x: 100,
      y: 40,
      width: 1280,
      height: 720,
    });
    expect(response.result).toMatchObject({
      changed: true,
      monitor: "Side",
      position: { x: 100, y: 40 },
      size: { width: 1280, height: 720 },
    });
  });

  it("reports a save failure after moving and retries the save without moving again", async () => {
    let current = geometry();
    const state = {
      available: true,
      form: "normal",
      visible: true,
      readGeometry: async () => current,
      readMonitors: async () => [MAIN],
      moveTo: vi.fn(async () => {
        current = geometry({ position: { x: 160, y: 114 } });
      }),
      rememberPosition: vi
        .fn(async () => {})
        .mockRejectedValueOnce(new Error("Storage unavailable")),
    };
    const run = () =>
      windowHandlers["window.move"].run(
        context("window.move", { monitor: "Main", x: 80, y: 32, expectedRevision: 0 }, state)
      );

    await expect(run()).rejects.toMatchObject({ reason: "persistenceFailed" });
    await expect(run()).resolves.toMatchObject({
      result: { changed: false, position: { x: 80, y: 32 } },
    });
    expect(state.moveTo).toHaveBeenCalledOnce();
    expect(state.rememberPosition).toHaveBeenCalledTimes(2);
  });

  it("reports macOS positions in points, where each display scales its own coordinates", () => {
    const retina = { ...MAIN, unitsPerCss: 1, origin: { x: 0, y: 25 } };
    const external = { ...SIDE, origin: { x: 1920, y: 0 } };
    // The window sits on the 1x external display at 2020 points; Tauri reports 2020 physical.
    const onExternal = geometry({ scale: 1, origin: { x: 2020, y: 40 }, monitor: external });
    expect(windowPositionSettled(onExternal, { monitor: "Side", x: 100, y: 40 })).toBe(true);
    const onRetina = geometry({ origin: { x: 50, y: 65 }, monitor: retina });
    expect(windowPositionSettled(onRetina, { monitor: "Main", x: 50, y: 40 })).toBe(true);
  });

  it("refuses an unknown monitor, a position off the work area, Dock and a minimized window", async () => {
    const monitors = [MAIN, SIDE];
    expect(
      planWindowMove({ form: "normal" }, geometry(), monitors, { monitor: "Gone", x: 0, y: 0 })
    ).toEqual({ refusal: "monitorNotFound" });
    expect(
      planWindowMove({ form: "normal" }, geometry(), monitors, { monitor: "Side", x: 700, y: 0 })
    ).toMatchObject({ refusal: "windowPositionUnavailable" });
    expect(
      planWindowMove({ form: "dock" }, geometry(), monitors, { monitor: "Side", x: 0, y: 0 })
    ).toEqual({ refusal: "dockActive" });
    await expect(
      windowHandlers["window.move"].run(
        context(
          "window.move",
          { monitor: "Side", x: 0, y: 0, expectedRevision: 0 },
          {
            available: true,
            form: "normal",
            visible: true,
            readGeometry: async () => geometry({ minimized: true }),
            readMonitors: async () => monitors,
            moveTo: vi.fn(),
          }
        )
      )
    ).rejects.toMatchObject({ reason: "windowMinimized" });
  });

  it("maximizes, restores and minimizes through the window's own state, idempotently", async () => {
    let current = geometry();
    const state = {
      available: true,
      form: "normal",
      visible: true,
      readGeometry: async () => current,
      maximize: vi.fn(async () => {
        current = geometry({ maximized: true });
      }),
      unmaximize: vi.fn(async () => {
        current = geometry({ maximized: false });
      }),
      minimize: vi.fn(async () => {
        current = geometry({ minimized: true });
      }),
    };
    const run = (method) =>
      windowHandlers[method].run(context(method, { expectedRevision: 0 }, state));
    await expect(run("window.maximize")).resolves.toMatchObject({
      result: { changed: true, maximized: true },
    });
    await expect(run("window.maximize")).resolves.toMatchObject({ result: { changed: false } });
    expect(state.maximize).toHaveBeenCalledOnce();
    await expect(run("window.unmaximize")).resolves.toMatchObject({
      result: { changed: true, maximized: false },
    });
    await expect(run("window.minimize")).resolves.toMatchObject({
      result: { changed: true, minimized: true },
    });
    await expect(run("window.maximize")).rejects.toMatchObject({ reason: "windowMinimized" });
    await expect(
      windowHandlers["window.minimize"].run(
        context("window.minimize", { expectedRevision: 0 }, { ...state, visible: false })
      )
    ).rejects.toMatchObject({ reason: "windowHidden" });
    await expect(
      windowHandlers["window.maximize"].run(
        context("window.maximize", { expectedRevision: 0 }, { ...state, form: "dock" })
      )
    ).rejects.toMatchObject({ reason: "dockActive" });
  });
});
