import { describe, expect, it } from "vitest";
import { UI_PREFERENCES } from "./data.js";

describe("normal-mode icon roles", () => {
  it("defines only icon sizes with independent scaling policies", () => {
    expect(UI_PREFERENCES.iconography.sizesPx).toEqual({
      panelAction: 12,
      managementAction: 14,
      shellAction: 14,
      panelModule: 14,
    });
  });
});
