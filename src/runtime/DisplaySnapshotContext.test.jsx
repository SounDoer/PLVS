/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { act, render, renderHook } from "@testing-library/react";
import { MeterRuntimeProvider, useMeterRuntimeAssembly } from "./MeterRuntimeContext.jsx";
import { DisplaySnapshotProvider, useDisplaySnapshot } from "./DisplaySnapshotContext.jsx";

describe("DisplaySnapshotProvider", () => {
  it("reports no channels before any frame and follows the live frame's channel count", () => {
    /** @type {ReturnType<typeof useMeterRuntimeAssembly>} */
    let assembly;
    /** @type {ReturnType<typeof useDisplaySnapshot>} */
    let snapshot;
    function Probe() {
      assembly = useMeterRuntimeAssembly();
      snapshot = useDisplaySnapshot();
      return null;
    }
    render(
      <MeterRuntimeProvider>
        <DisplaySnapshotProvider>
          <Probe />
        </DisplaySnapshotProvider>
      </MeterRuntimeProvider>
    );

    expect(snapshot.channelCount).toBe(0);
    expect(snapshot.hasHistoryData).toBe(false);

    act(() => assembly.display.setAudio((current) => ({ ...current, peakDb: [-3, -4, -5] })));

    expect(snapshot.channelCount).toBe(3);
    expect(snapshot.displayAudio.peakDb).toEqual([-3, -4, -5]);
  });

  it("refuses the hook outside the provider", () => {
    expect(() => renderHook(() => useDisplaySnapshot())).toThrow(
      "useDisplaySnapshot must be used inside DisplaySnapshotProvider"
    );
  });
});
