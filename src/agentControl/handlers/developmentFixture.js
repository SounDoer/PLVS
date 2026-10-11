import { semanticFailure } from "../bridge/failures.js";

/** @param {import("../bridge/types.js").BridgeContext} ctx */
async function establishOrReset(ctx) {
  const { request, requestId, clock } = ctx;
  const { developmentFixtures } = ctx.snap;
  try {
    if (request.params.expectedRevision !== clock.current()) {
      throw Object.assign(new Error("The Agent Control revision changed."), {
        reason: "revisionConflict",
        details: {
          expectedRevision: request.params.expectedRevision,
          currentRevision: clock.current(),
        },
      });
    }
    const result =
      request.method === "dev.fixture.establish"
        ? await developmentFixtures.establish(request.params)
        : await developmentFixtures.reset(request.params);
    return {
      requestId,
      result: { ...result, revision: clock.current() },
    };
  } catch (error) {
    if (typeof error?.reason !== "string") throw error;
    throw semanticFailure(
      error.reason,
      error.reason === "uiGenerationConflict"
        ? "$.params.expectedUiGeneration"
        : error.reason === "revisionConflict"
          ? "$.params.expectedRevision"
          : "$.params",
      error.message,
      error.reason === "revisionConflict" ? -32004 : -32042,
      error.details
    );
  }
}

/** @type {Record<string, import("../bridge/types.js").HandlerEntry>} */
export const developmentFixtureHandlers = {
  "dev.fixture.establish": { run: establishOrReset },
  "dev.fixture.reset": { run: establishOrReset },
};
