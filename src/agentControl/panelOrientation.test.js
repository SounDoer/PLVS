import { describe, expect, it } from "vitest";
import { DEFAULT_PANEL_CONTROLS } from "../lib/panelControls.js";
import { PANEL_ORIENTATIONS } from "../math/panelOrientation.js";
import { spectrumRequestKeyFromControls } from "../analysis/analysisRequests.js";
import { planPublicPanelControlPatch, planPublicPanelReset } from "./panelControlPatch.js";
import { readPublicPanelControls } from "./panelControls.js";
import { buildPublicPanelControlSchema } from "./panelControlSchema.js";

describe.each(["levelMeter", "loudness", "waveform", "spectrogram"])(
  "%s orientation",
  (moduleId) => {
    it.each(PANEL_ORIENTATIONS)(
      "round trips %s without changing other controls or analysis",
      (orientation) => {
        const current = { ...DEFAULT_PANEL_CONTROLS, historyOffsetSec: 12, historyWindowSec: 30 };
        const before = { ...current };
        const next = planPublicPanelControlPatch(moduleId, current, { orientation });
        expect(next.issues).toEqual([]);
        expect(readPublicPanelControls(moduleId, next.panelControls).orientation).toBe(orientation);
        expect(next.panelControls).toEqual({ ...before, [`${moduleId}Orientation`]: orientation });
        expect(current).toEqual(before);
        expect(spectrumRequestKeyFromControls(next.panelControls)).toEqual(
          spectrumRequestKeyFromControls(current)
        );
        const reset = planPublicPanelReset(moduleId, next.panelControls);
        expect(readPublicPanelControls(moduleId, reset.panelControls).orientation).toBe(
          moduleId === "levelMeter" ? "bottom-to-top" : "right-to-left"
        );
      }
    );

    it.each(["horizontal", "vertical", "diagonal", null, 1])(
      "rejects invalid orientation %s",
      (orientation) => {
        const result = planPublicPanelControlPatch(moduleId, DEFAULT_PANEL_CONTROLS, {
          orientation,
        });
        expect(result.issues[0].code).toBe("invalidEnum");
        expect(result.changed).toEqual([]);
        expect(result.panelControls).toEqual(DEFAULT_PANEL_CONTROLS);
      }
    );

    it("does not partially apply direction beside an invalid field", () => {
      const result = planPublicPanelControlPatch(moduleId, DEFAULT_PANEL_CONTROLS, {
        orientation: "right-to-left",
        unknown: true,
      });
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.changed).toEqual([]);
      expect(result.panelControls).toEqual(DEFAULT_PANEL_CONTROLS);
    });
  }
);

it("stores Heatmap direction without changing the 3D camera", () => {
  const current = {
    ...DEFAULT_PANEL_CONTROLS,
    spectrogramMode: "surface",
    spectrogram3dAzimuthDeg: 210,
  };
  const result = planPublicPanelControlPatch("spectrogram", current, {
    orientation: "bottom-to-top",
  });
  expect(result.issues).toEqual([]);
  expect(result.panelControls).toEqual({ ...current, spectrogramOrientation: "bottom-to-top" });
  expect(
    buildPublicPanelControlSchema("spectrogram", result.panelControls).properties.orientation
      .effective
  ).toBe(false);
});
