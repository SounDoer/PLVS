/** @vitest-environment jsdom */
import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRef } from "react";

const register = vi.fn();
const unregister = vi.fn();
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
const { saveForControl } = vi.hoisted(() => ({ saveForControl: vi.fn() }));

vi.mock("../ipc/env.js", () => ({ isTauri: () => true }));
vi.mock("../lib/shortcutPrefs.js", () => ({
  loadKeyboardShortcutPrefs: () =>
    Promise.resolve({
      toggleLiveCapture: { accelerator: "CmdOrCtrl+1", global: true },
      toggleLiveSnapshot: { accelerator: "CmdOrCtrl+2", global: false },
      clear: { accelerator: "CmdOrCtrl+3", global: true },
    }),
  saveKeyboardShortcutPrefs: () => Promise.resolve(),
  saveKeyboardShortcutPrefsForControl: saveForControl,
}));
vi.mock("@tauri-apps/plugin-global-shortcut", () => ({ register, unregister }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { setCoordinatorRole } from "../lib/runtimeRole.js";
import { useKeyboardShortcuts } from "./useKeyboardShortcuts.js";

let latest;
function Harness({ dispatch }) {
  const ref = useRef(dispatch);
  ref.current = dispatch;
  latest = useKeyboardShortcuts(ref);
  return null;
}

beforeEach(() => {
  register.mockReset();
  unregister.mockReset();
  register.mockResolvedValue(undefined);
  unregister.mockResolvedValue(undefined);
  invoke.mockReset();
  invoke.mockResolvedValue(false);
  saveForControl.mockReset();
  saveForControl.mockResolvedValue(undefined);
  delete window.__PLVS_INITIAL_STATE__;
  setCoordinatorRole(undefined);
});

describe("useKeyboardShortcuts", () => {
  it("registers every requested global action and routes its action id", async () => {
    const dispatch = vi.fn();
    render(<Harness dispatch={dispatch} />);

    await waitFor(() => expect(register).toHaveBeenCalledTimes(2));
    const clearCall = register.mock.calls.find(([accelerator]) => accelerator === "CmdOrCtrl+3");
    clearCall[1]({ state: "Pressed" });

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("runtime_route_global_shortcut", {
        actionId: "clear",
      })
    );
    expect(dispatch).toHaveBeenCalledWith("clear");
  });

  it("does not dispatch locally when native routing selected a participant", async () => {
    invoke.mockResolvedValue(true);
    const dispatch = vi.fn();
    render(<Harness dispatch={dispatch} />);
    await waitFor(() => expect(register).toHaveBeenCalledTimes(2));

    register.mock.calls[0][1]({ state: "Pressed" });
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("suspends all global actions while capturing and restores them", async () => {
    render(<Harness dispatch={vi.fn()} />);
    await waitFor(() => expect(register).toHaveBeenCalledTimes(2));

    await act(async () => latest.setShortcutCapturing(true));
    await waitFor(() => expect(unregister).toHaveBeenCalledTimes(2));

    register.mockClear();
    await act(async () => latest.setShortcutCapturing(false));
    await waitFor(() => expect(register).toHaveBeenCalledTimes(2));
  });

  it("keeps participant instances registration-free until promotion", async () => {
    window.__PLVS_INITIAL_STATE__ = { isCoordinator: false };
    render(<Harness dispatch={vi.fn()} />);
    await waitFor(() => expect(latest.shortcutsReady).toBe(true));
    expect(register).not.toHaveBeenCalled();

    act(() => setCoordinatorRole(true));
    await waitFor(() => expect(register).toHaveBeenCalledTimes(2));
  });

  it("releases every registration on coordinator demotion", async () => {
    render(<Harness dispatch={vi.fn()} />);
    await waitFor(() => expect(register).toHaveBeenCalledTimes(2));

    act(() => setCoordinatorRole(false));
    await waitFor(() => expect(unregister).toHaveBeenCalledTimes(2));
  });

  it("restores registrations when an atomic control save fails", async () => {
    render(<Harness dispatch={vi.fn()} />);
    await waitFor(() => expect(register).toHaveBeenCalledTimes(2));
    register.mockClear();
    unregister.mockClear();
    saveForControl.mockRejectedValueOnce(new Error("revision conflict"));

    await expect(
      latest.applyKeyboardShortcutsForControl({
        ...latest.keyboardShortcuts,
        clear: { accelerator: "CmdOrCtrl+Alt+K", global: true },
      })
    ).rejects.toThrow("revision conflict");

    expect(register).toHaveBeenCalledWith("CmdOrCtrl+Alt+K", expect.any(Function));
    expect(unregister).toHaveBeenCalledWith("CmdOrCtrl+3");
    expect(unregister).toHaveBeenCalledWith("CmdOrCtrl+Alt+K");
    expect(register).toHaveBeenCalledWith("CmdOrCtrl+3", expect.any(Function));
    expect(latest.keyboardShortcuts.clear.accelerator).toBe("CmdOrCtrl+3");
  });
});
