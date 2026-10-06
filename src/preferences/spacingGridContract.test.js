import { describe, expect, it } from "vitest";

import { UI_PREFERENCES } from "./data.js";

/**
 * Shell and panel spacing sits on a 4px grid -- see Spacing Tokens in design-tokens.md. A value
 * between the steps (the old 0.3, 0.35 and 0.4rem) is a whole number of device pixels at one
 * display scale and a fraction at the others, where the browser rounds it differently from one
 * gap to the next.
 */
const STEP_REM = 0.25;
const SPACING_KEY = /(padding|gap|inset)/i;

function spacingValues(node, path = [], out = []) {
  for (const [key, value] of Object.entries(node)) {
    const next = [...path, key];
    if (value && typeof value === "object") {
      spacingValues(value, next, out);
    } else if (typeof value === "number" && /Rem$|Rem\./.test(next.join(".") + ".")) {
      if (next.some((part) => SPACING_KEY.test(part))) out.push([next.join("."), value]);
    }
  }
  return out;
}

describe("spacing grid contract", () => {
  const values = spacingValues(UI_PREFERENCES.layout).concat(
    spacingValues(UI_PREFERENCES.modules ?? {}, ["modules"])
  );

  it("finds the spacing values it is meant to guard", () => {
    expect(values.length).toBeGreaterThanOrEqual(20);
  });

  it("keeps every spacing value on the 4px grid", () => {
    const offGrid = values.filter(([, rem]) => !Number.isInteger(rem / STEP_REM));

    expect(offGrid).toEqual([]);
  });

  it("uses only a handful of steps", () => {
    expect([...new Set(values.map(([, rem]) => rem))].sort((a, b) => a - b)).toEqual([
      0, 0.25, 0.5, 0.75,
    ]);
  });
});
