import { describe, it, expect } from "vitest";
import { UI_PREFERENCES } from "./data.js";

describe("UI_PREFERENCES localStorage keys", () => {
  it("uses plvs.ui as layoutPersistKey", () => {
    expect(UI_PREFERENCES.layoutPersistKey).toBe("plvs.ui");
  });
});

describe("UI_PREFERENCES loudness history", () => {
  it("defaults the shared history window to 1 minute", () => {
    expect(UI_PREFERENCES.modules.loudness.history.defaultWindowSec).toBe(60);
  });
});
