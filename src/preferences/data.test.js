import { describe, it, expect } from "vitest";
import { UI_PREFERENCES } from "./data.js";

describe("UI_PREFERENCES loudness history", () => {
  it("defaults the shared history window to 1 minute", () => {
    expect(UI_PREFERENCES.modules.loudness.history.defaultWindowSec).toBe(60);
  });
});
