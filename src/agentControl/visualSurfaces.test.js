/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resolveVisualSurface,
  settleVisualSurface,
  subscribeVisualSurfaceResize,
} from "./visualSurfaces.js";

function rect(left, top, width, height) {
  return { left, top, width, height, right: left + width, bottom: top + height };
}

function addSurface(kind, bounds, { ready = true } = {}) {
  const element = document.createElement("div");
  element.setAttribute("data-visual-capture-surface", kind);
  if (ready) element.setAttribute("data-visual-capture-ready", "true");
  element.getBoundingClientRect = vi.fn(() => bounds);
  document.body.append(element);
  return element;
}

function addPanel(panelId, bounds) {
  const element = document.createElement("div");
  element.setAttribute("data-visual-panel-id", panelId);
  element.setAttribute("data-visual-capture-ready", "true");
  element.getBoundingClientRect = vi.fn(() => bounds);
  document.body.append(element);
  return element;
}

describe("visual surface resolution", () => {
  beforeEach(() => {
    document.body.replaceChildren();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 800 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 600 });
    Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 1.25 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("resolves main and bounded workspace geometry without exposing selectors", () => {
    addSurface("main", rect(0, 0, 800, 600));
    addSurface("workspace", rect(-2, 80, 804, 500));
    const main = resolveVisualSurface({ target: { kind: "main" }, workspace: {} });
    const workspace = resolveVisualSurface({ target: { kind: "workspace" }, workspace: {} });

    expect(main.surface).toMatchObject({
      windowLabel: "main",
      rect: { x: 0, y: 0, width: 800, height: 600 },
      viewport: { width: 800, height: 600 },
      devicePixelRatio: 1.25,
    });
    expect(workspace.surface.rect).toEqual({ x: 0, y: 80, width: 800, height: 500 });
    expect(JSON.stringify({ ...workspace.surface, element: undefined })).not.toMatch(/selector/);
  });

  it("distinguishes missing Panels from existing inactive tabs", () => {
    const workspace = { panelsById: { active: {}, inactive: {} } };
    addPanel("active", rect(10, 10, 300, 200));
    expect(
      resolveVisualSurface({ target: { kind: "missing", panelId: "missing" }, workspace }).error
        .reason
    ).toBe("invalidParams");
    expect(
      resolveVisualSurface({ target: { kind: "panel", panelId: "missing" }, workspace }).error
        .reason
    ).toBe("panelNotFound");
    expect(
      resolveVisualSurface({ target: { kind: "panel", panelId: "inactive" }, workspace }).error
        .reason
    ).toBe("panelNotVisible");
    expect(
      resolveVisualSurface({ target: { kind: "panel", panelId: "active" }, workspace }).surface.rect
    ).toEqual({ x: 10, y: 10, width: 300, height: 200 });
  });

  it("selects the rendered focus Panel and leaves overlays untouched", () => {
    const workspace = { panelsById: { spectrum: {} } };
    const hiddenLeaf = addPanel("spectrum", rect(0, 0, 200, 100));
    hiddenLeaf.style.visibility = "hidden";
    const focusPanel = addPanel("spectrum", rect(0, 0, 800, 600));
    const overlay = document.createElement("div");
    overlay.dataset.overlay = "open";
    focusPanel.append(overlay);

    const result = resolveVisualSurface({
      target: { kind: "panel", panelId: "spectrum" },
      workspace,
    });
    expect(result.surface.element).toBe(focusPanel);
    expect(document.querySelector("[data-overlay=open]")).toBe(overlay);
  });

  it.each([
    ["dockHeader", "dock-header"],
    ["dockEditor", "dock-editor"],
  ])("requires the owning accessory WebView for %s", (kind, windowLabel) => {
    addSurface(kind, rect(0, 0, 400, 100));
    expect(resolveVisualSurface({ target: { kind }, workspace: {}, windowLabel }).ok).toBe(true);
    expect(resolveVisualSurface({ target: { kind }, workspace: {}, windowLabel: "main" })).toEqual({
      ok: false,
      error: expect.objectContaining({ reason: "targetUnavailable" }),
    });
  });
});

describe("visual paint settlement", () => {
  beforeEach(() => {
    document.body.replaceChildren();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 640 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 480 });
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { ready: Promise.resolve() },
    });
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) =>
      setTimeout(() => callback(performance.now()), 0)
    );
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(clearTimeout);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("waits for two stable animation frames and settled Canvas backing dimensions", async () => {
    const surface = addSurface("workspace", rect(20, 30, 400, 300));
    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 600;
    canvas.getBoundingClientRect = vi.fn(() => rect(20, 30, 400, 300));
    surface.append(canvas);
    const getRevision = vi.fn(() => 12);

    await expect(
      settleVisualSurface({
        target: { kind: "workspace" },
        workspace: {},
        expectedRevision: 12,
        getRevision,
      })
    ).resolves.toMatchObject({
      revision: 12,
      rect: { x: 20, y: 30, width: 400, height: 300 },
    });
    expect(window.requestAnimationFrame).toHaveBeenCalledTimes(2);
    expect(getRevision).toHaveBeenCalledTimes(1);
  });

  it("reports a conflict only after settlement and creates no geometry result", async () => {
    addSurface("workspace", rect(0, 0, 640, 480));
    await expect(
      settleVisualSurface({
        target: { kind: "workspace" },
        workspace: {},
        expectedRevision: 4,
        getRevision: () => 5,
      })
    ).rejects.toMatchObject({
      reason: "revisionConflict",
      details: { expectedRevision: 4, currentRevision: 5 },
    });
  });

  it("times out when readiness or Canvas dimensions never settle", async () => {
    addSurface("workspace", rect(0, 0, 640, 480), { ready: false });
    await expect(
      settleVisualSurface({
        target: { kind: "workspace" },
        workspace: {},
        getRevision: () => 0,
        timeoutMs: 15,
      })
    ).rejects.toMatchObject({ reason: "renderNotSettled" });
  });

  it("supports cancellation", async () => {
    addSurface("workspace", rect(0, 0, 640, 480), { ready: false });
    const controller = new AbortController();
    const pending = settleVisualSurface({
      target: { kind: "workspace" },
      workspace: {},
      getRevision: () => 0,
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("creates ResizeObserver only for an explicit recording subscription", () => {
    const surface = addSurface("workspace", rect(0, 0, 640, 480));
    const disconnect = vi.fn();
    const observe = vi.fn();
    const ResizeObserverStub = vi.fn(function ResizeObserverStub(callback) {
      this.observe = observe;
      this.disconnect = disconnect;
      this.callback = callback;
    });
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);

    expect(ResizeObserverStub).not.toHaveBeenCalled();
    const unsubscribe = subscribeVisualSurfaceResize({
      target: { kind: "workspace" },
      workspace: {},
      onGeometry: vi.fn(),
    });
    expect(ResizeObserverStub).toHaveBeenCalledTimes(1);
    expect(observe).toHaveBeenCalledWith(surface);
    unsubscribe();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
