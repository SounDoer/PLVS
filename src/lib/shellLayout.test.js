import { describe, it, expect } from "vitest";
import {
  CAPTION_TEXT,
  FOOTER_DIVIDER,
  FOOTER_LABEL,
  FOOTER_VALUE,
  PANEL_HEADER_BAR,
  PANEL_HEADER_PIN_ICON,
  PANEL_HEADER_TITLE_GROUP,
  SHELL_HEADER_ACTIONS,
  SHELL_FOOTER,
  SHELL_HEADER,
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

  it("footer item helpers share the status typography token", () => {
    expect(FOOTER_LABEL).toContain("--ui-fs-status");
    expect(FOOTER_VALUE).toContain("text-muted-foreground");
    for (const className of [FOOTER_LABEL, FOOTER_VALUE]) {
      expect(className).not.toContain("text-[10px]");
      expect(className).not.toContain("text-xs");
    }
    expect(FOOTER_DIVIDER).toContain("h-3");
    expect(FOOTER_DIVIDER).toContain("mx-1.5");
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

  it("header actions use the header action gap variable", () => {
    expect(SHELL_HEADER_ACTIONS).toContain("--ui-header-action-gap");
    expect(SHELL_HEADER_ACTIONS).not.toContain("gap-1");
  });

  it("SHELL_FOOTER border uses border-border (not a hardcoded white tint)", () => {
    expect(SHELL_FOOTER).toContain("border-border");
    expect(SHELL_FOOTER).not.toContain("border-white/");
  });

  it("panel title groups clip overflow before action buttons", () => {
    expect(PANEL_HEADER_BAR).toContain("@container");
    expect(PANEL_HEADER_TITLE_GROUP).toContain("min-w-0");
    expect(PANEL_HEADER_TITLE_GROUP).toContain("overflow-hidden");
    expect(PANEL_HEADER_TITLE_GROUP).toContain("@max-[80px]:hidden");
    expect(PANEL_HEADER_TITLE_GROUP).toContain("--ui-fs-panel-title");
  });

  it("optically scales pin icons against the shared panel action size", () => {
    expect(PANEL_HEADER_PIN_ICON).toContain("--ui-icon-panel-action");
    expect(PANEL_HEADER_PIN_ICON).toContain("*0.9");
  });

  it("panel axis rail helpers share one CSS variable", () => {
    for (const widthClass of [W_LOUDNESS_Y_AXIS, W_SPECTRUM_Y_AXIS, W_PEAK_TICKS]) {
      expect(widthClass).toContain("--ui-chart-y-axis-rail-w");
      expect(widthClass).not.toContain("--ui-w-loudness-y-axis");
      expect(widthClass).not.toContain("--ui-w-spectrum-y-axis");
      expect(widthClass).not.toContain("--ui-w-peak-ticks");
    }
  });
});
