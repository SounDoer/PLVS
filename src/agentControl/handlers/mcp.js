import { recordMcpUsage } from "../mcpUsage.js";
import { MCP_CLIENT_SEEN_METHOD } from "../mcpUsageProtocol.js";

/**
 * Records the chat app the MCP adapter is serving. Touches no observed domain, so it never
 * advances the revision.
 *
 * @param {import("../bridge/types.js").BridgeContext} ctx
 */
async function clientSeen(ctx) {
  const { request, requestId } = ctx;
  recordMcpUsage(request.params.client);
  return { requestId, result: { recorded: true } };
}

/** @type {Record<string, import("../bridge/types.js").HandlerEntry>} */
export const mcpHandlers = {
  [MCP_CLIENT_SEEN_METHOD]: { run: clientSeen },
};
