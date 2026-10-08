import { readFile } from "node:fs/promises";
import { Buffer } from "node:buffer";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import {
  ROOT,
  loadRecipe,
  verifyAudio,
  validateRecipe,
  contained,
  candidateIssues,
  assertClearUi,
  assertGeometry,
  assertDefaultScene,
} from "./hero-lib.mjs";
import { DEFAULT_WORKSPACE_STATE as defaults } from "../../src/workspace/constants.js";
import { serializeWorkspaceLayout } from "../../src/agentControl/workspaceLayout.js";
import { readPublicPanelControls } from "../../src/agentControl/panelControls.js";
import { createStarterProfile } from "../../src/lib/loudnessProfileCatalog.js";

const recipe = await loadRecipe();
function measured() {
  return {
    source: { kind: "live", state: "running" },
    sample: { freshness: "fresh", elapsedMs: 78000 },
    loudness: { integratedLufs: -15.3 },
    levels: { channels: [{ peakDbfs: -8 }] },
    profile: { byMetric: { ...recipe.capture.requiredStatuses } },
  };
}
function scene() {
  return {
    workspace: {
      layout: serializeWorkspaceLayout(defaults),
      panels: defaults.panelOrder.map((id) => ({
        id,
        moduleId: defaults.panelsById[id].moduleId,
        axes: {},
        controls: readPublicPanelControls(
          defaults.panelsById[id].moduleId,
          defaults.panelControlsById[id],
          { hasLoudnessReference: true }
        ),
      })),
    },
    appearance: { resolvedThemeId: recipe.scene.themeId },
    settings: { interfaceSize: recipe.scene.interfaceSize },
    dock: { enabled: false },
    view: {
      pinned: false,
      focusView: { autoHideControls: false, compactPanels: false, borderless: false },
      surfaceOpacity: 100,
      glassEnabled: false,
    },
  };
}
describe("marketing capture safeguards", () => {
  it("pins the approved audio bytes and provenance", async () => {
    const bytes = await readFile(join(ROOT, recipe.audio.path));
    verifyAudio(bytes, recipe);
    const provenance = JSON.parse(await readFile(join(ROOT, recipe.audio.provenancePath), "utf8"));
    expect(provenance.excerpt.sha256).toBe(recipe.audio.sha256);
    const changed = Buffer.from(bytes);
    changed[100] ^= 1;
    expect(() => verifyAudio(changed, recipe)).toThrow("checksum");
  });
  it("rejects FILE recipes and unsafe output paths", () => {
    expect(() =>
      validateRecipe({ ...recipe, capture: { ...recipe.capture, source: "file" } })
    ).toThrow();
    expect(() => contained(ROOT, "../outside.png")).toThrow();
    expect(() =>
      validateRecipe({ ...recipe, capture: { ...recipe.capture, candidateSeconds: [30] } })
    ).toThrow();
  });
  it("rejects stale, silent, incomplete or wrong-color measurements", () => {
    expect(candidateIssues(measured(), recipe)).toEqual([]);
    const wrong = measured();
    wrong.source.kind = "file";
    wrong.sample.freshness = "stale";
    wrong.sample.elapsedMs = 2000;
    wrong.loudness.integratedLufs = null;
    wrong.levels.channels = [];
    wrong.profile.byMetric.truePeak = "ok";
    expect(candidateIssues(wrong, recipe)).toHaveLength(4);
  });
  it("requires the actual window geometry and unobstructed registered UI", () => {
    const ui = {
      window: { visible: true, form: "normal" },
      surfaces: [],
      activeBlockingEditors: [],
    };
    expect(() => assertClearUi(ui)).not.toThrow();
    expect(() => assertClearUi({ ...ui, surfaces: [{ kind: "menu" }] })).toThrow();
    expect(() =>
      assertGeometry({ ...recipe.environment, windowDpi: 96 }, recipe.environment)
    ).toThrow("windowDpi");
  });
  it("rejects rearranged panels, changed controls and altered threshold rules", () => {
    const profile = createStarterProfile(() => "test");
    expect(() => assertDefaultScene(scene(), profile, recipe)).not.toThrow();
    const layout = scene();
    layout.workspace.layout.children.reverse();
    expect(() => assertDefaultScene(layout, profile, recipe)).toThrow("layout");
    const controls = scene();
    controls.workspace.panels[0].controls = {};
    expect(() => assertDefaultScene(controls, profile, recipe)).toThrow("controls");
    expect(() => assertDefaultScene(scene(), { ...profile, rules: [] }, recipe)).toThrow("profile");
  });
});
