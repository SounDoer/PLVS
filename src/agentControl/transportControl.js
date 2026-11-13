import { getSuccessfulFileSession } from "../lib/fileAnalysisSessionRegistry.js";
import { withSelectedAudioTrack } from "../lib/fileAnalysisSource.js";
import { fileImportTracks } from "../lib/fileImportPlan.js";
import { semanticFailure } from "./bridge/failures.js";

function cloneJson(value) {
  if (value == null) return value ?? null;
  return JSON.parse(JSON.stringify(value));
}

function compactError(error) {
  if (error == null) return null;
  if (typeof error === "string") return { message: error };
  return { message: error.message || String(error) };
}

/**
 * @param {string} state
 */
function publicFileState(state) {
  if (state === "ready" || state === "canceled" || state === "empty") return "stopped";
  return ["probing", "analyzing", "complete", "stopped", "error"].includes(state) ? state : "error";
}

function serializeFileSession(session) {
  const result = getSuccessfulFileSession(session) ?? session;
  return {
    id: session.id,
    path: session.path,
    fileName: session.fileName,
    state: publicFileState(session.state),
    runId: session.runId ?? 0,
    runOutcome: session.runOutcome ?? null,
    progress: Number.isFinite(session.progress) ? Math.max(0, Math.min(1, session.progress)) : 0,
    probe: cloneJson(result.metadata),
    summary: cloneJson(result.summary),
    createdAt: session.createdAt ?? null,
    analyzedAt: result.analyzedAt ?? null,
    decodedFrames: Number.isFinite(result.decodedFrames) ? result.decodedFrames : 0,
    analysisSettings: cloneJson(result.analysisSettings),
    error: compactError(session.error),
    historyReleased: session.historyReleased === true,
    historyAvailable: Boolean(session.intake),
    ...(session.successfulResult && session.state !== "complete" ? { resultAvailable: true } : {}),
  };
}

export function buildTransportSnapshot(runtime, context = {}) {
  const snapshotOffsetSec =
    Number.isFinite(context.selectedOffset) && context.selectedOffset >= 0
      ? context.selectedOffset
      : null;
  return {
    source: runtime.sourceMode === "file" ? "file" : "live",
    snapshot: {
      active: snapshotOffsetSec !== null,
      offsetSec: snapshotOffsetSec,
    },
    live: {
      state: runtime.liveLifecycle ?? (runtime.running ? "running" : "stopped"),
      requestedDeviceId:
        context.requestedDeviceId === undefined ? "default" : context.requestedDeviceId,
      resolvedDeviceId: runtime.liveResolvedDeviceId ?? null,
      startedAt: runtime.liveStartedAt ?? null,
      atLiveEdge: snapshotOffsetSec === null,
      error: compactError(runtime.liveLastError),
    },
    files: {
      activeId: runtime.activeFileId ?? null,
      analyzingId: runtime.analyzingFileId ?? null,
      preparingId: runtime.preparingFileId ?? null,
      sessions: (runtime.fileSessions ?? []).map(serializeFileSession),
      ...(context.fileBatch ? { batch: context.fileBatch } : {}),
    },
  };
}

export function transportLifecycleSignature(snapshot) {
  if (!snapshot) return "null";
  return JSON.stringify({
    source: snapshot.source,
    live: {
      state: snapshot.live.state,
      requestedDeviceId: snapshot.live.requestedDeviceId,
      resolvedDeviceId: snapshot.live.resolvedDeviceId,
      startedAt: snapshot.live.startedAt,
      error: snapshot.live.error,
    },
    snapshot: snapshot.snapshot,
    files: {
      activeId: snapshot.files.activeId,
      preparingId: snapshot.files.preparingId ?? null,
      analyzingId: snapshot.files.analyzingId,
      batch: snapshot.files.batch,
      sessions: snapshot.files.sessions.map(
        ({ id, path, state, runId, runOutcome, error, historyReleased }) => ({
          id,
          path,
          state,
          runId,
          runOutcome,
          error,
          historyReleased,
        })
      ),
    },
  });
}

/**
 * @param {string} method
 */
export function projectTransportMutation(snapshot, method, params = {}) {
  const projected = cloneJson(snapshot);
  if (method === "transport.snapshot.select") {
    projected.snapshot = { active: true, offsetSec: params.offsetSec };
    projected.live.atLiveEdge = false;
  } else if (method === "transport.snapshot.clear") {
    projected.snapshot = { active: false, offsetSec: null };
    projected.live.atLiveEdge = true;
  } else if (method === "transport.source.live") {
    projected.source = "live";
    const analyzingId = projected.files.analyzingId;
    projected.files.analyzingId = null;
    if (analyzingId) {
      const session = projected.files.sessions.find(({ id }) => id === analyzingId);
      if (session) session.state = "stopped";
    }
  } else if (method === "transport.source.file") {
    projected.source = "file";
    projected.live.state = "stopped";
  } else if (method === "transport.file.select") {
    projected.source = "file";
    projected.live.state = "stopped";
    projected.files.activeId = params.sessionId;
  } else if (method === "transport.file.remove") {
    projected.files.sessions = projected.files.sessions.filter(({ id }) => id !== params.sessionId);
    if (projected.files.activeId === params.sessionId) {
      projected.files.activeId = projected.files.sessions.at(-1)?.id ?? null;
    }
    if (projected.files.analyzingId === params.sessionId) projected.files.analyzingId = null;
  } else if (method === "transport.file.clear") {
    projected.files = { activeId: null, analyzingId: null, sessions: [] };
  }
  return projected;
}

/**
 * @param {string} code
 * @param {string} path
 * @param {string} message
 */
function issue(code, path, message) {
  return { code, path, message };
}

function result(overrides = {}) {
  return {
    changed: [],
    effects: [],
    warnings: [],
    issues: [],
    refusal: null,
    confirmation: null,
    affectedSessions: [],
    evictedSessions: [],
    ...overrides,
  };
}

/**
 * @param {string} method
 */
export function planTransportMutation(snapshot, method, params = {}, context = {}) {
  if (context.deviceTransitioning === true) {
    return result({ refusal: { code: "transitionInProgress", state: "restarting" } });
  }
  const targetId = params.sessionId;
  const fileTaskId = snapshot.files.analyzingId ?? snapshot.files.preparingId;
  const target = targetId
    ? snapshot.files.sessions.find((session) => session.id === targetId)
    : null;
  if (
    method.startsWith("transport.file.") &&
    !["transport.file.analyze", "transport.file.clear"].includes(method) &&
    !target
  ) {
    return result({
      issues: [
        issue(
          "fileSessionNotFound",
          "$.sessionId",
          `File session ${targetId ?? ""} was not found.`
        ),
      ],
    });
  }

  const entersFile =
    method === "transport.source.file" ||
    method === "transport.file.analyze" ||
    method === "transport.file.reanalyze" ||
    method === "transport.file.restore" ||
    method === "transport.file.select";
  if (entersFile && context.docked === true) {
    return result({ refusal: { code: "dockActive" } });
  }

  if (method === "transport.snapshot.select") {
    if (context.historyAvailable !== true) {
      return result({ refusal: { code: "historyUnavailable" } });
    }
    if (params.offsetSec > context.historyMaxOffsetSec) {
      return result({
        issues: [
          issue(
            "outOfRange",
            "$.offsetSec",
            "offsetSec is outside the currently retained history."
          ),
        ],
      });
    }
    if (snapshot.snapshot.active && snapshot.snapshot.offsetSec === params.offsetSec) {
      return result();
    }
    return result({ changed: ["transport.snapshot"] });
  }
  if (method === "transport.snapshot.clear") {
    if (!snapshot.snapshot.active) return result();
    return result({ changed: ["transport.snapshot"] });
  }

  if (method === "transport.source.live") {
    if (snapshot.source === "live" && !fileTaskId) return result();
    if (fileTaskId && params.allowStopFileAnalysis !== true) {
      return result({ confirmation: { requiredFlag: "allowStopFileAnalysis" } });
    }
    return result({
      changed: ["transport.source"],
      effects: fileTaskId ? ["stopFileAnalysis"] : [],
    });
  }
  if (method === "transport.source.file") {
    if (snapshot.source === "file") return result();
    return result({
      changed: ["transport.source"],
      effects: snapshot.live.state === "running" ? ["stopLiveCapture"] : [],
    });
  }
  if (method === "transport.live.start") {
    if (snapshot.live.state === "running") return result();
    if (["starting", "stopping"].includes(snapshot.live.state)) {
      return result({ refusal: { code: "transitionInProgress", state: snapshot.live.state } });
    }
    if (fileTaskId && params.allowStopFileAnalysis !== true) {
      return result({ confirmation: { requiredFlag: "allowStopFileAnalysis" } });
    }
    return result({
      changed: [
        ...(snapshot.source !== "live" ? ["transport.source"] : []),
        "transport.live.state",
      ],
      effects: fileTaskId ? ["stopFileAnalysis"] : [],
    });
  }
  if (method === "transport.live.stop") {
    if (snapshot.live.state === "stopped") return result();
    if (["starting", "stopping"].includes(snapshot.live.state)) {
      return result({ refusal: { code: "transitionInProgress", state: snapshot.live.state } });
    }
    return result({ changed: ["transport.live.state"] });
  }
  if (method === "transport.live.clear") {
    return result({ changed: ["transport.live.data"], effects: ["clearLiveMeasurement"] });
  }
  if (method === "transport.file.analyze") {
    if (snapshot.files.analyzingId || snapshot.files.preparingId) {
      return result({ refusal: { code: "analysisInProgress" } });
    }
    return result({
      changed: [...(snapshot.source !== "file" ? ["transport.source"] : []), "transport.files"],
      effects: snapshot.live.state === "running" ? ["stopLiveCapture"] : [],
    });
  }
  if (method === "transport.file.reanalyze" || method === "transport.file.restore") {
    if (
      method === "transport.file.restore" &&
      (!target?.historyReleased || !target?.probe?.sourceVersion || !target?.summary)
    ) {
      return result({ refusal: { code: "historyUnavailable", sessionId: targetId } });
    }
    if (snapshot.files.analyzingId || snapshot.files.preparingId) {
      return result({ refusal: { code: "analysisInProgress" } });
    }
    return result({
      changed: ["transport.files"],
      effects: snapshot.source !== "file" ? ["selectFileSource"] : [],
      affectedSessions: [target],
    });
  }
  if (method === "transport.file.stop") {
    if (snapshot.files.analyzingId !== targetId && snapshot.files.preparingId !== targetId) {
      return result({ refusal: { code: "fileAnalysisNotActive", sessionId: targetId } });
    }
    return result({
      changed: ["transport.files"],
      effects: ["stopFileAnalysis"],
      affectedSessions: [target],
    });
  }
  if (method === "transport.file.select") {
    if (snapshot.source === "file" && snapshot.files.activeId === targetId) return result();
    return result({
      changed: [
        ...(snapshot.source !== "file" ? ["transport.source"] : []),
        ...(snapshot.files.activeId !== targetId ? ["transport.files.activeId"] : []),
      ],
      effects: snapshot.live.state === "running" ? ["stopLiveCapture"] : [],
      affectedSessions: [target],
    });
  }
  if (method === "transport.file.remove") {
    return result({
      changed: ["transport.files"],
      effects: ["removeFileSession"],
      affectedSessions: [target],
    });
  }
  if (method === "transport.file.clear") {
    if (snapshot.files.sessions.length === 0 && !snapshot.files.batch?.items.length)
      return result();
    return result({
      changed: ["transport.files"],
      effects: ["clearFileSessions"],
      affectedSessions: [...snapshot.files.sessions],
    });
  }
  return result({ issues: [issue("methodNotFound", "$.method", `Unknown method: ${method}.`)] });
}

/**
 * Choose the track `transport file analyze` imports. Automation cannot answer the GUI's track
 * dialog, so a file with several tracks needs `trackIndex` rather than a silent default.
 */
export function selectImportTrack(probe, trackIndex) {
  const tracks = fileImportTracks(probe);
  const details = { path: probe.path, tracks: cloneJson(tracks) };
  if (trackIndex === undefined) {
    if (tracks.length === 1) return withSelectedAudioTrack(probe, tracks[0].index);
    throw semanticFailure(
      "fileTrackSelectionRequired",
      "$.params.trackIndex",
      "The file has several audio tracks; choose one with --track <index>.",
      -32087,
      details
    );
  }
  if (!tracks.some((track) => track?.index === trackIndex)) {
    throw semanticFailure(
      "invalidTransport",
      "$.params.trackIndex",
      `The file has no audio track with index ${trackIndex}.`,
      -32602,
      details
    );
  }
  return withSelectedAudioTrack(probe, trackIndex);
}
