/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useCaptureTransport } from "./useCaptureTransport.js";

function setup() {
  const display = {
    clearNotice: vi.fn(),
    setSelectedOffset: vi.fn(),
    setShowClock: vi.fn(),
    clock: { startTimer: vi.fn(), stopTimer: vi.fn() },
  };
  const intake = { beginCaptureSession: vi.fn() };
  const hook = renderHook(() => useCaptureTransport({ display, getLiveIntake: () => intake }));
  return { ...hook, display, intake };
}

describe("useCaptureTransport lifecycle", () => {
  it("settles start only after the engine acknowledges capture", async () => {
    const { result } = setup();
    let settled = false;
    let starting;
    act(() => {
      starting = result.current.startLiveForControl().then(() => (settled = true));
    });
    expect(result.current.lifecycle).toBe("starting");
    expect(settled).toBe(false);
    act(() => result.current.markStarted({ resolvedDeviceId: "device-1" }));
    await starting;
    expect(result.current.lifecycle).toBe("running");
    expect(result.current.resolvedDeviceId).toBe("device-1");
  });

  it("settles stop after native shutdown", async () => {
    const { result } = setup();
    let starting;
    act(() => {
      starting = result.current.startLiveForControl();
      result.current.markStarted();
    });
    await starting;

    let stopping;
    act(() => {
      stopping = result.current.stopLiveForControl();
    });
    expect(result.current.lifecycle).toBe("stopping");
    act(() => result.current.markStopped());
    await stopping;
    expect(result.current.lifecycle).toBe("stopped");
  });

  it("settles stop after a capture failure without an engine acknowledgement", async () => {
    // A failure has already halted capture: `running` is false, so the audio engine has nothing to
    // shut down and never calls `markStopped`. Waiting for it left the stop pending forever, and
    // Agent Control's serialized queue -- every later command -- hung behind it.
    const { result } = setup();
    let starting;
    act(() => {
      starting = result.current.startLiveForControl();
      result.current.markStartFailed(new Error("device busy"));
    });
    await expect(starting).rejects.toThrow("device busy");
    expect(result.current.lifecycle).toBe("error");

    let settled = false;
    await act(async () => {
      void result.current.stopLiveForControl().then(() => (settled = true));
    });
    expect(settled).toBe(true);
    expect(result.current.lifecycle).toBe("stopped");
    expect(result.current.running).toBe(false);
  });

  it("keeps dropped-audio evidence until a new session starts or Live is cleared", () => {
    const { result } = setup();
    act(() => result.current.recordAudioDrop(0));
    expect(result.current.audioDrop).toBe(null);

    act(() => result.current.recordAudioDrop(3));
    act(() => result.current.recordAudioDrop(2));
    expect(result.current.audioDrop).toEqual({ chunks: 5, since: expect.any(Number) });

    act(() => result.current.markStopped());
    expect(result.current.audioDrop?.chunks).toBe(5);

    act(() => result.current.markStarted());
    expect(result.current.audioDrop).toBe(null);

    act(() => result.current.recordAudioDrop(1));
    act(() => result.current.clearAudioDrop());
    expect(result.current.audioDrop).toBe(null);
  });

  it("exposes device restart settlement and blocks overlapping Transport actions", async () => {
    const { result } = setup();
    let starting;
    act(() => {
      starting = result.current.startLiveForControl();
      result.current.markStarted({ resolvedDeviceId: "device-1" });
    });
    await starting;

    let settled = false;
    let restart;
    act(() => {
      restart = result.current.beginDeviceRestartForControl().then(() => (settled = true));
    });
    expect(result.current.lifecycle).toBe("running");
    expect(result.current.deviceTransition).toBe("restarting");
    expect(settled).toBe(false);
    await expect(result.current.stopLiveForControl()).rejects.toMatchObject({
      code: "transitionInProgress",
    });
    act(() => result.current.markStarted({ resolvedDeviceId: "device-2" }));
    await restart;
    expect(settled).toBe(true);
    expect(result.current.deviceTransition).toBeNull();
    expect(result.current.resolvedDeviceId).toBe("device-2");
  });

  it("preserves a failed restart as stopped/error and rejects its settlement", async () => {
    const { result } = setup();
    let starting;
    act(() => {
      starting = result.current.startLiveForControl();
      result.current.markStarted({ resolvedDeviceId: "device-1" });
    });
    await starting;

    let restart;
    act(() => {
      restart = result.current.beginDeviceRestartForControl();
      result.current.markStartFailed(new Error("new device busy"));
    });
    await expect(restart).rejects.toThrow("new device busy");
    expect(result.current.running).toBe(false);
    expect(result.current.lifecycle).toBe("error");
    expect(result.current.deviceTransition).toBeNull();
    expect(result.current.lastError).toEqual({ message: "new device busy" });
  });
});
