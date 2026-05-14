import { describe, it, expect } from "vitest";
import {
  CAPTION_TEXT,
  SHELL_FOOTER,
  SHELL_HEADER,
  APP_TITLE,
  METRICS_LIST_PAD,
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
});
