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
  channelCount: 0,
  channelLabelTokens: [],
  channelLabelHasOverride: false,
  setChannelLabelToken: vi.fn(),
  resetChannelLabels: vi.fn(),
};

describe("SettingsPanel", () => {
  it("renders core controls when open in system mode", () => {
    render(<SettingsPanel {...BASE_PROPS} appearance="system" />);
    expect(screen.getByLabelText("Appearance")).toBeTruthy();
    expect(screen.queryByLabelText("Theme")).toBeNull();
  });

  it("shows theme picker in fixed mode", () => {
    render(<SettingsPanel {...BASE_PROPS} appearance="fixed" fixedThemeSelectValue="plvs-dark" />);
    expect(screen.getByLabelText("Appearance")).toBeTruthy();
    expect(screen.getByLabelText("Theme")).toBeTruthy();
  });

  it("uses shared layout primitives for settings sections and rows", () => {
    render(<SettingsPanel {...BASE_PROPS} appearance="fixed" fixedThemeSelectValue="plvs-dark" />);

    expect(document.body.querySelector("[data-settings-body]")).toBeTruthy();
    expect(document.body.querySelectorAll("[data-settings-section]").length).toBeGreaterThanOrEqual(
      4
    );
    expect(document.body.querySelectorAll("[data-settings-row]").length).toBeGreaterThanOrEqual(5);
  });

  it("renders configuration profile actions", () => {
    const onExportConfiguration = vi.fn();
    const onImportConfiguration = vi.fn();
    render(
      <SettingsPanel
        {...BASE_PROPS}
        onExportConfiguration={onExportConfiguration}
        onImportConfiguration={onImportConfiguration}
        configurationStatus="Configuration exported"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Export configuration" }));
    fireEvent.click(screen.getByRole("button", { name: "Import configuration" }));

    expect(onExportConfiguration).toHaveBeenCalledTimes(1);
    expect(onImportConfiguration).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Configuration exported")).toBeTruthy();
  });

  it("confirms before resetting configuration", () => {
    const onResetConfiguration = vi.fn();
    render(<SettingsPanel {...BASE_PROPS} onResetConfiguration={onResetConfiguration} />);

    fireEvent.click(screen.getByRole("button", { name: "Reset configuration" }));
    expect(onResetConfiguration).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Confirm reset configuration" }));
    expect(onResetConfiguration).toHaveBeenCalledTimes(1);
  });

  it("shows theme actions inline with the theme select for custom themes", () => {
    render(
      <SettingsPanel
        {...BASE_PROPS}
        appearance="fixed"
        fixedThemeSelectValue="custom-1"
        customThemeOptions={[{ id: "custom-1", label: "Custom Theme" }]}
        activeIsCustom={true}
      />
    );

    const themePicker = screen.getByRole("group", { name: "Theme picker" });
    expect(themePicker).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit theme" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete theme" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "New theme" })).toBeTruthy();
  });

  it("hides edit/delete for built-in themes", () => {
    render(
      <SettingsPanel
        {...BASE_PROPS}
        appearance="fixed"
        fixedThemeSelectValue="plvs-dark"
        activeIsCustom={false}
      />
    );

    expect(screen.queryByRole("button", { name: "Edit theme" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete theme" })).toBeNull();
    expect(screen.getByRole("button", { name: "New theme" })).toBeTruthy();
  });

  it("locks theme controls while the theme editor is open", () => {
    render(
      <SettingsPanel
        {...BASE_PROPS}
        appearance="fixed"
        fixedThemeSelectValue="custom-1"
        customThemeOptions={[{ id: "custom-1", label: "Custom Theme" }]}
        activeIsCustom={true}
        themeControlsDisabled={true}
      />
    );

    expect(
      screen.getByText("Finish editing the current theme before changing theme settings.")
    ).toBeTruthy();
    expect(screen.getByLabelText("Appearance").disabled).toBe(true);
    expect(screen.getByLabelText("Theme").disabled).toBe(true);
    expect(screen.getByRole("button", { name: "New theme" }).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Edit theme" }).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Delete theme" }).disabled).toBe(true);
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

  it("shows the current app version in settings", () => {
    render(<SettingsPanel {...BASE_PROPS} appVersion="0.0.17" />);
    expect(screen.getByText("v0.0.17")).toBeTruthy();
    expect(screen.getByText("Checking...")).toBeTruthy();
    expect(screen.getByText("Releases")).toBeTruthy();
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

    expect(screen.getByText("Update unavailable")).toBeTruthy();
    fireEvent.click(screen.getByText("Releases"));
    expect(openReleaseUrl).toHaveBeenCalledWith("https://github.com/SounDoer/PLVS/releases");
  });

  it("calls onCheckForUpdate from the version row", () => {
    const onCheckForUpdate = vi.fn();
    render(
      <SettingsPanel
        {...BASE_PROPS}
        appVersion="0.1.10"
        latestVersion="0.1.10"
        hasUpdate={false}
        onCheckForUpdate={onCheckForUpdate}
      />
    );

    fireEvent.click(screen.getByText("Check"));
    expect(onCheckForUpdate).toHaveBeenCalledTimes(1);
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
    expect(screen.getByText("Releases")).toBeTruthy();
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

    expect(screen.getByText("v0.1.10 available")).toBeTruthy();
    fireEvent.click(screen.getByText("Releases"));

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

  it("renders Close Behavior select with current value", () => {
    render(<SettingsPanel {...BASE_PROPS} {...SYSTEM_PROPS} closeAction="tray" />);
    expect(screen.getByLabelText("Close Behavior")).toBeTruthy();
  });

  it("existing controls still render with new props absent (backwards compat)", () => {
    render(<SettingsPanel {...BASE_PROPS} />);
    expect(screen.getByLabelText("Appearance")).toBeTruthy();
  });

  it("renders the keyboard shortcuts reference rows", () => {
    render(<SettingsPanel {...BASE_PROPS} />);
    expect(screen.getByText("Start / Stop")).toBeTruthy();
    expect(screen.queryByText("Fullscreen Panel")).toBeNull();
    expect(screen.queryByText("Exit Fullscreen")).toBeNull();
  });

  it("renders the editable Clear row with capture and global toggle", () => {
    render(
      <SettingsPanel
        {...BASE_PROPS}
        clearGlobal={true}
        clearReady={true}
        clearShortcut="CmdOrCtrl+K"
      />
    );
    expect(screen.getByLabelText("Clear shortcut")).toBeTruthy();
    expect(screen.getByRole("switch", { name: /Global Shortcut/i })).toBeTruthy();
  });

  it("shows the error state on the Global shortcut toggle when registration failed", () => {
    render(
      <SettingsPanel
        {...BASE_PROPS}
        clearGlobal={true}
        clearReady={true}
        registrationError="HotKey already registered"
      />
    );
    expect(screen.getByText(/combo unavailable/i)).toBeTruthy();
    expect(screen.getByRole("switch", { name: /Global Shortcut/i }).className).toContain(
      "ring-destructive"
    );
  });
});

describe("SettingsPanel — Channel labels", () => {
  it("shows the idle hint when no input is connected", () => {
    render(<SettingsPanel {...BASE_PROPS} channelCount={0} />);
    expect(screen.getByText("Connect an input to label its channels.")).toBeTruthy();
  });

  it("renders one role select per channel when an input is active", () => {
    render(<SettingsPanel {...BASE_PROPS} channelCount={2} channelLabelTokens={["L", "R"]} />);
    expect(screen.getByLabelText("Channel 1 role")).toBeTruthy();
    expect(screen.getByLabelText("Channel 2 role")).toBeTruthy();
  });

  it("disables Reset when there is no channel-label override", () => {
    render(
      <SettingsPanel
        {...BASE_PROPS}
        channelCount={2}
        channelLabelTokens={["L", "R"]}
        channelLabelHasOverride={false}
      />
    );
    expect(screen.getByRole("button", { name: "Reset channel labels" }).disabled).toBe(true);
  });

  it("resets channel labels only after confirming", () => {
    const resetChannelLabels = vi.fn();
    render(
      <SettingsPanel
        {...BASE_PROPS}
        channelCount={2}
        channelLabelTokens={["L", "R"]}
        channelLabelHasOverride={true}
        resetChannelLabels={resetChannelLabels}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Reset channel labels" }));
    expect(resetChannelLabels).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("Confirm reset channel labels"));
    expect(resetChannelLabels).toHaveBeenCalledTimes(1);
  });
});

describe("SettingsPanel — Clear shortcut reset", () => {
  it("resets the clear shortcut only after confirming", () => {
    const setClearShortcut = vi.fn();
    render(<SettingsPanel {...BASE_PROPS} clearReady={true} setClearShortcut={setClearShortcut} />);
    fireEvent.click(screen.getByRole("button", { name: "Reset clear shortcut" }));
    expect(setClearShortcut).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("Confirm reset clear shortcut"));
    expect(setClearShortcut).toHaveBeenCalledWith("CmdOrCtrl+K");
  });
});

describe("SettingsPanel — Delete theme", () => {
  it("deletes the active custom theme only after confirming", () => {
    const deleteCustomTheme = vi.fn();
    render(
      <SettingsPanel
        {...BASE_PROPS}
        appearance="fixed"
        fixedThemeSelectValue="custom-1"
        customThemeOptions={[{ id: "custom-1", label: "Custom Theme" }]}
        activeIsCustom={true}
        deleteCustomTheme={deleteCustomTheme}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete theme" }));
    expect(deleteCustomTheme).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("Confirm delete theme"));
    expect(deleteCustomTheme).toHaveBeenCalledWith("custom-1");
  });
});
