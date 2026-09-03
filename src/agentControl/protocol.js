const REQUEST_FIELDS = new Set(["jsonrpc", "id", "method", "params"]);

function isPlainJsonObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function error(reason, path, message, code) {
  return { ok: false, error: { reason, path, message, code } };
}

function unknownField(value, allowed) {
  return Object.keys(value).find((key) => !allowed.has(key));
}

function invalidParams(path, message) {
  return error("invalidParams", path, message, -32602);
}

export function normalizeAgentControlRequest(input) {
  if (!isPlainJsonObject(input)) {
    return error("invalidRequest", "$", "Request must be a plain JSON object.", -32600);
  }
  const extraRequestField = unknownField(input, REQUEST_FIELDS);
  if (extraRequestField) {
    return error(
      "invalidRequest",
      `$.${extraRequestField}`,
      `Unknown request field: ${extraRequestField}.`,
      -32600
    );
  }
  if (
    input.jsonrpc !== "2.0" ||
    typeof input.id !== "string" ||
    input.id === "" ||
    typeof input.method !== "string"
  ) {
    return error("invalidRequest", "$", "Invalid JSON-RPC request envelope.", -32600);
  }
  if (!isPlainJsonObject(input.params)) {
    return invalidParams("$.params", "Request params must be a plain JSON object.");
  }

  if (
    input.method === "app.capabilities" ||
    input.method === "app.inspect" ||
    input.method === "axis.describe" ||
    input.method === "axis.inspect"
  ) {
    const field = Object.keys(input.params)[0];
    if (field) return invalidParams(`$.params.${field}`, `Unknown parameter: ${field}.`);
    return {
      ok: true,
      request: { id: input.id, method: input.method, params: {} },
    };
  }

  if (input.method === "workspace.applyLayout") {
    const field = unknownField(input.params, new Set(["layout", "expectedRevision", "dryRun"]));
    if (field) return invalidParams(`$.params.${field}`, `Unknown parameter: ${field}.`);
    if (!isPlainJsonObject(input.params.layout)) {
      return invalidParams("$.params.layout", "Layout must be a plain JSON object.");
    }
    if (
      input.params.expectedRevision !== undefined &&
      (!Number.isSafeInteger(input.params.expectedRevision) || input.params.expectedRevision < 0)
    ) {
      return invalidParams(
        "$.params.expectedRevision",
        "expectedRevision must be a non-negative safe integer."
      );
    }
    if (input.params.dryRun !== undefined && typeof input.params.dryRun !== "boolean") {
      return invalidParams("$.params.dryRun", "dryRun must be a boolean.");
    }
    return {
      ok: true,
      request: {
        id: input.id,
        method: input.method,
        params: {
          layout: input.params.layout,
          ...(input.params.expectedRevision !== undefined
            ? { expectedRevision: input.params.expectedRevision }
            : {}),
          ...(input.params.dryRun !== undefined ? { dryRun: input.params.dryRun } : {}),
        },
      },
    };
  }

  if (input.method === "panel.describe") {
    const field = unknownField(input.params, new Set(["panelId"]));
    if (field) return invalidParams(`$.params.${field}`, `Unknown parameter: ${field}.`);
    if (typeof input.params.panelId !== "string" || input.params.panelId.trim() === "") {
      return invalidParams("$.params.panelId", "panelId must be a non-empty string.");
    }
    return {
      ok: true,
      request: {
        id: input.id,
        method: input.method,
        params: { panelId: input.params.panelId },
      },
    };
  }

  if (
    input.method === "axis.shared.update" ||
    input.method === "axis.shared.reset" ||
    input.method === "axis.panel.update" ||
    input.method === "axis.panel.reset"
  ) {
    const panelTarget = input.method.startsWith("axis.panel.");
    const update = input.method.endsWith(".update");
    const payloadKey = panelTarget ? "patch" : "range";
    const allowed = new Set([
      ...(panelTarget ? ["panelId"] : []),
      "kind",
      ...(update ? [payloadKey] : []),
      "expectedRevision",
      "dryRun",
    ]);
    const field = unknownField(input.params, allowed);
    if (field) return invalidParams(`$.params.${field}`, `Unknown parameter: ${field}.`);
    if (
      panelTarget &&
      (typeof input.params.panelId !== "string" || input.params.panelId.trim() === "")
    ) {
      return invalidParams("$.params.panelId", "panelId must be a non-empty string.");
    }
    if (typeof input.params.kind !== "string" || input.params.kind.trim() === "") {
      return invalidParams("$.params.kind", "kind must be a non-empty string.");
    }
    if (update && !isPlainJsonObject(input.params[payloadKey])) {
      return invalidParams(`$.params.${payloadKey}`, `${payloadKey} must be a plain JSON object.`);
    }
    if (
      input.params.expectedRevision !== undefined &&
      (!Number.isSafeInteger(input.params.expectedRevision) || input.params.expectedRevision < 0)
    ) {
      return invalidParams(
        "$.params.expectedRevision",
        "expectedRevision must be a non-negative safe integer."
      );
    }
    if (input.params.dryRun !== undefined && typeof input.params.dryRun !== "boolean") {
      return invalidParams("$.params.dryRun", "dryRun must be a boolean.");
    }
    return {
      ok: true,
      request: {
        id: input.id,
        method: input.method,
        params: {
          ...(panelTarget ? { panelId: input.params.panelId } : {}),
          kind: input.params.kind,
          ...(update ? { [payloadKey]: input.params[payloadKey] } : {}),
          ...(input.params.expectedRevision !== undefined
            ? { expectedRevision: input.params.expectedRevision }
            : {}),
          ...(input.params.dryRun !== undefined ? { dryRun: input.params.dryRun } : {}),
        },
      },
    };
  }

  if (input.method === "panel.update" || input.method === "panel.reset") {
    const isUpdate = input.method === "panel.update";
    const field = unknownField(
      input.params,
      new Set(["panelId", ...(isUpdate ? ["patch"] : []), "expectedRevision", "dryRun"])
    );
    if (field) return invalidParams(`$.params.${field}`, `Unknown parameter: ${field}.`);
    if (typeof input.params.panelId !== "string" || input.params.panelId.trim() === "") {
      return invalidParams("$.params.panelId", "panelId must be a non-empty string.");
    }
    if (isUpdate && !isPlainJsonObject(input.params.patch)) {
      return invalidParams("$.params.patch", "patch must be a plain JSON object.");
    }
    if (
      input.params.expectedRevision !== undefined &&
      (!Number.isSafeInteger(input.params.expectedRevision) || input.params.expectedRevision < 0)
    ) {
      return invalidParams(
        "$.params.expectedRevision",
        "expectedRevision must be a non-negative safe integer."
      );
    }
    if (input.params.dryRun !== undefined && typeof input.params.dryRun !== "boolean") {
      return invalidParams("$.params.dryRun", "dryRun must be a boolean.");
    }
    return {
      ok: true,
      request: {
        id: input.id,
        method: input.method,
        params: {
          panelId: input.params.panelId,
          ...(isUpdate ? { patch: input.params.patch } : {}),
          ...(input.params.expectedRevision !== undefined
            ? { expectedRevision: input.params.expectedRevision }
            : {}),
          ...(input.params.dryRun !== undefined ? { dryRun: input.params.dryRun } : {}),
        },
      },
    };
  }

  return error(
    "methodNotFound",
    "$.method",
    `Unknown agent-control method: ${input.method}.`,
    -32601
  );
}

export function agentControlRpcError(errorValue) {
  const fallback = {
    reason: "internalError",
    path: "$",
    message: "The PLVS frontend could not process the request.",
    code: -32603,
  };
  const value = isPlainJsonObject(errorValue) ? { ...fallback, ...errorValue } : fallback;
  return {
    code: Number.isInteger(value.code) ? value.code : fallback.code,
    message: typeof value.message === "string" ? value.message : fallback.message,
    data: {
      reason: typeof value.reason === "string" ? value.reason : fallback.reason,
      ...(typeof value.path === "string" ? { path: value.path } : {}),
      ...(isPlainJsonObject(value.details) ? { details: value.details } : {}),
    },
  };
}
