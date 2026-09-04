import { describe, expect, it } from "vitest";
import {
  buildTransportSnapshot,
  planTransportMutation,
  transportLifecycleSignature,
} from "./transportControl.js";

const runtime = {
  sourceMode: "file",
  liveLifecycle: "stopped",
  liveResolvedDeviceId: null,
  liveStartedAt: null,
  liveLastError: null,
  activeFileId: "file-1",
  analyzingFileId: null,
  fileSessions: [
    {
      id: "file-1",
      path: "C:\\audio\\mix.wav",
      fileName: "mix.wav",
      state: "complete",
      progress: 1,
      metadata: { durationMs: 1000 },
      summary: { integratedLufs: -23 },
      createdAt: 10,
      analyzedAt: 20,
      decodedFrames: 48000,
      historyTruncated: false,
      historyCoveredMs: 1000,
      analysisSettings: { dialogueVadEngine: "firered" },
      error: null,
      intake: { rows: [1, 2, 3] },
    },
  ],
};

const context = {
  requestedDeviceId: "default",
  atLiveEdge: true,
  docked: false,
};

describe("Transport Control", () => {
  it("serializes lifecycle state without intake objects", () => {
    const snapshot = buildTransportSnapshot(runtime, context);
    expect(snapshot).toEqual({
      source: "file",
      live: {
        state: "stopped",
        requestedDeviceId: "default",
        resolvedDeviceId: null,
        startedAt: null,
        atLiveEdge: true,
        error: null,
      },
      files: {
        activeId: "file-1",
        analyzingId: null,
        sessions: [
          {
            id: "file-1",
            path: "C:\\audio\\mix.wav",
            fileName: "mix.wav",
            state: "complete",
            progress: 1,
            probe: { durationMs: 1000 },
            summary: { integratedLufs: -23 },
            createdAt: 10,
            analyzedAt: 20,
            decodedFrames: 48000,
            historyTruncated: false,
            historyCoveredMs: 1000,
            analysisSettings: { dialogueVadEngine: "firered" },
            error: null,
          },
        ],
      },
    });
    expect(JSON.stringify(snapshot)).not.toContain("intake");
  });

  it("does not revise for progress but revises for lifecycle and selection", () => {
    const snapshot = buildTransportSnapshot(runtime, context);
    const progressed = structuredClone(snapshot);
    progressed.files.sessions[0].progress = 0.5;
    expect(transportLifecycleSignature(progressed)).toBe(transportLifecycleSignature(snapshot));
    progressed.files.sessions[0].state = "error";
    expect(transportLifecycleSignature(progressed)).not.toBe(transportLifecycleSignature(snapshot));
  });

  it("plans explicit source and LIVE actions with confirmation and no-op semantics", () => {
    const stopped = buildTransportSnapshot(runtime, context);
    expect(planTransportMutation(stopped, "transport.live.stop", {}, context).changed).toEqual([]);
    expect(planTransportMutation(stopped, "transport.source.live", {}, context)).toMatchObject({
      changed: ["transport.source"],
      effects: [],
    });
    const analyzing = {
      ...stopped,
      files: { ...stopped.files, analyzingId: "file-1" },
    };
    expect(
      planTransportMutation(analyzing, "transport.live.start", {}, context).confirmation
    ).toEqual({ requiredFlag: "allowStopFileAnalysis" });
  });

  it("validates file targets and refuses FILE entry while docked", () => {
    const snapshot = buildTransportSnapshot(runtime, context);
    expect(
      planTransportMutation(snapshot, "transport.file.select", { sessionId: "missing" }, context)
        .issues
    ).toEqual([expect.objectContaining({ code: "fileSessionNotFound" })]);
    expect(
      planTransportMutation(snapshot, "transport.source.file", {}, { ...context, docked: true })
        .refusal
    ).toEqual({ code: "dockActive" });
    expect(
      planTransportMutation(
        { ...snapshot, source: "live" },
        "transport.file.reanalyze",
        { sessionId: "file-1" },
        { ...context, docked: true }
      ).refusal
    ).toEqual({ code: "dockActive" });
  });

  it("previews affected and evicted FILE sessions", () => {
    const snapshot = buildTransportSnapshot(runtime, context);
    snapshot.files.sessions = Array.from({ length: 5 }, (_, index) => ({
      ...snapshot.files.sessions[0],
      id: `file-${index + 1}`,
      state: "complete",
    }));
    snapshot.files.activeId = "file-5";
    expect(
      planTransportMutation(snapshot, "transport.file.analyze", {}, context).evictedSessions
    ).toEqual([expect.objectContaining({ id: "file-1" })]);
    expect(
      planTransportMutation(snapshot, "transport.file.remove", { sessionId: "file-2" }, context)
        .affectedSessions
    ).toEqual([expect.objectContaining({ id: "file-2" })]);
    expect(
      planTransportMutation(snapshot, "transport.file.clear", {}, context).affectedSessions
    ).toHaveLength(5);
  });
});
