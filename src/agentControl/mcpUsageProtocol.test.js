import { afterEach, describe, expect, it } from "vitest";
import manifest from "./commandManifest.json" with { type: "json" };
import { getMcpUsage, recordMcpUsage, resetMcpUsage } from "./mcpUsage.js";
import { MCP_CLIENT_SEEN_METHOD, normalizeMcpUsageRequest } from "./mcpUsageProtocol.js";
import { mcpHandlers } from "./handlers/mcp.js";

function request(params, extra = {}) {
  return { jsonrpc: "2.0", id: "mcp-1", method: MCP_CLIENT_SEEN_METHOD, params, ...extra };
}

afterEach(() => resetMcpUsage());

describe("MCP usage reporting", () => {
  it("accepts a trimmed client name and nothing else", () => {
    expect(normalizeMcpUsageRequest(request({ client: "  Claude  " }))).toEqual({
      ok: true,
      request: { id: "mcp-1", method: MCP_CLIENT_SEEN_METHOD, params: { client: "Claude" } },
    });
    for (const params of [
      {},
      { client: "" },
      { client: "x".repeat(81) },
      { client: "bad\nname" },
      { client: 3 },
      { client: "Claude", version: "1" },
    ]) {
      expect(normalizeMcpUsageRequest(request(params)).ok, JSON.stringify(params)).toBe(false);
    }
    expect(normalizeMcpUsageRequest(request({ client: "Claude" }, { extra: 1 })).ok).toBe(false);
  });

  it("stays out of the public manifest", () => {
    expect(manifest.commands.some(({ wireMethod }) => wireMethod === MCP_CLIENT_SEEN_METHOD)).toBe(
      false
    );
  });

  it("records the client in memory without touching app state", async () => {
    expect(getMcpUsage()).toBeNull();
    const result = await mcpHandlers[MCP_CLIENT_SEEN_METHOD].run(
      /** @type {any} */ ({ request: { params: { client: "Codex" } }, requestId: "mcp-1" })
    );
    expect(result).toEqual({ requestId: "mcp-1", result: { recorded: true } });
    expect(getMcpUsage()?.client).toBe("Codex");
    recordMcpUsage("Claude", 42);
    expect(getMcpUsage()).toEqual({ client: "Claude", at: 42 });
  });
});
