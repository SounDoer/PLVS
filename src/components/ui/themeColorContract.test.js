import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { badgeVariants } from "./badge.jsx";
import { buttonVariants } from "./button.jsx";

describe("theme color contract", () => {
  it("uses the destructive foreground token for destructive buttons", () => {
    const classes = buttonVariants({ variant: "destructive" });

    expect(classes).toContain("text-destructive-foreground");
    expect(classes).not.toMatch(/(?:^|\s)text-white(?:\s|$)/);
  });

  it("gives every focusable element a themed focus ring", () => {
    // Without this the browser draws its own, in a color no theme can reach.
    const css = readFileSync(new URL("../../index.css", import.meta.url), "utf8");
    const base = css.match(/@layer base \{[\s\S]*?\n\}/)?.[0] ?? "";

    expect(base).toContain(":focus-visible");
    expect(base).toContain("var(--ring)");
  });

  it("uses the destructive foreground token for destructive badges", () => {
    const classes = badgeVariants({ variant: "destructive" });

    expect(classes).toContain("text-destructive-foreground");
    expect(classes).not.toMatch(/(?:^|\s)text-white(?:\s|$)/);
  });
});
