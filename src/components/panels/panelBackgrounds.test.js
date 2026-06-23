import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("panel chart chrome", () => {
  it("does not use muted chart-area backgrounds or rounded chart containers", () => {
    const panelFiles = [
      "LoudnessHistoryChart.jsx",
      "WaveformPanel.jsx",
      "SpectrogramPanel.jsx",
      "SpectrumPanel.jsx",
      "VectorscopePanel.jsx",
      "LevelMeterPanel.jsx",
    ];

    for (const file of panelFiles) {
      const source = readFileSync(join(__dirname, file), "utf8");
      expect(source, file).not.toContain("bg-muted");
    }

    const disallowedChartContainerClasses = [
      ["LoudnessHistoryChart.jsx", "flex-1 rounded-lg"],
      ["WaveformPanel.jsx", "flex-1 rounded"],
      ["WaveformPanel.jsx", "w-full rounded"],
      ["SpectrogramPanel.jsx", "h-full rounded-lg"],
      ["SpectrumPanel.jsx", "h-full rounded-lg"],
      ["VectorscopePanel.jsx", "w-full rounded-lg"],
      ["LevelMeterPanel.jsx", "rounded-lg p-0"],
    ];

    for (const [file, classSnippet] of disallowedChartContainerClasses) {
      const source = readFileSync(join(__dirname, file), "utf8");
      expect(source, `${file} should not use ${classSnippet}`).not.toContain(classSnippet);
    }
  });
});
