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

function deferred() {
  /** @type {(value?: any) => void} */
  let resolve;
  const promise = new Promise((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

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

  it("does not present configuration actions as busy while the save dialog is open", async () => {
    mocks.isTauri.mockReturnValue(true);
    mocks.exportProfile.mockResolvedValue({
      app: "PLVS",
      kind: "configuration-profile",
      version: 1,
    });
    const saveDialog = deferred();
    mocks.saveConfigurationProfileFile.mockReturnValue(saveDialog.promise);
    const { result } = renderHook(() => useConfigurationProfileActions());

    let operation;
    await act(async () => {
      operation = result.current.exportConfiguration();
      await Promise.resolve();
    });

    expect(result.current.configurationBusy).toBe(false);

    await act(async () => {
      saveDialog.resolve(null);
      await operation;
    });
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

  it("becomes busy only after the import dialog returns a file", async () => {
    mocks.isTauri.mockReturnValue(true);
    const picker = deferred();
    const reader = deferred();
    mocks.pickConfigurationProfileFile.mockReturnValue(picker.promise);
    mocks.readProfileFile.mockReturnValue(reader.promise);
    const { result } = renderHook(() => useConfigurationProfileActions());

    let operation;
    act(() => {
      operation = result.current.importConfiguration();
    });
    expect(result.current.configurationBusy).toBe(false);

    await act(async () => {
      picker.resolve("C:\\profile.plvsconfig");
      await Promise.resolve();
    });
    expect(result.current.configurationBusy).toBe(true);

    await act(async () => {
      reader.resolve('{"app":"PLVS","kind":"configuration-profile"}');
      await operation;
    });
    expect(result.current.configurationBusy).toBe(false);
  });

  it("reports a coordinated reload failure as an import failure", async () => {
    mocks.isTauri.mockReturnValue(true);
    mocks.pickConfigurationProfileFile.mockResolvedValue("C:\\profile.plvsconfig");
    mocks.readProfileFile.mockResolvedValue('{"app":"PLVS","kind":"configuration-profile"}');
    mocks.importProfile.mockResolvedValue(undefined);
    mocks.reloadAfterProfileChange.mockRejectedValue(new Error("peer failed"));
    const { result } = renderHook(() => useConfigurationProfileActions());

    await act(async () => {
      await result.current.importConfiguration();
    });

    expect(result.current.configurationStatus).toBe("Import failed");
    expect(result.current.configurationBusy).toBe(false);
  });
});
