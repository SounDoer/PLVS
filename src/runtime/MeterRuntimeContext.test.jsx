/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MeterRuntimeProvider, useMeterRuntime } from "./MeterRuntimeContext.jsx";

function wrapper({ children }) {
  return <MeterRuntimeProvider>{children}</MeterRuntimeProvider>;
}

describe("MeterRuntimeProvider", () => {
  it("owns the live lifecycle behind startLive and stopLive", () => {
    const { result } = renderHook(() => useMeterRuntime(), { wrapper });

    expect(result.current.sourceMode).toBe("live");
    expect(result.current.running).toBe(false);

    act(() => result.current.startLive());
    expect(result.current.running).toBe(true);

    act(() => result.current.stopLive());
    expect(result.current.running).toBe(false);
  });

  it("stops live capture when switching to File", () => {
    const { result } = renderHook(() => useMeterRuntime(), { wrapper });

    act(() => result.current.startLive());
    act(() => result.current.switchSource("file"));

    expect(result.current.sourceMode).toBe("file");
    expect(result.current.running).toBe(false);
  });
});
