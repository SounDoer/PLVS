import { describeActiveLoudnessProfile } from "../../lib/activeLoudnessProfile.js";

import { buildMeasurementDescription, buildMeasurementInspection } from "../measurementControl.js";
import { measurementPredicateMatches } from "../measurementPredicates.js";
import { semanticFailure, WAIT_CANCELLED } from "../bridge/failures.js";

function isDifferentPublishedMeasurement(live, afterGeneration, afterSequence) {
  const sequence = live?.record?.sequence;
  if (!Number.isSafeInteger(sequence)) return false;
  return live.generation !== afterGeneration || sequence !== (afterSequence ?? null);
}

/**
 * @param {import("../bridge/types.js").BridgeContext} ctx
 * @param {any} [liveOverride]
 */
function buildCurrentMeasurement(ctx, liveOverride) {
  const { clock } = ctx;
  const currentMeasurement = ctx.live().measurementContext;
  const currentProfile = {
    active: ctx.live().loudnessActive,
    profile: ctx.live().loudnessProfile,
  };
  const live = liveOverride ??
    currentMeasurement.getLiveMeasurement?.() ?? {
      generation: 0,
      record: null,
    };
  const record = live.record ?? null;
  const labels = currentMeasurement.getChannelLabels?.(record) ?? [];
  const profile = describeActiveLoudnessProfile({
    active: currentProfile.active,
    document: currentProfile.profile?.document,
    draft: currentProfile.profile?.draft,
  });
  return buildMeasurementInspection({
    revision: clock.current(),
    observedAtMs: Date.now(),
    liveState: currentMeasurement.liveState,
    sessionGeneration: live.generation,
    record,
    channelLabels: labels,
    vectorscopeRequest: currentMeasurement.vectorscopeRequests?.[0] ?? null,
    dialogueActive: currentMeasurement.dialogueActive === true,
    profile,
  });
}
/**
 * @param {import("../bridge/types.js").BridgeContext} ctx
 * @param {any} [liveOverride]
 */
function buildMeasurementOrFail(ctx, liveOverride) {
  try {
    return buildCurrentMeasurement(ctx, liveOverride);
  } catch (error) {
    throw semanticFailure(
      "measurementSnapshotFailed",
      "$",
      `The LIVE measurement snapshot could not be formed: ${error?.message || String(error)}`,
      -32072
    );
  }
}

/** @param {import("../bridge/types.js").BridgeContext} ctx */
async function describe(ctx) {
  const { requestId, clock } = ctx;
  return {
    requestId,
    result: buildMeasurementDescription(clock.current()),
  };
}

/** @param {import("../bridge/types.js").BridgeContext} ctx */
async function inspect(ctx) {
  const { requestId } = ctx;
  return {
    requestId,
    result: buildMeasurementOrFail(ctx),
  };
}

/** @param {import("../bridge/types.js").BridgeContext} ctx */
async function wait(ctx) {
  const { request, requestId, waiters } = ctx;
  const currentMeasurement = ctx.live().measurementContext;
  const initialLive = currentMeasurement.getLiveMeasurement?.() ?? {
    generation: 0,
    record: null,
  };
  if (
    isDifferentPublishedMeasurement(
      initialLive,
      request.params.afterGeneration,
      request.params.afterSequence
    )
  ) {
    return {
      requestId,
      result: {
        outcome: "sample",
        matchedImmediately: true,
        measurement: buildMeasurementOrFail(ctx, initialLive),
      },
    };
  }
  if (waiters.entries.size >= 4) {
    throw semanticFailure("waitLimitReached", "$", "Too many long waits are active.", -32070);
  }
  const result = await new Promise((resolve, reject) => {
    const waiter = {
      kind: "measurement",
      timer: null,
      unsubscribe: () => {},
      resolve,
      reject,
    };
    const finish = (value) => {
      clearTimeout(waiter.timer);
      waiter.unsubscribe();
      waiters.entries.delete(requestId);
      resolve(value);
    };
    const observe = (live) => {
      if (
        !isDifferentPublishedMeasurement(
          live,
          request.params.afterGeneration,
          request.params.afterSequence
        )
      ) {
        return;
      }
      finish({ outcome: "sample", matchedImmediately: false, live });
    };
    waiter.timer = setTimeout(() => {
      const live = ctx.live().measurementContext.getLiveMeasurement?.() ?? {
        generation: 0,
        record: null,
      };
      finish({ outcome: "timeout", live });
    }, request.params.timeoutMs);
    waiters.entries.set(requestId, waiter);
    waiter.unsubscribe = currentMeasurement.subscribeLiveMeasurement?.(observe) ?? (() => {});
    observe(currentMeasurement.getLiveMeasurement?.() ?? { generation: 0, record: null });
  });
  if (result === WAIT_CANCELLED) return null;
  if (result.outcome === "timeout") {
    throw semanticFailure(
      "timeout",
      "$.params.timeoutMs",
      "No different LIVE measurement sample was published before the timeout.",
      -32071,
      {
        afterGeneration: request.params.afterGeneration,
        afterSequence: request.params.afterSequence ?? null,
        currentGeneration: result.live.generation,
        currentSequence: result.live.record?.sequence ?? null,
        liveState: ctx.live().measurementContext.liveState,
      }
    );
  }
  return {
    requestId,
    result: {
      outcome: "sample",
      matchedImmediately: result.matchedImmediately,
      measurement: buildMeasurementOrFail(ctx, result.live),
    },
  };
}

/** @param {import("../bridge/types.js").BridgeContext} ctx */
async function waitUntil(ctx) {
  const { request, requestId, waiters } = ctx;
  const currentMeasurement = ctx.live().measurementContext;
  const predicate = request.params.predicate;
  const holdMs = predicate.holdMs ?? 0;
  const initialLive = currentMeasurement.getLiveMeasurement?.() ?? {
    generation: 0,
    record: null,
  };
  const initialMeasurement = buildMeasurementOrFail(ctx, initialLive);
  if (holdMs === 0 && measurementPredicateMatches(initialMeasurement, predicate)) {
    return {
      requestId,
      result: {
        outcome: "condition",
        matchedImmediately: true,
        predicate,
        measurement: initialMeasurement,
      },
    };
  }
  if (waiters.entries.size >= 4) {
    throw semanticFailure("waitLimitReached", "$", "Too many long waits are active.", -32070);
  }
  const result = await new Promise((resolve, reject) => {
    const waiter = {
      kind: "measurementPredicate",
      timer: null,
      holdTimer: null,
      unsubscribe: () => {},
      resolve,
      reject,
    };
    const clearHold = () => {
      clearTimeout(waiter.holdTimer);
      waiter.holdTimer = null;
    };
    const finish = (value) => {
      clearTimeout(waiter.timer);
      clearHold();
      waiter.unsubscribe();
      waiters.entries.delete(requestId);
      resolve(value);
    };
    const fail = (error) => {
      clearTimeout(waiter.timer);
      clearHold();
      waiter.unsubscribe();
      waiters.entries.delete(requestId);
      reject(error);
    };
    const observe = (live) => {
      try {
        const measurement = buildMeasurementOrFail(ctx, live);
        if (!measurementPredicateMatches(measurement, predicate)) {
          clearHold();
          return;
        }
        if (holdMs === 0) {
          finish({ measurement, matchedImmediately: false });
          return;
        }
        if (waiter.holdTimer !== null) return;
        waiter.holdTimer = setTimeout(() => {
          try {
            const latest = ctx.live().measurementContext.getLiveMeasurement?.() ?? {
              generation: 0,
              record: null,
            };
            const finalMeasurement = buildMeasurementOrFail(ctx, latest);
            if (measurementPredicateMatches(finalMeasurement, predicate)) {
              finish({ measurement: finalMeasurement, matchedImmediately: false });
            } else {
              clearHold();
            }
          } catch (error) {
            fail(error);
          }
        }, holdMs);
      } catch (error) {
        fail(error);
      }
    };
    waiter.timer = setTimeout(() => {
      const live = ctx.live().measurementContext.getLiveMeasurement?.() ?? {
        generation: 0,
        record: null,
      };
      finish({ timeout: true, live });
    }, request.params.timeoutMs);
    waiters.entries.set(requestId, waiter);
    waiter.unsubscribe = currentMeasurement.subscribeLiveMeasurement?.(observe) ?? (() => {});
    observe(currentMeasurement.getLiveMeasurement?.() ?? { generation: 0, record: null });
  });
  if (result === WAIT_CANCELLED) return null;
  if (result.timeout) {
    throw semanticFailure(
      "timeout",
      "$.params.timeoutMs",
      "The LIVE measurement condition was not satisfied before the timeout.",
      -32071,
      {
        predicate,
        currentGeneration: result.live.generation,
        currentSequence: result.live.record?.sequence ?? null,
        liveState: ctx.live().measurementContext.liveState,
      }
    );
  }
  return {
    requestId,
    result: {
      outcome: "condition",
      matchedImmediately: result.matchedImmediately,
      predicate,
      measurement: result.measurement,
    },
  };
}

/** @type {Record<string, import("../bridge/types.js").HandlerEntry>} */
export const measurementHandlers = {
  "measurement.describe": { run: describe, lane: "direct" },
  "measurement.inspect": { run: inspect, lane: "direct" },
  "measurement.wait": { run: wait, lane: "direct" },
  "measurement.waitUntil": { run: waitUntil, lane: "direct" },
};
