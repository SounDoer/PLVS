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
    window.__PLVS_INITIAL_STATE__ = { agentControl: { appName: "PLVS Development" } };
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
    expect(setTitle).toHaveBeenCalledWith("PLVS Development — Spotify");
    expect(ownsCoordinatorResources()).toBe(false);

    rerender({ sourceLabel: "VLC", running: true });
    invoke.mockResolvedValue({ displayName: "VLC", isCoordinator: true });
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    expect(invoke).toHaveBeenLastCalledWith("runtime_publish_instance_state", {
      update: expect.objectContaining({ sourceLabel: "VLC", captureStatus: "running" }),
    });
    await waitFor(() => expect(ownsCoordinatorResources()).toBe(true));
  });
});
