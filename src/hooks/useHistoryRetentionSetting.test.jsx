/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { settingsStore } from "../persistence/index.js";
import { useHistoryRetentionSetting } from "./useHistoryRetentionSetting.js";

describe("useHistoryRetentionSetting", () => {
  beforeEach(() => {
    settingsStore.reset();
  });

  it("persists a changed retention", async () => {
    const { result } = renderHook(() => useHistoryRetentionSetting());
    await act(() => expect(result.current.setHistoryRetentionSec("7200")).toBe(true));
    expect(result.current.historyRetentionSec).toBe(7200);
    expect(settingsStore.read().historyRetentionSec).toBe(7200);
  });

  it("reports when the normalized retention is unchanged", () => {
    const { result } = renderHook(() => useHistoryRetentionSetting());
    expect(result.current.setHistoryRetentionSec("3600")).toBe(false);
  });

  it("keeps pending opacity changes when restoring the default History Length", async () => {
    settingsStore.patch({ historyRetentionSec: 7200, surfaceOpacity: 100 });
    const { result } = renderHook(() => useHistoryRetentionSetting());

    await act(async () => {
      settingsStore.patchCoalesced({ surfaceOpacity: 61 });
      await result.current.setHistoryRetentionSec("3600");
    });

    expect(settingsStore.read()).toEqual({ surfaceOpacity: 61 });
  });
});
