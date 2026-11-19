/** @vitest-environment jsdom */
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRef } from "react";

const register = vi.fn();
const unregister = vi.fn();
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
const { loadShortcuts, saveShortcuts } = vi.hoisted(() => ({
  loadShortcuts: vi.fn(),
  saveShortcuts: vi.fn(),
}));

vi.mock("../ipc/env.js", () => ({ isTauri: () => true }));
vi.mock("../lib/shortcutPrefs.js", () => ({
  loadKeyboardShortcutPrefs: loadShortcuts,
  keyboardShortcutPrefsRevision: () => 4,
  saveKeyboardShortcutPrefs: saveShortcuts,
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
  loadShortcuts.mockReset();
  loadShortcuts.mockResolvedValue({
    toggleLiveCapture: { accelerator: "CmdOrCtrl+1", global: true },
    toggleLiveSnapshot: { accelerator: "CmdOrCtrl+2", global: false },
    clear: { accelerator: "CmdOrCtrl+3", global: true },
  });
  saveShortcuts.mockReset();
  saveShortcuts.mockResolvedValue(5);
  delete window.__PLVS_INITIAL_STATE__;
  setCoordinatorRole(undefined);
});

afterEach(async () => {
  await act(async () => cleanup());
});

function mockNativeShortcuts() {
  const bindings = new Map();
  register.mockImplementation(async (key, handler) => {
    if (bindings.has(key)) throw new Error("Already registered");
    bindings.set(key, handler);
  });
  unregister.mockImplementation(async (key) => {
    bindings.delete(key);
  });
  return bindings;
}

describe("useKeyboardShortcuts", () => {
  it("keeps the whole binding on a reset conflict and saves both fields after it is resolved", async () => {
    loadShortcuts.mockResolvedValue({
      toggleLiveCapture: { accelerator: "CmdOrCtrl+3", global: false },
      toggleLiveSnapshot: { accelerator: "CmdOrCtrl+2", global: false },
      clear: { accelerator: "CmdOrCtrl+Alt+K", global: true },
    });
    render(<Harness dispatch={vi.fn()} />);
    await waitFor(() => expect(latest.shortcutsReady).toBe(true));

    await act(async () => latest.resetShortcut("clear"));
    expect(saveShortcuts).not.toHaveBeenCalled();
    expect(latest.shortcutSaveErrors.clear).toBe("Used by Start / Stop");
    expect(latest.keyboardShortcuts.clear).toEqual({
      accelerator: "CmdOrCtrl+Alt+K",
      global: true,
    });

    await act(async () => latest.setShortcutAccelerator("toggleLiveCapture", "CmdOrCtrl+1"));
    saveShortcuts.mockClear();
    await act(async () => latest.resetShortcut("clear"));
    expect(saveShortcuts).toHaveBeenCalledOnce();
    expect(saveShortcuts.mock.calls[0][0].clear).toEqual({
      accelerator: "CmdOrCtrl+3",
      global: false,
    });
    expect(latest.shortcutSaveErrors.clear).toBeUndefined();
  });

  it("saves a former default as an explicit binding", async () => {
    render(<Harness dispatch={vi.fn()} />);
    await waitFor(() => expect(latest.shortcutsReady).toBe(true));
    await act(async () => latest.setShortcutAccelerator("clear", "CmdOrCtrl+K"));
    expect(latest.keyboardShortcuts.clear.accelerator).toBe("CmdOrCtrl+K");
    expect(saveShortcuts.mock.calls[0][0].clear.accelerator).toBe("CmdOrCtrl+K");
  });

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
    saveShortcuts.mockRejectedValueOnce(new Error("revision conflict"));

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

  it("reroutes already registered keys when another workbench swaps two bindings", async () => {
    const bindings = mockNativeShortcuts();
    const dispatch = vi.fn();
    render(<Harness dispatch={dispatch} />);
    await waitFor(() => expect(bindings.size).toBe(2));
    const original = latest.keyboardShortcuts;
    loadShortcuts.mockResolvedValue({
      ...original,
      clear: original.toggleLiveCapture,
      toggleLiveCapture: original.clear,
    });
    await act(async () => window.dispatchEvent(new Event("plvs-global-preferences-changed")));

    expect(latest.keyboardShortcuts.clear.accelerator).toBe("CmdOrCtrl+1");
    await act(async () => {
      bindings.get("CmdOrCtrl+1")({ state: "Pressed" });
      bindings.get("CmdOrCtrl+3")({ state: "Pressed" });
    });
    expect(dispatch.mock.calls).toEqual([["clear"], ["toggleLiveCapture"]]);
    expect(register).toHaveBeenCalledTimes(2);
    expect(unregister).not.toHaveBeenCalled();
  });

  it("registers unaffected bindings when another accelerator is unavailable", async () => {
    const bindings = mockNativeShortcuts();
    register.mockRejectedValueOnce(new Error("Already registered"));
    render(<Harness dispatch={vi.fn()} />);

    await waitFor(() => expect(bindings.has("CmdOrCtrl+3")).toBe(true));
    expect(latest.shortcutRegistrationErrors).toEqual({
      toggleLiveCapture: "Already registered",
    });
  });

  it("leaves saved native bindings in place when a new control binding is unavailable", async () => {
    const bindings = mockNativeShortcuts();
    render(<Harness dispatch={vi.fn()} />);
    await waitFor(() => expect(bindings.size).toBe(2));
    register.mockRejectedValueOnce(new Error("Taken by another application"));

    await expect(
      latest.applyKeyboardShortcutsForControl({
        ...latest.keyboardShortcuts,
        clear: { accelerator: "CmdOrCtrl+Alt+K", global: true },
      })
    ).rejects.toThrow("Taken by another application");

    expect(bindings.has("CmdOrCtrl+3")).toBe(true);
    expect(unregister).not.toHaveBeenCalled();
    expect(saveShortcuts).not.toHaveBeenCalled();
  });

  it("disables an unsaved key and reports a failed rollback when the old key cannot be recovered", async () => {
    const bindings = mockNativeShortcuts();
    const dispatch = vi.fn();
    render(<Harness dispatch={dispatch} />);
    await waitFor(() => expect(bindings.size).toBe(2));
    const original = latest.keyboardShortcuts;
    const registerNative = register.getMockImplementation();
    register.mockImplementation(async (key, handler) => {
      if (key === "CmdOrCtrl+3") throw new Error("Taken by another application");
      return registerNative(key, handler);
    });
    saveShortcuts.mockImplementationOnce(async () => {
      // The native shortcut is installed, but until it is saved it must not dispatch.
      bindings.get("CmdOrCtrl+Alt+K")({ state: "Pressed" });
      throw new Error("Revision conflict");
    });

    await act(async () => {
      await expect(
        latest.applyKeyboardShortcutsForControl({
          ...original,
          clear: { accelerator: "CmdOrCtrl+Alt+K", global: true },
        })
      ).rejects.toMatchObject({ partial: true, rollback: "failed" });
    });

    expect(dispatch).not.toHaveBeenCalled();
    expect([...bindings.keys()]).toEqual(["CmdOrCtrl+1"]);
    expect(latest.keyboardShortcuts.clear.accelerator).toBe("CmdOrCtrl+3");
    expect(latest.shortcutRegistrationErrors.clear).toBe("Taken by another application");

    register.mockImplementation(registerNative);
    loadShortcuts.mockResolvedValue({ ...original });
    await act(async () => window.dispatchEvent(new Event("plvs-global-preferences-changed")));
    expect(bindings.has("CmdOrCtrl+3")).toBe(true);
    expect(latest.shortcutRegistrationErrors).toEqual({});
  });

  it("serializes successive GUI edits against the last saved revision", async () => {
    let resolveFirst;
    saveShortcuts
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirst = resolve;
        })
      )
      .mockResolvedValueOnce(6);
    render(<Harness dispatch={vi.fn()} />);
    await waitFor(() => expect(latest.shortcutsReady).toBe(true));

    act(() => {
      latest.setShortcutAccelerator("clear", "CmdOrCtrl+9");
      latest.setShortcutGlobal("toggleLiveSnapshot", true);
    });
    await waitFor(() => expect(saveShortcuts).toHaveBeenCalledOnce());
    expect(saveShortcuts.mock.calls[0][1]).toBe(4);
    expect(latest.keyboardShortcuts.clear.accelerator).toBe("CmdOrCtrl+3");
    await act(async () => resolveFirst(5));

    expect(saveShortcuts).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        clear: { accelerator: "CmdOrCtrl+9", global: true },
        toggleLiveSnapshot: { accelerator: "CmdOrCtrl+2", global: true },
      }),
      5
    );
    expect(latest.keyboardShortcuts.toggleLiveSnapshot.global).toBe(true);
  });

  it("keeps the saved binding and reports a conflict on the affected row", async () => {
    saveShortcuts.mockRejectedValueOnce({ reason: "conflict" }).mockResolvedValueOnce(5);
    render(<Harness dispatch={vi.fn()} />);
    await waitFor(() => expect(latest.shortcutsReady).toBe(true));
    await act(() => latest.setShortcutGlobal("toggleLiveSnapshot", true));
    expect(latest.keyboardShortcuts.toggleLiveSnapshot.global).toBe(false);
    expect(latest.shortcutSaveErrors.toggleLiveSnapshot).toMatch(/another workbench/);
    await act(() => latest.setShortcutGlobal("toggleLiveSnapshot", true));
    expect(latest.keyboardShortcuts.toggleLiveSnapshot.global).toBe(true);
    expect(latest.shortcutSaveErrors).toEqual({});
  });
});
