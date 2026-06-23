import { describe, expect, it } from "vitest";
import { FrameIntake } from "./FrameIntake.js";
import {
  FILE_ANALYSIS_HISTORY_LIMIT,
  addFileEntry,
  clearFileHistory,
  createInitialFileHistory,
  getActiveFileSession,
  getAnalyzingFileSession,
  markFileAnalysisComplete,
  markFileAnalysisError,
  removeFileEntry,
  selectFileEntry,
  startFileAnalysisEntry,
  updateFileEntry,
} from "./fileAnalysisSessionRegistry.js";

function makeEntry(history, id, overrides = {}) {
  return addFileEntry(history, {
    id,
    path: `C:\\mixes\\${id}.wav`,
    intake: new FrameIntake(),
    createdAt: overrides.createdAt ?? id.charCodeAt(0),
    ...overrides,
  });
}

describe("fileAnalysisSessionRegistry", () => {
  it("creates duplicate path imports as distinct active-ready entries with distinct intake objects", () => {
    const firstIntake = new FrameIntake();
    const secondIntake = new FrameIntake();
    let history = createInitialFileHistory();

    history = addFileEntry(history, {
      id: "first",
      path: "C:\\mixes\\song.wav",
      intake: firstIntake,
      createdAt: 1,
    });
    history = addFileEntry(history, {
      id: "second",
      path: "C:\\mixes\\song.wav",
      intake: secondIntake,
      createdAt: 2,
    });

    expect(history.order).toEqual(["first", "second"]);
    expect(history.activeFileId).toBe("second");
    expect(history.sessionsById.first).toMatchObject({
      id: "first",
      path: "C:\\mixes\\song.wav",
      fileName: "song.wav",
      state: "ready",
    });
    expect(history.sessionsById.second).toMatchObject({
      id: "second",
      path: "C:\\mixes\\song.wav",
      fileName: "song.wav",
      state: "ready",
    });
    expect(history.sessionsById.first.intake).toBe(firstIntake);
    expect(history.sessionsById.second.intake).toBe(secondIntake);
    expect(history.sessionsById.first.intake).not.toBe(history.sessionsById.second.intake);
  });

  it("keeps active and analyzing identities separate", () => {
    let history = createInitialFileHistory();
    history = makeEntry(history, "one");
    history = makeEntry(history, "two");
    history = startFileAnalysisEntry(history, "one");
    history = selectFileEntry(history, "two");

    expect(history.activeFileId).toBe("two");
    expect(history.analyzingFileId).toBe("one");
    expect(getActiveFileSession(history).id).toBe("two");
    expect(getAnalyzingFileSession(history).id).toBe("one");
  });

  it("updates only the targeted entry", () => {
    let history = createInitialFileHistory();
    history = makeEntry(history, "one");
    history = makeEntry(history, "two");

    const updated = updateFileEntry(history, "one", (entry) => ({
      ...entry,
      progress: 0.5,
      metadata: { sampleRate: 48000 },
    }));

    expect(updated.sessionsById.one).toMatchObject({
      progress: 0.5,
      metadata: { sampleRate: 48000 },
    });
    expect(updated.sessionsById.two).toBe(history.sessionsById.two);
  });

  it("selects the most recent remaining entry when removing the active entry", () => {
    let history = createInitialFileHistory();
    history = makeEntry(history, "one", { createdAt: 1 });
    history = makeEntry(history, "two", { createdAt: 2 });
    history = makeEntry(history, "three", { createdAt: 3 });

    history = removeFileEntry(history, "three");

    expect(history.order).toEqual(["one", "two"]);
    expect(history.activeFileId).toBe("two");
  });

  it("clears the analyzing identity when removing the analyzing entry", () => {
    let history = createInitialFileHistory();
    history = makeEntry(history, "one");
    history = makeEntry(history, "two");
    history = startFileAnalysisEntry(history, "one");

    history = removeFileEntry(history, "one");

    expect(history.analyzingFileId).toBeNull();
    expect(history.activeFileId).toBe("two");
  });

  it("retains at most five entries by evicting the oldest non-active completed/error/ready entry", () => {
    let history = createInitialFileHistory();
    for (let index = 1; index <= FILE_ANALYSIS_HISTORY_LIMIT; index++) {
      history = makeEntry(history, `entry-${index}`, { createdAt: index });
      history =
        index === 2
          ? markFileAnalysisError(history, `entry-${index}`, { error: "failed", analyzedAt: index })
          : markFileAnalysisComplete(history, `entry-${index}`, {
              summary: { durationMs: index },
              decodedFrames: index,
              historyCoveredMs: index * 1000,
              analyzedAt: index,
            });
    }

    history = addFileEntry(history, {
      id: "entry-6",
      path: "C:\\mixes\\entry-6.wav",
      intake: new FrameIntake(),
      createdAt: 6,
    });

    expect(history.order).toHaveLength(FILE_ANALYSIS_HISTORY_LIMIT);
    expect(history.sessionsById["entry-1"]).toBeUndefined();
    expect(history.sessionsById["entry-2"]).toBeDefined();
    expect(history.activeFileId).toBe("entry-6");
  });

  it("leaves history temporarily over limit when only active or analyzing entries are removable", () => {
    let history = createInitialFileHistory();
    for (let index = 1; index <= FILE_ANALYSIS_HISTORY_LIMIT; index++) {
      history = makeEntry(history, `running-${index}`, { createdAt: index });
      history = updateFileEntry(history, `running-${index}`, (entry) => ({
        ...entry,
        state: "analyzing",
      }));
    }
    history = startFileAnalysisEntry(history, "running-1");

    history = addFileEntry(history, {
      id: "new-active",
      path: "C:\\mixes\\new-active.wav",
      intake: new FrameIntake(),
      createdAt: 6,
    });

    expect(history.order).toHaveLength(FILE_ANALYSIS_HISTORY_LIMIT + 1);
    expect(history.activeFileId).toBe("new-active");
    expect(history.analyzingFileId).toBe("running-1");
  });

  it("clears sessions, order, and ids", () => {
    let history = createInitialFileHistory();
    history = makeEntry(history, "one");
    history = startFileAnalysisEntry(history, "one");

    expect(clearFileHistory(history)).toEqual(createInitialFileHistory());
  });

  it("resets an entry when analysis starts and records completion payloads", () => {
    let history = createInitialFileHistory();
    history = makeEntry(history, "one");
    history = updateFileEntry(history, "one", (entry) => ({
      ...entry,
      summary: { stale: true },
      error: "stale",
      progress: 0.75,
      historyTruncated: true,
      historyCoveredMs: 123,
      decodedFrames: 456,
    }));

    history = startFileAnalysisEntry(history, "one");

    expect(history.sessionsById.one).toMatchObject({
      state: "analyzing",
      progress: 0,
      error: null,
      summary: null,
      historyTruncated: false,
      historyCoveredMs: null,
      decodedFrames: 0,
      runId: 1,
    });

    history = markFileAnalysisComplete(history, "one", {
      summary: { durationMs: 9000 },
      decodedFrames: 2048,
      historyTruncated: true,
      historyCoveredMs: 8000,
      analyzedAt: 10,
    });

    expect(history.analyzingFileId).toBeNull();
    expect(history.sessionsById.one).toMatchObject({
      state: "complete",
      progress: 1,
      summary: { durationMs: 9000 },
      decodedFrames: 2048,
      historyTruncated: true,
      historyCoveredMs: 8000,
      analyzedAt: 10,
    });
  });

  it("records errors and clears matching analyzing identity", () => {
    let history = createInitialFileHistory();
    history = makeEntry(history, "one");
    history = startFileAnalysisEntry(history, "one");

    history = markFileAnalysisError(history, "one", { error: "decode failed", analyzedAt: 20 });

    expect(history.analyzingFileId).toBeNull();
    expect(history.sessionsById.one).toMatchObject({
      state: "error",
      error: "decode failed",
      analyzedAt: 20,
    });
  });
});
