/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useCaptureTransport } from "./useCaptureTransport.js";

function makeDisplay() {
  return {
    setSelectedOffset: vi.fn(),
    setStatus: vi.fn(),
    setStatus2: vi.fn(),
    setShowClock: vi.fn(),
    clock: { startTimer: vi.fn(), stopTimer: vi.fn() },
  };
}

describe("useCaptureTransport", () => {
  it("startLive begins an intake session, flips running, and starts the clock", () => {
    const display = makeDisplay();
    const intake = { beginCaptureSession: vi.fn() };
    const { result } = renderHook(() =>
      useCaptureTransport({ display, getLiveIntake: () => intake })
    );

    act(() => result.current.startLive());

    expect(result.current.running).toBe(true);
    expect(intake.beginCaptureSession).toHaveBeenCalledTimes(1);
    expect(display.clock.startTimer).toHaveBeenCalledTimes(1);
    expect(display.setShowClock).toHaveBeenCalledWith(true);
  });

  it("stopLive flips running off, resets the scrub offset, writes statuses, stops the clock", () => {
    const display = makeDisplay();
    const { result } = renderHook(() =>
      useCaptureTransport({ display, getLiveIntake: () => ({ beginCaptureSession: vi.fn() }) })
    );

    act(() => result.current.startLive());
    act(() => result.current.stopLive());

    expect(result.current.running).toBe(false);
    expect(display.setSelectedOffset).toHaveBeenCalledWith(-1);
    expect(display.setStatus).toHaveBeenCalledWith("Stopped - click Start to resume");
    expect(display.setStatus2).toHaveBeenCalledWith("Device: Not connected");
    expect(display.clock.stopTimer).toHaveBeenCalledTimes(1);
  });

  it("halt only flips running without touching display", () => {
    const display = makeDisplay();
    const { result } = renderHook(() =>
      useCaptureTransport({ display, getLiveIntake: () => ({ beginCaptureSession: vi.fn() }) })
    );

    act(() => result.current.startLive());
    display.setStatus.mockClear();
    display.clock.stopTimer.mockClear();

    act(() => result.current.halt());

    expect(result.current.running).toBe(false);
    expect(display.setStatus).not.toHaveBeenCalled();
    expect(display.clock.stopTimer).not.toHaveBeenCalled();
  });
});
