import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  DOCK_SURFACE_CLASS,
  MODAL_SURFACE_CLASS,
  PANEL_SURFACE_CLASS,
  POPOVER_SURFACE_CLASS,
  POPOVER_TITLE_CLASS,
  SCRIM_CLASS,
  WORKSPACE_SURFACE_CLASS,
} from "./surfaceStyles.js";

const SRC = fileURLToPath(new URL("../..", import.meta.url));

function sources(dir = SRC, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (/\.jsx?$/.test(entry) && !entry.includes(".test.")) {
      out.push([path.slice(SRC.length), readFileSync(path, "utf8")]);
    }
  }
  return out;
}

describe("scrim", () => {
  it("darkens rather than following the theme", () => {
    // A theme-derived scrim inverts on a light theme: the retired effect.scrim
    // role tinted the workspace, which there is a near-white veil.
    expect(SCRIM_CLASS).toContain("bg-black/");
  });

  it("is the only dim any modal spells out", () => {
    // Four dialogs and the settings sheet each carried their own literal, at two
    // different opacities, for no reason either of them could state.
    const offenders = sources()
      .filter(([, source]) => /bg-black\/\d/.test(source))
      .map(([path]) => path)
      .filter((path) => !path.endsWith("surfaceStyles.js"));

    expect(offenders).toEqual([]);
  });
});

describe("surface roles", () => {
  it("gives popover titles the shared title hierarchy", () => {
    expect(POPOVER_TITLE_CLASS).toContain("var(--ui-fs-panel-title)");
    expect(POPOVER_TITLE_CLASS).toContain("font-semibold");
    expect(POPOVER_TITLE_CLASS).toContain("text-foreground");
    expect(POPOVER_TITLE_CLASS).not.toContain("var(--ui-fs-caption)");
    expect(POPOVER_TITLE_CLASS).not.toContain("text-muted-foreground");
  });

  it("keeps readable raised and modal surfaces opaque", () => {
    for (const className of [POPOVER_SURFACE_CLASS]) {
      expect(className).toContain("bg-popover");
      expect(className).toContain("shadow-raised");
      expect(className).not.toMatch(/bg-popover\//);
      expect(className).not.toContain("backdrop-blur");
    }

    expect(MODAL_SURFACE_CLASS).toContain("bg-card");
    expect(MODAL_SURFACE_CLASS).toContain("shadow-modal");
    expect(MODAL_SURFACE_CLASS).not.toMatch(/bg-card\//);
  });

  it("names each structural Surface Opacity boundary", () => {
    expect(WORKSPACE_SURFACE_CLASS).toContain("--ui-surface-workspace");
    expect(PANEL_SURFACE_CLASS).toContain("--ui-surface-panel");
    expect(DOCK_SURFACE_CLASS).toContain("--ui-surface-dock");
    for (const className of [WORKSPACE_SURFACE_CLASS, PANEL_SURFACE_CLASS, DOCK_SURFACE_CLASS]) {
      expect(className).not.toContain("color-mix");
      expect(className).not.toContain("opacity-");
    }
  });
});
