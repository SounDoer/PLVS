/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useMeterDisplay, INITIAL_METER_AUDIO, CLEARED_METER_AUDIO } from "./useMeterDisplay.js";

describe("useMeterDisplay", () => {
  it("starts with the initial meter snapshot and no transport notice", () => {
    const { result } = renderHook(() => useMeterDisplay());
    expect(result.current.audio).toEqual(INITIAL_METER_AUDIO);
    expect(result.current.selectedOffset).toBe(-1);
    expect(result.current.notice).toBeNull();
    expect(result.current.showClock).toBe(false);
  });

  it("starts without a transport notice", () => {
    const { result } = renderHook(() => useMeterDisplay());

    expect(result.current.notice).toBeNull();
  });

  it("raises and clears a transport notice", () => {
    const { result } = renderHook(() => useMeterDisplay());

    act(() => result.current.raiseNotice("error", "Audio unavailable"));
    expect(result.current.notice).toEqual({ kind: "error", text: "Audio unavailable" });

    act(() => result.current.clearNotice());
    expect(result.current.notice).toBeNull();
  });

  it("mirrors selectedOffset into selectedOffsetRef", () => {
    const { result } = renderHook(() => useMeterDisplay());
    act(() => result.current.setSelectedOffset(42));
    expect(result.current.selectedOffsetRef.current).toBe(42);
    expect(result.current.selectedOffset).toBe(42);
  });

  it("clearAudio replaces the snapshot with the clear-time literal", () => {
    const { result } = renderHook(() => useMeterDisplay());
    act(() => result.current.setAudio((a) => ({ ...a, momentary: -12 })));
    act(() => result.current.clearAudio());
    // Deliberate full replacement with the (smaller) clear-time shape — see the
    // CLEARED_METER_AUDIO comment in useMeterDisplay.js.
    expect(result.current.audio).toEqual(CLEARED_METER_AUDIO);
  });

  it("returns identity-stable setters and refs across rerenders", () => {
    const { result, rerender } = renderHook(() => useMeterDisplay());
    const first = {
      setAudio: result.current.setAudio,
      setSelectedOffset: result.current.setSelectedOffset,
      selectedOffsetRef: result.current.selectedOffsetRef,
      frameRef: result.current.frameRef,
    };
    rerender();
    expect(result.current.setAudio).toBe(first.setAudio);
    expect(result.current.setSelectedOffset).toBe(first.setSelectedOffset);
    expect(result.current.selectedOffsetRef).toBe(first.selectedOffsetRef);
    expect(result.current.frameRef).toBe(first.frameRef);
  });
});
