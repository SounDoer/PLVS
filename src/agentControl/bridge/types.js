/**
 * Shared shapes for the Agent Control bridge.
 *
 * @typedef {Record<string, any>} BridgeInputs
 *   Every option `useAgentControlBridge` was handed, after defaulting, plus the derived Loudness
 *   Profile and Theme values. Loosely typed on purpose: the hook's own JSDoc is the authority for
 *   the option shapes.
 *
 * @typedef {{
 *   request: { id?: string, method: string, params: Record<string, any> },
 *   requestId: string,
 *   snap: BridgeInputs,
 *   live: () => BridgeInputs,
 *   clock: ReturnType<typeof import("./revisionClock.js").createRevisionClock>,
 *   settlement: ReturnType<typeof import("./settlement.js").createSettlementRegistry>,
 *   waiters: ReturnType<typeof import("./waiters.js").createWaiters>,
 *   visual: {
 *     captures: Map<string, any>,
 *     recordings: Map<string, any>,
 *     captureActive: { current: boolean },
 *   },
 *   dockRequestContext: Record<string, any>,
 *   flush: (...args: any[]) => any,
 * }} BridgeContext
 *   What a handler receives. `snap` is the app state React had rendered when the request started
 *   and never changes during the request; `live()` is whatever React has rendered by the time it
 *   is called. The difference is behaviour: a handler plans against `snap` and reads `live()`
 *   after an `await` to see what was committed.
 *
 * @typedef {{
 *   run: (ctx: BridgeContext) => Promise<any>,
 *   lane?: "direct",
 *   monitorInventory?: true,
 * }} HandlerEntry
 *   `lane: "direct"` answers outside the serialized queue. `monitorInventory` reads the monitor
 *   inventory into `dockRequestContext` first.
 */
export {};
