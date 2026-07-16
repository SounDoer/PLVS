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
  it("exposes four discrete user-facing options", () => {
    expect(DEFAULT_INTERFACE_SIZE).toBe("default");
    expect(INTERFACE_SIZE_OPTIONS).toEqual([
      { id: "small", label: "Small" },
      { id: "default", label: "Default" },
      { id: "large", label: "Large" },
      { id: "extra-large", label: "Extra Large" },
    ]);
  });

  it("normalizes unknown persisted values to Default", () => {
    expect(normalizeInterfaceSize("small")).toBe("small");
    expect(normalizeInterfaceSize("large")).toBe("large");
    expect(normalizeInterfaceSize("extra-large")).toBe("extra-large");
    expect(normalizeInterfaceSize("huge")).toBe("default");
    expect(normalizeInterfaceSize(null)).toBe("default");
  });

  it("uses the former baseline for Small", () => {
    const resolved = resolveInterfacePreferences(UI_PREFERENCES, "small");

    expect(resolved).toBe(UI_PREFERENCES);
    expect(resolved.layout.drawer.preferredWidthPx).toBe(320);
  });

  it("resolves the enlarged Default profile", () => {
    const resolved = resolveInterfacePreferences(UI_PREFERENCES, "default");

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
    expect(resolved.layout.drawer.preferredWidthPx).toBe(336);
  });

  it("resolves the hand-tuned Large profile", () => {
    const resolved = resolveInterfacePreferences(UI_PREFERENCES, "large");

    expect(resolved.typography.sizesPx).toEqual({
      caption: 12,
      axis: 14,
      status: 14,
      control: 15,
      metricMeta: 15,
      panelTitle: 15,
      display: 16,
      body: 17,
      metricValue: 21,
    });
    expect(resolved.iconography.sizesPx).toEqual({
      panelAction: 15,
      managementAction: 17,
      shellAction: 17,
      panelModule: 17,
    });
    expect(resolved.layout.drawer.preferredWidthPx).toBe(368);
  });

  it("resolves the hand-tuned Extra Large profile", () => {
    const resolved = resolveInterfacePreferences(UI_PREFERENCES, "extra-large");

    expect(resolved.typography.sizesPx).toEqual({
      caption: 14,
      axis: 16,
      status: 16,
      control: 17,
      metricMeta: 17,
      panelTitle: 17,
      display: 18,
      body: 19,
      metricValue: 24,
    });
    expect(resolved.iconography.sizesPx).toEqual({
      panelAction: 17,
      managementAction: 19,
      shellAction: 19,
      panelModule: 19,
    });
    expect(resolved.layout.drawer.preferredWidthPx).toBe(400);
  });

  it("keeps Dock accessory documents on the compact baseline", () => {
    for (const surface of ["dock-header", "dock-editor"]) {
      const resolved = resolveInterfacePreferencesForSurface(
        UI_PREFERENCES,
        "extra-large",
        surface
      );
      expect(resolved.typography.sizesPx).toEqual(UI_PREFERENCES.typography.sizesPx);
      expect(resolved.iconography.sizesPx).toEqual(UI_PREFERENCES.iconography.sizesPx);
      expect(resolved.layout.drawer.preferredWidthPx).toBe(320);
    }

    expect(
      resolveInterfacePreferencesForSurface(UI_PREFERENCES, "extra-large", null).typography.sizesPx
        .body
    ).toBe(19);
    expect(
      resolveInterfacePreferencesForSurface(UI_PREFERENCES, "extra-large", "unknown").typography
        .sizesPx.body
    ).toBe(19);
  });
});
