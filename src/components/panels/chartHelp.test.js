import { describe, expect, it } from "vitest";
import { resolvePanelHelpItems } from "./chartHelp.js";
import { MODULE_CATALOG } from "../../workspace/moduleCatalog.js";
import { STEREO_MAP_MODES } from "../../math/stereoMapMath.js";

const rows = (id, controls = {}, context = {}) =>
  (resolvePanelHelpItems(id, controls, context) ?? []).flatMap((section) => section.items);
const effects = (...args) => rows(...args).map((item) => item.effect);

describe("contextual panel gestures", () => {
  it.each(["heatmap", "lines", "surface"])(
    "keeps Spectrogram %s right-button meanings separate",
    (spectrogramMode) => {
      const items = rows("spectrogram", { spectrogramMode });
      if (spectrogramMode === "heatmap") {
        expect(items.find((item) => item.gesture === "right-drag")?.effect).toBe("Pan Timeline");
        expect(items.find((item) => item.gesture === "right-double-click")?.effect).toBe(
          "Reset Timeline"
        );
        expect(items.some((item) => item.modifiers.includes("Shift"))).toBe(false);
        expect(items.some((item) => item.gesture === "hover")).toBe(true);
      } else {
        expect(items.find((item) => item.gesture === "right-drag")?.effect).toBe("Rotate");
        expect(items.find((item) => item.gesture === "right-double-click")?.effect).toBe(
          "Reset Viewpoint"
        );
        expect(items.find((item) => item.modifiers.includes("Shift"))?.effect).toBe(
          "Adjust Height Scale"
        );
        expect(items.some((item) => item.gesture === "hover")).toBe(false);
      }
    }
  );

  it("normalizes omitted controls just like the panels", () => {
    expect(resolvePanelHelpItems("spectrogram", undefined)).toEqual(
      resolvePanelHelpItems("spectrogram", { spectrogramMode: "heatmap" })
    );
    expect(effects("vectorscope")).toContain("Slow Trace Decay");
    expect(effects("spectrum")).not.toContain("Clear Max Hold");
  });

  it.each(["off", "decay", "hold"])(
    "only offers Spectrum %s clear and hold-slow when usable",
    (spectrumMaxMode) => {
      expect(effects("spectrum", { spectrumMaxMode }).includes("Clear Max Hold")).toBe(
        spectrumMaxMode === "hold"
      );
      expect(effects("spectrum", { spectrumMaxMode })).toContain("Slow Trace");
      const snapshotEffects = effects("spectrum", { spectrumMaxMode }, { isSnapshot: true });
      expect(snapshotEffects).not.toContain("Clear Max Hold");
      expect(snapshotEffects).not.toContain("Slow Trace");
      expect(snapshotEffects).toContain("Return to Live");
    }
  );

  it.each(["lissajous", "polarSample", "polarLevel"])(
    "filters Vectorscope %s with mode, switch and snapshot",
    (vectorscopeMode) => {
      const controls = { vectorscopeMode, vectorscopePolarLevelMaxHold: true };
      expect(effects("vectorscope", controls)).toEqual(
        vectorscopeMode === "lissajous"
          ? ["Slow Trace Decay"]
          : vectorscopeMode === "polarLevel"
            ? ["Reset Max Hold"]
            : []
      );
      expect(resolvePanelHelpItems("vectorscope", controls, { isSnapshot: true })).toBeNull();
      expect(
        resolvePanelHelpItems("vectorscope", {
          vectorscopeMode: "polarLevel",
          vectorscopePolarLevelMaxHold: false,
        })
      ).toBeNull();
    }
  );

  it.each(["peak", "rms", "momentary", "shortTerm"])(
    "only offers the TP Max marker in Peak, not %s modes",
    (levelMeterMode) => {
      expect(
        effects("levelMeter", { levelMeterMode, levelMeterTpMaxMarker: true }).includes(
          "Reset TP Max"
        )
      ).toBe(levelMeterMode === "peak");
      expect(effects("levelMeter", { levelMeterMode, levelMeterTpMaxMarker: false })).not.toContain(
        "Reset TP Max"
      );
    }
  );

  it.each(Object.keys(MODULE_CATALOG))("removes hidden axis instructions for %s", (moduleId) => {
    const groups = resolvePanelHelpItems(moduleId, {}, { hideAxesAndLabels: true }) ?? [];
    expect(groups.some((group) => group.title === "Axes")).toBe(false);
    expect(groups.every((group) => group.items.length > 0)).toBe(true);
  });

  it("hides the Level Meter button when only hidden axes remain", () => {
    expect(
      resolvePanelHelpItems(
        "levelMeter",
        { levelMeterTpMaxMarker: false },
        { hideAxesAndLabels: true }
      )
    ).toBeNull();
    expect(
      effects(
        "levelMeter",
        { levelMeterMode: "peak", levelMeterTpMaxMarker: true },
        { hideAxesAndLabels: true }
      )
    ).toEqual(["Reset TP Max"]);
  });

  it.each(Object.values(STEREO_MAP_MODES))(
    "names Stereo Map %s chart panning accurately and limits level axes",
    (stereoMapMode) => {
      const items = rows("stereo-map", { stereoMapMode });
      expect(
        items.find((item) => item.gesture === "left-drag" && item.modifiers.includes("Ctrl"))
          ?.effect
      ).toBe("Pan Frequency");
      const hasLevelAxis =
        stereoMapMode === STEREO_MAP_MODES.MONO_LOSS_DB ||
        stereoMapMode === STEREO_MAP_MODES.MS_RATIO_DB;
      expect(items.some((item) => item.target === "Level Axis")).toBe(hasLevelAxis);
    }
  );

  it.each(["loudness", "waveform", "spectrum", "spectrogram", "stereo-map"])(
    "includes the %s hover probe",
    (moduleId) => {
      expect(rows(moduleId).some((item) => item.gesture === "hover")).toBe(true);
    }
  );

  it("has no empty Stats reference or reference for unknown modules", () => {
    expect(resolvePanelHelpItems("stats", {})).toBeNull();
    expect(resolvePanelHelpItems("unknown", {})).toBeNull();
  });

  it("provides stable identifiers, explicit operations and no duplicated modifiers in prose", () => {
    for (const moduleId of Object.keys(MODULE_CATALOG)) {
      for (const section of resolvePanelHelpItems(moduleId, {}) ?? []) {
        const ids = section.items.map((item) => item.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const item of section.items) {
          expect(item.gesture).toBeTruthy();
          expect(item.effect).toBeTruthy();
          expect(Array.isArray(item.modifiers)).toBe(true);
          expect(item.effect).not.toMatch(/Ctrl|Shift|Max hold/);
        }
      }
    }
  });
});
