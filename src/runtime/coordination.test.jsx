/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  exit: vi.fn(),
  flush: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/plugin-process", () => ({ exit: mocks.exit }));
vi.mock("../persistence/index.js", () => ({ flushPersistence: mocks.flush }));
vi.mock("../ipc/env.js", () => ({ isTauri: () => true }));

import {
  commitGlobalOperation,
  prepareGlobalOperation,
  useRuntimeCoordination,
} from "./coordination.js";

describe("runtime coordination", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.flush.mockResolvedValue();
  });

  afterEach(() => vi.useRealTimers());

  it("prepares a participant by stopping and flushing before acknowledgement", async () => {
    const stop = vi.fn().mockResolvedValue();
    const command = {
      commandId: "command-a",
      operationId: "operation-a",
      instanceId: "instance-a",
      action: "prepareGlobal",
    };
    mocks.invoke.mockImplementation((name) => {
      if (name === "runtime_poll_command") return Promise.resolve(command);
      return Promise.resolve();
    });
    const { unmount } = renderHook(() =>
      useRuntimeCoordination({
        blockingEditors: [],
        running: true,
        stop,
        start: vi.fn(),
        show: vi.fn(),
      })
    );

    await act(async () => {});

    expect(stop).toHaveBeenCalledTimes(1);
    expect(mocks.flush).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).toHaveBeenCalledWith("runtime_ack_command", {
      commandId: "command-a",
      outcome: "ready",
      detail: null,
    });
    unmount();
  });

  it("restores capture when the coordinator disappears after prepare", async () => {
    const stop = vi.fn().mockResolvedValue();
    const start = vi.fn().mockResolvedValue();
    const command = {
      commandId: "command-a",
      operationId: "operation-a",
      instanceId: "instance-a",
      action: "prepareGlobal",
    };
    let delivered = false;
    mocks.invoke.mockImplementation((name) => {
      if (name === "runtime_poll_command" && !delivered) {
        delivered = true;
        return Promise.resolve(command);
      }
      if (name === "runtime_poll_command") return Promise.resolve(null);
      return Promise.resolve();
    });
    const { unmount } = renderHook(() =>
      useRuntimeCoordination({
        blockingEditors: [],
        running: true,
        stop,
        start,
        show: vi.fn(),
      })
    );
    await act(async () => {});

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_250);
    });

    expect(stop).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("refuses a new prepare while recovery from an abandoned operation is pending", async () => {
    const stop = vi.fn().mockResolvedValue();
    const commands = [
      {
        commandId: "command-a",
        operationId: "operation-a",
        instanceId: "instance-a",
        action: "prepareGlobal",
      },
      {
        commandId: "command-b",
        operationId: "operation-b",
        instanceId: "instance-a",
        action: "prepareGlobal",
      },
    ];
    mocks.invoke.mockImplementation((name) => {
      if (name === "runtime_poll_command") return Promise.resolve(commands.shift() ?? null);
      return Promise.resolve();
    });
    const { unmount } = renderHook(() =>
      useRuntimeCoordination({
        blockingEditors: [],
        running: true,
        stop,
        start: vi.fn(),
        show: vi.fn(),
      })
    );
    await act(async () => {});
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    expect(stop).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).toHaveBeenCalledWith("runtime_ack_command", {
      commandId: "command-b",
      outcome: "blocked",
      detail: "Another identity-wide operation is awaiting recovery.",
    });
    unmount();
  });

  it("restores capture when retiring a quitting workbench fails", async () => {
    const stop = vi.fn().mockResolvedValue();
    const start = vi.fn().mockResolvedValue();
    const command = {
      commandId: "command-a",
      operationId: "quit-a",
      instanceId: "instance-a",
      action: "quitInstance",
    };
    mocks.invoke.mockImplementation((name) => {
      if (name === "runtime_poll_command") return Promise.resolve(command);
      if (name === "runtime_retire_current_workspace") {
        return Promise.reject(new Error("catalog unavailable"));
      }
      return Promise.resolve();
    });
    const { unmount } = renderHook(() =>
      useRuntimeCoordination({
        blockingEditors: [],
        running: true,
        stop,
        start,
        show: vi.fn(),
      })
    );

    await act(async () => {});

    expect(stop).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(1);
    expect(mocks.exit).not.toHaveBeenCalled();
    expect(mocks.invoke).toHaveBeenCalledWith("runtime_ack_command", {
      commandId: "command-a",
      outcome: "failed",
      detail: "Error: catalog unavailable",
    });
    unmount();
  });

  it("refuses an identity-wide operation before issuing commands when this editor is open", async () => {
    const { unmount } = renderHook(() =>
      useRuntimeCoordination({
        blockingEditors: ["theme-editor"],
        running: false,
        stop: vi.fn(),
        start: vi.fn(),
        show: vi.fn(),
      })
    );

    await expect(prepareGlobalOperation()).rejects.toThrow("theme-editor");
    expect(mocks.invoke).not.toHaveBeenCalledWith("runtime_issue_commands", expect.anything());
    unmount();
  });

  it("restores local capture without preparing peers when the local flush fails", async () => {
    const stop = vi.fn().mockResolvedValue();
    const start = vi.fn().mockResolvedValue();
    mocks.flush.mockRejectedValueOnce(new Error("disk full"));
    mocks.invoke.mockImplementation((name) => {
      if (name === "runtime_poll_command") return Promise.resolve(null);
      return Promise.resolve([]);
    });
    const { unmount } = renderHook(() =>
      useRuntimeCoordination({
        blockingEditors: [],
        running: true,
        stop,
        start,
        show: vi.fn(),
      })
    );

    await expect(prepareGlobalOperation()).rejects.toThrow("disk full");

    expect(stop).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).not.toHaveBeenCalledWith("runtime_issue_commands", expect.anything());
    unmount();
  });

  it("restores local capture when peer preparation cannot be issued", async () => {
    const stop = vi.fn().mockResolvedValue();
    const start = vi.fn().mockResolvedValue();
    mocks.invoke.mockImplementation((name) => {
      if (name === "runtime_poll_command") return Promise.resolve(null);
      if (name === "runtime_issue_commands") return Promise.reject(new Error("coordinator lost"));
      return Promise.resolve();
    });
    const { unmount } = renderHook(() =>
      useRuntimeCoordination({
        blockingEditors: [],
        running: true,
        stop,
        start,
        show: vi.fn(),
      })
    );

    await expect(prepareGlobalOperation()).rejects.toThrow("coordinator lost");

    expect(stop).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).toHaveBeenCalledWith("runtime_finish_operation", {
      operationId: expect.any(String),
    });
    unmount();
  });

  it("does not tell peers to close when the coordinator cannot flush its own state", async () => {
    mocks.flush.mockRejectedValueOnce(new Error("disk full"));
    mocks.invoke.mockResolvedValue([]);
    const operation = {
      id: "operation-a",
      issued: [{ instanceId: "instance-a" }],
      localWasRunning: false,
    };

    await expect(commitGlobalOperation(operation)).rejects.toThrow("disk full");

    expect(mocks.invoke).not.toHaveBeenCalledWith(
      "runtime_issue_commands",
      expect.objectContaining({ action: "commitGlobal" })
    );
    expect(mocks.invoke).not.toHaveBeenCalledWith("runtime_finish_operation", {
      operationId: "operation-a",
    });
  });
});
