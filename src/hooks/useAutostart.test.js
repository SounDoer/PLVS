/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

vi.mock("../ipc/env.js", () => ({ isTauri: vi.fn(() => false) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { isTauri } from "../ipc/env.js";
import { invoke } from "@tauri-apps/api/core";
import { useAutostart } from "./useAutostart.js";
import { setCoordinatorRole } from "../lib/runtimeRole.js";

describe("useAutostart", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isTauri).mockReturnValue(false);
    delete window.__PLVS_INITIAL_STATE__;
    setCoordinatorRole(undefined);
  });

  it("is not ready and disabled in non-Tauri environment", () => {
    const { result } = renderHook(() => useAutostart());
    expect(result.current.autostartReady).toBe(false);
    expect(result.current.autostartEnabled).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("reads current autostart state on mount in Tauri environment", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(invoke).mockResolvedValue(true);
    const { result } = renderHook(() => useAutostart());
    await waitFor(() => expect(result.current.autostartReady).toBe(true));
    expect(result.current.autostartEnabled).toBe(true);
    expect(invoke).toHaveBeenCalledWith("plugin:autostart|is_enabled");
  });

  it("calls enable command and updates state when toggled on", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(invoke).mockResolvedValueOnce(false);
    vi.mocked(invoke).mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutostart());
    await waitFor(() => expect(result.current.autostartReady).toBe(true));
    await act(async () => {
      await result.current.setAutostartEnabled(true);
    });
    expect(invoke).toHaveBeenCalledWith("plugin:autostart|enable");
    expect(result.current.autostartEnabled).toBe(true);
  });

  it("calls disable command and updates state when toggled off", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(invoke).mockResolvedValueOnce(true);
    vi.mocked(invoke).mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutostart());
    await waitFor(() => expect(result.current.autostartReady).toBe(true));
    await act(async () => {
      await result.current.setAutostartEnabled(false);
    });
    expect(invoke).toHaveBeenCalledWith("plugin:autostart|disable");
    expect(result.current.autostartEnabled).toBe(false);
  });

  it("stays not ready when is_enabled call rejects", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(invoke).mockRejectedValue(new Error("unavailable"));
    const { result } = renderHook(() => useAutostart());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(result.current.autostartReady).toBe(false);
  });

  it("lets a participant update the shared preference without owning the OS registration", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    window.__PLVS_INITIAL_STATE__ = {
      isCoordinator: false,
      globalPreferences: { openAtLogin: false },
      multiInstancePersistence: { globalPreferenceRevisions: { openAtLogin: 3 } },
    };
    vi.mocked(invoke).mockResolvedValueOnce({ openAtLogin: 4 });
    const { result } = renderHook(() => useAutostart());
    await waitFor(() => expect(result.current.autostartReady).toBe(true));

    await act(async () => result.current.setAutostartEnabledForControl(true));

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("persistence_save_global_preferences", {
      values: { openAtLogin: true },
      expectedRevisions: { openAtLogin: 3 },
    });
    expect(result.current.autostartEnabled).toBe(true);
  });

  it("applies the shared preference after this process becomes coordinator", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    window.__PLVS_INITIAL_STATE__ = {
      isCoordinator: false,
      globalPreferences: { openAtLogin: true },
      multiInstancePersistence: { globalPreferenceRevisions: { openAtLogin: 1 } },
    };
    const { result } = renderHook(() => useAutostart());
    await waitFor(() => expect(result.current.autostartReady).toBe(true));
    expect(invoke).not.toHaveBeenCalled();

    vi.mocked(invoke).mockResolvedValue(false);
    act(() => setCoordinatorRole(true));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("plugin:autostart|enable"));
  });
});
