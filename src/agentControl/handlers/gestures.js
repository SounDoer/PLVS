import { semanticFailure } from "../bridge/failures.js";

export const HOLD_SLOW_MAX_MS = 10000;

/**
 * Chart gestures with no other command: clearing Max Hold, resetting TP Max and press-and-hold
 * Slow Trace. Each calls the same function as the gesture on the panel; none advances the revision.
 *
 * @param {import("../bridge/types.js").BridgeContext} ctx
 */
async function run(ctx) {
  const { request, requestId, clock, live } = ctx;
  const currentRevision = clock.current();
  if (request.params.expectedRevision !== currentRevision) {
    throw semanticFailure(
      "revisionConflict",
      "$.params.expectedRevision",
      `App state changed after revision ${request.params.expectedRevision}.`,
      -32004,
      { expectedRevision: request.params.expectedRevision, currentRevision }
    );
  }
  const { panelId } = request.params;
  const gestures = live().uiNavigation?.getPanelGestures?.(panelId);
  if (!gestures) {
    throw semanticFailure(
      "panelNotFound",
      "$.params.panelId",
      `Panel ${panelId} is not currently rendered.`,
      -32010,
      { panelId }
    );
  }
  const gesture =
    request.method === "measurement.resetHold"
      ? gestures.clearMaxHold
      : request.method === "measurement.resetTruePeakMax"
        ? gestures.resetTruePeakMax
        : gestures.holdSlow;
  if (!gesture) {
    throw semanticFailure(
      "controlUnavailable",
      "$.params.panelId",
      "This gesture is unavailable for the panel in its current mode.",
      -32012,
      { panelId }
    );
  }
  if (request.method === "panel.holdSlow") {
    const durationMs = request.params.durationMs;
    gesture.start();
    try {
      await new Promise((resolve) => setTimeout(resolve, durationMs));
    } finally {
      // The panel may have changed mode meanwhile; release through the latest handlers.
      (live().uiNavigation?.getPanelGestures?.(panelId)?.holdSlow ?? gesture).stop();
    }
    return { requestId, result: { revision: clock.current(), panelId, durationMs } };
  }
  await gesture();
  return { requestId, result: { revision: clock.current(), panelId } };
}

/** @type {Record<string, import("../bridge/types.js").HandlerEntry>} */
export const gestureHandlers = {
  // Measurement methods answer outside the serialized queue, like the reads beside them.
  "measurement.resetHold": { run, lane: "direct" },
  "measurement.resetTruePeakMax": { run, lane: "direct" },
  "panel.holdSlow": { run },
};
