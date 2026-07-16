import { afterEach, describe, expect, it } from "vitest";
import { UI_PREFERENCES } from "./data.js";
import { applyLayoutToDocument } from "./applyDocumentTheme.js";

const TYPOGRAPHY_VARS = {
  "--ui-fs-caption": "10px",
  "--ui-fs-axis": "11px",
  "--ui-fs-status": "11px",
  "--ui-fs-control": "12px",
  "--ui-fs-metric-meta": "12px",
  "--ui-fs-panel-title": "12px",
  "--ui-fs-display": "13px",
  "--ui-fs-body": "14px",
  "--ui-fs-metric-value": "16px",
};

const ICON_VARS = {
  "--ui-icon-panel-action": "12px",
  "--ui-icon-management-action": "14px",
  "--ui-icon-shell-action": "14px",
  "--ui-icon-panel-module": "14px",
};

const CHART_AXIS_ROW_HEIGHT = "max(0.8rem, calc(var(--ui-fs-axis) * 1.15))";
const CHART_Y_AXIS_RAIL_WIDTH = "max(20px, calc(var(--ui-fs-axis) * 1.65))";
const DRAWER_WIDTH_VAR = "--ui-drawer-w";

describe("normal-mode typography variables", () => {
  afterEach(() => {
    for (const name of [
      ...Object.keys(TYPOGRAPHY_VARS),
      ...Object.keys(ICON_VARS),
      DRAWER_WIDTH_VAR,
    ]) {
      document.documentElement.style.removeProperty(name);
    }
  });

  it("applies every semantic role from UI preferences", () => {
    applyLayoutToDocument(UI_PREFERENCES);

    for (const [name, value] of Object.entries(TYPOGRAPHY_VARS)) {
      expect(document.documentElement.style.getPropertyValue(name)).toBe(value);
    }
  });

  it("applies only the independent semantic icon roles", () => {
    applyLayoutToDocument(UI_PREFERENCES);

    for (const [name, value] of Object.entries(ICON_VARS)) {
      expect(document.documentElement.style.getPropertyValue(name)).toBe(value);
    }
  });

  it("lets the chart axis row grow with readable axis text", () => {
    applyLayoutToDocument(UI_PREFERENCES);

    expect(document.documentElement.style.getPropertyValue("--ui-chart-x-axis-row-h")).toBe(
      CHART_AXIS_ROW_HEIGHT
    );
    expect(document.documentElement.style.getPropertyValue("--ui-chart-y-axis-rail-w")).toBe(
      CHART_Y_AXIS_RAIL_WIDTH
    );
  });

  it("applies the preferred settings drawer width", () => {
    applyLayoutToDocument(UI_PREFERENCES);

    expect(document.documentElement.style.getPropertyValue(DRAWER_WIDTH_VAR)).toBe("320px");
  });
});
