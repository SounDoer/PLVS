/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SettingsPanel } from "./SettingsPanel.jsx";
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
  appearance: "system",
  setAppearanceMode: vi.fn(),
  fixedThemeSelectValue: "",
  setFixedThemeIdFromPicker: vi.fn(),
  themeSelectOptions: THEME_SELECT_OPTIONS,
  referenceLufs: -23,
  setReferenceLufs: vi.fn(),
  channelLayout: "auto",
  setChannelLayout: vi.fn(),
  vectorscopePairOptions: [],
  vectorscopePairX: 0,
  vectorscopePairY: 1,
  onVectorscopePairChange: vi.fn(),
};

describe("SettingsPanel", () => {
  it("Settings title uses --ui-fs-panel-title token, not hardcoded text-lg", () => {
    render(<SettingsPanel {...BASE_PROPS} appearance="system" />);
    const title = screen.getByText("Settings");
    expect(title.className).not.toContain("text-lg");
    expect(title.className).toContain("--ui-fs-panel-title");
  });

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

  it("does not call setReferenceLufs when input is cleared (empty string → 0 guard)", () => {
    const setReferenceLufs = vi.fn();
    render(
      <SettingsPanel {...BASE_PROPS} referenceLufs={-23} setReferenceLufs={setReferenceLufs} />
    );
    const input = screen.getByLabelText("Loudness reference");
    fireEvent.change(input, { target: { value: "" } });
    expect(setReferenceLufs).not.toHaveBeenCalled();
  });
});
