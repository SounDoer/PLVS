import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_LOUDNESS_PROFILE } from "../../src/lib/loudnessProfileCatalog.js";
import {
  finalFrameStatuses,
  homepageRecipeProblems,
  imageModuleIds,
  portableDockPanels,
  portableWorkspace,
  statusMismatches,
} from "./homepage-render-lib.mjs";

const recipe = JSON.parse(
  readFileSync(new URL("./recipes/homepage-images.json", import.meta.url), "utf8")
);
const fixture = JSON.parse(
  readFileSync(
    new URL("../../src/transfer/fixtures/homepageStereoV1.json", import.meta.url),
    "utf8"
  )
);

function withImage(patch, name = "history") {
  const copy = structuredClone(recipe);
  Object.assign(
    copy.images.find((image) => image.name === name),
    patch
  );
  return copy;
}

describe("homepage image recipe", () => {
  it("is valid as committed", () => {
    expect(homepageRecipeProblems(recipe)).toEqual([]);
  });

  it("refuses a Snapshot away from the final frame on panels that only have final readings", () => {
    expect(homepageRecipeProblems(withImage({ snapshotOffsetSec: 5 }, "multichannel"))).toEqual([
      expect.stringMatching(/multichannel: .*levelMeter, stats/),
    ]);
    expect(
      homepageRecipeProblems(withImage({ snapshotOffsetSec: 3 }, "landing-dock-custom")).join()
    ).toMatch(/levelMeter.*vectorscope/);
    expect(homepageRecipeProblems(withImage({ snapshotOffsetSec: 0 }, "multichannel"))).toEqual([]);
  });

  it("checks sizes, crops, fixtures and names", () => {
    expect(homepageRecipeProblems(withImage({ output: { width: 1591, height: 880 } }))).toEqual([
      expect.stringMatching(/viewport × 1.25 is 1590 × 880/),
    ]);
    expect(homepageRecipeProblems(withImage({ fixture: "5.1" })).join()).toMatch(/unknown fixture/);
    expect(homepageRecipeProblems(withImage({ crop: { type: "panel" } })).join()).toMatch(
      /names its moduleId/
    );
    expect(homepageRecipeProblems(withImage({ name: "landing-hero" })).join()).toMatch(
      /duplicate name/
    );
    expect(homepageRecipeProblems(withImage({ snapshotOffsetSec: -1 })).join()).toMatch(
      /non-negative/
    );
  });

  it("checks the rules-editor crop, overlay and Profile reference", () => {
    const at = "rules-editor";
    expect(
      homepageRecipeProblems(
        withImage({ crop: { type: "rect", x: 120, y: 120, width: 440, height: 400 } }, at)
      ).join()
    ).toMatch(/rect × 1.25 is 550 × 500/);
    expect(
      homepageRecipeProblems(
        withImage({ crop: { type: "rect", x: 900, y: 120, width: 448, height: 400 } }, at)
      ).join()
    ).toMatch(/leaves the viewport/);
    expect(homepageRecipeProblems(withImage({ overlay: { type: "settings" } }, at)).join()).toMatch(
      /unknown overlay settings/
    );
    expect(homepageRecipeProblems(withImage({ loudnessProfile: "nobody" }, at)).join()).toMatch(
      /unknown loudnessProfile "nobody"/
    );
    expect(homepageRecipeProblems(withImage({ shell: true }, "landing-dock")).join()).toMatch(
      /only a workspace scene takes shell/
    );
  });

  it("resolves the modules each scene shows", () => {
    const byName = Object.fromEntries(recipe.images.map((image) => [image.name, image]));
    expect(imageModuleIds(recipe, byName["frequency-full"])).toEqual(["spectrum", "loudness"]);
    expect(imageModuleIds(recipe, byName["landing-dock-custom"])).toContain("vectorscope");
    expect(imageModuleIds(recipe, byName["landing-hero"])).toContain("stats");
    expect(imageModuleIds(recipe, byName["landing-dock"]).length).toBeGreaterThan(4);
  });
});

describe("hero verdicts", () => {
  it("reads the required statuses from the committed fixture", () => {
    const hero = recipe.images.find(({ name }) => name === "landing-hero");
    const statuses = finalFrameStatuses(fixture, DEFAULT_LOUDNESS_PROFILE);
    expect(statusMismatches(statuses, hero.requiredStatuses)).toEqual([]);
  });

  it("names each status that differs", () => {
    expect(
      statusMismatches({ integrated: "ok" }, { integrated: "warn", truePeak: "fail" })
    ).toEqual(["integrated reads ok, not warn", "truePeak reads unwatched, not fail"]);
  });
});

describe("portable scene pieces", () => {
  it("keys workspace panels and carries their controls and axes", () => {
    const workspace = portableWorkspace({
      layout: {
        type: "split",
        direction: "vertical",
        children: [
          { type: "panel", panelId: "spectrum" },
          { type: "panel", panelId: "loudness" },
        ],
      },
      panels: { spectrum: { view: "ms" } },
      axes: { loudness: { time: { windowSec: 60 } } },
    });
    expect(workspace.layout.children).toEqual([
      { type: "panel", key: "panel-spectrum" },
      { type: "panel", key: "panel-loudness" },
    ]);
    expect(workspace.panels).toEqual([
      { key: "panel-spectrum", moduleId: "spectrum", controls: { view: "ms" }, axes: {} },
      {
        key: "panel-loudness",
        moduleId: "loudness",
        controls: {},
        axes: { time: { windowSec: 60 } },
      },
    ]);
  });

  it("layers recipe Dock controls over first-run controls where asked", () => {
    const panels = portableDockPanels(
      [
        {
          moduleId: "levelMeter",
          title: "Peak",
          width: 330,
          firstRunControls: true,
          controls: { mode: "peak" },
        },
        { moduleId: "levelMeter", width: 330, controls: { mode: "rms" } },
      ],
      { levelMeter: { mode: "loudness", orientation: "bottom-to-top" } }
    );
    expect(panels).toEqual([
      {
        key: "dock-1",
        moduleId: "levelMeter",
        title: "Peak",
        preferredWidthCssPx: 330,
        controls: { mode: "peak", orientation: "bottom-to-top" },
      },
      {
        key: "dock-2",
        moduleId: "levelMeter",
        preferredWidthCssPx: 330,
        controls: { mode: "rms" },
      },
    ]);
  });
});
