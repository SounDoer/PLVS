import { describe, expect, it } from "vitest";

import { DEFAULT_PANEL_CONTROLS } from "../lib/panelControls.js";
import { MODULE_CATALOG } from "../workspace/moduleCatalog.js";
import { planPublicPanelControlPatch, planPublicPanelReset } from "./panelControlPatch.js";
import { buildPublicPanelControlSchema } from "./panelControlSchema.js";
import { readPublicPanelControls } from "./panelControls.js";

const MODULE_IDS = Object.keys(MODULE_CATALOG);
const CONTEXT = { channelCount: 2, channelLabels: ["L", "R"], hasLoudnessReference: true };

describe.each(MODULE_IDS)("App Control and the %s module", (moduleId) => {
  // Every entry point throws `Unsupported panel module` on an id it has no branch for, so a module
  // added to the catalog alone stays broken until whichever command a user happens to call first.
  it("describes, reads, patches and resets", () => {
    expect(() =>
      buildPublicPanelControlSchema(moduleId, DEFAULT_PANEL_CONTROLS, CONTEXT)
    ).not.toThrow();
    expect(() => readPublicPanelControls(moduleId, DEFAULT_PANEL_CONTROLS, CONTEXT)).not.toThrow();
    expect(() =>
      planPublicPanelControlPatch(moduleId, DEFAULT_PANEL_CONTROLS, {}, CONTEXT)
    ).not.toThrow();
    expect(() => planPublicPanelReset(moduleId, DEFAULT_PANEL_CONTROLS, CONTEXT)).not.toThrow();
  });

  // The schema, the read mapping and the patch planner are three hand-written lists of the same
  // fields, and nothing makes them agree. A field added to one and forgotten in another leaves a
  // surface that either advertises what it refuses or accepts what it never mentions.
  it("describes exactly the fields it reads", () => {
    const schema = buildPublicPanelControlSchema(moduleId, DEFAULT_PANEL_CONTROLS, CONTEXT);
    const values = readPublicPanelControls(moduleId, DEFAULT_PANEL_CONTROLS, CONTEXT);
    expect(Object.keys(schema.properties).sort()).toEqual(Object.keys(values).sort());
  });

  it("accepts a patch of every field it describes", () => {
    const schema = buildPublicPanelControlSchema(moduleId, DEFAULT_PANEL_CONTROLS, CONTEXT);
    const values = readPublicPanelControls(moduleId, DEFAULT_PANEL_CONTROLS, CONTEXT);
    const patch = (body) =>
      planPublicPanelControlPatch(moduleId, DEFAULT_PANEL_CONTROLS, body, CONTEXT).issues;

    for (const field of Object.keys(schema.properties)) {
      expect(patch({ [field]: values[field] }), field).toEqual([]);

      // A merge field is also patched one member at a time, the shape an agent actually sends.
      const { patchMode, properties } = schema.properties[field];
      if (patchMode !== "merge" || !properties) continue;
      for (const member of Object.keys(properties)) {
        expect(
          patch({ [field]: { [member]: values[field][member] } }),
          `${field}.${member}`
        ).toEqual([]);
      }
    }
  });
});
