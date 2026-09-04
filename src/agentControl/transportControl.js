function cloneJson(value) {
  if (value == null) return value ?? null;
  return JSON.parse(JSON.stringify(value));
}

function compactError(error) {
  if (error == null) return null;
  if (typeof error === "string") return { message: error };
  return { message: error.message || String(error) };
}

function publicFileState(state) {
  if (state === "ready" || state === "empty") return "stopped";
  return ["probing", "analyzing", "complete", "stopped", "error"].includes(state) ? state : "error";
}

function serializeFileSession(session) {
  return {
    id: session.id,
    path: session.path,
    fileName: session.fileName,
    state: publicFileState(session.state),
    progress: Number.isFinite(session.progress) ? Math.max(0, Math.min(1, session.progress)) : 0,
    probe: cloneJson(session.metadata),
    summary: cloneJson(session.summary),
    createdAt: session.createdAt ?? null,
    analyzedAt: session.analyzedAt ?? null,
    decodedFrames: Number.isFinite(session.decodedFrames) ? session.decodedFrames : 0,
    historyTruncated: session.historyTruncated === true,
    historyCoveredMs: Number.isFinite(session.historyCoveredMs) ? session.historyCoveredMs : null,
    analysisSettings: cloneJson(session.analysisSettings),
    error: compactError(session.error),
  };
}

export function buildTransportSnapshot(runtime, context = {}) {
  return {
    source: runtime.sourceMode === "file" ? "file" : "live",
    live: {
      state: runtime.liveLifecycle ?? (runtime.running ? "running" : "stopped"),
      requestedDeviceId: context.requestedDeviceId ?? "default",
      resolvedDeviceId: runtime.liveResolvedDeviceId ?? null,
      startedAt: runtime.liveStartedAt ?? null,
      atLiveEdge: context.atLiveEdge !== false,
      error: compactError(runtime.liveLastError),
    },
    files: {
      activeId: runtime.activeFileId ?? null,
      analyzingId: runtime.analyzingFileId ?? null,
      sessions: (runtime.fileSessions ?? []).map(serializeFileSession),
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
    files: {
      activeId: snapshot.files.activeId,
      analyzingId: snapshot.files.analyzingId,
      sessions: snapshot.files.sessions.map(({ id, path, state, error }) => ({
        id,
        path,
        state,
        error,
      })),
    },
  });
}

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

export function planTransportMutation(snapshot, method, params = {}, context = {}) {
  const targetId = params.sessionId;
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
    method === "transport.file.select";
  if (entersFile && context.docked === true) {
    return result({ refusal: { code: "dockActive" } });
  }

  if (method === "transport.source.live") {
    if (snapshot.source === "live" && snapshot.files.analyzingId === null) return result();
    if (snapshot.files.analyzingId && params.allowStopFileAnalysis !== true) {
      return result({ confirmation: { requiredFlag: "allowStopFileAnalysis" } });
    }
    return result({
      changed: ["transport.source"],
      effects: snapshot.files.analyzingId ? ["stopFileAnalysis"] : [],
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
    if (snapshot.files.analyzingId && params.allowStopFileAnalysis !== true) {
      return result({ confirmation: { requiredFlag: "allowStopFileAnalysis" } });
    }
    return result({
      changed: [
        ...(snapshot.source !== "live" ? ["transport.source"] : []),
        "transport.live.state",
      ],
      effects: snapshot.files.analyzingId ? ["stopFileAnalysis"] : [],
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
    if (snapshot.files.analyzingId) {
      return result({ refusal: { code: "analysisInProgress" } });
    }
    const retained = [...snapshot.files.sessions];
    const evictedSessions = [];
    while (retained.length >= 5) {
      const index = retained.findIndex(
        (session) =>
          session.id !== snapshot.files.activeId &&
          session.id !== snapshot.files.analyzingId &&
          ["complete", "stopped", "error"].includes(session.state)
      );
      if (index < 0) break;
      evictedSessions.push(retained[index]);
      retained.splice(index, 1);
    }
    return result({
      changed: [...(snapshot.source !== "file" ? ["transport.source"] : []), "transport.files"],
      effects: snapshot.live.state === "running" ? ["stopLiveCapture"] : [],
      evictedSessions,
    });
  }
  if (method === "transport.file.reanalyze") {
    if (snapshot.files.analyzingId) {
      return result({ refusal: { code: "analysisInProgress" } });
    }
    return result({
      changed: ["transport.files"],
      effects: snapshot.source !== "file" ? ["selectFileSource"] : [],
      affectedSessions: [target],
    });
  }
  if (method === "transport.file.stop") {
    if (snapshot.files.analyzingId !== targetId) {
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
    if (snapshot.files.sessions.length === 0) return result();
    return result({
      changed: ["transport.files"],
      effects: ["clearFileSessions"],
      affectedSessions: [...snapshot.files.sessions],
    });
  }
  return result({ issues: [issue("methodNotFound", "$.method", `Unknown method: ${method}.`)] });
}
