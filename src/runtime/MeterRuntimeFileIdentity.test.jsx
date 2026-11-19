/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import {
  MeterRuntimeProvider,
  useMeterRuntime,
  useMeterRuntimeAssembly,
} from "./MeterRuntimeContext.jsx";
import { probeFileAnalysis } from "../ipc/commands.js";
import { selectImportTrack } from "../agentControl/transportControl.js";
vi.mock("../ipc/env.js", () => ({ isTauri: () => true }));
vi.mock("../ipc/commands.js", () => ({ probeFileAnalysis: vi.fn(), clearAudioHistory: vi.fn() }));
const sourceVersion = { canonicalPath: "C:/mix.mkv", byteLength: 10, sha256: "old" };
const probe = {
  path: "C:/mix.mkv",
  selectedTrack: { index: 2, channels: 2 },
  audioTracks: [
    { index: 1, channels: 2 },
    { index: 2, channels: 2 },
  ],
  sourceVersion,
};
beforeEach(() => vi.clearAllMocks());
function mount() {
  const hook = renderHook(
    () => ({ runtime: useMeterRuntime(), assembly: useMeterRuntimeAssembly() }),
    {
      wrapper: ({ children }) => <MeterRuntimeProvider>{children}</MeterRuntimeProvider>,
    }
  );
  act(() => {
    hook.result.current.runtime.switchSource("file");
    hook.result.current.runtime.beginFileAnalysis(probe.path, {}, probe);
  });
  const id = hook.result.current.runtime.activeFileId;
  act(() => {
    hook.result.current.assembly.ledger.updateSession(id, (entry) => ({
      ...entry,
      state: "complete",
      metadata: probe,
      summary: { integratedLufs: -23 },
    }));
    hook.result.current.assembly.ledger.setAnalyzingFileId(null);
  });
  return { ...hook, id };
}
it("analyzes the only track in a replacement file and keeps the old result", async () => {
  const { result, id } = mount();
  vi.mocked(probeFileAnalysis).mockResolvedValue({
    ...probe,
    selectedTrack: probe.audioTracks[0],
    audioTracks: [probe.audioTracks[0]],
    sourceVersion: { ...sourceVersion, sha256: "new" },
  });
  await act(async () => {
    await result.current.runtime.reanalyzeFile(id, {});
  });
  expect(result.current.runtime.activeFileId).not.toBe(id);
  expect(
    result.current.runtime.fileSessions.find((file) => file.id === id).summary.integratedLufs
  ).toBe(-23);
  expect(result.current.assembly.ledger.validRunRequest.probe.selectedTrack.index).toBe(1);
});

it.each([true, false])(
  "waits for a new choice on a multitrack replacement (confirm: %s)",
  async (confirm) => {
    const { result, id } = mount();
    vi.mocked(probeFileAnalysis).mockResolvedValue({
      ...probe,
      sourceVersion: { ...sourceVersion, sha256: "new" },
    });
    let pending;
    await act(async () => {
      pending = result.current.runtime.reanalyzeFile(id, {});
    });
    expect(result.current.runtime.fileTaskBusy).toBe(true);
    expect(result.current.assembly.ledger.validRunRequest).toBeNull();
    expect(result.current.runtime.activeFileSession.summary.integratedLufs).toBe(-23);
    const picker = result.current.runtime.replacementTrackSelection;
    await act(async () => {
      if (confirm) picker.onConfirm(1);
      else await picker.onCancel();
      await pending;
    });
    expect(result.current.runtime.replacementTrackSelection).toBeNull();
    expect(result.current.runtime.fileSessions).toHaveLength(confirm ? 2 : 1);
    expect(
      result.current.runtime.fileSessions.find((file) => file.id === id).summary.integratedLufs
    ).toBe(-23);
    if (confirm)
      expect(result.current.assembly.ledger.validRunRequest.probe.selectedTrack.index).toBe(1);
    else expect(result.current.runtime.fileTaskBusy).toBe(false);
  }
);

it("returns a track-selection refusal to Agent Control before starting a replacement", async () => {
  const { result, id } = mount();
  vi.mocked(probeFileAnalysis).mockResolvedValue({
    ...probe,
    sourceVersion: { ...sourceVersion, sha256: "new" },
  });
  const beforeRun = vi.fn();
  await act(async () => {
    await expect(
      result.current.runtime.reanalyzeFileForControl(
        id,
        {},
        {
          selectReplacementTrack: (discovered) =>
            selectImportTrack(discovered, undefined, { replacement: true }),
          beforeRun,
        }
      )
    ).rejects.toMatchObject({ reason: "fileTrackSelectionRequired", path: "$.params.sessionId" });
  });
  expect(beforeRun).not.toHaveBeenCalled();
  expect(result.current.runtime.replacementTrackSelection).toBeNull();
  expect(result.current.runtime.fileTaskBusy).toBe(false);
  expect(result.current.runtime.activeFileSession.state).toBe("complete");
});
it("retains the original track even if the new probe defaults to a different track", async () => {
  const { result, id } = mount();
  vi.mocked(probeFileAnalysis).mockResolvedValue({ ...probe, selectedTrack: probe.audioTracks[0] });
  await act(async () => {
    await result.current.runtime.reanalyzeFile(id, {});
  });
  expect(result.current.runtime.activeFileId).toBe(id);
  expect(result.current.assembly.ledger.validRunRequest.probe.selectedTrack.index).toBe(2);
});
it("preserves results when the source cannot be read", async () => {
  const { result, id } = mount();
  vi.mocked(probeFileAnalysis).mockRejectedValue(new Error("missing source"));
  await act(async () => {
    await result.current.runtime.reanalyzeFile(id, {});
  });
  expect(result.current.runtime.activeFileSession.summary.integratedLufs).toBe(-23);
  expect(result.current.runtime.analyzingFileId).toBeNull();
});

it("cancels preparation without allowing the late probe to start a task", async () => {
  const { result, id } = mount();
  let resolve;
  vi.mocked(probeFileAnalysis).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    })
  );
  let pending;
  act(() => {
    pending = result.current.runtime.reanalyzeFile(id, {});
  });
  expect(result.current.runtime.fileTaskBusy).toBe(true);
  await act(async () => {
    await result.current.runtime.stopFileAnalysis(id);
  });
  await act(async () => {
    resolve(probe);
    await pending;
  });
  expect(result.current.runtime.fileTaskBusy).toBe(false);
  expect(result.current.assembly.ledger.validRunRequest).toBeNull();
});

it.each([false, true])(
  "restores original conditions and rejects changed content (%s)",
  async (changed) => {
    const { result, id } = mount();
    act(() =>
      result.current.assembly.ledger.updateSession(id, (entry) => ({
        ...entry,
        intake: null,
        historyReleased: true,
        successfulResult: { ...entry.successfulResult, intake: null },
      }))
    );
    vi.mocked(probeFileAnalysis).mockResolvedValue({
      ...probe,
      sourceVersion: { ...sourceVersion, sha256: changed ? "new" : "old" },
    });
    await act(async () => {
      await result.current.runtime.restoreFileHistory(id);
    });
    if (changed) {
      expect(result.current.assembly.ledger.validRunRequest).toBeNull();
      expect(result.current.runtime.fileSessions).toHaveLength(1);
    } else {
      expect(result.current.runtime.activeFileSession.attempt.kind).toBe("restore");
      expect(result.current.assembly.ledger.validRunRequest.analysisSettings).toEqual({});
    }
    expect(result.current.runtime.activeFileSession.summary.integratedLufs).toBe(-23);
  }
);
