import {
  buildModuleDescription,
  buildModuleDescriptionContext,
  buildModuleList,
} from "../moduleControl.js";
import { semanticFailure } from "../bridge/failures.js";

/** @param {import("../bridge/types.js").BridgeContext} ctx */
async function list(ctx) {
  const { requestId, clock } = ctx;
  return {
    requestId,
    result: {
      revision: clock.current(),
      modules: buildModuleList(),
    },
  };
}

/** @param {import("../bridge/types.js").BridgeContext} ctx */
async function describe(ctx) {
  const { request, requestId, clock } = ctx;
  const { hasLoudnessReference, analysisContext } = ctx.snap;
  const context = { ...analysisContext, hasLoudnessReference };
  const module = buildModuleDescription(request.params.moduleId, context);
  if (!module) {
    throw semanticFailure(
      "moduleNotFound",
      "$.params.moduleId",
      `Module ${request.params.moduleId} was not found.`,
      -32011
    );
  }
  return {
    requestId,
    result: {
      revision: clock.current(),
      schemaBasis: "defaultControls",
      context: buildModuleDescriptionContext(analysisContext, hasLoudnessReference),
      module,
    },
  };
}

/** @type {Record<string, import("../bridge/types.js").HandlerEntry>} */
export const moduleHandlers = {
  "module.list": { run: list },
  "module.describe": { run: describe },
};
