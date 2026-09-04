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

  it("settles stop after native shutdown and exposes start failures", async () => {
    const { result } = setup();
    let starting;
    act(() => {
      starting = result.current.startLiveForControl();
      result.current.markStartFailed(new Error("device busy"));
    });
    await expect(starting).rejects.toThrow("device busy");
    expect(result.current.lifecycle).toBe("error");

    let stopping;
    act(() => {
      stopping = result.current.stopLiveForControl();
    });
    expect(result.current.lifecycle).toBe("stopping");
    act(() => result.current.markStopped());
    await stopping;
    expect(result.current.lifecycle).toBe("stopped");
  });
});
