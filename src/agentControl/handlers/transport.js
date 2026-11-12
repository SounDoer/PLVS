import { describeActiveLoudnessProfile } from "../../lib/activeLoudnessProfile.js";
import { buildFileAnalysisReport } from "../../lib/fileAnalysisReport.js";
import { renderFileAnalysisReportMarkdown } from "../../lib/fileAnalysisReportMarkdown.js";
import { buildFileAnalysisStatisticsCsv } from "../../lib/fileAnalysisStatisticsCsv.js";
import { isTransportAction } from "../protocol.js";
import { planTransportMutation, projectTransportMutation } from "../transportControl.js";
import { semanticFailure, WAIT_CANCELLED } from "../bridge/failures.js";
import { paced } from "./paced.js";

/**
 * @param {string} method
 */
function transportMutationMatches(method, params, execution, snapshot) {
  const sessionId = execution?.sessionId ?? params.sessionId;
  if (method === "transport.snapshot.select") {
    return snapshot.snapshot.active && snapshot.snapshot.offsetSec === params.offsetSec;
  }
  if (method === "transport.snapshot.clear") return !snapshot.snapshot.active;
  if (method === "transport.source.live") {
    return snapshot.source === "live" && snapshot.files.analyzingId === null;
  }
  if (method === "transport.source.file") return snapshot.source === "file";
  if (method === "transport.live.start") {
    return snapshot.source === "live" && snapshot.live.state === "running";
  }
  if (method === "transport.live.stop") return snapshot.live.state === "stopped";
  if (method === "transport.file.analyze" && execution?.reused) {
    return snapshot.source === "file" && snapshot.files.activeId === sessionId;
  }
  if (
    method === "transport.file.analyze" ||
    method === "transport.file.reanalyze" ||
    method === "transport.file.restore"
  ) {
    if (execution?.runId) {
      return snapshot.files.sessions.some(
        (session) => session.id === sessionId && session.runId === execution.runId
      );
    }
    return (
      snapshot.source === "file" &&
      snapshot.files.analyzingId === sessionId &&
      snapshot.files.sessions.some(
        (session) => session.id === sessionId && ["probing", "analyzing"].includes(session.state)
      )
    );
  }
  if (method === "transport.file.stop") {
    return (
      snapshot.files.analyzingId !== sessionId &&
      snapshot.files.preparingId !== sessionId &&
      snapshot.files.sessions.some(
        (session) => session.id === sessionId && ["stopped", "complete"].includes(session.state)
      )
    );
  }
  if (method === "transport.file.select") {
    return snapshot.source === "file" && snapshot.files.activeId === sessionId;
  }
  if (method === "transport.file.remove") {
    return !snapshot.files.sessions.some((session) => session.id === sessionId);
  }
  if (method === "transport.file.clear") return snapshot.files.sessions.length === 0;
  return false;
}

/** @param {import("../bridge/types.js").BridgeContext} ctx */
async function inspect(ctx) {
  const { requestId, clock } = ctx;
  const { transport } = ctx.snap;
  return {
    requestId,
    result: { revision: clock.current(), ...transport },
  };
}

/** @param {import("../bridge/types.js").BridgeContext} ctx */
async function fileWait(ctx) {
  const { request, requestId, clock, waiters, live } = ctx;
  const { sessionId, runId, timeoutMs } = request.params;
  const read = () => {
    const session = live().transport.files.sessions.find(({ id }) => id === sessionId);
    const outcome = !session
      ? "unavailable"
      : session.runId > runId
        ? "superseded"
        : session.runId < runId
          ? "unavailable"
          : session.runOutcome;
    return outcome ? { revision: clock.current(), sessionId, runId, outcome } : null;
  };
  const immediate = read();
  if (immediate) return { requestId, result: immediate };
  if (waiters.entries.size >= 4) {
    throw semanticFailure("waitLimitReached", "$", "Too many long waits are active.", -32070);
  }
  const result = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      waiters.entries.delete(requestId);
      resolve(read());
    }, timeoutMs);
    waiters.entries.set(requestId, { kind: "file", read, timer, resolve });
  });
  if (result === WAIT_CANCELLED) return null;
  if (!result) {
    throw semanticFailure(
      "timeout",
      "$.params.timeoutMs",
      "File analysis did not finish before the timeout.",
      -32071,
      { sessionId, runId, revision: clock.current() }
    );
  }
  return { requestId, result };
}

function reportSession(transport, sessionId, paramPath) {
  const session = transport.files.sessions.find(({ id }) => id === sessionId);
  if (!session) {
    throw semanticFailure(
      "fileSessionNotFound",
      paramPath,
      "The FILE session was not found.",
      -32080,
      { sessionId }
    );
  }
  if (!session.summary || (session.state !== "complete" && session.resultAvailable !== true)) {
    throw semanticFailure(
      "fileAnalysisNotComplete",
      paramPath,
      "Only a completed FILE analysis can be reported.",
      -32085,
      { sessionId: session.id, state: session.state }
    );
  }
  // The public snapshot names the probe `probe`; the GUI builder reads `metadata`.
  return { ...session, state: "complete", metadata: session.probe };
}

/** @param {import("../bridge/types.js").BridgeContext} ctx */
function reportOptions(ctx) {
  const { loudnessActive, loudnessProfile } = ctx.live();
  return {
    appVersion: String(ctx.snap.runtime.appVersion),
    loudnessProfile: describeActiveLoudnessProfile({
      active: loudnessActive,
      document: loudnessProfile?.document,
      draft: loudnessProfile?.draft,
    }),
  };
}

/** @param {import("../bridge/types.js").BridgeContext} ctx */
async function fileReport(ctx) {
  const { request, requestId, clock, snap } = ctx;
  const session = reportSession(snap.transport, request.params.sessionId, "$.params.sessionId");
  const report = buildFileAnalysisReport(session, reportOptions(ctx));
  return {
    requestId,
    result: {
      revision: clock.current(),
      sessionId: session.id,
      ...(request.params.reportFormat === "markdown"
        ? { markdown: renderFileAnalysisReportMarkdown(report) }
        : { report }),
    },
  };
}

/** @param {import("../bridge/types.js").BridgeContext} ctx */
async function fileExportStatistics(ctx) {
  const { request, requestId, clock, snap } = ctx;
  const { sessionIds } = request.params;
  const sessions = sessionIds.map((id, index) =>
    reportSession(snap.transport, id, `$.params.sessionIds[${index}]`)
  );
  return {
    requestId,
    result: {
      revision: clock.current(),
      sessionIds,
      csv: buildFileAnalysisStatisticsCsv(sessions, reportOptions(ctx)),
    },
  };
}

/** @param {import("../bridge/types.js").BridgeContext} ctx */
async function mutate(ctx) {
  const { request, requestId, clock, settlement, live } = ctx;
  const { transportContext, executeTransport } = ctx.snap;
  const currentRevision = clock.current();
  if (
    request.params.expectedRevision !== undefined &&
    request.params.expectedRevision !== currentRevision
  ) {
    throw semanticFailure(
      "revisionConflict",
      "$.params.expectedRevision",
      `Transport changed after revision ${request.params.expectedRevision}.`,
      -32004,
      {
        expectedRevision: request.params.expectedRevision,
        currentRevision,
      }
    );
  }
  const planned = planTransportMutation(
    live().transport,
    request.method,
    request.params,
    transportContext
  );
  if (planned.issues.length > 0) {
    const missing = planned.issues.some(({ code }) => code === "fileSessionNotFound");
    throw semanticFailure(
      missing ? "fileSessionNotFound" : "invalidTransport",
      missing ? "$.params.sessionId" : "$.params",
      missing ? "The FILE session was not found." : "The Transport request is invalid.",
      missing ? -32080 : -32602,
      { issues: planned.issues }
    );
  }
  if (planned.refusal) {
    const refusalCodes = {
      transitionInProgress: -32081,
      analysisInProgress: -32082,
      dockActive: -32083,
      fileAnalysisNotActive: -32084,
      historyUnavailable: -32086,
    };
    throw semanticFailure(
      planned.refusal.code,
      "$.params",
      "The Transport operation is unavailable in the current state.",
      refusalCodes[planned.refusal.code] ?? -32012,
      planned.refusal
    );
  }
  if (planned.confirmation) {
    throw semanticFailure(
      "confirmationRequired",
      "$.params.allowStopFileAnalysis",
      "Active FILE analysis must be stopped before switching to LIVE.",
      -32041,
      planned.confirmation
    );
  }
  const action = isTransportAction(request.method);
  const result = {
    ...(action
      ? {
          action: request.method,
          status:
            request.method === "transport.file.analyze" ||
            request.method === "transport.file.reanalyze" ||
            request.method === "transport.file.restore"
              ? "accepted"
              : "completed",
        }
      : {
          dryRun: request.params.dryRun === true,
          changed: planned.changed.length > 0,
        }),
    revision: currentRevision,
    effects: planned.effects,
    warnings: planned.warnings,
    ...(planned.affectedSessions.length > 0 ? { affectedSessions: planned.affectedSessions } : {}),
    ...(planned.evictedSessions.length > 0 ? { evictedSessions: planned.evictedSessions } : {}),
    state: {
      transport: action
        ? live().transport
        : projectTransportMutation(live().transport, request.method, request.params),
    },
  };
  if (request.params.dryRun === true || planned.changed.length === 0) {
    return { requestId, result };
  }

  let execution;
  try {
    execution = await executeTransport(request.method, request.params);
  } catch (error) {
    // A refusal decided during execution, before any side effect (such as a File track choice).
    if (typeof error?.reason === "string") throw error;
    throw semanticFailure(
      "applicationFailed",
      "$.params",
      `Transport operation failed: ${error?.message || String(error)}`,
      -32050,
      {
        partial: true,
        stage: error?.stage ?? "execution",
        changed: planned.changed,
        revision: clock.current(),
        ...(error?.sessionId ? { sessionId: error.sessionId } : {}),
      }
    );
  }

  if (request.method === "transport.live.clear") {
    clock.bump();
    clock.scheduleWake();
    result.revision = clock.current();
  } else {
    const matches = (candidate) =>
      transportMutationMatches(request.method, request.params, execution, candidate);
    if (matches(live().transport)) {
      result.revision = clock.current();
    } else {
      result.revision = await settlement.observed(
        "transport",
        settlement.arm("transport", { matches }),
        "The Transport change"
      );
    }
  }
  result.state.transport = live().transport;
  if ("status" in result && result.status === "accepted" && execution?.sessionId) {
    Object.assign(result, {
      sessionId: execution.sessionId,
      ...(execution.runId > 0 ? { runId: execution.runId } : {}),
    });
  }
  Object.assign(result, execution?.result ?? {});
  if (Array.isArray(execution?.affectedSessions)) {
    result.affectedSessions = execution.affectedSessions;
  }
  if (Array.isArray(execution?.evictedSessions)) {
    result.evictedSessions = execution.evictedSessions;
  }
  return { requestId, result };
}

/** @type {Record<string, import("../bridge/types.js").HandlerEntry>} */
export const transportHandlers = {
  "transport.inspect": { run: inspect },
  "transport.file.report": { run: fileReport },
  "transport.file.exportStatistics": { run: fileExportStatistics },
  "transport.file.wait": { run: fileWait, lane: "direct" },
  "transport.file.analyze": { run: mutate },
  "transport.file.clear": { run: mutate },
  "transport.file.reanalyze": { run: mutate },
  "transport.file.restore": { run: mutate },
  "transport.file.remove": { run: mutate },
  "transport.file.select": { run: mutate },
  "transport.file.stop": { run: mutate },
  "transport.live.clear": { run: mutate },
  "transport.live.start": { run: mutate },
  "transport.live.stop": { run: mutate },
  "transport.snapshot.clear": { run: mutate },
  "transport.snapshot.select": { run: paced(mutate) },
  "transport.source.file": { run: mutate },
  "transport.source.live": { run: mutate },
};
