/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SettingsPanel } from "./SettingsPanel.jsx";
import { BUILTIN_THEMES_V2 } from "../theme/builtinThemesV2.js";

const CUSTOM_THEME = {
  ...structuredClone(BUILTIN_THEMES_V2["plvs-dark"]),
  id: "custom-1",
  name: "Custom Theme",
};
const CUSTOM_THEME_OPTION = { id: CUSTOM_THEME.id, label: CUSTOM_THEME.name, theme: CUSTOM_THEME };

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
  interfaceSize: "default",
  setInterfaceSize: vi.fn(),
  fixedThemeSelectValue: "",
  setFixedThemeIdFromPicker: vi.fn(),
  channelCount: 0,
  channelLabelTokens: [],
  channelLabelHasOverride: false,
  selectedLayoutId: null,
  setChannelLayout: vi.fn(),
  setChannelLabelToken: vi.fn(),
  resetChannelLabels: vi.fn(),
};

function hexToRgb(hex) {
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgb(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255})`;
}

describe("SettingsPanel", () => {
  it("shows the opt-in crash-report prompt setting", () => {
    const onAskToSendCrashReports = vi.fn().mockResolvedValue(undefined);
    render(
      <SettingsPanel
        {...BASE_PROPS}
        askToSendCrashReports={true}
        onAskToSendCrashReports={onAskToSendCrashReports}
      />
    );

    const toggle = screen.getByLabelText("ask to send crash reports");
    expect(toggle.getAttribute("data-state")).toBe("checked");
    fireEvent.click(toggle);
    expect(onAskToSendCrashReports).toHaveBeenCalledWith(false);
  });

  it("renders core controls when open in system mode", () => {
    render(<SettingsPanel {...BASE_PROPS} appearance="system" />);
    expect(screen.getByLabelText("Appearance")).toBeTruthy();
    expect(screen.queryByLabelText("Theme")).toBeNull();
    expect(screen.getByLabelText("Interface Size")).toBeTruthy();
    const interfaceSizeHelp = screen.getByRole("button", {
      name: "Interface Size help: Adjusts text and related interface icons. Dock is unaffected.",
    });
    expect(
      screen.queryByText("Adjusts text and related interface icons. Dock is unaffected.")
    ).toBeNull();
    fireEvent.mouseEnter(interfaceSizeHelp);
    expect(
      screen.getByText("Adjusts text and related interface icons. Dock is unaffected.")
    ).toBeTruthy();
    expect(screen.getByLabelText("Interface Size").className).toContain("min-h-6");
    expect(screen.getByLabelText("Interface Size").className).not.toContain(" h-6 ");
    expect(screen.getByRole("heading", { name: "Settings" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Close settings" })).toBeTruthy();
    expect(document.body.querySelector("[data-settings-header]")).toBeTruthy();
    expect(document.body.querySelector("[data-settings-scroll]")).toBeTruthy();
    expect(document.body.querySelector("[data-slot=sheet-content]").className).toContain(
      "settings-sheet"
    );
    expect(document.body.querySelector("[data-slot=sheet-content]").className).toContain("bg-card");
    expect(document.body.querySelector("[data-slot=sheet-content]").className).not.toMatch(
      /bg-card\//
    );
    expect(document.body.querySelector("[data-slot=sheet-overlay]").className).toContain(
      "backdrop-blur-sm"
    );
  });

  it("updates the global interface size", () => {
    const setInterfaceSize = vi.fn();
    render(<SettingsPanel {...BASE_PROPS} setInterfaceSize={setInterfaceSize} />);

    fireEvent.click(screen.getByLabelText("Interface Size"));
    fireEvent.click(screen.getByRole("option", { name: "Extra Large" }));

    expect(setInterfaceSize).toHaveBeenCalledWith("extra-large");
  });

  it("provides a visible close action that follows the sheet exit flow", async () => {
    const setSettingsOpen = vi.fn();
    render(<SettingsPanel {...BASE_PROPS} setSettingsOpen={setSettingsOpen} />);

    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));

    await waitFor(() => expect(setSettingsOpen).toHaveBeenCalledWith(false));
  });

  it("shows theme picker in fixed mode", () => {
    render(<SettingsPanel {...BASE_PROPS} appearance="fixed" fixedThemeSelectValue="plvs-dark" />);
    expect(screen.getByLabelText("Appearance")).toBeTruthy();
    expect(screen.getByLabelText("Theme")).toBeTruthy();
  });

  it("aligns trailing selectors with switches and reset actions", () => {
    render(<SettingsPanel {...BASE_PROPS} appearance="fixed" fixedThemeSelectValue="plvs-dark" />);

    for (const label of ["Close Behavior", "Interface Size", "Appearance", "History Length"]) {
      const trigger = screen.getByLabelText(label);
      expect(trigger.className).toContain("!pr-0");
      expect(trigger.className).toContain("!pl-2");
    }
    expect(screen.getByLabelText("Theme").className).toContain("pr-0");
    expect(screen.getByLabelText("Theme").className).toContain("pl-2");
    expect(
      screen.getByText("Dialogue Detection").closest("[data-settings-row]").className
    ).toContain("grid-cols-[minmax(0,1fr)_max-content]");
    const dialogueRow = screen.getByText("Dialogue Detection").closest("[data-settings-row]");
    const dialogueValue = dialogueRow.querySelector("[data-settings-row-value]");
    const integratedControl = dialogueValue.querySelector("[data-integrated-select-action]");
    expect(integratedControl).toBeTruthy();
    expect(integratedControl.className).toContain("hover:bg-ui-hover");
    expect(integratedControl.className).not.toContain("focus-within:bg-ui-hover");
    expect(
      integratedControl.contains(
        screen.getByRole("button", { name: "Open FireRedVAD official link" })
      )
    ).toBe(true);
    expect(integratedControl.contains(screen.getByLabelText("Dialogue Detection"))).toBe(true);
    expect(
      dialogueValue.contains(screen.getByRole("button", { name: /Dialogue Detection help:/ }))
    ).toBe(false);
    const dialogueTrigger = screen.getByLabelText("Dialogue Detection");
    expect(dialogueTrigger.className).toContain("!pr-0");
    expect(dialogueTrigger.className).toContain("!pl-2");
    expect(dialogueTrigger.className).toContain("!gap-1");
    expect(dialogueTrigger.className).toContain("hover:bg-transparent");
    expect(dialogueTrigger.contains(screen.getByRole("button", { name: /official link/ }))).toBe(
      false
    );
  });

  it("uses shared layout primitives for settings sections and rows", () => {
    render(<SettingsPanel {...BASE_PROPS} appearance="fixed" fixedThemeSelectValue="plvs-dark" />);

    expect(document.body.querySelector("[data-settings-body]")).toBeTruthy();
    expect(document.body.querySelectorAll("[data-settings-section]").length).toBeGreaterThanOrEqual(
      4
    );
    expect(document.body.querySelectorAll("[data-settings-row]").length).toBeGreaterThanOrEqual(5);
    expect(
      document.body.querySelectorAll("[data-settings-row-value]").length
    ).toBeGreaterThanOrEqual(5);
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

    expect(screen.getByText("Complete Setup").closest("[data-settings-row]").className).toContain(
      "settings-row-stackable"
    );
    const exportConfiguration = screen.getByRole("button", {
      name: "Export complete setup",
    });
    const importConfiguration = screen.getByRole("button", {
      name: "Import complete setup",
    });
    expect(exportConfiguration.className).toContain("bg-secondary");
    expect(importConfiguration.className).toContain("bg-secondary");
    fireEvent.click(exportConfiguration);
    fireEvent.click(importConfiguration);

    expect(onExportConfiguration).toHaveBeenCalledTimes(1);
    expect(onImportConfiguration).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Configuration exported")).toBeTruthy();
  });

  it("renders Agent Control as a toggle with an honest tip", () => {
    const onSetAgentControlEnabled = vi.fn();
    render(
      <SettingsPanel
        {...BASE_PROPS}
        agentControlStatus={{
          supported: true,
          enabled: false,
          cliInstalled: true,
          onPath: false,
          message: "Lets AI agents and scripts on this machine control PLVS through plvs-cli.",
        }}
        onSetAgentControlEnabled={onSetAgentControlEnabled}
      />
    );

    expect(screen.getByText("Agent Control")).toBeTruthy();
    const help = screen.getByRole("button", {
      name: "Agent Control help: Lets AI agents and scripts on this machine control PLVS through plvs-cli.",
    });
    fireEvent.mouseEnter(help);
    expect(
      screen.getByText("Lets AI agents and scripts on this machine control PLVS through plvs-cli.")
    ).toBeTruthy();

    const toggle = screen.getByRole("switch", { name: "Agent Control" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(toggle);
    expect(onSetAgentControlEnabled).toHaveBeenCalledWith(true);
  });

  it("disables Agent Control where the platform has no endpoint", () => {
    render(
      <SettingsPanel
        {...BASE_PROPS}
        agentControlStatus={{
          supported: false,
          enabled: false,
          cliInstalled: false,
          onPath: false,
          message: "Agent Control is unavailable on this platform.",
        }}
      />
    );

    expect(screen.getByRole("switch", { name: "Agent Control" }).hasAttribute("disabled")).toBe(
      true
    );
  });

  it("says the endpoint is not listening while the switch is on", () => {
    const { rerender } = render(
      <SettingsPanel
        {...BASE_PROPS}
        agentControlStatus={{
          supported: true,
          enabled: true,
          listening: false,
          startError: "unable to bind plvs-agent-control-dev: Access is denied.",
          cliInstalled: true,
          message: "Lets AI agents and scripts on this machine control PLVS through plvs-cli.",
        }}
      />
    );

    // The switch keeps showing the granted permission; the line below it carries the failure.
    expect(screen.getByRole("switch", { name: "Agent Control" }).getAttribute("aria-checked")).toBe(
      "true"
    );
    expect(
      screen.getByText(
        "Enabled, but not listening: unable to bind plvs-agent-control-dev: Access is denied."
      )
    ).toBeTruthy();

    rerender(
      <SettingsPanel
        {...BASE_PROPS}
        agentControlStatus={{
          supported: true,
          enabled: true,
          listening: false,
          startError: null,
          cliInstalled: true,
          message: "Lets AI agents and scripts on this machine control PLVS through plvs-cli.",
        }}
      />
    );

    expect(screen.getByText("Enabled, but not listening.")).toBeTruthy();

    rerender(
      <SettingsPanel
        {...BASE_PROPS}
        agentControlStatus={{
          supported: true,
          enabled: true,
          listening: true,
          startError: null,
          cliInstalled: true,
          message: "Lets AI agents and scripts on this machine control PLVS through plvs-cli.",
        }}
      />
    );

    expect(screen.queryByText(/not listening/)).toBeNull();
  });

  it("shows the copyable prompt starter only while Agent Control is enabled", () => {
    const { rerender } = render(
      <SettingsPanel
        {...BASE_PROPS}
        agentControlStatus={{
          supported: true,
          enabled: false,
          cliInstalled: true,
          message: "Agent Control is ready.",
        }}
      />
    );

    expect(screen.queryByText("Prompt Starter")).toBeNull();

    rerender(
      <SettingsPanel
        {...BASE_PROPS}
        agentControlStatus={{
          supported: true,
          enabled: true,
          listening: true,
          cliInstalled: true,
          message: "Agent Control is ready.",
        }}
      />
    );

    expect(screen.getByText("Prompt Starter")).toBeTruthy();
    expect(
      screen.getByRole("textbox", { name: "copy agent control prompt starter text" }).textContent
    ).toBe(
      "Use PLVS’s built-in Agent Control CLI (`plvs-cli`). First inspect the available capabilities and current app state, then help me..."
    );
    expect(screen.getByRole("button", { name: "copy agent control prompt starter" })).toBeTruthy();
  });

  it("confirms in a modal before resetting, and says what will be lost", () => {
    const onResetConfiguration = vi.fn();
    render(<SettingsPanel {...BASE_PROPS} onResetConfiguration={onResetConfiguration} />);

    const resetButton = screen.getByRole("button", { name: "Reset PLVS to default" });
    expect(resetButton.className).toContain("hover:bg-ui-hover");
    expect(resetButton.className).toContain("hover:text-destructive");
    fireEvent.click(resetButton);
    expect(onResetConfiguration).not.toHaveBeenCalled();

    // The two consequences a user would not otherwise expect.
    const description = screen.getByText(/Every setting, preset, theme and loudness profile/);
    expect(description.textContent).toContain("erased");
    expect(description.textContent).toContain("restarts");

    fireEvent.click(screen.getByRole("button", { name: "Reset PLVS" }));
    expect(onResetConfiguration).toHaveBeenCalledTimes(1);
  });

  it("dismisses the reset modal without resetting", () => {
    const onResetConfiguration = vi.fn();
    render(<SettingsPanel {...BASE_PROPS} onResetConfiguration={onResetConfiguration} />);

    fireEvent.click(screen.getByRole("button", { name: "Reset PLVS to default" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onResetConfiguration).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("shows theme actions inline with the theme select for custom themes", () => {
    render(
      <SettingsPanel
        {...BASE_PROPS}
        appearance="fixed"
        fixedThemeSelectValue="custom-1"
        customThemeOptions={[CUSTOM_THEME_OPTION]}
      />
    );

    const themePicker = screen.getByRole("group", { name: "Theme picker" });
    expect(themePicker).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Theme" }));
    expect(screen.getByRole("button", { name: "Edit Custom Theme" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Duplicate Custom Theme" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Export Custom Theme" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete Custom Theme" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add Theme" })).toBeTruthy();
  });

  it("exports one custom Theme from its picker row", () => {
    const onExportTheme = vi.fn();
    render(
      <SettingsPanel
        {...BASE_PROPS}
        appearance="fixed"
        fixedThemeSelectValue="custom-1"
        customThemeOptions={[CUSTOM_THEME_OPTION]}
        onExportTheme={onExportTheme}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Theme" }));
    fireEvent.click(screen.getByRole("button", { name: "Export Custom Theme" }));
    expect(onExportTheme).toHaveBeenCalledWith("custom-1");
  });

  it("keeps the theme picker clickable while the settings sheet blanks body pointer events", () => {
    render(<SettingsPanel {...BASE_PROPS} appearance="fixed" fixedThemeSelectValue="plvs-dark" />);

    fireEvent.click(screen.getByRole("button", { name: "Theme" }));
    const content = document.querySelector("[data-slot='popover-content']");
    expect(document.body.style.pointerEvents).toBe("none");
    expect(content.className).toContain("pointer-events-auto");
  });

  it("creates a custom theme from inside the picker panel", () => {
    const createCustomTheme = vi.fn();
    render(
      <SettingsPanel
        {...BASE_PROPS}
        appearance="fixed"
        fixedThemeSelectValue="plvs-dark"
        createCustomTheme={createCustomTheme}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Theme" }));
    fireEvent.click(screen.getByRole("button", { name: "Add Theme" }));
    expect(createCustomTheme).toHaveBeenCalled();
  });

  it("sizes the theme panel to its names instead of a fixed width", () => {
    render(<SettingsPanel {...BASE_PROPS} appearance="fixed" fixedThemeSelectValue="plvs-dark" />);

    fireEvent.click(screen.getByRole("button", { name: "Theme" }));
    const content = document.querySelector("[data-slot='popover-content']");

    expect(content.className).toContain("w-auto");
    expect(content.className).toContain("max-w-72");
    expect(content.className).not.toMatch(/(?:^|\s)w-72(?:\s|$)/);
  });

  it("previews every authored core color", () => {
    render(<SettingsPanel {...BASE_PROPS} appearance="fixed" fixedThemeSelectValue="plvs-dark" />);
    fireEvent.click(screen.getByRole("button", { name: "Theme" }));

    const dark = BUILTIN_THEMES_V2["plvs-dark"].core;
    const row = screen.getByRole("button", { name: "Dark" });
    const painted = Array.from(
      row.querySelectorAll("[style*='background-color'], [style*='color']")
    )
      .map((node) => node.style.backgroundColor || node.style.color)
      .filter(Boolean);

    for (const key of [
      "workspace",
      "surface",
      "text",
      "interfaceAccent",
      "primaryData",
      "secondaryData",
    ]) {
      expect(painted).toContain(hexToRgb(dark[key]));
    }
  });

  it("leads the appearance section with Interface Size", () => {
    render(<SettingsPanel {...BASE_PROPS} appearance="system" />);

    const rows = Array.from(document.querySelectorAll("[data-settings-row]"));
    const index = (label) => rows.findIndex((row) => row.textContent.startsWith(label));

    expect(index("Interface Size")).toBeGreaterThanOrEqual(0);
    expect(index("Interface Size")).toBeLessThan(index("Appearance"));
  });

  it("keeps the row name out of the action tooltips", () => {
    render(
      <SettingsPanel
        {...BASE_PROPS}
        appearance="fixed"
        fixedThemeSelectValue="custom-1"
        customThemeOptions={[CUSTOM_THEME_OPTION]}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Theme" }));

    // The name stays in the accessible name, which has to tell the rows apart.
    const edit = screen.getByRole("button", { name: "Edit Custom Theme" });
    fireEvent.mouseEnter(edit);

    expect(screen.getByText("Edit")).toBeTruthy();
    expect(screen.queryByText("Edit Custom Theme")).toBeNull();
  });

  it("hides edit/delete for built-in themes", () => {
    render(<SettingsPanel {...BASE_PROPS} appearance="fixed" fixedThemeSelectValue="plvs-dark" />);

    fireEvent.click(screen.getByRole("button", { name: "Theme" }));
    expect(screen.queryByRole("button", { name: /^Edit / })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Delete / })).toBeNull();
    expect(screen.getByRole("button", { name: "Customize Dark" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add Theme" })).toBeTruthy();
  });

  it("locks theme controls while the theme editor is open", () => {
    render(
      <SettingsPanel
        {...BASE_PROPS}
        appearance="fixed"
        fixedThemeSelectValue="custom-1"
        customThemeOptions={[CUSTOM_THEME_OPTION]}
        themeControlsDisabled={true}
      />
    );

    expect(
      screen.getByText("Finish editing the current theme before changing theme settings.")
    ).toBeTruthy();
    expect(screen.getByLabelText("Appearance").disabled).toBe(true);
    expect(screen.getByLabelText("Theme").disabled).toBe(true);
    // Add Theme lives inside the picker panel, so locking the trigger is what
    // keeps it out of reach.
    expect(screen.queryByRole("button", { name: "Add Theme" })).toBeNull();
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
    expect(screen.queryByRole("button", { name: "Licenses" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Privacy" })).toBeNull();
    expect(document.querySelector("[data-settings-footer-status]").className).toContain(
      "justify-start"
    );
    const footerLinks = document.querySelector("[data-settings-footer-links]");
    expect(footerLinks.className).toContain("flex-wrap");
    expect(footerLinks.className).toContain("justify-start");
    expect(footerLinks.querySelectorAll(".border-l")).toHaveLength(0);
  });

  it("shows up to date when the update check succeeds without a newer version", () => {
    render(
      <SettingsPanel
        {...BASE_PROPS}
        appVersion="0.0.17"
        updateStatus="ok"
        hasUpdate={false}
        latestVersion={null}
      />
    );

    expect(screen.getByText("Up to date")).toBeTruthy();
    expect(screen.queryByText("Checking...")).toBeNull();
  });

  it("keeps release link visible when update check fails", () => {
    const openExternalUrl = vi.fn();
    render(
      <SettingsPanel
        {...BASE_PROPS}
        appVersion="0.0.17"
        updateStatus="unavailable"
        openExternalUrl={openExternalUrl}
      />
    );

    expect(screen.getByText("Update unavailable")).toBeTruthy();
    fireEvent.click(screen.getByText("Releases"));
    expect(openExternalUrl).toHaveBeenCalledWith("https://github.com/SounDoer/PLVS/releases");
  });

  it("opens the docs URL from the footer", () => {
    const openExternalUrl = vi.fn();
    render(<SettingsPanel {...BASE_PROPS} appVersion="0.0.17" openExternalUrl={openExternalUrl} />);

    fireEvent.click(screen.getByText("Docs"));
    expect(openExternalUrl).toHaveBeenCalledWith("https://plvs.soundoer.com/docs/");
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
    const openExternalUrl = vi.fn();
    const releaseUrl = "https://github.com/SounDoer/PLVS/releases/tag/v0.1.10";
    render(
      <SettingsPanel
        {...BASE_PROPS}
        appVersion="0.1.9"
        latestVersion="0.1.10"
        releaseUrl={releaseUrl}
        hasUpdate={true}
        openExternalUrl={openExternalUrl}
      />
    );

    expect(screen.getByText("v0.1.10 available")).toBeTruthy();
    fireEvent.click(screen.getByText("Releases"));

    expect(openExternalUrl).toHaveBeenCalledWith(releaseUrl);
  });

  it("shows an Update button when an update is available and requests its dialog", () => {
    const onInstallUpdate = vi.fn();
    render(
      <SettingsPanel
        {...BASE_PROPS}
        appVersion="0.1.9"
        latestVersion="0.1.10"
        hasUpdate={true}
        onInstallUpdate={onInstallUpdate}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Update" }));
    expect(onInstallUpdate).toHaveBeenCalledTimes(1);
  });

  it("does not show an Update button when there is no update", () => {
    render(
      <SettingsPanel {...BASE_PROPS} appVersion="0.1.10" latestVersion="0.1.10" hasUpdate={false} />
    );

    expect(screen.queryByText("Update")).toBeNull();
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

  const HISTORY_PROPS = {
    historyRetentionSec: 3600,
    setHistoryRetentionSec: vi.fn(),
  };

  it("renders History Length select with current value", () => {
    render(<SettingsPanel {...BASE_PROPS} {...HISTORY_PROPS} historyRetentionSec={7200} />);
    expect(screen.getByLabelText("History Length")).toBeTruthy();
  });

  // Pins the copy: the neighbouring Dialogue Detection row does restart the measurement, so this
  // row has to say that it does not, or the pair reads as arbitrary.
  it("explains that History Length does not restart the measurement", () => {
    const tip =
      "How far back the history panels can be scrolled. Changing it does not restart the " +
      "measurement; shortening it drops rows older than the new length.";
    render(<SettingsPanel {...BASE_PROPS} {...HISTORY_PROPS} />);
    expect(screen.queryByText(tip)).toBeNull();
    fireEvent.mouseEnter(screen.getByRole("button", { name: `History Length help: ${tip}` }));
    expect(screen.getByText(tip)).toBeTruthy();
  });

  it("calls setHistoryRetentionSec when a new option is chosen", () => {
    const setHistoryRetentionSec = vi.fn();
    render(
      <SettingsPanel
        {...BASE_PROPS}
        {...HISTORY_PROPS}
        setHistoryRetentionSec={setHistoryRetentionSec}
      />
    );
    fireEvent.click(screen.getByLabelText("History Length"));
    fireEvent.click(screen.getByText("120 min"));
    expect(setHistoryRetentionSec).toHaveBeenCalledWith("7200");
  });

  const DIALOGUE_PROPS = {
    dialogueVadEngine: "firered",
    setDialogueVadEngine: vi.fn(),
  };

  it("renders Dialogue Detection with the three engines", () => {
    render(<SettingsPanel {...BASE_PROPS} {...DIALOGUE_PROPS} />);
    fireEvent.click(screen.getByLabelText("Dialogue Detection"));
    // Order matters: the default engine is offered first.
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "FireRedVAD",
      "Silero VAD",
      "TEN VAD",
    ]);
    // No Off option: showing a dialogue metric is what enables detection.
    expect(screen.queryByRole("option", { name: /off/i })).toBeNull();
  });

  it("calls setDialogueVadEngine when a new engine is chosen", () => {
    const setDialogueVadEngine = vi.fn();
    render(
      <SettingsPanel
        {...BASE_PROPS}
        {...DIALOGUE_PROPS}
        setDialogueVadEngine={setDialogueVadEngine}
      />
    );
    fireEvent.click(screen.getByLabelText("Dialogue Detection"));
    fireEvent.click(screen.getByText("TEN VAD"));
    expect(setDialogueVadEngine).toHaveBeenCalledWith("ten");
  });

  it("opens the official link for the selected engine", () => {
    const openExternalUrl = vi.fn();
    render(
      <SettingsPanel
        {...BASE_PROPS}
        {...DIALOGUE_PROPS}
        dialogueVadEngine="ten"
        openExternalUrl={openExternalUrl}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Open TEN VAD official link" }));
    expect(openExternalUrl).toHaveBeenCalledWith("https://github.com/TEN-framework/ten-vad");
  });

  it("existing controls still render with new props absent (backwards compat)", () => {
    render(<SettingsPanel {...BASE_PROPS} />);
    expect(screen.getByLabelText("Appearance")).toBeTruthy();
  });

  it("renders the keyboard shortcuts reference rows", () => {
    render(<SettingsPanel {...BASE_PROPS} />);
    expect(screen.queryByText("Start / Stop")).toBeNull();
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
      "border-destructive"
    );
  });

  it("calls onOpenFeedback when the footer's Feedback link is clicked", () => {
    const onOpenFeedback = vi.fn();
    render(<SettingsPanel {...BASE_PROPS} appVersion="0.1.10" onOpenFeedback={onOpenFeedback} />);

    fireEvent.click(screen.getByRole("button", { name: "Feedback" }));
    expect(onOpenFeedback).toHaveBeenCalledTimes(1);
  });

  it("offers Saved Items transfer above Complete Setup", () => {
    const onLibraryExport = vi.fn();
    const onSharedPackImport = vi.fn();
    render(
      <SettingsPanel
        {...BASE_PROPS}
        onLibraryExport={onLibraryExport}
        onSharedPackImport={onSharedPackImport}
      />
    );

    const exportLibrary = screen.getByRole("button", { name: "Export saved items" });
    const importLibrary = screen.getByRole("button", { name: "Import saved items" });
    expect(exportLibrary.className).toContain("bg-secondary");
    expect(importLibrary.className).toContain("bg-secondary");
    expect(screen.queryByRole("button", { name: "Paste theme" })).toBeNull();

    const libraryTip =
      "Loudness Profiles, Presets and Themes. Export lets you choose saved items; Import adds them without replacing your current setup.";
    fireEvent.mouseEnter(screen.getByRole("button", { name: `Saved Items help: ${libraryTip}` }));
    expect(screen.getByText(libraryTip)).toBeTruthy();

    const rows = Array.from(document.querySelectorAll("[data-settings-row]"));
    const index = (label) => rows.findIndex((row) => row.textContent.startsWith(label));
    expect(index("Saved Items")).toBeGreaterThanOrEqual(0);
    expect(index("Complete Setup")).toBeGreaterThanOrEqual(0);
    expect(index("Saved Items")).toBeLessThan(index("Complete Setup"));

    fireEvent.click(exportLibrary);
    expect(onLibraryExport).toHaveBeenCalledTimes(1);
    fireEvent.click(importLibrary);
    expect(onSharedPackImport).toHaveBeenCalledTimes(1);
  });
});

describe("SettingsPanel — Channel labels", () => {
  it("shows a sole matching standard layout as text", () => {
    const setChannelLayout = vi.fn();
    const roles = ["L", "R", "C", "LFE", "Lb", "Rb", "Ls", "Rs", "Ltf", "Rtf", "Ltr", "Rtr"];
    render(
      <SettingsPanel
        {...BASE_PROPS}
        channelCount={12}
        channelLabelTokens={roles}
        selectedLayoutId="7.1.4"
        setChannelLayout={setChannelLayout}
      />
    );

    const layoutSelect = screen.getByLabelText("channel layout");
    expect(layoutSelect.textContent).toContain("7.1.4");
    expect(screen.queryByRole("combobox", { name: "channel layout" })).toBeNull();
    expect(setChannelLayout).not.toHaveBeenCalled();
  });

  it("offers every matching standard when the channel count has multiple layouts", () => {
    render(
      <SettingsPanel
        {...BASE_PROPS}
        channelCount={8}
        channelLabelTokens={["L", "R", "C", "LFE", "Lb", "Rb", "Ls", "Rs"]}
        selectedLayoutId="7.1"
      />
    );

    fireEvent.click(screen.getByLabelText("channel layout"));
    expect(screen.getByRole("option", { name: "7.1" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "5.1.2" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "Custom" })).toBeNull();
  });

  it("reports edited roles as Custom and allows switching back to a standard layout", () => {
    const setChannelLayout = vi.fn();
    const roles = ["L", "R", "C", "LFE", "Lb", "Rb", "Ls", "Rs", "Ltf", "Rtf", "Ltr", "Rtr"];
    render(
      <SettingsPanel
        {...BASE_PROPS}
        channelCount={12}
        channelLabelTokens={[...roles.slice(0, 4), "Ls", "Rs", "Lb", "Rb", ...roles.slice(8)]}
        selectedLayoutId="custom"
        setChannelLayout={setChannelLayout}
      />
    );

    expect(screen.getByLabelText("channel layout").textContent).toContain("Custom");
    fireEvent.click(screen.getByLabelText("channel layout"));
    expect(screen.getByRole("option", { name: "Custom" })).toBeTruthy();
    fireEvent.click(screen.getByRole("option", { name: "7.1.4" }));
    expect(setChannelLayout).toHaveBeenCalledWith("7.1.4");
  });

  it("shows Unknown rather than Custom when automatic detection cannot identify the layout", () => {
    render(
      <SettingsPanel
        {...BASE_PROPS}
        channelCount={12}
        channelLabelTokens={Array.from({ length: 12 }, () => "generic")}
        selectedLayoutId={null}
      />
    );

    expect(screen.getByLabelText("channel layout").textContent).toContain("Unknown");
  });

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
    render(
      <SettingsPanel
        {...BASE_PROPS}
        clearReady={true}
        clearShortcut="CmdOrCtrl+Shift+K"
        setClearShortcut={setClearShortcut}
      />
    );
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
        customThemeOptions={[CUSTOM_THEME_OPTION]}
        deleteCustomTheme={deleteCustomTheme}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Theme" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete Custom Theme" }));
    expect(deleteCustomTheme).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("Confirm delete Custom Theme"));
    expect(deleteCustomTheme).toHaveBeenCalledWith("custom-1");
  });
});
