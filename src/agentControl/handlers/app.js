import { buildAgentControlCapabilities, buildAgentControlSnapshot } from "../appSnapshot.js";
import { buildPublicView } from "../viewControl.js";
import { buildDockSnapshot } from "../dockControl.js";
import { deviceInspection } from "./shared.js";
import { semanticFailure, WAIT_CANCELLED } from "../bridge/failures.js";
import { activeLoudnessProfileId } from "../bridge/signatures.js";

/** @param {import("../bridge/types.js").BridgeContext} ctx */
async function capabilities(ctx) {
  const { requestId, clock, live } = ctx;
  const { runtime } = ctx.snap;
  const visualControl = live().visual;
  const capabilityRuntime = visualControl
    ? {
        ...runtime,
        visual: {
          screenshot: visualControl.platformCapabilities?.screenshot?.available === true,
          recording: visualControl.platformCapabilities?.recording?.available === true,
        },
      }
    : runtime;
  return {
    requestId,
    result: buildAgentControlCapabilities(capabilityRuntime, clock.current()),
  };
}

/** @param {import("../bridge/types.js").BridgeContext} ctx */
async function wait(ctx) {
  const { request, requestId, clock, waiters } = ctx;
  const activeBatch = clock.activeBatch();
  const awaitingActiveBatch =
    activeBatch?.bumped === true && request.params.afterRevision === activeBatch.startRevision;
  if (clock.current() !== request.params.afterRevision && !awaitingActiveBatch) {
    return {
      requestId,
      result: {
        outcome: "changed",
        matchedImmediately: true,
        revision: clock.current(),
      },
    };
  }
  if (waiters.entries.size >= 4) {
    throw semanticFailure("waitLimitReached", "$", "Too many long waits are active.", -32070);
  }
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      waiters.entries.delete(requestId);
      resolve({
        outcome: "timeout",
        revision: clock.current(),
      });
    }, request.params.timeoutMs);
    waiters.entries.set(requestId, {
      kind: "revision",
      afterRevision: request.params.afterRevision,
      timer,
      resolve,
      reject,
    });
  });
  if (result === WAIT_CANCELLED) return null;
  if (result.outcome === "timeout") {
    throw semanticFailure(
      "timeout",
      "$.params.timeoutMs",
      "The app revision did not change before the timeout.",
      -32071,
      {
        afterRevision: request.params.afterRevision,
        currentRevision: result.revision,
      }
    );
  }
  return { requestId, result };
}

/** @param {import("../bridge/types.js").BridgeContext} ctx */
async function inspect(ctx) {
  const { requestId, clock, dockRequestContext, live } = ctx;
  const {
    runtime,
    workspace,
    presets,
    settings,
    transport,
    device,
    dock,
    loudnessProfiles,
    loudnessActive,
    hasLoudnessReference,
    analysisContext,
  } = ctx.snap;
  return {
    requestId,
    result: buildAgentControlSnapshot({
      runtime,
      revision: clock.current(),
      workspace,
      presets,
      appearance: live().themeState.appearance,
      loudnessProfile: {
        activeId: activeLoudnessProfileId(loudnessProfiles, loudnessActive),
      },
      settings,
      transport,
      device: device ? deviceInspection(device) : null,
      dock: buildDockSnapshot(dock, dockRequestContext),
      view: buildPublicView(live().viewContext.view),
      hasLoudnessReference,
      analysisContext,
    }),
  };
}

/** @type {Record<string, import("../bridge/types.js").HandlerEntry>} */
export const appHandlers = {
  "app.capabilities": { run: capabilities },
  "app.wait": { run: wait, lane: "direct" },
  "app.inspect": { run: inspect },
};
