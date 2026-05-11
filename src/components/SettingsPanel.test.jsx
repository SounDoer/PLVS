/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SettingsPanel } from "./SettingsPanel.jsx";
import { LOUDNESS_REFERENCE_PROFILES } from "../loudnessReferenceProfiles.js";
import { THEME_SELECT_OPTIONS } from "../theme/builtinThemes.js";

beforeEach(() => {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});

const BASE_PROPS = {
  settingsOpen: true,
  setSettingsOpen: vi.fn(),
  setAppearanceMode: vi.fn(),
  fixedThemeSelectValue: "",
  setFixedThemeIdFromPicker: vi.fn(),
  themeSelectOptions: THEME_SELECT_OPTIONS,
  referenceProfileId: "ebu-r128--23",
  setReferenceProfileId: vi.fn(),
  loudnessReferenceProfiles: LOUDNESS_REFERENCE_PROFILES,
  channelLayout: "auto",
  setChannelLayout: vi.fn(),
  vectorscopePairOptions: [],
  vectorscopePairX: 0,
  vectorscopePairY: 1,
  onVectorscopePairChange: vi.fn(),
  resetLayout: vi.fn(),
};

describe("SettingsPanel", () => {
  it("renders core controls when open in system mode", () => {
    render(<SettingsPanel {...BASE_PROPS} appearance="system" />);
    expect(screen.getByLabelText("Loudness reference")).toBeTruthy();
    expect(screen.getByLabelText("Appearance")).toBeTruthy();
    expect(screen.queryByLabelText("Colour theme")).toBeNull();
  });

  it("shows theme picker in fixed mode", () => {
    render(
      <SettingsPanel {...BASE_PROPS} appearance="fixed" fixedThemeSelectValue="audiometer-dark" />
    );
    expect(screen.getByLabelText("Appearance")).toBeTruthy();
    expect(screen.getByLabelText("Colour theme")).toBeTruthy();
  });
});
