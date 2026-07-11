import { describe, expect, it } from "vitest";
import { DOCK_MODULE_IDS } from "./dockLayout.js";
import { DOCK_MODULE_REGISTRY } from "./registry.jsx";

describe("DOCK_MODULE_REGISTRY", () => {
  it("covers exactly the known dock module ids", () => {
    expect(Object.keys(DOCK_MODULE_REGISTRY).sort()).toEqual([...DOCK_MODULE_IDS].sort());
  });

  it("every entry has id, label, and a component", () => {
    for (const id of DOCK_MODULE_IDS) {
      const entry = DOCK_MODULE_REGISTRY[id];
      expect(entry.id).toBe(id);
      expect(typeof entry.label).toBe("string");
      expect(typeof entry.Component).toBe("function");
      expect(typeof entry.flexible).toBe("boolean");
    }
  });
});
