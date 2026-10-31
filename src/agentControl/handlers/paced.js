import { buildAgentControlPanelSnapshot } from "../appSnapshot.js";
import { buildAxisInspection } from "../axisControl.js";

/**
 * One value between `from` and `to` at progress `t`. Numbers move linearly, frequencies
 * geometrically so a zoom reads evenly on a logarithmic axis; anything else switches at the end.
 */
export function interpolate(from, to, t, key = "") {
  if (typeof to === "number" && typeof from === "number" && Number.isFinite(from)) {
    if (/Hz$/.test(key) && from > 0 && to > 0) return from * (to / from) ** t;
    const value = from + (to - from) * t;
    // Integer controls stay integers on the way.
    return Number.isInteger(from) && Number.isInteger(to) ? Math.round(value) : value;
  }
  if (to && typeof to === "object" && !Array.isArray(to)) {
    return Object.fromEntries(
      Object.entries(to).map(([name, value]) => [
        name,
        interpolate(from && typeof from === "object" ? from[name] : undefined, value, t, name),
      ])
    );
  }
  return t >= 1 || from === undefined ? to : from;
}

const SOURCES = {
  "axis.shared.update": {
    current: (inputs, params) => buildAxisInspection(inputs.workspace).shared[params.kind],
    read: (params) => params.range,
    write: (params, range) => ({ ...params, range }),
  },
  "axis.panel.update": {
    current: (inputs, params) =>
      buildAxisInspection(inputs.workspace).panels.find(({ id }) => id === params.panelId)?.axes?.[
        params.kind
      ]?.range,
    read: (params) => params.patch.range,
    write: (params, range) => ({ ...params, patch: { ...params.patch, range } }),
  },
  "panel.update": {
    current: (inputs, params) =>
      inputs.workspace.panelsById?.[params.panelId]
        ? buildAgentControlPanelSnapshot({
            workspace: inputs.workspace,
            panelId: params.panelId,
            hasLoudnessReference: inputs.hasLoudnessReference,
            analysisContext: inputs.analysisContext,
          }).controls
        : undefined,
    read: (params) => params.patch,
    write: (params, patch) => ({ ...params, patch }),
  },
  "transport.snapshot.select": {
    // From the live edge when no Snapshot is selected, as a person's scrub starts at "now".
    current: (inputs) => ({ offsetSec: inputs.transport?.snapshot?.offsetSec ?? 0 }),
    read: (params) => ({ offsetSec: params.offsetSec }),
    write: (params, values) => ({ ...params, offsetSec: values.offsetSec }),
  },
};

/**
 * Applies a paced request as evenly spaced intermediate requests through the method's own handler,
 * from the current values to the requested ones, ending exactly on the request. Each step is an
 * ordinary state change: planned, validated, committed and persisted like the single request.
 *
 * @param {(ctx: import("../bridge/types.js").BridgeContext) => Promise<any>} run
 */
export function paced(run) {
  return async (ctx) => {
    const { steps, durationMs = 0, ...params } = ctx.request.params;
    const plain = { ...ctx, request: { ...ctx.request, params } };
    const source = SOURCES[ctx.request.method];
    const target = source && steps ? source.read(params) : undefined;
    const from = target === undefined ? undefined : source.current(ctx.snap, params);
    if (!steps || target === undefined || from === undefined) return run(plain);
    let response;
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps;
      const values = t >= 1 ? target : interpolate(from, target, t);
      const stepParams = source.write(params, values);
      if (step > 1) stepParams.expectedRevision = ctx.clock.current();
      response = await run({
        ...ctx,
        snap: step === 1 ? ctx.snap : ctx.live(),
        request: { ...ctx.request, params: stepParams },
      });
      if (step < steps) await new Promise((resolve) => setTimeout(resolve, durationMs / steps));
    }
    return { ...response, result: { ...response.result, steps, durationMs } };
  };
}
