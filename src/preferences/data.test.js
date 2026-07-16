import { describe, it, expect } from "vitest";
import { UI_PREFERENCES } from "./data.js";

describe("UI_PREFERENCES loudness history", () => {
  it("defaults the shared history window to 1 minute", () => {
    expect(UI_PREFERENCES.modules.loudness.history.defaultWindowSec).toBe(60);
  });
});

describe("UI_PREFERENCES header density", () => {
  it("keeps the app header lightly compact", () => {
    expect(UI_PREFERENCES.layout.header.paddingXRem).toBe(0.4);
    expect(UI_PREFERENCES.layout.header.paddingYRem).toBe(0.4);
    expect(UI_PREFERENCES.layout.header.actionGapRem).toBe(0.2);
  });
});

describe("UI_PREFERENCES shell density", () => {
  it("keeps the shell region gap compact", () => {
    expect(UI_PREFERENCES.layout.shell.paddingRem.base).toBe(0.3);
    expect(UI_PREFERENCES.layout.shell.gapRem.base).toBe(0.35);
  });
});

describe("UI_PREFERENCES settings drawer", () => {
  it("uses the Small profile width as the compact baseline", () => {
    expect(UI_PREFERENCES.layout.drawer.preferredWidthPx).toBe(320);
  });
});
