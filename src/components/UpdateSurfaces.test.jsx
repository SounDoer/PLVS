/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BlockingEditorsProvider, useBlockingEditors } from "../hooks/BlockingEditorsContext.jsx";
import { UpdateSurfaces } from "./UpdateSurfaces.jsx";

const mock = vi.hoisted(() => ({
  settings: { updatePreferences: { choiceMade: false }, setUpdatePreferences: vi.fn() },
  docked: false,
  registry: null,
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
  useDock: () => ({ docked: mock.docked, dockEdge: "bottom" }),
}));
vi.mock("../dock/DockAccessoriesContext.jsx", () => ({
  useDockAccessories: () => ({ setUpdateGeometry: vi.fn() }),
}));
vi.mock("../dock/useDockUpdateWindow.js", () => ({ useDockUpdateWindow: () => ({ error: null }) }));
function Harness() {
  mock.registry = useBlockingEditors();
  return <UpdateSurfaces currentVersion="0.21.0" />;
}
beforeEach(() => {
  mock.settings.setUpdatePreferences.mockReset();
  mock.docked = false;
});
describe("first-launch update choice", () => {
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
    fireEvent.click(screen.getByRole("button", { name: "Save Preferences" }));
    expect(mock.settings.setUpdatePreferences).toHaveBeenCalledWith({
      autoCheck: true,
      autoDownload: false,
    });
    expect((await screen.findByRole("alert")).textContent).toContain("Save failed");
    expect(mock.registry.activeBlockingEditors).toContain("updatePreferences");
  });
});
