/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { startFileProbe } from "../ipc/commands.js";
import { useFileImportQueue } from "./useFileImportQueue.js";

vi.mock("../ipc/commands.js", () => ({ startFileProbe: vi.fn() }));

const probeFileAnalysis = vi.fn();
const cancelProbe = vi.fn();

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
  probeFileAnalysis.mockReset();
  probeFileAnalysis.mockImplementation(async (path) => probe(path));
  cancelProbe.mockReset();
  cancelProbe.mockResolvedValue(undefined);
  vi.mocked(startFileProbe).mockImplementation((path) => ({
    result: probeFileAnalysis(path),
    cancel: cancelProbe,
  }));
});

it("drops the batch session ID after its result is removed", async () => {
  const { result, begin, rerender } = mountQueue();
  act(() => result.current.enqueue(["one.wav"]));
  await waitFor(() => expect(begin).toHaveBeenCalledOnce());
  rerender({ busy: true });
  rerender({ busy: false, sessions: [{ id: "one.wav", state: "complete" }] });
  await waitFor(() => expect(result.current.active).toBe(false));
  expect(result.current.sessionIds.has("one.wav")).toBe(true);

  rerender({ busy: false, sessions: [] });
  expect(result.current.sessionIds.has("one.wav")).toBe(false);
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

it("continues the remaining batch when the current analysis cannot be stopped", async () => {
  const { result, rerender, begin, stop } = mountQueue();
  act(() => result.current.enqueue(["one.wav", "two.wav"]));
  await waitFor(() => expect(begin).toHaveBeenCalledOnce());
  rerender({ busy: true });
  stop.mockRejectedValueOnce(new Error("Native stop failed"));
  await act(async () => {
    await expect(result.current.cancelBatch()).rejects.toThrow("Native stop failed");
  });
  expect(result.current.items).toMatchObject([{ path: "two.wav", state: "queued" }]);
  expect(result.current.canResume).toBe(false);
  rerender({ busy: false });
  await waitFor(() => expect(begin).toHaveBeenCalledTimes(2));
});

it("cancels the native probe before starting the next item", async () => {
  let cancelResult;
  vi.mocked(probeFileAnalysis).mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        cancelResult = reject;
      })
  );
  cancelProbe.mockImplementationOnce(async () => cancelResult(new Error("canceled")));
  const { result, begin } = mountQueue();
  act(() => result.current.enqueue(["one.wav", "two.wav"]));
  await waitFor(() => expect(result.current.probing).toBe(true));
  await act(async () => result.current.stopCurrent());
  expect(cancelProbe).toHaveBeenCalledOnce();
  await waitFor(() =>
    expect(begin).toHaveBeenCalledWith("two.wav", {}, probe("two.wav"), null, true)
  );
  expect(begin).toHaveBeenCalledTimes(1);
  expect(result.current.snapshot.items.find(({ path }) => path === "one.wav")?.state).toBe(
    "canceled"
  );
});

it("queues explicit retries for distinct tracks of the same file", () => {
  const source = probe("movie.mov", 2);
  const sessions = source.audioTracks.map((selectedTrack) => ({
    id: `session-${selectedTrack.index}`,
    path: source.path,
    metadata: { ...source, selectedTrack },
  }));
  const { result, rerender } = mountQueue(sessions);
  rerender({ busy: true });
  act(() => {
    result.current.retrySession(sessions[0]);
    result.current.retrySession(sessions[1]);
    result.current.retrySession(sessions[0]);
  });
  expect(
    result.current.snapshot.items.map(({ sessionId, trackIndex }) => [sessionId, trackIndex])
  ).toEqual([
    ["session-0", 0],
    ["session-1", 1],
  ]);
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

it("requires a new track choice when retrying a changed multi-track source", async () => {
  const original = probe("movie.mov", 2);
  const session = {
    id: "failed",
    path: original.path,
    metadata: {
      ...original,
      selectedTrack: original.audioTracks[1],
    },
  };
  const changed = {
    ...original,
    sourceVersion: { ...original.sourceVersion, sha256: "replacement" },
  };
  vi.mocked(probeFileAnalysis).mockResolvedValue(changed);
  const { result, begin } = mountQueue([session]);

  act(() => result.current.retrySession(session));
  await waitFor(() => expect(result.current.snapshot.items[0]?.state).toBe("track"));
  expect(begin).not.toHaveBeenCalled();

  act(() => result.current.confirmTrack(result.current.items[0].id, 0));
  await waitFor(() => expect(begin).toHaveBeenCalledWith(original.path, {}, changed, null, true));
});

it.each(["unchanged", "single-track replacement"])(
  "retries an %s source on the available track",
  async (kind) => {
    const original = probe("movie.mov", 2);
    const session = {
      id: "failed",
      path: original.path,
      metadata: {
        ...original,
        selectedTrack: original.audioTracks[1],
      },
    };
    const replacement = probe("movie.mov");
    replacement.sourceVersion.sha256 = "replacement";
    const expectedProbe = kind === "unchanged" ? session.metadata : replacement;
    vi.mocked(probeFileAnalysis).mockResolvedValue(kind === "unchanged" ? original : replacement);
    const { result, begin } = mountQueue([session]);

    act(() => result.current.retrySession(session));

    await waitFor(() =>
      expect(begin).toHaveBeenCalledWith(
        original.path,
        {},
        expectedProbe,
        kind === "unchanged" ? session.id : null,
        true
      )
    );
  }
);
