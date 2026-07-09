/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useConfigurationProfileActions } from "./useConfigurationProfileActions.js";

const mocks = vi.hoisted(() => ({
  isTauri: vi.fn(() => false),
  exportProfile: vi.fn(),
  importProfile: vi.fn(),
  resetProfile: vi.fn(),
  reloadAfterProfileChange: vi.fn(),
  pickConfigurationProfileFile: vi.fn(),
  saveConfigurationProfileFile: vi.fn(),
  readProfileFile: vi.fn(),
  writeProfileFile: vi.fn(),
}));

vi.mock("../ipc/env.js", () => ({ isTauri: mocks.isTauri }));
vi.mock("../ipc/fileDialog.js", () => ({
  pickConfigurationProfileFile: mocks.pickConfigurationProfileFile,
  saveConfigurationProfileFile: mocks.saveConfigurationProfileFile,
}));
vi.mock("../ipc/commands.js", () => ({
  readProfileFile: mocks.readProfileFile,
  writeProfileFile: mocks.writeProfileFile,
}));
vi.mock("../persistence/profile.js", () => ({
  exportProfile: mocks.exportProfile,
  importProfile: mocks.importProfile,
  reloadAfterProfileChange: mocks.reloadAfterProfileChange,
  resetProfile: mocks.resetProfile,
}));

describe("useConfigurationProfileActions", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset?.();
    mocks.isTauri.mockReturnValue(false);
  });

  it("exports a desktop profile to the selected file", async () => {
    mocks.isTauri.mockReturnValue(true);
    mocks.exportProfile.mockResolvedValue({
      app: "PLVS",
      kind: "configuration-profile",
      version: 1,
      settings: { referenceLufs: -18 },
    });
    mocks.saveConfigurationProfileFile.mockResolvedValue("C:\\profile.plvsconfig");
    mocks.writeProfileFile.mockResolvedValue(undefined);
    const { result } = renderHook(() => useConfigurationProfileActions());

    await act(async () => {
      await result.current.exportConfiguration();
    });

    expect(mocks.saveConfigurationProfileFile).toHaveBeenCalledWith(
      "plvs-configuration.plvsconfig"
    );
    expect(mocks.writeProfileFile).toHaveBeenCalledWith(
      "C:\\profile.plvsconfig",
      expect.stringContaining('"referenceLufs": -18')
    );
    expect(result.current.configurationStatus).toBe("Configuration exported");
    expect(result.current.configurationBusy).toBe(false);
  });

  it("reports import as desktop-only outside Tauri", async () => {
    const { result } = renderHook(() => useConfigurationProfileActions());

    await act(async () => {
      await result.current.importConfiguration();
    });

    expect(result.current.configurationStatus).toBe("Import is available in the desktop app");
    expect(result.current.configurationBusy).toBe(false);
  });

  it("imports a selected desktop profile and reloads", async () => {
    mocks.isTauri.mockReturnValue(true);
    mocks.pickConfigurationProfileFile.mockResolvedValue("C:\\profile.plvsconfig");
    mocks.readProfileFile.mockResolvedValue('{"app":"PLVS","kind":"configuration-profile"}');
    mocks.importProfile.mockResolvedValue(undefined);
    const { result } = renderHook(() => useConfigurationProfileActions());

    await act(async () => {
      await result.current.importConfiguration();
    });

    await waitFor(() => {
      expect(mocks.importProfile).toHaveBeenCalledWith({
        app: "PLVS",
        kind: "configuration-profile",
      });
      expect(mocks.reloadAfterProfileChange).toHaveBeenCalledTimes(1);
      expect(result.current.configurationBusy).toBe(false);
    });
  });
});
