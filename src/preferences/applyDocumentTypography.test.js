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
  "--ui-icon-panel-module": "16px",
};

describe("normal-mode typography variables", () => {
  afterEach(() => {
    for (const name of [...Object.keys(TYPOGRAPHY_VARS), ...Object.keys(ICON_VARS)]) {
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
});
