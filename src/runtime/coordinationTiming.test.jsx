/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useCaptureTransport } from "../hooks/useCaptureTransport.js";
import { useState } from "react";
import {
  canRestartAfterPeerClose,
  quitAllInstances,
  quitCurrentWorkbench,
  useRuntimeCoordination,
} from "./coordination.js";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), exit: vi.fn(), flush: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/plugin-process", () => ({ exit: mocks.exit }));
vi.mock("../persistence/index.js", () => ({ flushPersistence: mocks.flush }));
vi.mock("../ipc/env.js", () => ({ isTauri: () => true }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  mocks.invoke.mockResolvedValue(null);
  mocks.exit.mockResolvedValue(undefined);
  mocks.flush.mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());

async function mountRunning() {
  const commands = [];
  mocks.invoke.mockImplementation(async (name) => {
    if (name === "runtime_poll_command") return commands.shift() ?? null;
    if (name === "runtime_issue_commands" || name === "runtime_wait_commands") return [];
    return null;
  });
  const { result } = renderHook(() => {
    const [fileBusy, setFileBusy] = useState(false);
    const [blockingEditors, setBlockingEditors] = useState([]);
    const transport = useCaptureTransport({
      display: {
        clearNotice: vi.fn(),
        setSelectedOffset: vi.fn(),
        setShowClock: vi.fn(),
        clock: { startTimer: vi.fn(), stopTimer: vi.fn() },
      },
      getLiveIntake: () => ({ beginCaptureSession: vi.fn() }),
    });
    useRuntimeCoordination({
      blockingEditors,
      running: transport.lifecycle === "running",
      measurementBusy: transport.running || transport.lifecycle === "stopping" || fileBusy,
      stop: async () => {
        await transport.stopLiveForCoordination();
        setFileBusy(false);
      },
      start: transport.startLiveForControl,
      show: async () => {},
    });
    return { transport, setFileBusy, setBlockingEditors };
  });
  let starting;
  act(() => {
    starting = result.current.transport.startLiveForControl();
  });
  await act(async () => {
    result.current.transport.markStarted();
    await starting;
  });
  return { result, commands };
}

it.each(["local", "all", "remote", "remote-global"])(
  "quits through %s on the first attempt when native stop precedes the React commit",
  async (route) => {
    const { result, commands } = await mountRunning();
    let closing;
    await act(async () => {
      if (route === "local") closing = quitCurrentWorkbench();
      else if (route === "all") closing = quitAllInstances();
      else {
        commands.push({
          commandId: "prepare",
          operationId: "op",
          action: route === "remote" ? "quitInstance" : "prepareGlobal",
        });
        vi.advanceTimersByTime(250);
      }
      closing?.catch(() => {});
    });
    expect(result.current.transport.lifecycle).toBe("stopping");
    // Hold React's batch open while the real native-stop acknowledgement settles the quit.
    await act(async () => {
      result.current.transport.markStopped();
      if (closing) await closing;
    });
    if (route === "remote-global") {
      commands.push({ commandId: "commit", operationId: "op", action: "commitGlobal" });
      await act(async () => {
        vi.advanceTimersByTime(250);
      });
    }
    if (route === "remote" || route === "remote-global") {
      expect(mocks.invoke).toHaveBeenCalledWith("runtime_commit_exit", {
        commandId: route === "remote" ? "prepare" : "commit",
      });
      expect(mocks.exit).not.toHaveBeenCalled();
    } else expect(mocks.exit).toHaveBeenCalledExactlyOnceWith(0);
  }
);

it("publishes File cancellation before deciding that the workbench is idle", async () => {
  const { result } = await mountRunning();
  act(() => {
    result.current.transport.markStopped();
    result.current.setFileBusy(true);
  });
  await act(async () => {
    await quitCurrentWorkbench();
  });
  expect(mocks.exit).toHaveBeenCalledExactlyOnceWith(0);
});

it("refuses a restart queued during retirement even before React commits it", async () => {
  const { result } = await mountRunning();
  act(() => result.current.transport.markStopped());
  mocks.invoke.mockImplementation(async (name) => {
    if (name === "runtime_retire_current_workspace") {
      result.current.transport.startLive();
      return 3;
    }
    return null;
  });
  await act(async () => {
    await expect(quitCurrentWorkbench()).rejects.toThrow("Measurement resumed");
  });
  expect(mocks.exit).not.toHaveBeenCalled();
  expect(mocks.invoke).toHaveBeenCalledWith("runtime_restore_retired_workspace", { position: 3 });
});

it("refuses an editor opened while the final quit acknowledgement is delivered", async () => {
  const { result } = await mountRunning();
  act(() => result.current.transport.markStopped());
  await act(async () => {
    await expect(
      quitCurrentWorkbench({
        beforeExit: async () => result.current.setBlockingEditors(["theme"]),
      })
    ).rejects.toMatchObject({ code: "editorActive" });
  });
  expect(mocks.exit).not.toHaveBeenCalled();
});

it("preserves the save failure if measurement already restarted during the failed flush", async () => {
  const { result } = await mountRunning();
  mocks.flush.mockImplementationOnce(async () => {
    result.current.transport.startLive();
    throw new Error("save failed");
  });
  let closing;
  await act(async () => {
    closing = quitCurrentWorkbench();
    closing.catch(() => {});
  });
  await act(async () => {
    result.current.transport.markStopped();
    await expect(closing).rejects.toThrow("save failed");
  });
  expect(mocks.exit).not.toHaveBeenCalled();
  expect(result.current.transport.lifecycle).toBe("starting");
});

it("refuses coordinated quit when measurement starts in the persistence continuation", async () => {
  const { result } = await mountRunning();
  act(() => result.current.transport.markStopped());
  mocks.flush.mockImplementationOnce(async () => result.current.transport.startLive());
  await act(async () => {
    await expect(quitAllInstances()).rejects.toThrow("Measurement resumed");
  });
  expect(mocks.exit).not.toHaveBeenCalled();
});

it("hands acknowledgement and exit to native without a later frontend veto", async () => {
  const { result, commands } = await mountRunning();
  act(() => result.current.transport.markStopped());
  commands.push({ commandId: "prepare", operationId: "op", action: "prepareGlobal" });
  await act(async () => {
    vi.advanceTimersByTime(250);
  });
  const invoke = mocks.invoke.getMockImplementation();
  mocks.invoke.mockImplementation(async (name, params) => {
    if (name === "runtime_commit_exit" && params.commandId === "commit") {
      result.current.transport.startLive();
    }
    return invoke(name, params);
  });
  commands.push({ commandId: "commit", operationId: "op", action: "commitGlobal" });
  await act(async () => {
    vi.advanceTimersByTime(250);
  });
  expect(mocks.exit).not.toHaveBeenCalled();
  expect(mocks.invoke).toHaveBeenCalledWith("runtime_commit_exit", { commandId: "commit" });
  expect(mocks.invoke).not.toHaveBeenCalledWith(
    "runtime_ack_command",
    expect.objectContaining({ commandId: "commit" })
  );
});

it("does not relaunch after peers close when a new measurement is still awaiting React commit", async () => {
  const { result } = await mountRunning();
  act(() => result.current.transport.markStopped());
  act(() => {
    result.current.transport.startLive();
    expect(canRestartAfterPeerClose()).toBe(false);
  });
});
