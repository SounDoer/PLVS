import { describe, it, expect } from "vitest";
import {
  CAPTION_TEXT,
  SHELL_FOOTER,
  SHELL_HEADER,
  APP_TITLE,
  METRICS_LIST_PAD,
  W_LOUDNESS_Y_AXIS,
  W_PEAK_TICKS,
  W_SPECTRUM_Y_AXIS,
} from "./shellLayout";

describe("shellLayout token names", () => {
  it("CAPTION_TEXT uses --ui-fs-axis (not the retired --ui-fs-axis-value)", () => {
    expect(CAPTION_TEXT).toContain("--ui-fs-axis");
    expect(CAPTION_TEXT).not.toContain("--ui-fs-axis-value");
  });

  it("SHELL_FOOTER uses --ui-fs-status", () => {
    expect(SHELL_FOOTER).toContain("--ui-fs-status");
  });

  it("APP_TITLE uses --ui-fs-app-title", () => {
    expect(APP_TITLE).toContain("--ui-fs-app-title");
  });

  it("METRICS_LIST_PAD uses --ui-panel-pad-metrics (not the retired --ui-article-pad-metrics)", () => {
    expect(METRICS_LIST_PAD).toContain("--ui-panel-pad-metrics");
    expect(METRICS_LIST_PAD).not.toContain("--ui-article-pad-metrics");
  });

  it("SHELL_HEADER uses --radius (not the retired --ui-radius-card)", () => {
    expect(SHELL_HEADER).toContain("--radius");
    expect(SHELL_HEADER).not.toContain("--ui-radius-card");
  });

  it("SHELL_FOOTER uses --radius (not the retired --ui-radius-card)", () => {
    expect(SHELL_FOOTER).toContain("--radius");
    expect(SHELL_FOOTER).not.toContain("--ui-radius-card");
  });

  it("SHELL_HEADER border uses border-border (not a hardcoded white tint)", () => {
    expect(SHELL_HEADER).toContain("border-border");
    expect(SHELL_HEADER).not.toContain("border-white/");
  });

  it("SHELL_FOOTER border uses border-border (not a hardcoded white tint)", () => {
    expect(SHELL_FOOTER).toContain("border-border");
    expect(SHELL_FOOTER).not.toContain("border-white/");
  });

  it("panel axis rail helpers share one CSS variable", () => {
    for (const widthClass of [W_LOUDNESS_Y_AXIS, W_SPECTRUM_Y_AXIS, W_PEAK_TICKS]) {
      expect(widthClass).toContain("--ui-w-axis-rail");
      expect(widthClass).not.toContain("--ui-w-loudness-y-axis");
      expect(widthClass).not.toContain("--ui-w-spectrum-y-axis");
      expect(widthClass).not.toContain("--ui-w-peak-ticks");
    }
  });
});
