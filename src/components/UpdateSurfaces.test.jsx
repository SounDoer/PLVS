/** @vitest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BlockingEditorsProvider, useBlockingEditors } from "../hooks/BlockingEditorsContext.jsx";
import { UpdateSurfaces } from "./UpdateSurfaces.jsx";

const mock = vi.hoisted(() => ({
  settings: { updatePreferences: { choiceMade: false }, setUpdatePreferences: vi.fn() },
  docked: false,
  windowError: null,
  exitDock: vi.fn(async () => ({ ok: true })),
  registry: null,
  adapters: new Map(),
  surfaces: [],
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
    updateControls: {
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
  useDockUpdateWindow: () => ({ error: mock.windowError }),
}));
function Harness() {
  mock.registry = useBlockingEditors();
  return <UpdateSurfaces currentVersion="0.21.0" />;
}
beforeEach(() => {
  mock.settings.setUpdatePreferences.mockReset();
  mock.settings.updatePreferences = { choiceMade: false };
  mock.adapters.clear();
  mock.surfaces = [];
  mock.docked = false;
  mock.windowError = null;
  mock.exitDock.mockClear();
});
describe("first-launch update choice", () => {
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
  it("Skip explicitly saves both automatic options off", async () => {
    render(
      <BlockingEditorsProvider>
        <Harness />
      </BlockingEditorsProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    await waitFor(() =>
      expect(mock.settings.setUpdatePreferences).toHaveBeenCalledWith({
        autoCheck: false,
        autoDownload: false,
      })
    );
  });
  it("defaults to checking on and downloading off and retains a failed save", async () => {
    mock.settings.setUpdatePreferences.mockRejectedValue(new Error("Save failed"));
    render(
      <BlockingEditorsProvider>
        <Harness />
      </BlockingEditorsProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(mock.settings.setUpdatePreferences).toHaveBeenCalledWith({
      autoCheck: true,
      autoDownload: false,
    });
    expect((await screen.findByRole("alert")).textContent).toContain("Save failed");
    expect(mock.registry.activeBlockingEditors).toContain("updatePreferences");
  });
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
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(adapter.canEstablish()).toBe(true);
    act(() => adapter.establish("fixture-a"));
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
    expect(mock.adapters.get("update-preferences.pending").matches("fixture-a")).toBe(true);
    expect(preferencesSurface().active).toBe(true);
    expect(mock.registry.activeBlockingEditors).toContain("updatePreferences");
    act(() => preferencesSurface().onCancel());
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(mock.settings.setUpdatePreferences).not.toHaveBeenCalled();
  });

  it("resets only its own fixture and never saves", () => {
    const adapter = renderAfterChoice();
    act(() => adapter.establish("fixture-a"));
    act(() => mock.adapters.get("update-preferences.pending").reset("fixture-b"));
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
    act(() => mock.adapters.get("update-preferences.pending").reset("fixture-a"));
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
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
