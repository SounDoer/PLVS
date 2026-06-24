import { describe, it, expect } from "vitest";
import { UI_PREFERENCES } from "./data.js";

describe("UI_PREFERENCES loudness history", () => {
  it("defaults the shared history window to 1 minute", () => {
    expect(UI_PREFERENCES.modules.loudness.history.defaultWindowSec).toBe(60);
  });
});

describe("UI_PREFERENCES header density", () => {
  it("keeps the app header lightly compact", () => {
    expect(UI_PREFERENCES.layout.header.paddingYRem).toBe(0.4);
    expect(UI_PREFERENCES.layout.header.actionGapRem).toBe(0.2);
  });
});
