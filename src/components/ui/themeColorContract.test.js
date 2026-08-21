import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { badgeVariants } from "./badge.jsx";
import { buttonVariants } from "./button.jsx";

/** Every app source except tests, keyed by path. */
function appSources() {
  const sources = import.meta.glob("../../**/*.{js,jsx}", {
    query: "?raw",
    import: "default",
    eager: true,
  });
  return Object.fromEntries(Object.entries(sources).filter(([path]) => !path.includes(".test.")));
}

describe("theme color contract", () => {
  it("uses the destructive foreground token for destructive buttons", () => {
    const classes = buttonVariants({ variant: "destructive" });

    expect(classes).toContain("text-destructive-foreground");
    expect(classes).not.toMatch(/(?:^|\s)text-white(?:\s|$)/);
  });

  it("suppresses focus outlines globally rather than per component", () => {
    // The browser draws its own unless something says otherwise, so this one rule
    // carries the whole decision.
    const css = readFileSync(new URL("../../index.css", import.meta.url), "utf8");
    const base = css.match(/@layer base \{[\s\S]*?\n\}/)?.[0] ?? "";

    expect(base).toMatch(/:focus-visible\s*\{\s*outline:\s*none;\s*\}/);
  });

  it("leaves no per-component focus ring to fight the global rule", () => {
    const offenders = Object.entries(appSources())
      .filter(([, source]) => /focus(?:-visible)?:(?:ring|outline|border-ring)/.test(source))
      .map(([path]) => path);

    expect(offenders).toEqual([]);
  });

  it("never spends the accent surface on hover", () => {
    // `--accent` marks what is currently active. Hover is where the pointer is,
    // which is not the same claim and must not borrow the same color.
    const offenders = Object.entries(appSources())
      .filter(([, source]) => /(?:hover|focus):bg-accent/.test(source))
      .map(([path]) => path);

    expect(offenders).toEqual([]);
  });

  it("keeps one neutral hover for every transparent-base control", () => {
    // `hover:bg-secondary/*` survives only where the control is already filled
    // with it and hover shifts its own fill.
    const offenders = Object.entries(appSources())
      .filter(([path]) => !/(?:^|\/)(?:badge|button)\.jsx$/.test(path))
      .filter(([, source]) => /hover:bg-secondary/.test(source))
      .map(([path]) => path);

    expect(offenders).toEqual([]);
  });

  it("paints grid lines at the colour the theme resolved for them", () => {
    // Six modules resolve their grid from one role, but each used to dim it again
    // on the way to the canvas -- 0.3 and 0.16 in the 3D floor, 0.08 borrowed
    // from the spectrum's token for the stereo map's baseline. A second strength
    // is a second role now (data.gridSubtle), not an alpha in a draw call.
    const offenders = Object.entries(appSources())
      .filter(([, source]) => /--ui-spectrum-grid-opacity|stroke="var\(--border\)"/.test(source))
      .map(([path]) => path);

    expect(offenders).toEqual([]);
  });

  it("uses the destructive foreground token for destructive badges", () => {
    const classes = badgeVariants({ variant: "destructive" });

    expect(classes).toContain("text-destructive-foreground");
    expect(classes).not.toMatch(/(?:^|\s)text-white(?:\s|$)/);
  });
});
