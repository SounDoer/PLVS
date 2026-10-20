const REQUEST_FIELDS = new Set(["jsonrpc", "id", "method", "params"]);
const METHODS = new Set([
  "dev.update.preferences",
  "dev.update.open",
  "dev.update.confirm",
  "dev.update.quit",
]);

function plain(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function failure(reason, path, message, code = -32602) {
  return { ok: false, error: { reason, path, message, code } };
}

function validateGeneration(params, field) {
  if (!Number.isSafeInteger(params[field]) || params[field] < 0) {
    return failure(
      field === "expectedRevision" ? "revisionRequired" : "uiGenerationRequired",
      `$.params.${field}`,
      `${field} must be a non-negative safe integer.`
    );
  }
  return null;
}

export function isDevelopmentUpdateMethod(method) {
  return METHODS.has(method);
}

export function normalizeDevelopmentUpdateRequest(input) {
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
    !isDevelopmentUpdateMethod(input.method) ||
    !plain(input.params)
  ) {
    return failure("invalidRequest", "$", "Invalid development update request.", -32600);
  }

  const common = new Set(["expectedRevision", "expectedUiGeneration"]);
  const allowed =
    input.method === "dev.update.preferences"
      ? new Set([...common, "surfaceId", "autoCheck", "autoDownload"])
      : input.method === "dev.update.confirm"
        ? new Set([...common, "surfaceId"])
        : common;
  const field = Object.keys(input.params).find((name) => !allowed.has(name));
  if (field) return failure("invalidParams", `$.params.${field}`, `Unknown parameter: ${field}.`);
  for (const generation of ["expectedRevision", "expectedUiGeneration"]) {
    const error = validateGeneration(input.params, generation);
    if (error) return error;
  }
  if (["dev.update.preferences", "dev.update.confirm"].includes(input.method)) {
    if (!/^ui-[a-z0-9-]{16,60}$/.test(input.params.surfaceId ?? "")) {
      return failure("invalidParams", "$.params.surfaceId", "surfaceId is invalid.");
    }
  }
  if (input.method === "dev.update.preferences") {
    if (
      typeof input.params.autoCheck !== "boolean" ||
      typeof input.params.autoDownload !== "boolean" ||
      (!input.params.autoCheck && input.params.autoDownload)
    ) {
      return failure(
        "invalidParams",
        "$.params",
        "Update preferences require booleans and autoDownload requires autoCheck."
      );
    }
  }

  return {
    ok: true,
    request: {
      id: input.id,
      method: input.method,
      params: Object.fromEntries([...allowed].map((name) => [name, input.params[name]])),
    },
  };
}
