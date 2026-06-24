import { describe, expect, it } from "vitest";
import {
  DEFAULT_CLOSE_ACTION,
  DEFAULT_REFERENCE_LUFS,
  DEFAULT_THEME_EDITOR_POS,
  normalizeCloseAction,
  normalizeReferenceLufs,
  normalizeThemeEditorPos,
  normalizeSettingsFocusView,
} from "./defaults.js";

describe("settings defaults", () => {
  it("exports the user-facing default settings values", () => {
    expect(DEFAULT_REFERENCE_LUFS).toBe(-23);
    expect(DEFAULT_CLOSE_ACTION).toBe("ask");
    expect(DEFAULT_THEME_EDITOR_POS).toEqual({ x: 80, y: 80 });
  });

  it("normalizes reference LUFS", () => {
    expect(normalizeReferenceLufs(-14)).toBe(-14);
    expect(normalizeReferenceLufs("5")).toBe(DEFAULT_REFERENCE_LUFS);
    expect(normalizeReferenceLufs("")).toBe(DEFAULT_REFERENCE_LUFS);
    expect(normalizeReferenceLufs("   ")).toBe(DEFAULT_REFERENCE_LUFS);
    expect(normalizeReferenceLufs(null)).toBe(DEFAULT_REFERENCE_LUFS);
  });

  it("normalizes close action", () => {
    expect(normalizeCloseAction("tray")).toBe("tray");
    expect(normalizeCloseAction("quit")).toBe("quit");
    expect(normalizeCloseAction("ask")).toBe("ask");
    expect(normalizeCloseAction("other")).toBe(DEFAULT_CLOSE_ACTION);
  });

  it("normalizes focus view and theme editor position", () => {
    expect(normalizeSettingsFocusView({ autoHideControls: true, compactPanels: 1 })).toEqual({
      autoHideControls: true,
      compactPanels: false,
    });
    expect(normalizeThemeEditorPos({ x: 12, y: 24 })).toEqual({ x: 12, y: 24 });
    expect(normalizeThemeEditorPos({ x: "12", y: 24 })).toEqual(DEFAULT_THEME_EDITOR_POS);
  });
});
