const REQUEST_FIELDS = new Set(["jsonrpc", "id", "method", "params"]);
const METHODS = new Set(["dev.performance.inspect", "dev.performance.stall"]);
export const DEVELOPMENT_PERFORMANCE_STALL_MIN_MS = 100;
export const DEVELOPMENT_PERFORMANCE_STALL_MAX_MS = 30_000;

function plain(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function failure(reason, path, message, rpcCode = -32602) {
  return { ok: false, error: { reason, path, message, rpcCode } };
}

export function isDevelopmentPerformanceMethod(method) {
  return METHODS.has(method);
}

export function normalizeDevelopmentPerformanceRequest(input) {
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
    !isDevelopmentPerformanceMethod(input.method) ||
    !plain(input.params)
  ) {
    return failure("invalidRequest", "$", "Invalid development performance request.", -32600);
  }

  if (input.method === "dev.performance.inspect") {
    const field = Object.keys(input.params)[0];
    return field
      ? failure("invalidParams", `$.params.${field}`, `Unknown parameter: ${field}.`)
      : { ok: true, request: { id: input.id, method: input.method, params: {} } };
  }

  const field = Object.keys(input.params).find((name) => name !== "milliseconds");
  if (field) return failure("invalidParams", `$.params.${field}`, `Unknown parameter: ${field}.`);
  const milliseconds = input.params.milliseconds;
  if (
    !Number.isSafeInteger(milliseconds) ||
    milliseconds < DEVELOPMENT_PERFORMANCE_STALL_MIN_MS ||
    milliseconds > DEVELOPMENT_PERFORMANCE_STALL_MAX_MS
  ) {
    return failure(
      "invalidParams",
      "$.params.milliseconds",
      `milliseconds must be an integer from ${DEVELOPMENT_PERFORMANCE_STALL_MIN_MS} to ${DEVELOPMENT_PERFORMANCE_STALL_MAX_MS}.`
    );
  }
  return {
    ok: true,
    request: { id: input.id, method: input.method, params: { milliseconds } },
  };
}
