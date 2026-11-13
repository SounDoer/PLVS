/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { probeFileAnalysis } from "../ipc/commands.js";
import { useFileImportQueue } from "./useFileImportQueue.js";

vi.mock("../ipc/commands.js", () => ({ probeFileAnalysis: vi.fn() }));

function probe(path, trackCount = 1) {
  const audioTracks = Array.from({ length: trackCount }, (_, index) => ({ index }));
  return {
    path,
    audioTracks,
    selectedTrack: audioTracks[0],
    sourceVersion: { canonicalPath: path, sha256: "fixture", byteLength: 10 },
  };
}

function mountQueue(files = []) {
  const begin = vi.fn((path, _settings, _probe, _existingId, _activate) => path);
  const stop = vi.fn(async () => {});
  const options = {
    enabled: true,
    files,
    activeFileId: "displayed",
    getSettings: () => ({}),
    begin,
    select: vi.fn(),
    stop,
  };
  const hook = renderHook(
    ({ busy, sessions = files, dialogue = false }) =>
      useFileImportQueue({
        ...options,
        busy,
        files: sessions,
        getSettings: dialogue ? () => ({ dialogue: { enabled: true } }) : options.getSettings,
      }),
    {
      initialProps: /** @type {{ busy: boolean, sessions?: any[], dialogue?: boolean }} */ ({
        busy: false,
      }),
    }
  );
  return { ...hook, begin, stop };
}

beforeEach(() => {
  vi.mocked(probeFileAnalysis).mockReset();
  vi.mocked(probeFileAnalysis).mockImplementation(async (path) => probe(path));
});

it("preserves an explicitly selected result until the running row is selected again", async () => {
  const { result, rerender, begin } = mountQueue([{ id: "displayed" }]);
  act(() => result.current.enqueue(["one.wav", "two.wav", "three.wav"]));
  await waitFor(() => expect(begin).toHaveBeenCalledTimes(1));
  rerender({ busy: true });
  act(() => result.current.onFileSelected("displayed"));
  act(() => result.current.enqueue(["four.wav"]));
  expect(begin).toHaveBeenCalledTimes(1);
  rerender({ busy: false });
  await waitFor(() =>
    expect(begin).toHaveBeenNthCalledWith(2, "two.wav", {}, probe("two.wav"), null, false)
  );
  rerender({ busy: true });
  act(() => result.current.onFileSelected("two.wav"));
  rerender({ busy: false });
  await waitFor(() =>
    expect(begin).toHaveBeenNthCalledWith(3, "three.wav", {}, probe("three.wav"), null, true)
  );
});

it("continues after a probe failure and defers multi-track files until a track is chosen", async () => {
  vi.mocked(probeFileAnalysis)
    .mockRejectedValueOnce(new Error("Cannot decode"))
    .mockResolvedValueOnce(probe("video.mov", 2));
  const { result, rerender, begin } = mountQueue();
  act(() => result.current.enqueue(["bad.wav", "video.mov", "third.wav"]));
  await waitFor(() =>
    expect(begin).toHaveBeenCalledWith("third.wav", {}, probe("third.wav"), null, true)
  );
  expect(result.current.items.map(({ state }) => state)).toEqual(["error", "track"]);
  rerender({ busy: true });
  act(() => result.current.chooseTrack(result.current.items[1].id));
  act(() => result.current.enqueue(["fourth.wav", "third.wav"]));
  vi.mocked(probeFileAnalysis).mockImplementation(async (path) =>
    probe(path, path === "video.mov" ? 2 : 1)
  );
  act(() => result.current.confirm(1));
  rerender({ busy: false });
  await waitFor(() =>
    expect(begin).toHaveBeenNthCalledWith(2, "fourth.wav", {}, probe("fourth.wav"), null, true)
  );
  rerender({ busy: true });
  rerender({ busy: false });
  await waitFor(() => expect(begin.mock.calls[2]?.[2].selectedTrack.index).toBe(1));
  expect(begin.mock.calls.map(([path]) => path)).toEqual(["third.wav", "fourth.wav", "video.mov"]);
});

it("stops one running item and cancels the rest only on Cancel Batch", async () => {
  const { result, rerender, begin, stop } = mountQueue();
  act(() => result.current.enqueue(["one.wav", "two.wav", "three.wav"]));
  await waitFor(() => expect(begin).toHaveBeenCalledTimes(1));
  rerender({ busy: true });
  await act(async () => result.current.stopCurrent());
  expect(stop).toHaveBeenCalledWith("one.wav");
  rerender({ busy: false });
  await waitFor(() => expect(begin).toHaveBeenCalledTimes(2));
  rerender({ busy: true });
  await act(async () => result.current.cancelBatch());
  expect(stop).toHaveBeenCalledWith("two.wav");
  expect(result.current.items).toEqual([
    expect.objectContaining({ path: "three.wav", state: "paused" }),
  ]);
  rerender({ busy: false });
  expect(begin).toHaveBeenCalledTimes(2);
});

it("discards a canceled probe before starting the next item", async () => {
  let completeProbe;
  vi.mocked(probeFileAnalysis).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        completeProbe = resolve;
      })
  );
  const { result, begin } = mountQueue();
  act(() => result.current.enqueue(["one.wav", "two.wav"]));
  await waitFor(() => expect(result.current.probing).toBe(true));
  await act(async () => result.current.stopCurrent());
  await act(async () => completeProbe(probe("one.wav")));
  await waitFor(() =>
    expect(begin).toHaveBeenCalledWith("two.wav", {}, probe("two.wav"), null, true)
  );
  expect(begin).toHaveBeenCalledTimes(1);
});

it("resumes the interrupted file and pending files in order with their original settings", async () => {
  const { result, rerender, begin } = mountQueue();
  act(() => result.current.enqueue(["one.wav", "two.wav", "three.wav"]));
  await waitFor(() => expect(begin).toHaveBeenCalledTimes(1));
  rerender({ busy: true });
  await act(async () => result.current.stopCurrent());
  const one = {
    id: "one.wav",
    state: "canceled",
    runOutcome: "stopped",
    metadata: probe("one.wav"),
  };
  rerender({ busy: false, sessions: [one] });
  await waitFor(() => expect(begin).toHaveBeenCalledTimes(2));
  rerender({ busy: true, sessions: [one] });
  await act(async () => result.current.cancelBatch());
  const two = { ...one, id: "two.wav", metadata: probe("two.wav") };
  rerender({ busy: false, sessions: [one, two], dialogue: true });
  await waitFor(() => expect(result.current.active).toBe(false));
  expect(result.current.items.map((item) => [item.path, item.state])).toEqual([
    ["two.wav", "paused"],
    ["three.wav", "paused"],
  ]);
  act(() => result.current.resumeBatch());
  await waitFor(() =>
    expect(begin).toHaveBeenNthCalledWith(3, "two.wav", {}, probe("two.wav"), "two.wav", true)
  );
  rerender({ busy: true, sessions: [one, two], dialogue: true });
  rerender({ busy: false, sessions: [one, two], dialogue: true });
  await waitFor(() =>
    expect(begin).toHaveBeenNthCalledWith(4, "three.wav", {}, probe("three.wav"), null, true)
  );
});
