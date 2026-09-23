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

import { prepareGlobalOperation, useRuntimeCoordination } from "./coordination.js";

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
});
