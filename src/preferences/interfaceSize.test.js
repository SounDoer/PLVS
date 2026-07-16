import { describe, expect, it } from "vitest";
import { UI_PREFERENCES } from "./data.js";
import {
  DEFAULT_INTERFACE_SIZE,
  INTERFACE_SIZE_OPTIONS,
  normalizeInterfaceSize,
  resolveInterfacePreferences,
  resolveInterfacePreferencesForSurface,
} from "./interfaceSize.js";

describe("interface size profiles", () => {
  it("exposes three discrete user-facing options", () => {
    expect(DEFAULT_INTERFACE_SIZE).toBe("default");
    expect(INTERFACE_SIZE_OPTIONS).toEqual([
      { id: "default", label: "Default" },
      { id: "large", label: "Large" },
      { id: "extra-large", label: "Extra Large" },
    ]);
  });

  it("normalizes unknown persisted values to Default", () => {
    expect(normalizeInterfaceSize("large")).toBe("large");
    expect(normalizeInterfaceSize("extra-large")).toBe("extra-large");
    expect(normalizeInterfaceSize("huge")).toBe("default");
    expect(normalizeInterfaceSize(null)).toBe("default");
  });

  it("resolves the hand-tuned Large profile", () => {
    const resolved = resolveInterfacePreferences(UI_PREFERENCES, "large");

    expect(resolved.typography.sizesPx).toEqual({
      caption: 11,
      axis: 12,
      status: 12,
      control: 13,
      metricMeta: 13,
      panelTitle: 13,
      display: 14,
      body: 15,
      metricValue: 18,
    });
    expect(resolved.iconography.sizesPx).toEqual({
      panelAction: 13,
      managementAction: 15,
      shellAction: 15,
      panelModule: 15,
    });
  });

  it("resolves the hand-tuned Extra Large profile", () => {
    const resolved = resolveInterfacePreferences(UI_PREFERENCES, "extra-large");

    expect(resolved.typography.sizesPx).toEqual({
      caption: 12,
      axis: 13,
      status: 13,
      control: 14,
      metricMeta: 14,
      panelTitle: 14,
      display: 15,
      body: 17,
      metricValue: 19,
    });
    expect(resolved.iconography.sizesPx).toEqual({
      panelAction: 14,
      managementAction: 17,
      shellAction: 17,
      panelModule: 16,
    });
  });

  it("keeps Dock accessory documents on the Default profile", () => {
    for (const surface of ["dock-header", "dock-editor"]) {
      const resolved = resolveInterfacePreferencesForSurface(
        UI_PREFERENCES,
        "extra-large",
        surface
      );
      expect(resolved.typography.sizesPx).toEqual(UI_PREFERENCES.typography.sizesPx);
      expect(resolved.iconography.sizesPx).toEqual(UI_PREFERENCES.iconography.sizesPx);
    }

    expect(
      resolveInterfacePreferencesForSurface(UI_PREFERENCES, "extra-large", null).typography.sizesPx
        .body
    ).toBe(17);
    expect(
      resolveInterfacePreferencesForSurface(UI_PREFERENCES, "extra-large", "unknown").typography
        .sizesPx.body
    ).toBe(17);
  });
});
