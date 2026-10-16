/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { settingsStore } from "../persistence/index.js";
import { buildDockPanelDescription, compileDockLayout } from "./dockControl.js";

const dock = {
  panelsById: { v: { id: "v", moduleId: "vectorscope" } },
  panelOrder: ["v"],
  panelSizesById: { v: 220 },
  controlsByPanelId: {},
};

describe("Dock Vector profile constraints", () => {
  it("describes the rendered minimum while preserving smaller saved preferences", () => {
    try {
      settingsStore.patch({ interfaceSize: "small" });
      expect(buildDockPanelDescription(dock, "v").width.min).toBe(71);
      expect(compileDockLayout(dock, { panels: [{ panelId: "v", width: 71 }] }, {}).issues).toEqual(
        []
      );
      settingsStore.patch({ interfaceSize: "extra-large" });
      expect(buildDockPanelDescription(dock, "v").width.min).toBe(96);
      expect(compileDockLayout(dock, { panels: [{ panelId: "v", width: 71 }] }, {}).issues).toEqual(
        []
      );
      expect(compileDockLayout(dock, { panels: [{ panelId: "v", width: 96 }] }, {}).issues).toEqual(
        []
      );
    } finally {
      settingsStore.reset();
    }
  });
});
