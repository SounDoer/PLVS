/**
 * `mcp.clientSeen`: sent by `plvs-cli mcp` so Settings can show which chat app last used PLVS.
 * Private like the `dev.*` methods — absent from the public manifest, capabilities and generated
 * reference — but served in every build, because the MCP adapter ships in every build.
 */
const REQUEST_FIELDS = new Set(["jsonrpc", "id", "method", "params"]);
export const MCP_CLIENT_SEEN_METHOD = "mcp.clientSeen";
export const MCP_CLIENT_NAME_MAX_LENGTH = 80;

function plain(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function failure(reason, path, message, rpcCode = -32602) {
  return { ok: false, error: { reason, path, message, rpcCode } };
}

/** @param {unknown} method */
export function isMcpUsageMethod(method) {
  return method === MCP_CLIENT_SEEN_METHOD;
}

/** @param {any} input */
export function normalizeMcpUsageRequest(input) {
  if (!plain(input)) return failure("invalidRequest", "$", "Request must be an object.", -32600);
  const requestField = Object.keys(input).find((field) => !REQUEST_FIELDS.has(field));
  if (requestField) {
    return failure(
      "invalidRequest",
      `$.${requestField}`,
      `Unknown request field: ${requestField}.`,
      -32600
    );
  }
  if (
    input.jsonrpc !== "2.0" ||
    typeof input.id !== "string" ||
    input.id === "" ||
    !isMcpUsageMethod(input.method) ||
    !plain(input.params)
  ) {
    return failure("invalidRequest", "$", "Invalid MCP usage request.", -32600);
  }
  const field = Object.keys(input.params).find((name) => name !== "client");
  if (field) return failure("invalidParams", `$.params.${field}`, `Unknown parameter: ${field}.`);
  const client = typeof input.params.client === "string" ? input.params.client.trim() : "";
  const hasControlCharacter = [...client].some((character) => character.charCodeAt(0) < 0x20);
  if (!client || client.length > MCP_CLIENT_NAME_MAX_LENGTH || hasControlCharacter) {
    return failure(
      "invalidParams",
      "$.params.client",
      `client must be 1 to ${MCP_CLIENT_NAME_MAX_LENGTH} printable characters.`
    );
  }
  return { ok: true, request: { id: input.id, method: input.method, params: { client } } };
}
