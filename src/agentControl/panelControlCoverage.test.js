import { describe, expect, it, vi } from "vitest";

import { AXIS_VIEWPORTS } from "../workspace/axisViewports.js";
import { MODULE_CATALOG } from "../workspace/moduleCatalog.js";

/**
 * Controls deliberately withheld from App Control, each with the reason it stays internal.
 *
 * Empty is the correct state: every control PLVS has today is reachable through Panel Control or
 * Axis Control. A new entry here is a decision, not a formality -- see the test below.
 */
const INTERNAL_ONLY_CONTROLS = new Set([]);

const { readKeys } = vi.hoisted(() => ({ readKeys: new Set() }));

/**
 * Records which internal control keys the public read mapping consumes, by handing it a recording
 * Proxy in place of the normalized record. Scanning the mapping's source text would also count keys
 * named in a comment or in an unrelated branch; this counts only keys the code actually reads.
 */
vi.mock("../lib/panelControls.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    normalizePanelControls: (raw) =>
      new Proxy(actual.normalizePanelControls(raw), {
        get(target, key) {
          if (typeof key === "string") readKeys.add(key);
          return target[key];
        },
      }),
  };
});

const { DEFAULT_PANEL_CONTROLS } = await import("../lib/panelControls.js");
const { readPublicPanelControls } = await import("./panelControls.js");

/** Contexts that widen the mapping's conditional branches -- channel topology, loudness reference. */
const CONTEXTS = [
  {},
  { channelCount: 2, channelLabels: ["L", "R"] },
  { channelCount: 4, hasLoudnessReference: true },
];

function panelControlKeys() {
  readKeys.clear();
  for (const moduleId of Object.keys(MODULE_CATALOG)) {
    for (const context of CONTEXTS) {
      readPublicPanelControls(moduleId, DEFAULT_PANEL_CONTROLS, context);
    }
  }
  return new Set(readKeys);
}

/** The keys Axis Control reads and writes: each kind's link flag and its members' local ranges. */
function axisControlKeys() {
  const keys = new Set();
  for (const kind of Object.values(AXIS_VIEWPORTS)) {
    keys.add(kind.linkKey);
    for (const member of Object.values(kind.members)) {
      for (const key of Object.values(member)) keys.add(key);
    }
  }
  return keys;
}

describe("panel control coverage", () => {
  it("exposes every panel control through App Control, or records why it is withheld", () => {
    const panel = panelControlKeys();
    const axis = axisControlKeys();
    const unhandled = Object.keys(DEFAULT_PANEL_CONTROLS).filter(
      (key) => !panel.has(key) && !axis.has(key) && !INTERNAL_ONLY_CONTROLS.has(key)
    );
    expect(unhandled).toEqual([]);
  });

  it("keeps the withheld list free of controls that no longer exist", () => {
    const stale = [...INTERNAL_ONLY_CONTROLS].filter((key) => !(key in DEFAULT_PANEL_CONTROLS));
    expect(stale).toEqual([]);
  });

  it("keeps the withheld list free of controls that are in fact exposed", () => {
    const panel = panelControlKeys();
    const axis = axisControlKeys();
    const contradictory = [...INTERNAL_ONLY_CONTROLS].filter(
      (key) => panel.has(key) || axis.has(key)
    );
    expect(contradictory).toEqual([]);
  });
});
