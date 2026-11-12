/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useFileImport } from "./useFileImport.js";
import { probeFileAnalysis } from "../ipc/commands.js";
vi.mock("../ipc/commands.js", () => ({ probeFileAnalysis: vi.fn() }));
vi.mock("../ipc/env.js", () => ({ isTauri: () => true }));
const track = { index: 1, language: "eng", channels: 2 };
const probe = {
  path: "C:/mix.mkv",
  fileName: "mix.mkv",
  selectedTrack: track,
  audioTracks: [track, { index: 2, language: "zho", channels: 6 }],
  sourceVersion: { canonicalPath: "C:/mix.mkv", sha256: "abc", byteLength: 10 },
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(probeFileAnalysis).mockResolvedValue(probe);
});
function mount(files = []) {
  const begin = vi.fn(),
    select = vi.fn();
  const settings = { dialogue: { enabled: true, engine: "firered" } };
  const hook = renderHook(() =>
    useFileImport({
      files,
      busy: false,
      getSettings: () => settings,
      begin,
      select,
      raiseNotice: vi.fn(),
    })
  );
  return { ...hook, begin, select, settings };
}
it("waits for track confirmation and freezes settings before probing", async () => {
  const { result, begin, settings } = mount();
  await act(async () => result.current.importFile(probe.path));
  expect(begin).not.toHaveBeenCalled();
  settings.dialogue.engine = "silero";
  act(() => result.current.confirm(2));
  expect(begin).toHaveBeenCalledWith(
    probe.path,
    { dialogue: { enabled: true, engine: "firered" } },
    expect.objectContaining({ selectedTrack: { index: 2, language: "zho", channels: 6 } })
  );
});
it("selects an identical file/track result without recomputation", async () => {
  const { result, begin, select } = mount([
    {
      id: "old",
      metadata: probe,
      state: "complete",
      summary: {},
      analysisSettings: { dialogue: { enabled: true, engine: "firered" } },
    },
  ]);
  await act(async () => result.current.importFile(probe.path));
  act(() => result.current.confirm(1));
  expect(select).toHaveBeenCalledWith("old");
  expect(begin).not.toHaveBeenCalled();
});
it.each(["canceled", "error"])("restarts a %s entry without a result on Open", async (state) => {
  const singleTrack = { ...probe, audioTracks: [track] };
  vi.mocked(probeFileAnalysis).mockResolvedValue(singleTrack);
  const { result, begin, select, settings } = mount([{ id: "old", metadata: singleTrack, state }]);
  await act(async () => result.current.importFile(probe.path));
  expect(begin).toHaveBeenCalledWith(probe.path, settings, singleTrack, "old");
  expect(select).not.toHaveBeenCalled();
});
it("creates another entry for another track or changed content", async () => {
  const { result, begin, select } = mount([
    { id: "old", metadata: { ...probe, sourceVersion: { ...probe.sourceVersion, sha256: "old" } } },
  ]);
  await act(async () => result.current.importFile(probe.path));
  act(() => result.current.confirm(1));
  expect(begin).toHaveBeenCalledTimes(1);
  expect(select).not.toHaveBeenCalled();
});
it("ignores a late probe after cancellation and preserves the selected result", async () => {
  let finish;
  vi.mocked(probeFileAnalysis).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const { result, begin, select } = mount();
  let pending;
  act(() => {
    pending = result.current.importFile(probe.path);
  });
  act(() => result.current.cancel());
  await act(async () => {
    finish(probe);
    await pending;
  });
  expect(result.current.selection).toBeNull();
  expect(begin).not.toHaveBeenCalled();
  expect(select).not.toHaveBeenCalled();
});
