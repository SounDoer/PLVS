import { expect, it, vi } from "vitest";
import { dockFrequencyViewport } from "./dockFrequencyViewport.js";
import { normalizeDockModuleControls, dockSettingsTab } from "./dockModuleControls.js";
it.each(["spectrum", "spectrogram", "stereoMap"])(
  "routes %s linked gestures to shared frequency and unlinks without jumping",
  (module) => {
    const controls = normalizeDockModuleControls(module, {});
    const shared = { min: 80, max: 8000 };
    const updateShared = vi.fn();
    const updateLocal = vi.fn();
    const view = dockFrequencyViewport(
      dockSettingsTab(module),
      controls,
      shared,
      updateShared,
      updateLocal
    );
    expect(view.axisViewports.frequency).toEqual({ ...shared, linked: true });
    view.setAxisViewportRange("frequency", 100, 10000);
    expect(updateShared).toHaveBeenCalledWith({ min: 100, max: 10000 });
    expect(updateLocal).not.toHaveBeenCalled();
    view.setAxisViewportLinked("frequency", false);
    const detached = updateLocal.mock.calls[0][0];
    const localView = dockFrequencyViewport(
      dockSettingsTab(module),
      detached,
      { min: 20, max: 20000 },
      updateShared,
      updateLocal
    );
    expect(localView.axisViewports.frequency).toEqual({ ...shared, linked: false });
    updateShared.mockClear();
    localView.setAxisViewportRange("frequency", 200, 2000);
    expect(updateShared).not.toHaveBeenCalled();
    expect(
      dockFrequencyViewport(dockSettingsTab(module), updateLocal.mock.calls.at(-1)[0], shared)
        .axisViewports.frequency
    ).toEqual({ min: 200, max: 2000, linked: false });
  }
);
