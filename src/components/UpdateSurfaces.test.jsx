/** @vitest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BlockingEditorsProvider, useBlockingEditors } from "../hooks/BlockingEditorsContext.jsx";
import { UpdateSurfaces } from "./UpdateSurfaces.jsx";

const mock = vi.hoisted(() => ({
  settings: {
    updatePreferences: { choiceMade: false },
    setUpdatePreferences: vi.fn(),
    appearance: "system",
    resolvedThemeId: "plvs-dark",
    interfaceSize: "default",
    setAppearanceMode: vi.fn(),
    setFixedThemeIdFromPicker: vi.fn(),
    setInterfaceSize: vi.fn(),
  },
  crashReportSetting: { enabled: true, setEnabled: vi.fn() },
  dockOptions: null,
  docked: false,
  windowError: null,
  exitDock: vi.fn(async () => ({ ok: true })),
  registry: null,
  adapters: new Map(),
  surfaces: [],
  updateControls: null,
}));
vi.mock("../dev/DevelopmentEventFixturesContext.jsx", () => ({
  useDevelopmentEventFixtureAdapter: (name, adapter) => mock.adapters.set(name, adapter),
}));
vi.mock("../uiNavigation/UiNavigationContext.jsx", () => ({
  useUiSurface: (descriptor) => {
    mock.surfaces.push(descriptor);
    return descriptor.active ? "surface" : null;
  },
}));
vi.mock("../hooks/AppLifecycleContext.jsx", () => ({
  useAppLifecycle: () => ({
    crashReportSetting: mock.crashReportSetting,
    updateControls: mock.updateControls ?? {
      enabled: true,
      installationSupported: true,
      details: null,
      installStatus: "idle",
      dismissDetails: vi.fn(),
      confirmInstall: vi.fn(),
    },
  }),
}));
vi.mock("../settings/SettingsContext.jsx", () => ({ useAppSettings: () => mock.settings }));
vi.mock("../dock/DockContext.jsx", () => ({
  useDock: () => ({
    docked: mock.docked,
    dockEdge: "bottom",
    exitDockRestoringAttributes: mock.exitDock,
  }),
}));
vi.mock("../dock/DockAccessoriesContext.jsx", () => ({
  useDockAccessories: () => ({ setUpdateGeometry: vi.fn() }),
}));
vi.mock("../dock/useDockUpdateWindow.js", () => ({
  useDockUpdateWindow: (options) => {
    mock.dockOptions = options;
    return { error: mock.windowError };
  },
}));
function Harness() {
  mock.registry = useBlockingEditors();
  return <UpdateSurfaces currentVersion="0.21.0" />;
}
beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  mock.settings.setUpdatePreferences.mockReset();
  mock.crashReportSetting.setEnabled.mockReset();
  mock.settings.setAppearanceMode.mockClear();
  mock.settings.setFixedThemeIdFromPicker.mockClear();
  mock.settings.setInterfaceSize.mockClear();
  mock.settings.updatePreferences = { choiceMade: false };
  mock.adapters.clear();
  mock.surfaces = [];
  mock.docked = false;
  mock.windowError = null;
  mock.exitDock.mockClear();
  mock.updateControls = null;
});
describe("first-launch update choice", () => {
  it("applies appearance and size immediately without confirming updates", () => {
    render(
      <BlockingEditorsProvider>
        <Harness />
      </BlockingEditorsProvider>
    );
    fireEvent.keyDown(screen.getByRole("combobox", { name: "appearance" }), { key: "ArrowDown" });
    fireEvent.click(screen.getByRole("option", { name: "Dark" }));
    expect(mock.settings.setFixedThemeIdFromPicker).toHaveBeenCalledWith("plvs-dark");
    fireEvent.keyDown(screen.getByRole("combobox", { name: "interface size" }), {
      key: "ArrowDown",
    });
    fireEvent.click(screen.getByRole("option", { name: "Extra Large" }));
    expect(mock.settings.setInterfaceSize).toHaveBeenCalledWith("extra-large");
    expect(mock.settings.setUpdatePreferences).not.toHaveBeenCalled();
    expect(mock.crashReportSetting.setEnabled).not.toHaveBeenCalled();
  });
  it("leaves an existing installation's preferences untouched", () => {
    mock.settings.updatePreferences = { choiceMade: true, autoCheck: false, autoDownload: false };
    render(
      <BlockingEditorsProvider>
        <Harness />
      </BlockingEditorsProvider>
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mock.settings.setUpdatePreferences).not.toHaveBeenCalled();
    expect(mock.crashReportSetting.setEnabled).not.toHaveBeenCalled();
    expect(mock.settings.setAppearanceMode).not.toHaveBeenCalled();
    expect(mock.settings.setFixedThemeIdFromPicker).not.toHaveBeenCalled();
    expect(mock.settings.setInterfaceSize).not.toHaveBeenCalled();
  });
  it("restores the normal host without saving or skipping when the Dock accessory fails", () => {
    mock.docked = true;
    mock.windowError = "Window unavailable";
    render(
      <BlockingEditorsProvider>
        <Harness />
      </BlockingEditorsProvider>
    );
    expect(mock.exitDock).toHaveBeenCalledOnce();
    expect(mock.settings.setUpdatePreferences).not.toHaveBeenCalled();
    expect(mock.registry.activeBlockingEditors).toContain("updatePreferences");
  });
  it.each([false, true])(
    "blocks scene mutations while the untouched choice is open (Dock=%s)",
    (docked) => {
      mock.docked = docked;
      render(
        <BlockingEditorsProvider>
          <Harness />
        </BlockingEditorsProvider>
      );
      const mutate = vi.fn();
      const apply = () => {
        mock.registry.assertSceneOperationAllowed("applyPreset");
        mutate();
      };
      expect(apply).toThrow();
      expect(mutate).not.toHaveBeenCalled();
    }
  );
  it("offers only Continue and cannot dismiss or enable updates before confirmation", async () => {
    render(
      <BlockingEditorsProvider>
        <Harness />
      </BlockingEditorsProvider>
    );
    expect(screen.getByRole("heading", { name: "Welcome to PLVS" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Skip" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(mock.settings.setUpdatePreferences).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    fireEvent.pointerDown(document.querySelector('[data-modal-backdrop-scope="viewport"]'));
    const surface = mock.surfaces
      .filter((surface) => surface.target?.phase === "preferences")
      .at(-1);
    expect(surface.dismissible).toBe(false);
    expect(surface.supportedActions).toEqual([]);
    act(() => surface.onCancel());
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(mock.settings.setUpdatePreferences).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() =>
      expect(mock.settings.setUpdatePreferences).toHaveBeenCalledWith({
        autoCheck: true,
        autoDownload: false,
      })
    );
    expect(mock.crashReportSetting.setEnabled).toHaveBeenCalledWith(true);
  });
  it("defaults to checking on and downloading off and retains a failed save", async () => {
    mock.settings.setUpdatePreferences.mockRejectedValue(new Error("Save failed"));
    render(
      <BlockingEditorsProvider>
        <Harness />
      </BlockingEditorsProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() =>
      expect(mock.settings.setUpdatePreferences).toHaveBeenCalledWith({
        autoCheck: true,
        autoDownload: false,
      })
    );
    expect((await screen.findByRole("alert")).textContent).toContain("Save failed");
    expect(mock.registry.activeBlockingEditors).toContain("updatePreferences");
  });
  it("waits for native saving and locks the controls until Continue completes", async () => {
    let finish;
    mock.crashReportSetting.setEnabled.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const view = render(
      <BlockingEditorsProvider>
        <Harness />
      </BlockingEditorsProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    for (const control of [
      ...screen.getAllByRole("combobox"),
      ...screen.getAllByRole("switch"),
      screen.getByRole("button", { name: "Continue" }),
    ])
      expect(control.hasAttribute("disabled")).toBe(true);
    expect(mock.settings.setUpdatePreferences).not.toHaveBeenCalled();
    await act(async () => finish());
    expect(mock.settings.setUpdatePreferences).toHaveBeenCalledWith({
      autoCheck: true,
      autoDownload: false,
    });
    mock.settings.updatePreferences = { choiceMade: true, autoCheck: true, autoDownload: false };
    view.rerender(
      <BlockingEditorsProvider>
        <Harness />
      </BlockingEditorsProvider>
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mock.registry.activeBlockingEditors).not.toContain("updatePreferences");
  });
});

it("keeps the welcome open and updates disabled when the native crash preference fails", async () => {
  mock.crashReportSetting.setEnabled.mockRejectedValue(new Error("Native save failed"));
  render(
    <BlockingEditorsProvider>
      <Harness />
    </BlockingEditorsProvider>
  );
  fireEvent.click(screen.getByRole("switch", { name: "ask to send crash reports" }));
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect((await screen.findByRole("alert")).textContent).toContain("Native save failed");
  expect(mock.crashReportSetting.setEnabled).toHaveBeenCalledWith(false);
  expect(mock.settings.setUpdatePreferences).not.toHaveBeenCalled();
  expect(mock.registry.activeBlockingEditors).toContain("updatePreferences");
});

it("routes Dock preferences through the owners and retains the update draft", async () => {
  mock.docked = true;
  render(
    <BlockingEditorsProvider>
      <Harness />
    </BlockingEditorsProvider>
  );
  const send = (type, payload) => act(() => mock.dockOptions.onAction({ type, payload }));
  send("welcome-appearance-change", { value: "plvs-light" });
  expect(mock.settings.setFixedThemeIdFromPicker).toHaveBeenCalledWith("plvs-light");
  send("welcome-appearance-change", { value: "system" });
  expect(mock.settings.setAppearanceMode).toHaveBeenCalledWith("system");
  send("welcome-interface-size-change", { value: "large" });
  expect(mock.settings.setInterfaceSize).toHaveBeenCalledWith("large");
  send("welcome-interface-size-change", { value: "invalid" });
  expect(mock.settings.setInterfaceSize).toHaveBeenCalledTimes(1);
  send("welcome-crash-report-change", { value: false });
  send("update-preferences-change", { patch: { autoCheck: false } });
  expect(mock.dockOptions.payload.preferences).toEqual({ autoCheck: false, autoDownload: false });
  expect(mock.settings.setUpdatePreferences).not.toHaveBeenCalled();
  send("update-preferences-save", {});
  await waitFor(() =>
    expect(mock.settings.setUpdatePreferences).toHaveBeenCalledWith({
      autoCheck: false,
      autoDownload: false,
    })
  );
  expect(mock.crashReportSetting.setEnabled).toHaveBeenCalledWith(false);
});
describe("update preferences development fixture", () => {
  const preferencesSurface = () =>
    mock.surfaces.filter((surface) => surface.target?.phase === "preferences").at(-1);
  function renderAfterChoice() {
    mock.settings.updatePreferences = { choiceMade: true };
    render(
      <BlockingEditorsProvider>
        <Harness />
      </BlockingEditorsProvider>
    );
    return mock.adapters.get("update-preferences.pending");
  }

  it("shows the first-run dialog after the choice was made and cancels without saving", () => {
    const adapter = renderAfterChoice();
    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
    expect(adapter.canEstablish()).toBe(true);
    act(() => adapter.establish("fixture-a"));
    expect(screen.getByRole("button", { name: "Continue" })).toBeTruthy();
    expect(mock.adapters.get("update-preferences.pending").matches("fixture-a")).toBe(true);
    expect(preferencesSurface().active).toBe(true);
    expect(mock.registry.activeBlockingEditors).toContain("updatePreferences");
    act(() => preferencesSurface().onCancel());
    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
    expect(mock.settings.setUpdatePreferences).not.toHaveBeenCalled();
  });

  it("resets only its own fixture and never saves", () => {
    const adapter = renderAfterChoice();
    act(() => adapter.establish("fixture-a"));
    act(() => mock.adapters.get("update-preferences.pending").reset("fixture-b"));
    expect(screen.getByRole("button", { name: "Continue" })).toBeTruthy();
    act(() => mock.adapters.get("update-preferences.pending").reset("fixture-a"));
    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
    expect(mock.settings.setUpdatePreferences).not.toHaveBeenCalled();
  });

  it("refuses to cover a real first-run choice", () => {
    render(
      <BlockingEditorsProvider>
        <Harness />
      </BlockingEditorsProvider>
    );
    expect(mock.adapters.get("update-preferences.pending").canEstablish()).toBe(false);
  });
});

it("shows a tutorial preview as an installed copy would, under its own fixture name", () => {
  mock.settings.updatePreferences = { choiceMade: true };
  mock.updateControls = {
    enabled: true,
    installationSupported: false,
    details: {
      origin: "fixture",
      staged: false,
      target: {
        id: "fixture-t",
        version: "0.21.1",
        preview: true,
        manifest: { notes: "- Fixes." },
      },
    },
    installStatus: "idle",
    dismissDetails: vi.fn(),
    confirmInstall: vi.fn(),
  };
  render(
    <BlockingEditorsProvider>
      <Harness />
    </BlockingEditorsProvider>
  );
  expect(screen.getByRole("button", { name: "Update and Restart" })).toBeTruthy();
  expect(
    mock.surfaces.some(
      (surface) => surface.active && surface.developmentFixture === "tutorial.update-available"
    )
  ).toBe(true);
});
