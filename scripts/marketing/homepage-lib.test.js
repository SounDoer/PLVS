import { describe, it, expect } from "vitest";
import {
  DOCK_RECIPE,
  FEATURES_RECIPE,
  loadRecipeFile,
  validateDockRecipe,
  validateFeaturesRecipe,
  parseCaptureArgs,
  parseExportArgs,
  assertLiveEdge,
  assertSnapshotAt,
  findStartupSurface,
} from "./homepage-lib.mjs";

const dock = await loadRecipeFile(DOCK_RECIPE, validateDockRecipe);
const features = await loadRecipeFile(FEATURES_RECIPE, validateFeaturesRecipe);
const copy = (value) => structuredClone(value);
const live = () => ({
  live: { state: "running", atLiveEdge: true },
  snapshot: { active: false, offsetSec: null },
});

describe("homepage capture arguments", () => {
  it("defaults to the given recipe and a new run directory", () => {
    expect(parseCaptureArgs([], DOCK_RECIPE)).toEqual({
      recipe: DOCK_RECIPE,
      out: null,
      wait: false,
    });
    expect(
      parseCaptureArgs(
        ["--recipe", "r.json", "--out", "artifacts/marketing/x", "--wait"],
        DOCK_RECIPE
      )
    ).toEqual({ recipe: "r.json", out: "artifacts/marketing/x", wait: true });
  });
  it("rejects unknown flags and missing values", () => {
    expect(() => parseCaptureArgs(["--publish"], DOCK_RECIPE)).toThrow("Usage");
    expect(() => parseCaptureArgs(["--out"], DOCK_RECIPE)).toThrow("Usage");
    expect(() => parseCaptureArgs(["--out", "--wait"], DOCK_RECIPE)).toThrow("Usage");
  });
  it("exports only after explicit review and publishes only on request", () => {
    expect(parseExportArgs(["run", "--reviewed"])).toEqual({ run: "run", publish: false });
    expect(parseExportArgs(["run", "--reviewed", "--publish"])).toEqual({
      run: "run",
      publish: true,
    });
    expect(() => parseExportArgs(["run"])).toThrow("Usage");
    expect(() => parseExportArgs(["run", "--publish"])).toThrow("Usage");
    expect(() => parseExportArgs(["--reviewed"])).toThrow("Usage");
    expect(() => parseExportArgs(["run", "--reviewed", "--force"])).toThrow("Usage");
  });
});

describe("Dock LIVE guard", () => {
  it("accepts running LIVE at the live edge", () => {
    expect(() => assertLiveEdge(live())).not.toThrow();
  });
  it("refuses an active Snapshot, a lagging view or stopped capture", () => {
    const snapshot = live();
    snapshot.snapshot = { active: true, offsetSec: 0 };
    expect(() => assertLiveEdge(snapshot)).toThrow("live edge");
    const behind = live();
    behind.live.atLiveEdge = false;
    expect(() => assertLiveEdge(behind)).toThrow("live edge");
    const stopped = live();
    stopped.live.state = "stopped";
    expect(() => assertLiveEdge(stopped)).toThrow("live edge");
    expect(() => assertLiveEdge(undefined)).toThrow("live edge");
  });
  it("requires the custom strip's Snapshot at the recipe offset", () => {
    expect(() => assertSnapshotAt({ snapshot: { active: true, offsetSec: 0 } }, 0)).not.toThrow();
    expect(() => assertSnapshotAt(live(), 0)).toThrow("Snapshot");
    expect(() => assertSnapshotAt({ snapshot: { active: true, offsetSec: 5 } }, 0)).toThrow();
  });
});

describe("first-run surface", () => {
  const spec = dock.startup.dismissSurfaces[0];
  const surface = {
    surfaceId: "s1",
    kind: "update",
    target: { phase: "preferences" },
    supportedActions: ["cancel"],
  };
  it("finds the Update Preferences dialog only while it can be cancelled", () => {
    expect(spec).toEqual({ kind: "update", phase: "preferences", action: "cancel" });
    expect(findStartupSurface({ surfaces: [surface] }, spec)).toBe(surface);
    expect(findStartupSurface({ surfaces: [{ ...surface, supportedActions: [] }] }, spec)).toBe(
      undefined
    );
    expect(
      findStartupSurface({ surfaces: [{ ...surface, target: { phase: "idle" } }] }, spec)
    ).toBe(undefined);
  });
});

describe("Dock recipe", () => {
  it("records LIVE default, Snapshot custom and the 125% strip size", () => {
    expect(dock.strips.map((s) => [s.name, s.transport])).toEqual([
      ["dock-default", "live-edge"],
      ["dock-custom", "snapshot"],
    ]);
    expect(dock.strips[1].snapshotOffsetSec).toBe(0);
    expect(dock.environment).toMatchObject({ width: 2560, height: 225, windowDpi: 120 });
    expect(dock.strips[1].layout.panels.map((p) => p.panelId ?? p.key)).toEqual([
      "level",
      "rms",
      "loudness",
      "spectrum",
      "correlation",
    ]);
  });
  it("rejects a Snapshot default strip, a moved custom offset and mismatched DPI", () => {
    const snapshotDefault = copy(dock);
    snapshotDefault.strips[0].transport = "snapshot";
    expect(() => validateDockRecipe(snapshotDefault)).toThrow("LIVE edge");
    const offset = copy(dock);
    offset.strips[1].snapshotOffsetSec = 5;
    expect(() => validateDockRecipe(offset)).toThrow();
    const dpi = copy(dock);
    dpi.environment.windowDpi = 96;
    expect(() => validateDockRecipe(dpi)).toThrow("Dock height");
  });
  it("requires the first-run surface to be cancelled and outputs inside the repository", () => {
    const confirm = copy(dock);
    confirm.startup.dismissSurfaces[0].action = "confirm";
    expect(() => validateDockRecipe(confirm)).toThrow("Startup");
    const outside = copy(dock);
    outside.publication["dock-default"].webp = "../landing-dock.webp";
    expect(() => validateDockRecipe(outside)).toThrow("escapes");
  });
});

describe("feature recipe", () => {
  it("keeps multichannel in FILE mode and the rest LIVE", () => {
    const fileMode = copy(features);
    fileMode.multichannel.source = "live";
    expect(() => validateFeaturesRecipe(fileMode)).toThrow("FILE");
    const liveMode = copy(features);
    liveMode.live.source = "file";
    expect(() => validateFeaturesRecipe(liveMode)).toThrow("LIVE");
  });
  it("requires controls for exactly the panels in each layout", () => {
    const extra = copy(features);
    extra.live.scenes[0].panels.stats = {};
    expect(() => validateFeaturesRecipe(extra)).toThrow("layout panels");
    const missing = copy(features);
    delete missing.multichannel.scene.panels.waveform;
    expect(() => validateFeaturesRecipe(missing)).toThrow("layout panels");
  });
  it("rejects duplicate images and panel captures without a panel", () => {
    const duplicate = copy(features);
    duplicate.live.scenes[1].images[1].name = "history";
    expect(() => validateFeaturesRecipe(duplicate)).toThrow("unique");
    const panel = copy(features);
    delete panel.live.scenes[1].images[0].panelId;
    expect(() => validateFeaturesRecipe(panel)).toThrow("Invalid image");
  });
});
