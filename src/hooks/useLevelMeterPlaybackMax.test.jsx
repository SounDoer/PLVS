/** @vitest-environment jsdom */
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useLevelMeterPlaybackMaxChannels } from "./useLevelMeterPlaybackMax.js";

describe("useLevelMeterPlaybackMaxChannels", () => {
  it("does not publish a fresh empty state for every frame while disabled", () => {
    const onRender = vi.fn();
    const { rerender } = renderHook(
      ({ values }) => {
        onRender();
        return useLevelMeterPlaybackMaxChannels({ enabled: false, mode: "peak", values });
      },
      { initialProps: { values: [-12, -13] } }
    );

    expect(onRender).toHaveBeenCalledTimes(1);

    rerender({ values: [-14, -15] });

    expect(onRender).toHaveBeenCalledTimes(2);
  });

  it("clears a tracked maximum once when disabled", () => {
    const onRender = vi.fn();
    const { result, rerender } = renderHook(
      ({ enabled, values }) => {
        onRender();
        return useLevelMeterPlaybackMaxChannels({ enabled, mode: "rms", values });
      },
      { initialProps: { enabled: true, values: [-20, -24] } }
    );

    expect(result.current).toEqual([-20, -24]);
    const rendersBeforeDisable = onRender.mock.calls.length;

    rerender({ enabled: false, values: [-21, -25] });

    expect(result.current).toEqual([]);
    expect(onRender.mock.calls.length).toBe(rendersBeforeDisable + 2);
    const rendersAfterClear = onRender.mock.calls.length;

    rerender({ enabled: false, values: [-22, -26] });

    expect(result.current).toEqual([]);
    expect(onRender.mock.calls.length).toBe(rendersAfterClear + 1);
  });
});
