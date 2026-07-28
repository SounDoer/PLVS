import { describe, expect, it } from "vitest";
import { reorderIdsAtPointer } from "./usePointerReorder.js";

describe("reorderIdsAtPointer", () => {
  it("moves the active id to the row under the pointer", () => {
    expect(reorderIdsAtPointer(["a", "b"], "a", 95, { top: 40, height: 72 })).toEqual(["b", "a"]);
  });

  it("leaves the order unchanged without a measurable rect", () => {
    const ids = ["a", "b"];
    expect(reorderIdsAtPointer(ids, "a", 95, null)).toBe(ids);
    expect(reorderIdsAtPointer(ids, "a", 95, { top: 0, height: 0 })).toBe(ids);
  });

  it("leaves the order unchanged when the pointer stays over the active row", () => {
    const ids = ["a", "b"];
    expect(reorderIdsAtPointer(ids, "a", 10, { top: 0, height: 72 })).toBe(ids);
  });
});
