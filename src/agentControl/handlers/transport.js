import { describeActiveLoudnessProfile } from "../../lib/activeLoudnessProfile.js";
import { buildFileAnalysisReport } from "../../lib/fileAnalysisReport.js";
import { renderFileAnalysisReportMarkdown } from "../../lib/fileAnalysisReportMarkdown.js";
import { isTransportAction } from "../protocol.js";
import { planTransportMutation, projectTransportMutation } from "../transportControl.js";
import { semanticFailure } from "../bridge/failures.js";

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
  if (method === "transport.file.analyze" || method === "transport.file.reanalyze") {
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
      snapshot.files.sessions.some(
        (session) => session.id === sessionId && session.state === "stopped"
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
async function fileReport(ctx) {
  const { request, requestId, clock, live } = ctx;
  const { runtime, transport } = ctx.snap;
  const session = transport.files.sessions.find(({ id }) => id === request.params.sessionId);
  if (!session) {
    throw semanticFailure(
      "fileSessionNotFound",
      "$.params.sessionId",
      "The FILE session was not found.",
      -32080,
      { sessionId: request.params.sessionId }
    );
  }
  if (session.state !== "complete") {
    throw semanticFailure(
      "fileAnalysisNotComplete",
      "$.params.sessionId",
      "Only a completed FILE analysis can be reported.",
      -32085,
      { sessionId: session.id, state: session.state }
    );
  }
  const currentProfile = {
    active: live().loudnessActive,
    profile: live().loudnessProfile,
  };
  // The public snapshot names the probe `probe`; the GUI builder reads `metadata`.
  const report = buildFileAnalysisReport(
    { ...session, metadata: session.probe },
    {
      appVersion: String(runtime.appVersion),
      loudnessProfile: describeActiveLoudnessProfile({
        active: currentProfile.active,
        document: currentProfile.profile?.document,
        draft: currentProfile.profile?.draft,
      }),
    }
  );
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
            request.method === "transport.file.reanalyze"
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
  "transport.file.analyze": { run: mutate },
  "transport.file.clear": { run: mutate },
  "transport.file.reanalyze": { run: mutate },
  "transport.file.remove": { run: mutate },
  "transport.file.select": { run: mutate },
  "transport.file.stop": { run: mutate },
  "transport.live.clear": { run: mutate },
  "transport.live.start": { run: mutate },
  "transport.live.stop": { run: mutate },
  "transport.snapshot.clear": { run: mutate },
  "transport.snapshot.select": { run: mutate },
  "transport.source.file": { run: mutate },
  "transport.source.live": { run: mutate },
};
