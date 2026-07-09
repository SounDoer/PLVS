/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCliPathSettings } from "./useCliPathSettings.js";

const mocks = vi.hoisted(() => ({
  isTauri: vi.fn(() => false),
  cliPathStatusCommand: vi.fn(),
  setCliPathEnabledCommand: vi.fn(),
}));

vi.mock("../ipc/env.js", () => ({ isTauri: mocks.isTauri }));
vi.mock("../ipc/commands.js", () => ({
  cliPathStatusCommand: mocks.cliPathStatusCommand,
  setCliPathEnabledCommand: mocks.setCliPathEnabledCommand,
}));

describe("useCliPathSettings", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.isTauri.mockReturnValue(false);
  });

  it("does not query CLI path status outside Tauri", () => {
    renderHook(() => useCliPathSettings({ settingsOpen: true }));

    expect(mocks.cliPathStatusCommand).not.toHaveBeenCalled();
  });

  it("queries CLI path status when settings open in Tauri", async () => {
    mocks.isTauri.mockReturnValue(true);
    mocks.cliPathStatusCommand.mockResolvedValue({
      supported: true,
      installed: true,
      onPath: false,
      message: "Ready",
    });

    const { result } = renderHook(() => useCliPathSettings({ settingsOpen: true }));

    await waitFor(() => {
      expect(result.current.cliPathStatus).toEqual({
        supported: true,
        installed: true,
        onPath: false,
        message: "Ready",
      });
    });
  });

  it("updates CLI PATH state through the command", async () => {
    mocks.isTauri.mockReturnValue(true);
    mocks.setCliPathEnabledCommand.mockResolvedValue({
      supported: true,
      installed: true,
      onPath: true,
      message: "Updated",
    });
    const { result } = renderHook(() => useCliPathSettings({ settingsOpen: false }));

    await act(async () => {
      await result.current.setCliPathEnabled(true);
    });

    expect(mocks.setCliPathEnabledCommand).toHaveBeenCalledWith(true);
    expect(result.current.cliPathStatus?.message).toBe("Updated");
    expect(result.current.cliPathBusy).toBe(false);
  });

  it("reports a failed PATH update without dropping existing status", async () => {
    mocks.isTauri.mockReturnValue(true);
    mocks.setCliPathEnabledCommand.mockRejectedValue(new Error("nope"));
    const { result } = renderHook(() => useCliPathSettings({ settingsOpen: false }));

    await act(async () => {
      await result.current.setCliPathEnabled(false);
    });

    expect(result.current.cliPathStatus).toEqual({
      supported: true,
      installed: false,
      onPath: false,
      message: "PATH update failed.",
    });
  });
});
