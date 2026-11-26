/** @vitest-environment jsdom */
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invoke, setTitle, isVisible, isFocused } = vi.hoisted(() => ({
  invoke: vi.fn(),
  setTitle: vi.fn(),
  isVisible: vi.fn(),
  isFocused: vi.fn(),
}));

vi.mock("../ipc/env.js", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ setTitle, isVisible, isFocused }),
}));

import { useInstanceIdentity } from "./useInstanceIdentity.js";
import { ownsCoordinatorResources, setCoordinatorRole } from "../lib/runtimeRole.js";

describe("useInstanceIdentity", () => {
  beforeEach(() => {
    invoke.mockReset().mockResolvedValue({ displayName: "Spotify", isCoordinator: false });
    setTitle.mockReset().mockResolvedValue(undefined);
    isVisible.mockReset().mockResolvedValue(true);
    isFocused.mockReset().mockResolvedValue(true);
    window.__PLVS_INITIAL_STATE__ = { agentControl: { appName: "PLVS Dev" } };
    setCoordinatorRole(false);
  });

  afterEach(() => {
    delete window.__PLVS_INITIAL_STATE__;
    setCoordinatorRole(undefined);
  });

  it("publishes Source and runtime state and applies the coordinator display name", async () => {
    const { rerender } = renderHook(
      ({ sourceLabel, running }) => useInstanceIdentity({ sourceLabel, running }),
      { initialProps: { sourceLabel: "Spotify", running: false } }
    );

    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    expect(invoke).toHaveBeenLastCalledWith("runtime_publish_instance_state", {
      update: expect.objectContaining({
        sourceLabel: "Spotify",
        captureStatus: "stopped",
        visible: true,
      }),
    });
    expect(setTitle).toHaveBeenCalledWith("PLVS Dev — Spotify");
    expect(ownsCoordinatorResources()).toBe(false);

    rerender({ sourceLabel: "VLC", running: true });
    invoke.mockResolvedValue({ displayName: "VLC", isCoordinator: true });
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    expect(invoke).toHaveBeenLastCalledWith("runtime_publish_instance_state", {
      update: expect.objectContaining({ sourceLabel: "VLC", captureStatus: "running" }),
    });
    await waitFor(() => expect(ownsCoordinatorResources()).toBe(true));
  });

  it("waits for an in-flight heartbeat and publishes the current visibility before returning", async () => {
    /** @type {(state: { displayName: string, isCoordinator: boolean }) => void} */
    let finishHeartbeat = () => {
      throw new Error("The heartbeat has not started.");
    };
    invoke.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishHeartbeat = resolve;
        })
    );
    const { result } = renderHook(() =>
      useInstanceIdentity({ sourceLabel: "VLC", running: false })
    );
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));

    isVisible.mockResolvedValue(false);
    const published = vi.fn();
    const publishHidden = result.current().then(published);
    await Promise.resolve();
    expect(published).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledTimes(1);

    finishHeartbeat({ displayName: "VLC", isCoordinator: false });
    await publishHidden;
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke).toHaveBeenLastCalledWith("runtime_publish_instance_state", {
      update: expect.objectContaining({ visible: false }),
    });
    expect(published).toHaveBeenCalledOnce();

    isVisible.mockResolvedValue(true);
    await result.current();
    expect(invoke).toHaveBeenCalledTimes(3);
    expect(invoke).toHaveBeenLastCalledWith("runtime_publish_instance_state", {
      update: expect.objectContaining({ visible: true }),
    });
  });

  it("publishes workbench menu state without losing its last focus when that state changes", async () => {
    const { rerender } = renderHook(
      ({ trayState }) =>
        useInstanceIdentity({
          sourceLabel: "VLC",
          running: false,
          trayState,
        }),
      { initialProps: { trayState: { safeAudioDeviceId: "default" } } }
    );
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    const focus = invoke.mock.calls[0][1].update.focusSequence;
    isFocused.mockResolvedValue(false);
    rerender({ trayState: { safeAudioDeviceId: "peer-output" } });
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    expect(invoke.mock.calls[1][1].update).toMatchObject({
      focusSequence: focus,
      trayState: { safeAudioDeviceId: "peer-output" },
    });
  });
});
