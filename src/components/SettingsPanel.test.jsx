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
    expect(screen.getByLabelText("Channel layout")).toBeTruthy();
    expect(screen.queryByLabelText("Channel layout (Advanced)")).toBeNull();
    expect(screen.queryByLabelText("Colour theme")).toBeNull();
  });

  it("shows theme picker in fixed mode", () => {
    render(<SettingsPanel {...BASE_PROPS} appearance="fixed" fixedThemeSelectValue="plvs-dark" />);
    expect(screen.getByLabelText("Appearance")).toBeTruthy();
    expect(screen.getByLabelText("Colour theme")).toBeTruthy();
  });

  it("does not render panel-specific channel selectors", () => {
    render(
      <SettingsPanel
        {...BASE_PROPS}
        vectorscopePairOptions={[{ key: "0-1", label: "L/R", x: 0, y: 1 }]}
        onVectorscopePairChange={vi.fn()}
        spectrumChannelOptions={[
          { key: "p-0-1", label: "L/R", sel: { type: "pair", x: 0, y: 1 } },
          { key: "s-2", label: "C", sel: { type: "single", ch: 2 } },
        ]}
        spectrumChannelSel={{ type: "single", ch: 2 }}
        onSpectrumChannelChange={vi.fn()}
      />
    );

    expect(screen.queryByText("Vectorscope channels")).toBeNull();
    expect(screen.queryByText("Spectrum channel")).toBeNull();
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

  it("shows the current app version in settings", () => {
    render(<SettingsPanel {...BASE_PROPS} appVersion="0.0.17" />);
    expect(screen.getByText("Version")).toBeTruthy();
    expect(screen.getByText("0.0.17")).toBeTruthy();
  });
});
