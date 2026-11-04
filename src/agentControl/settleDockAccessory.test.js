/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { settleDockAccessory } from "./settleDockAccessory.js";

const runtime = (visible) => ({
  accessoryGeometry: { dockEditor: { visible, width: 320, height: 200 } },
});
const options = (overrides = {}) => ({
  getRevision: () => 7,
  getUiGeneration: () => 3,
  ...overrides,
});

describe("settleDockAccessory", () => {
  it("refuses a target that is not shown", async () => {
    await expect(
      settleDockAccessory({ kind: "dockEditor" }, runtime(false), options())
    ).rejects.toMatchObject({ reason: "targetUnavailable" });
  });

  it("describes a shown accessory by its own window and size", async () => {
    const settled = await settleDockAccessory({ kind: "dockEditor" }, runtime(true), options());

    expect(settled).toMatchObject({
      windowLabel: "dock-editor",
      rect: { x: 0, y: 0, width: 320, height: 200 },
      viewport: { width: 320, height: 200 },
      revision: 7,
      uiGeneration: 3,
    });
  });

  it("refuses when the revision moved before the capture", async () => {
    await expect(
      settleDockAccessory({ kind: "dockEditor" }, runtime(true), options({ expectedRevision: 6 }))
    ).rejects.toMatchObject({ reason: "revisionConflict" });
  });
});

it("settles an authoring presentation using its actual window and WebView scale", async () => {
  const settled = await settleDockAccessory(
    { kind: "dockSettings" },
    {
      accessoryGeometry: {
        dockSettings: {
          visible: true,
          windowLabel: "dock-authoring",
          width: 432,
          height: 388,
          devicePixelRatio: 1.25,
        },
      },
    },
    options()
  );
  expect(settled.windowLabel).toBe("dock-authoring");
  expect(settled.devicePixelRatio).toBe(1.25);
  expect(settled.viewport).toEqual({ width: 432, height: 388 });
});
