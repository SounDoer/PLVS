/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { settingsStore } from "../persistence/index.js";
import { useHistoryRetentionSetting } from "./useHistoryRetentionSetting.js";

describe("useHistoryRetentionSetting", () => {
  beforeEach(() => {
    settingsStore.reset();
  });

  it("persists a changed retention and runs the shared Live-clear operation", async () => {
    const onChange = vi.fn().mockResolvedValue(true);
    const { result } = renderHook(() =>
      useHistoryRetentionSetting({ onChangeRef: { current: onChange } })
    );

    await act(() => result.current.setHistoryRetentionSec("7200"));

    expect(result.current.historyRetentionSec).toBe(7200);
    expect(settingsStore.read().historyRetentionSec).toBe(7200);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("does not clear when the normalized retention is unchanged", async () => {
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useHistoryRetentionSetting({ onChangeRef: { current: onChange } })
    );

    await act(() => result.current.setHistoryRetentionSec("3600"));

    expect(onChange).not.toHaveBeenCalled();
  });
});
