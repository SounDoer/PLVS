/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useMeterSettings } from "./useMeterSettings.js";

describe("useMeterSettings", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("reads default meter settings", () => {
    const { result } = renderHook(() => useMeterSettings());

    expect(result.current.referenceLufs).toBe(-23);
    expect(result.current.channelLabelOverrides).toEqual({});
  });

  it("reads and normalizes stored meter settings", () => {
    localStorage.setItem(
      "plvs:settings",
      JSON.stringify({
        referenceLufs: -14,
        channelLabelOverrides: {
          2: ["L", "R"],
          3: ["L", "bad", "R"],
        },
      })
    );

    const { result } = renderHook(() => useMeterSettings());

    expect(result.current.referenceLufs).toBe(-14);
    expect(result.current.channelLabelOverrides).toEqual({ 2: ["L", "R"] });
  });

  it("persists reference loudness and channel label overrides", async () => {
    const { result } = renderHook(() => useMeterSettings());

    act(() => {
      result.current.setReferenceLufs(-18);
      result.current.setChannelLabelOverrides({ 1: ["M"] });
    });

    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem("plvs:settings"))).toMatchObject({
        referenceLufs: -18,
        channelLabelOverrides: { 1: ["M"] },
      });
    });
  });

  it("updates from settings storage events", async () => {
    const { result } = renderHook(() => useMeterSettings());

    localStorage.setItem(
      "plvs:settings",
      JSON.stringify({
        referenceLufs: -20,
        channelLabelOverrides: { 2: ["L", "R"] },
      })
    );
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "plvs:settings" }));
    });

    await waitFor(() => {
      expect(result.current.referenceLufs).toBe(-20);
      expect(result.current.channelLabelOverrides).toEqual({ 2: ["L", "R"] });
    });
  });
});
