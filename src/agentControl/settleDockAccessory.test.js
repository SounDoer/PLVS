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
