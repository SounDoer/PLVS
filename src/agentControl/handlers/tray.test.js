import { describe, expect, it, vi } from "vitest";
import { normalizeAgentControlRequest } from "../protocol.js";
import { createRevisionClock } from "../bridge/revisionClock.js";
import { settleTrayScreenshot, trayHandlers } from "./tray.js";

const source = {
  key: "workbench:a:source",
  kind: "submenu",
  pageTitle: "Source",
  items: [{ key: "automatic", kind: "check", checked: true }],
};
const items = [
  { key: "workbench:a", kind: "submenu", items: [source, { key: "workbench:a:window" }] },
  { key: "app:quit" },
];

function setup(customPanel = true) {
  const state = {
    items,
    visible: customPanel ? false : null,
    navigation: {},
    uiGeneration: 4,
    rendered: null,
  };
  const action = vi.fn();
  const trayControl = {
    owner: true,
    customPanel,
    read: vi.fn(async () => state),
    open: vi.fn(async (navigation) => {
      state.visible = true;
      state.navigation = navigation;
      state.rendered = {
        presentation: 1,
        rect: { x: 0, y: 320, width: 610, height: 280 },
        viewport: { width: 610, height: 750 },
        devicePixelRatio: 2,
      };
      state.uiGeneration += 1;
      return 1;
    }),
    close: vi.fn(async () => {
      state.visible = false;
      state.rendered = null;
    }),
    activate: vi.fn(async (key, guard) => {
      await guard();
      action(key);
    }),
  };
  const ctx = (method, params = {}) =>
    /** @type {any} */ ({
      request: {
        method,
        params: { expectedRevision: 0, expectedUiGeneration: state.uiGeneration, ...params },
      },
      requestId: "tray-request",
      clock: createRevisionClock({ onWake: () => {} }),
      live: () => ({ trayControl }),
    });
  const run = (method, params) => trayHandlers[method].run(ctx(method, params));
  return { trayControl, ctx, run, action };
}

describe("Tray Control", () => {
  it("requires both guards and validates the item options", () => {
    for (const [method, params, reason] of [
      ["tray.open", { expectedRevision: 0 }, "uiGenerationRequired"],
      [
        "tray.close",
        { expectedRevision: 0, expectedUiGeneration: 4, item: "any" },
        "invalidParams",
      ],
      ["tray.activate", { expectedRevision: 0, expectedUiGeneration: 4 }, "invalidParams"],
    ]) {
      expect(
        normalizeAgentControlRequest({ jsonrpc: "2.0", id: "test", method, params })
      ).toMatchObject({
        ok: false,
        error: { reason },
      });
    }
  });

  it("reads native menu choices without claiming the host menu is visible", async () => {
    const { run, trayControl } = setup(false);
    expect((await run("tray.inspect")).result).toMatchObject({
      visible: null,
      presentation: "native",
      items,
    });
    await expect(run("tray.open")).rejects.toMatchObject({ reason: "controlUnavailable" });
    expect(trayControl.open).not.toHaveBeenCalled();
  });

  it("opens a picker, captures its window and activates its choice only with current guards", async () => {
    const { ctx, run, action } = setup();
    await expect(run("tray.activate", { item: "automatic" })).rejects.toMatchObject({
      reason: "targetUnavailable",
    });
    const opened = await run("tray.open", { item: source.key });
    expect(opened.result).toMatchObject({
      visible: true,
      navigation: { branchKey: "workbench:a", pickerKey: source.key },
      uiGeneration: 5,
    });
    const capture = await settleTrayScreenshot(ctx("visual.screenshot"));
    expect(capture).toMatchObject({
      windowLabel: "tray-workbench",
      rect: { x: 0, y: 320, width: 610, height: 280 },
      viewport: { width: 610, height: 750 },
      uiGeneration: 5,
    });
    await expect(
      run("tray.activate", { item: "automatic", expectedUiGeneration: 4 })
    ).rejects.toMatchObject({ reason: "uiGenerationConflict" });
    await expect(run("tray.activate", { item: "app:quit" })).rejects.toMatchObject({
      reason: "targetUnavailable",
    });
    expect(action).not.toHaveBeenCalled();
    await run("tray.activate", { item: "automatic" });
    expect(action).toHaveBeenCalledExactlyOnceWith("automatic");
    await run("tray.close");
    await expect(settleTrayScreenshot(ctx("visual.screenshot"))).rejects.toMatchObject({
      reason: "targetUnavailable",
    });
  });
});
