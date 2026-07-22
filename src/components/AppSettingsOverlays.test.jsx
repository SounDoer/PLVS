/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AppSettingsOverlays } from "./AppSettingsOverlays.jsx";
import { LoudnessProfilePopoverContent } from "./LoudnessProfilePopover.jsx";
import { LoudnessProfileProvider, useLoudnessProfile } from "../hooks/LoudnessProfileContext.jsx";
import { settingsStore } from "../persistence/index.js";

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
    onInstallUpdate,
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
      <button type="button" onClick={onInstallUpdate}>
        Update
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

vi.mock("./UpdateDialog.jsx", () => ({
  UpdateDialog: ({ open, version, releaseNotes, onConfirm, onCancel }) =>
    open ? (
      <div role="dialog" aria-label="update">
        <span>{version}</span>
        <span>{releaseNotes}</span>
        <button type="button" onClick={onCancel}>
          Cancel update
        </button>
        <button type="button" onClick={onConfirm}>
          Confirm update
        </button>
      </div>
    ) : null,
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

function renderOverlays(settings = makeSettings(), updateOverrides = {}) {
  const updateControls = {
    updateInfo: null,
    refreshUpdateCheck: vi.fn(),
    installStatus: "idle",
    install: vi.fn(),
    restartToApply: vi.fn(),
    resetInstall: vi.fn(),
    ...updateOverrides,
  };
  const channelSettings = {
    channelCount: 2,
    channelLabelTokens: [],
    channelLabelHasOverride: false,
    setChannelLabelToken: vi.fn(),
    resetChannelLabels: vi.fn(),
  };
  const renderView = () => (
    <AppSettingsOverlays
      settings={settings}
      channelSettings={channelSettings}
      updateControls={updateControls}
      appVersion="0.0.0"
    />
  );

  const view = render(renderView());

  return {
    ...view,
    updateControls,
    rerenderUpdate(nextUpdateControls) {
      Object.assign(updateControls, nextUpdateControls);
      view.rerender(renderView());
    },
  };
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

  it("opens the changelog dialog before starting an update", () => {
    const update = { downloadAndInstall: vi.fn() };
    const install = vi.fn();
    const resetInstall = vi.fn();
    renderOverlays(makeSettings(), {
      updateInfo: {
        hasUpdate: true,
        latestVersion: "0.9.5",
        releaseNotes: "### Fixed",
        update,
      },
      install,
      resetInstall,
    });

    fireEvent.click(screen.getByRole("button", { name: "Update" }));

    expect(screen.getByRole("dialog", { name: "update" })).toBeTruthy();
    expect(screen.getByText("0.9.5")).toBeTruthy();
    expect(screen.getByText("### Fixed")).toBeTruthy();
    expect(resetInstall).toHaveBeenCalledTimes(1);
    expect(install).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Confirm update" }));
    expect(install).toHaveBeenCalledWith(update);
  });

  it("closes the changelog dialog without installing when canceled", () => {
    const install = vi.fn();
    const resetInstall = vi.fn();
    renderOverlays(makeSettings(), {
      updateInfo: {
        hasUpdate: true,
        latestVersion: "0.9.5",
        releaseNotes: "### Fixed",
        update: { downloadAndInstall: vi.fn() },
      },
      install,
      resetInstall,
    });

    fireEvent.click(screen.getByRole("button", { name: "Update" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel update" }));

    expect(screen.queryByRole("dialog", { name: "update" })).toBeNull();
    expect(screen.getByRole("button", { name: "Update" })).toBeTruthy();
    expect(resetInstall).toHaveBeenCalledTimes(2);
    expect(install).not.toHaveBeenCalled();
  });

  it("keeps the opened update stable when a background check replaces updateInfo", () => {
    const firstUpdate = { downloadAndInstall: vi.fn() };
    const secondUpdate = { downloadAndInstall: vi.fn() };
    const install = vi.fn();
    const { rerenderUpdate } = renderOverlays(makeSettings(), {
      updateInfo: {
        hasUpdate: true,
        latestVersion: "0.9.5",
        releaseNotes: "First release notes",
        update: firstUpdate,
      },
      install,
    });

    fireEvent.click(screen.getByRole("button", { name: "Update" }));
    rerenderUpdate({
      updateInfo: {
        hasUpdate: true,
        latestVersion: "0.9.6",
        releaseNotes: "Second release notes",
        update: secondUpdate,
      },
    });

    expect(screen.getByText("0.9.5")).toBeTruthy();
    expect(screen.getByText("First release notes")).toBeTruthy();
    expect(screen.queryByText("Second release notes")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Confirm update" }));
    expect(install).toHaveBeenCalledWith(firstUpdate);
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

/// The whole path in one tree: popover, provider and mounted panel. The unit tests either side of
/// this one can both pass while the panel is wired to nothing, which is the failure that matters.
describe("Loudness Profile editor wiring", () => {
  afterEach(() => settingsStore.reset());

  function renderWired() {
    const hook = { result: { current: null } };
    function Harness() {
      hook.result.current = useLoudnessProfile();
      return (
        <>
          <LoudnessProfilePopoverContent profile={hook.result.current} />
          <AppSettingsOverlays
            settings={makeSettings()}
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
            loudnessProfile={hook.result.current}
          />
        </>
      );
    }
    render(
      <LoudnessProfileProvider>
        <Harness />
      </LoudnessProfileProvider>
    );
    return hook;
  }

  it("stays closed until an entry point asks for it", () => {
    renderWired();
    expect(screen.queryByRole("dialog", { name: "Loudness Profile editor" })).toBeNull();
  });

  it("opens the panel on the draft the popover started", () => {
    renderWired();
    fireEvent.click(screen.getByLabelText("Duplicate EBU R128 S1"));

    expect(screen.getByRole("dialog", { name: "Loudness Profile editor" })).toBeTruthy();
    expect(screen.getByLabelText("Loudness Profile name").value).toBe("EBU R128 S1 (copy)");
  });

  it("repaints what Stats reads as the panel is edited", () => {
    const hook = renderWired();
    fireEvent.click(screen.getByRole("button", { name: "New Loudness Profile" }));

    const input = screen.getByLabelText("Integrated target");
    fireEvent.change(input, { target: { value: "-16" } });
    fireEvent.blur(input);

    // `document` is the one every reader judges against, so an uncommitted keystroke reaching it
    // is the preview working end to end -- not just the draft object changing shape.
    expect(hook.result.current.document.metrics.integrated.target).toBe(-16);
  });
});
