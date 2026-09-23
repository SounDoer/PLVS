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

describe("useInstanceIdentity", () => {
  beforeEach(() => {
    invoke.mockReset().mockResolvedValue("Spotify");
    setTitle.mockReset().mockResolvedValue(undefined);
    isVisible.mockReset().mockResolvedValue(true);
    isFocused.mockReset().mockResolvedValue(true);
    window.__PLVS_INITIAL_STATE__ = { agentControl: { appName: "PLVS Development" } };
  });

  afterEach(() => {
    delete window.__PLVS_INITIAL_STATE__;
  });

  it("publishes Source and runtime state and applies the coordinator display name", async () => {
    const { rerender } = renderHook(
      ({ sourceLabel, running }) => useInstanceIdentity({ sourceLabel, running }),
      { initialProps: { sourceLabel: "Spotify", running: false } }
    );

    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    expect(invoke).toHaveBeenLastCalledWith(
      "runtime_publish_instance_state",
      expect.objectContaining({ sourceLabel: "Spotify", captureStatus: "stopped", visible: true })
    );
    expect(setTitle).toHaveBeenCalledWith("PLVS Development — Spotify");

    rerender({ sourceLabel: "VLC", running: true });
    invoke.mockResolvedValue("VLC");
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    expect(invoke).toHaveBeenLastCalledWith(
      "runtime_publish_instance_state",
      expect.objectContaining({ sourceLabel: "VLC", captureStatus: "running" })
    );
  });
});
