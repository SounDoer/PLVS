export const DEVELOPMENT_EVENT_FIXTURE_NAMES = Object.freeze([
  "update.available",
  "crash-report.pending",
  "close-confirmation.requested",
  "library-conflict.pending",
]);

const REQUEST_FIELDS = new Set(["jsonrpc", "id", "method", "params"]);
const ESTABLISH_FIELDS = new Set(["name", "expectedRevision", "expectedUiGeneration"]);
const RESET_FIELDS = new Set(["fixtureId", "expectedRevision", "expectedUiGeneration"]);

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
  if (params[field] === undefined) {
    return failure(
      field === "expectedRevision" ? "revisionRequired" : "uiGenerationRequired",
      `$.params.${field}`,
      `${field} is required for every development fixture action.`
    );
  }
  if (!Number.isSafeInteger(params[field]) || params[field] < 0) {
    return failure(
      "invalidParams",
      `$.params.${field}`,
      `${field} must be a non-negative safe integer.`
    );
  }
  return null;
}

export function isDevelopmentFixtureMethod(method) {
  return method === "dev.fixture.establish" || method === "dev.fixture.reset";
}

export function normalizeDevelopmentFixtureRequest(input) {
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
    !isDevelopmentFixtureMethod(input.method) ||
    !plain(input.params)
  ) {
    return failure("invalidRequest", "$", "Invalid development fixture request.", -32600);
  }

  const establish = input.method === "dev.fixture.establish";
  const allowed = establish ? ESTABLISH_FIELDS : RESET_FIELDS;
  const field = Object.keys(input.params).find((name) => !allowed.has(name));
  if (field) return failure("invalidParams", `$.params.${field}`, `Unknown parameter: ${field}.`);
  for (const generation of ["expectedRevision", "expectedUiGeneration"]) {
    const error = validateGeneration(input.params, generation);
    if (error) return error;
  }

  if (establish && !DEVELOPMENT_EVENT_FIXTURE_NAMES.includes(input.params.name)) {
    return failure("invalidParams", "$.params.name", "Unknown development event fixture.");
  }
  if (!establish && !/^fixture-[a-z0-9-]{16,60}$/.test(input.params.fixtureId ?? "")) {
    return failure("invalidParams", "$.params.fixtureId", "fixtureId is invalid.");
  }

  return {
    ok: true,
    request: {
      id: input.id,
      method: input.method,
      params: establish
        ? {
            name: input.params.name,
            expectedRevision: input.params.expectedRevision,
            expectedUiGeneration: input.params.expectedUiGeneration,
          }
        : {
            fixtureId: input.params.fixtureId,
            expectedRevision: input.params.expectedRevision,
            expectedUiGeneration: input.params.expectedUiGeneration,
          },
    },
  };
}
