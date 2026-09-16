/** @vitest-environment jsdom */

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { setCrashPromptEnabled } = vi.hoisted(() => ({ setCrashPromptEnabled: vi.fn() }));

vi.mock("../ipc/env.js", () => ({ isTauri: () => true }));
vi.mock("../ipc/commands.js", () => ({ setCrashPromptEnabled }));

import { settingsStore } from "../persistence/index.js";
import { useCrashReportSetting } from "./useCrashReportSetting.js";

beforeEach(() => {
  settingsStore.reset();
  setCrashPromptEnabled.mockReset();
  setCrashPromptEnabled.mockResolvedValue(undefined);
});

describe("useCrashReportSetting", () => {
  it("defaults asking on when the key is absent and preserves stored false", () => {
    const first = renderHook(() => useCrashReportSetting());
    expect(first.result.current.enabled).toBe(true);
    first.unmount();

    settingsStore.patch({ askToSendCrashReports: false });
    const second = renderHook(() => useCrashReportSetting());
    expect(second.result.current.enabled).toBe(false);
  });

  it("synchronizes Rust before persisting a changed preference", async () => {
    const { result } = renderHook(() => useCrashReportSetting());

    await act(() => result.current.setEnabled(false));

    expect(setCrashPromptEnabled).toHaveBeenCalledWith(false);
    expect(settingsStore.read().askToSendCrashReports).toBe(false);
    expect(result.current.enabled).toBe(false);
    expect(result.current.error).toBe("");
  });

  it("surfaces native synchronization failure without persisting a lie", async () => {
    setCrashPromptEnabled.mockRejectedValueOnce(new Error("native unavailable"));
    const { result } = renderHook(() => useCrashReportSetting());

    await act(async () => {
      await expect(result.current.setEnabled(false)).rejects.toThrow("native unavailable");
    });

    await waitFor(() => expect(result.current.error).toContain("native unavailable"));
    expect(settingsStore.read().askToSendCrashReports).toBeUndefined();
    expect(result.current.enabled).toBe(true);
  });
});
