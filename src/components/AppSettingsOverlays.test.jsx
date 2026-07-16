/** @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppSettingsOverlays } from "./AppSettingsOverlays.jsx";

const mocks = vi.hoisted(() => ({
  exportConfiguration: vi.fn(),
  importConfiguration: vi.fn(),
  resetConfiguration: vi.fn(),
  setCliPathEnabled: vi.fn(),
}));

vi.mock("../hooks/useConfigurationProfileActions.js", () => ({
  useConfigurationProfileActions: () => ({
    configurationBusy: false,
    configurationStatus: "ready",
    exportConfiguration: mocks.exportConfiguration,
    importConfiguration: mocks.importConfiguration,
    resetConfiguration: mocks.resetConfiguration,
  }),
}));

vi.mock("../hooks/useCliPathSettings.js", () => ({
  useCliPathSettings: () => ({
    cliPathStatus: "ready",
    cliPathBusy: false,
    setCliPathEnabled: mocks.setCliPathEnabled,
  }),
}));

vi.mock("./SettingsPanel.jsx", () => ({
  SettingsPanel: ({
    onOpenFeedback,
    themeControlsDisabled,
    cliPathStatus,
    interfaceSize,
    setInterfaceSize,
  }) => (
    <div data-testid="settings-panel">
      <span data-testid="theme-disabled">{String(themeControlsDisabled)}</span>
      <span data-testid="cli-status">{cliPathStatus}</span>
      <span data-testid="interface-size">{interfaceSize}</span>
      <button type="button" onClick={() => setInterfaceSize("large")}>
        Set interface size
      </button>
      <button type="button" onClick={onOpenFeedback}>
        Feedback
      </button>
    </div>
  ),
}));

vi.mock("./FeedbackDialog.jsx", () => ({
  FeedbackDialog: ({ onClose }) => (
    <div role="dialog" aria-label="feedback">
      <button type="button" onClick={onClose}>
        Close feedback
      </button>
    </div>
  ),
}));

vi.mock("./ThemeEditor.jsx", () => ({
  ThemeEditor: ({ dirty }) => <div data-testid="theme-editor">{String(dirty)}</div>,
}));

function makeSettings(overrides = {}) {
  return {
    settingsOpen: true,
    setSettingsOpen: vi.fn(),
    appearance: "system",
    setAppearanceMode: vi.fn(),
    interfaceSize: "default",
    setInterfaceSize: vi.fn(),
    fixedThemeSelectValue: "system",
    setFixedThemeIdFromPicker: vi.fn(),
    themeSelectOptions: [],
    autostartEnabled: false,
    setAutostartEnabled: vi.fn(),
    autostartReady: true,
    closeAction: "ask",
    setCloseAction: vi.fn(),
    clearShortcut: "CmdOrCtrl+K",
    setClearShortcut: vi.fn(),
    clearGlobal: false,
    setClearGlobal: vi.fn(),
    setClearCapturing: vi.fn(),
    clearReady: true,
    registrationError: null,
    customThemeOptions: [],
    createCustomTheme: vi.fn(),
    editActiveCustomTheme: vi.fn(),
    deleteCustomTheme: vi.fn(),
    activeIsCustom: false,
    editor: {
      isEditing: false,
      draft: null,
      setName: vi.fn(),
      updateSeed: vi.fn(),
      updateShell: vi.fn(),
      save: vi.fn(),
      cancel: vi.fn(),
      dirty: false,
    },
    editorPos: { x: 0, y: 0 },
    moveEditor: vi.fn(),
    ...overrides,
  };
}

function renderOverlays(settings = makeSettings()) {
  return render(
    <AppSettingsOverlays
      settings={settings}
      channelSettings={{
        channelCount: 2,
        channelLabelTokens: [],
        channelLabelHasOverride: false,
        setChannelLabelToken: vi.fn(),
        resetChannelLabels: vi.fn(),
      }}
      updateControls={{
        updateInfo: null,
        refreshUpdateCheck: vi.fn(),
        installStatus: "idle",
        install: vi.fn(),
        restartToApply: vi.fn(),
      }}
      appVersion="0.0.0"
    />
  );
}

describe("AppSettingsOverlays", () => {
  it("forwards the global interface size setting", () => {
    const settings = makeSettings();
    renderOverlays(settings);

    expect(screen.getByTestId("interface-size").textContent).toBe("default");
    fireEvent.click(screen.getByRole("button", { name: "Set interface size" }));
    expect(settings.setInterfaceSize).toHaveBeenCalledWith("large");
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opens feedback from Settings and closes the settings sheet", () => {
    const settings = makeSettings();
    renderOverlays(settings);

    fireEvent.click(screen.getByRole("button", { name: "Feedback" }));

    expect(settings.setSettingsOpen).toHaveBeenCalledWith(false);
    expect(screen.getByRole("dialog", { name: "feedback" })).toBeTruthy();
  });

  it("renders the theme editor when custom theme editing is active", () => {
    renderOverlays(
      makeSettings({
        editor: {
          ...makeSettings().editor,
          isEditing: true,
          dirty: true,
        },
      })
    );

    expect(screen.getByTestId("theme-disabled").textContent).toBe("true");
    expect(screen.getByTestId("theme-editor").textContent).toBe("true");
  });
});
