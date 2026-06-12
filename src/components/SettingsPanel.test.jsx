/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { act } from "@testing-library/react";
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
};

describe("SettingsPanel", () => {
  it("renders core controls when open in system mode", () => {
    render(<SettingsPanel {...BASE_PROPS} appearance="system" />);
    expect(screen.getByLabelText("Loudness reference")).toBeTruthy();
    expect(screen.getByLabelText("Appearance")).toBeTruthy();
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
    expect(screen.queryByText("Version")).toBeNull();
    expect(screen.getByText("v0.0.17")).toBeTruthy();
    expect(screen.getByText("Checking updates")).toBeTruthy();
    expect(screen.getByText("View releases")).toBeTruthy();
  });

  it("keeps release link visible when update check fails", () => {
    const openReleaseUrl = vi.fn();
    render(
      <SettingsPanel
        {...BASE_PROPS}
        appVersion="0.0.17"
        updateStatus="unavailable"
        openReleaseUrl={openReleaseUrl}
      />
    );

    expect(screen.getByText("Update check unavailable")).toBeTruthy();
    fireEvent.click(screen.getByText("View releases"));
    expect(openReleaseUrl).toHaveBeenCalledWith("https://github.com/SounDoer/PLVS/releases");
  });

  it("shows up to date when the latest release is not newer", () => {
    render(
      <SettingsPanel
        {...BASE_PROPS}
        appVersion="0.1.10"
        latestVersion="0.1.9"
        releaseUrl="https://github.com/SounDoer/PLVS/releases/tag/v0.1.9"
        hasUpdate={false}
      />
    );

    expect(screen.getByText("Up to date")).toBeTruthy();
    expect(screen.queryByText(/New version available/)).toBeNull();
    expect(screen.getByText("View releases")).toBeTruthy();
  });

  it("opens the release URL through the provided handler", () => {
    const openReleaseUrl = vi.fn();
    const releaseUrl = "https://github.com/SounDoer/PLVS/releases/tag/v0.1.10";
    render(
      <SettingsPanel
        {...BASE_PROPS}
        appVersion="0.1.9"
        latestVersion="0.1.10"
        releaseUrl={releaseUrl}
        hasUpdate={true}
        openReleaseUrl={openReleaseUrl}
      />
    );

    expect(screen.getByText("Update available: v0.1.10")).toBeTruthy();
    fireEvent.click(screen.getByText("View release"));

    expect(openReleaseUrl).toHaveBeenCalledWith(releaseUrl);
  });

  const SYSTEM_PROPS = {
    autostartEnabled: false,
    setAutostartEnabled: vi.fn(),
    autostartReady: false,
    closeAction: "ask",
    setCloseAction: vi.fn(),
  };

  it("renders Open at login switch disabled when autostartReady is false", () => {
    render(<SettingsPanel {...BASE_PROPS} {...SYSTEM_PROPS} />);
    const toggle = screen.getByRole("switch", { name: /open at login/i });
    expect(toggle).toBeTruthy();
    expect(toggle.disabled).toBe(true);
  });

  it("renders Open at login switch checked when autostartEnabled is true", () => {
    render(
      <SettingsPanel
        {...BASE_PROPS}
        {...SYSTEM_PROPS}
        autostartEnabled={true}
        autostartReady={true}
      />
    );
    const toggle = screen.getByRole("switch", { name: /open at login/i });
    expect(toggle.getAttribute("data-state")).toBe("checked");
    expect(toggle.disabled).toBe(false);
  });

  it("renders Close behavior select with current value", () => {
    render(<SettingsPanel {...BASE_PROPS} {...SYSTEM_PROPS} closeAction="tray" />);
    expect(screen.getByLabelText("Close behavior")).toBeTruthy();
  });

  it("existing controls still render with new props absent (backwards compat)", () => {
    render(<SettingsPanel {...BASE_PROPS} />);
    expect(screen.getByLabelText("Loudness reference")).toBeTruthy();
    expect(screen.getByLabelText("Appearance")).toBeTruthy();
  });

  it("renders the keyboard shortcuts reference rows without a Clear read-only row", () => {
    render(<SettingsPanel {...BASE_PROPS} />);
    expect(screen.getByText("Keyboard shortcuts")).toBeTruthy();
    expect(screen.getByText("Start / Stop")).toBeTruthy();
    expect(screen.getByText("Exit fullscreen")).toBeTruthy();
  });

  it("renders the editable Clear row with toggle and capture", () => {
    render(
      <SettingsPanel
        {...BASE_PROPS}
        clearGlobal={true}
        clearReady={true}
        clearShortcut="CmdOrCtrl+K"
      />
    );
    expect(screen.getByLabelText("Clear")).toBeTruthy();
    expect(screen.getByLabelText("Clear shortcut")).toBeTruthy();
  });

  it("shows the error state on the Clear toggle when registration failed", () => {
    render(
      <SettingsPanel
        {...BASE_PROPS}
        clearGlobal={true}
        clearReady={true}
        registrationError="HotKey already registered"
      />
    );
    expect(screen.getByText(/combo unavailable/i)).toBeTruthy();
    expect(screen.getByLabelText("Clear").className).toContain("ring-destructive");
  });
});
