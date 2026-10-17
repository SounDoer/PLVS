/** @param {import("../bridge/types.js").BridgeContext} ctx */
async function inspectOrStall(ctx) {
  const { request, requestId } = ctx;
  const { developmentPerformance } = ctx.snap;
  const result =
    request.method === "dev.performance.inspect"
      ? await developmentPerformance.inspect()
      : await developmentPerformance.stall(request.params.milliseconds);
  return { requestId, result };
}

/** @type {Record<string, import("../bridge/types.js").HandlerEntry>} */
export const developmentPerformanceHandlers = {
  "dev.performance.inspect": { run: inspectOrStall },
  "dev.performance.stall": { run: inspectOrStall },
};
