import { describe, it, expect } from "vitest";
import { WORKSPACE_STORAGE_KEY, BUILTIN_PRESETS, ALL_MODULE_IDS } from "./constants.js";

describe("digit keyboard shortcuts (keys 1–N map to ALL_MODULE_IDS)", () => {
  it("covers all modules: one digit key per module", () => {
    expect(ALL_MODULE_IDS).toHaveLength(7);
  });

  it("digit 7 maps to waveform", () => {
    expect(ALL_MODULE_IDS[6]).toBe("waveform");
  });
});

describe("workspace localStorage keys", () => {
  it("uses plvs:workspace:v3 as WORKSPACE_STORAGE_KEY", () => {
    expect(WORKSPACE_STORAGE_KEY).toBe("plvs:workspace:v3");
  });
});

describe("BUILTIN_PRESETS ratio invariants", () => {
  function collectSplitNodes(node) {
    if (node.type === "leaf") return [];
    return [node, ...node.children.flatMap(collectSplitNodes)];
  }

  for (const preset of BUILTIN_PRESETS) {
    const splits = collectSplitNodes(preset.tree);

    it(`${preset.name}: all fixed sizes are ratios between 0 and 1`, () => {
      for (const s of splits) {
        for (const size of s.sizes) {
          if (size !== null) {
            expect(size).toBeGreaterThan(0);
            expect(size).toBeLessThan(1);
          }
        }
      }
    });

    it(`${preset.name}: fixed ratios per split sum to less than 1`, () => {
      for (const s of splits) {
        const fixedSum = s.sizes.filter((v) => v !== null).reduce((a, b) => a + b, 0);
        expect(fixedSum).toBeLessThan(1);
      }
    });
  }
});
