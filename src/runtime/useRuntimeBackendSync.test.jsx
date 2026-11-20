/** @vitest-environment jsdom */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRuntimeBackendSync } from "./useRuntimeBackendSync.js";

const mocks = vi.hoisted(() => ({
  isTauri: vi.fn(() => true),
  setAnalysisRequests: vi.fn(),
}));

vi.mock("../ipc/env.js", () => ({ isTauri: mocks.isTauri }));
vi.mock("../ipc/commands.js", () => ({ setAnalysisRequests: mocks.setAnalysisRequests }));

function renderSync(overrides = {}) {
  const target = { selection: { mode: "live" }, meter: {} };
  const props = {
    analysisRequests: { spectrum: [], vectorscope: [] },
    channelRoles: null,
    channelCount: 2,
    running: true,
    ready: true,
    dialogueGating: true,
    dialogueVadEngine: "silero",
    liveClearTarget: vi.fn(() => target),
    clearLiveForControl: vi.fn().mockResolvedValue(true),
    resetLiveDisplayControls: vi.fn(),
    deferLiveClear: vi.fn(),
    raiseNotice: vi.fn(),
    ...overrides,
  };
  return {
    ...renderHook((hookProps) => useRuntimeBackendSync(hookProps), { initialProps: props }),
    props,
    target,
  };
}

describe("useRuntimeBackendSync", () => {
  beforeEach(() => {
    mocks.isTauri.mockReset().mockReturnValue(true);
    mocks.setAnalysisRequests.mockReset().mockResolvedValue(undefined);
  });

  it("does not send analysis requests outside Tauri", () => {
    mocks.isTauri.mockReturnValue(false);
    renderSync();
    expect(mocks.setAnalysisRequests).not.toHaveBeenCalled();
  });

  it("sends requests before Live starts so File can use them and retries a failed send", async () => {
    const analysisRequests = { spectrum: [{ key: "s1" }], vectorscope: [] };
    mocks.setAnalysisRequests.mockRejectedValueOnce(new Error("ipc failed")).mockResolvedValue();
    const { props, rerender } = renderSync({ analysisRequests, running: false });
    await Promise.resolve();
    rerender({ ...props, analysisRequests: { ...analysisRequests } });
    expect(mocks.setAnalysisRequests).toHaveBeenCalledTimes(2);
    expect(mocks.setAnalysisRequests).toHaveBeenLastCalledWith(analysisRequests);
    expect(props.clearLiveForControl).not.toHaveBeenCalled();
  });

  it("applies combined edits at one boundary and exposes only acknowledged rules", async () => {
    const { result, props, target, rerender } = renderSync();
    const roles = ["L", "R"];
    await expect(
      result.current.applyMeasurementRules({ channelRoles: roles, dialogueVadEngine: "firered" })
    ).resolves.toBe(true);
    rerender({ ...props, channelRoles: roles, dialogueVadEngine: "firered" });
    expect(props.clearLiveForControl).toHaveBeenCalledExactlyOnceWith(target, {
      channelRoles: roles,
      dialogueGating: true,
      dialogueVadEngine: "firered",
    });
    expect(props.resetLiveDisplayControls).toHaveBeenCalledExactlyOnceWith(target);
    expect(result.current.channelRolesRef.current).toEqual(roles);
    expect(result.current.dialogueVadEngineRef.current).toBe("firered");

    props.clearLiveForControl.mockRejectedValueOnce(new Error("ipc failed"));
    await expect(
      result.current.applyMeasurementRules({ dialogueVadEngine: "silero" })
    ).rejects.toThrow("ipc failed");
    expect(result.current.dialogueVadEngineRef.current).toBe("firered");
    expect(props.resetLiveDisplayControls).toHaveBeenCalledTimes(1);
  });

  it("does not reset a replacement source and defers a File-mode edit to Live", async () => {
    const { result, props, target } = renderSync();
    const pending = result.current.applyMeasurementRules({ dialogueVadEngine: "firered" }, target);
    props.liveClearTarget.mockReturnValue({ selection: { mode: "file" }, meter: {} });
    await expect(pending).rejects.toThrow("source changed");
    await expect(
      result.current.applyMeasurementRules({ dialogueVadEngine: "firered" })
    ).resolves.toBe(false);
    expect(props.clearLiveForControl).not.toHaveBeenCalled();
    expect(props.deferLiveClear).toHaveBeenCalledOnce();
  });
});
