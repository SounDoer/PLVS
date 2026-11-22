import { describe, expect, it } from "vitest";
import { suggestNames, withControlSuggestions } from "./nameSuggestions.js";

describe("name suggestions", () => {
  it("finds typos, transpositions, case and separator variants, and partial names", () => {
    expect(suggestNames("gird", ["grid", "layers", "mode"])).toEqual(["grid"]);
    expect(suggestNames("spectrm", ["spectrum", "spectrogram", "stats"])).toEqual(["spectrum"]);
    expect(suggestNames("Level-Meter", ["levelMeter", "loudness"])).toEqual(["levelMeter"]);
    expect(suggestNames("stereo", ["stereo-map", "stats"])).toEqual(["stereo-map"]);
  });

  it("offers nothing for an unrelated name and at most three names", () => {
    expect(suggestNames("zzz", ["grid", "mode"])).toEqual([]);
    expect(suggestNames("a1", ["a2", "a3", "a4", "a5"])).toHaveLength(3);
    expect(suggestNames(undefined, ["grid"])).toEqual([]);
  });

  it("draws control suggestions from the same place in the current state", () => {
    const current = { grid: true, threeD: { azimuth: 30, elevation: 20 } };
    expect(
      withControlSuggestions(
        [
          { code: "unknownControl", path: "$.threeD.azimuht", message: "Unknown." },
          { code: "invalidType", path: "$.grid", message: "Bad." },
        ],
        current
      )
    ).toEqual([
      {
        code: "unknownControl",
        path: "$.threeD.azimuht",
        message: "Unknown.",
        suggestions: ["azimuth"],
      },
      { code: "invalidType", path: "$.grid", message: "Bad." },
    ]);
  });

  it("explains the inspection wrapper instead of suggesting a name", () => {
    const [issue] = withControlSuggestions(
      [{ code: "unknownControl", path: "$.settings", message: "Unknown Settings control." }],
      { interfaceSize: "default" },
      { wrapper: "settings", command: "settings update" }
    );
    expect(issue.message).toBe(
      'settings update takes the fields inside "settings" directly: remove the "settings" wrapper that inspection shows around them.'
    );
    expect(issue.suggestions).toBeUndefined();
  });
});
