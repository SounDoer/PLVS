/** @vitest-environment jsdom */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRuntimeBackendSync } from "./useRuntimeBackendSync.js";

const mocks = vi.hoisted(() => ({
  isTauri: vi.fn(() => false),
  setAnalysisRequests: vi.fn(),
  setLoudnessWeights: vi.fn(),
  setDialogueGating: vi.fn(),
  setDialogueVadEngine: vi.fn(),
}));

vi.mock("../ipc/env.js", () => ({
  isTauri: mocks.isTauri,
}));

vi.mock("../ipc/commands.js", () => ({
  setAnalysisRequests: mocks.setAnalysisRequests,
  setLoudnessWeights: mocks.setLoudnessWeights,
  setDialogueGating: mocks.setDialogueGating,
  setDialogueVadEngine: mocks.setDialogueVadEngine,
}));

function renderSync(props = {}) {
  const initialProps = {
    analysisRequests: { spectrum: [], vectorscope: [] },
    loudnessWeights: null,
    running: false,
    dialogueGating: false,
    dialogueVadEngine: "silero",
    ...props,
  };
  return renderHook((hookProps) => useRuntimeBackendSync(hookProps), { initialProps });
}

async function flushPromises() {
  await Promise.resolve();
}

describe("useRuntimeBackendSync", () => {
  beforeEach(() => {
    mocks.isTauri.mockReset().mockReturnValue(false);
    mocks.setAnalysisRequests.mockReset().mockResolvedValue(undefined);
    mocks.setLoudnessWeights.mockReset().mockResolvedValue(undefined);
    mocks.setDialogueGating.mockReset().mockResolvedValue(undefined);
    mocks.setDialogueVadEngine.mockReset().mockResolvedValue(undefined);
  });

  it("does not send backend updates outside Tauri", async () => {
    renderSync({
      analysisRequests: { spectrum: [{ key: "s1" }], vectorscope: [] },
      loudnessWeights: [1, 1],
      running: true,
      dialogueGating: true,
      dialogueVadEngine: "webrtc",
    });
    await flushPromises();

    expect(mocks.setAnalysisRequests).not.toHaveBeenCalled();
    expect(mocks.setLoudnessWeights).not.toHaveBeenCalled();
    expect(mocks.setDialogueGating).not.toHaveBeenCalled();
    expect(mocks.setDialogueVadEngine).not.toHaveBeenCalled();
  });

  it("syncs backend values in Tauri and exposes current refs", async () => {
    mocks.isTauri.mockReturnValue(true);
    const analysisRequests = { spectrum: [{ key: "s1" }], vectorscope: [] };
    const loudnessWeights = [1, 0.5];

    const { result } = renderSync({
      analysisRequests,
      loudnessWeights,
      running: true,
      dialogueGating: true,
      dialogueVadEngine: "webrtc",
    });
    await flushPromises();

    expect(mocks.setAnalysisRequests).toHaveBeenCalledWith(analysisRequests);
    expect(mocks.setLoudnessWeights).toHaveBeenCalledWith(loudnessWeights);
    expect(mocks.setDialogueGating).toHaveBeenCalledWith(true);
    expect(mocks.setDialogueVadEngine).toHaveBeenCalledWith("webrtc");
    expect(result.current.loudnessWeightsRef.current).toBe(loudnessWeights);
    expect(result.current.dialogueGatingRef.current).toBe(true);
    expect(result.current.dialogueVadEngineRef.current).toBe("webrtc");
  });

  it("deduplicates analysis request syncs until a send fails", async () => {
    mocks.isTauri.mockReturnValue(true);
    const analysisRequests = { spectrum: [{ key: "s1" }], vectorscope: [] };
    mocks.setAnalysisRequests.mockRejectedValueOnce(new Error("ipc failed")).mockResolvedValue();

    const { rerender } = renderSync({ analysisRequests });
    await flushPromises();
    rerender({
      analysisRequests: { spectrum: [{ key: "s1" }], vectorscope: [] },
      loudnessWeights: null,
      running: false,
      dialogueGating: false,
      dialogueVadEngine: "silero",
    });
    await flushPromises();

    expect(mocks.setAnalysisRequests).toHaveBeenCalledTimes(2);
  });
});
