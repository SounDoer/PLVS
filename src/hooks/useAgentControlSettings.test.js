/** @vitest-environment jsdom */
import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  agentControlStatusCommand: vi.fn(),
  setAgentControlEnabledCommand: vi.fn(),
  isTauri: vi.fn(() => true),
}));

vi.mock("../ipc/commands.js", () => ({
  agentControlStatusCommand: mocks.agentControlStatusCommand,
  setAgentControlEnabledCommand: mocks.setAgentControlEnabledCommand,
}));
vi.mock("../ipc/env.js", () => ({ isTauri: mocks.isTauri }));

import { useAgentControlSettings } from "./useAgentControlSettings.js";

const READY = {
  supported: true,
  enabled: false,
  cliInstalled: true,
  onPath: false,
  message: "Allows programs on this machine to control PLVS through plvs-cli.",
};

describe("useAgentControlSettings", () => {
  beforeEach(() => {
    mocks.agentControlStatusCommand.mockReset().mockResolvedValue(READY);
    mocks.setAgentControlEnabledCommand.mockReset();
  });

  it("reads status when settings open", async () => {
    const { result } = renderHook(() => useAgentControlSettings({ settingsOpen: true }));
    await waitFor(() => expect(result.current.agentControlStatus).toEqual(READY));
  });

  it("does not read status while settings are closed", () => {
    renderHook(() => useAgentControlSettings({ settingsOpen: false }));
    expect(mocks.agentControlStatusCommand).not.toHaveBeenCalled();
  });

  it("adopts and returns the status the setter settles on", async () => {
    const enabled = { ...READY, enabled: true, onPath: true, message: "on" };
    mocks.setAgentControlEnabledCommand.mockResolvedValue(enabled);
    const { result } = renderHook(() => useAgentControlSettings({ settingsOpen: true }));
    await waitFor(() => expect(result.current.agentControlStatus).toEqual(READY));

    let settled;
    await act(async () => {
      settled = await result.current.setAgentControlEnabled(true);
    });
    expect(mocks.setAgentControlEnabledCommand).toHaveBeenCalledWith(true);
    expect(result.current.agentControlStatus).toEqual(enabled);
    expect(settled).toEqual(enabled);
  });

  it("reports a failed change without claiming the toggle moved", async () => {
    mocks.setAgentControlEnabledCommand.mockRejectedValue(new Error("nope"));
    const { result } = renderHook(() => useAgentControlSettings({ settingsOpen: true }));
    await waitFor(() => expect(result.current.agentControlStatus).toEqual(READY));

    let settled;
    await act(async () => {
      settled = await result.current.setAgentControlEnabled(true);
    });
    expect(result.current.agentControlStatus.enabled).toBe(false);
    expect(result.current.agentControlStatus.message).toBe("Agent Control could not be changed.");
    expect(settled.enabled).toBe(false);
    expect(result.current.agentControlBusy).toBe(false);
  });
});
