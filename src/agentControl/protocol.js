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
    input.method === "axis.inspect" ||
    input.method === "preset.list" ||
    input.method === "settings.describe" ||
    input.method === "settings.inspect"
  ) {
    const field = Object.keys(input.params)[0];
    if (field) return invalidParams(`$.params.${field}`, `Unknown parameter: ${field}.`);
    return {
      ok: true,
      request: { id: input.id, method: input.method, params: {} },
    };
  }

  if (input.method === "preset.describe") {
    const field = unknownField(input.params, new Set(["presetId", "expectedPresetsRevision"]));
    if (field) return invalidParams(`$.params.${field}`, `Unknown parameter: ${field}.`);
    if (typeof input.params.presetId !== "string" || input.params.presetId.trim() === "") {
      return invalidParams("$.params.presetId", "presetId must be a non-empty string.");
    }
    if (
      input.params.expectedPresetsRevision !== undefined &&
      (!Number.isSafeInteger(input.params.expectedPresetsRevision) ||
        input.params.expectedPresetsRevision < 0)
    ) {
      return invalidParams(
        "$.params.expectedPresetsRevision",
        "expectedPresetsRevision must be a non-negative safe integer."
      );
    }
    return {
      ok: true,
      request: {
        id: input.id,
        method: input.method,
        params: {
          presetId: input.params.presetId,
          ...(input.params.expectedPresetsRevision !== undefined
            ? { expectedPresetsRevision: input.params.expectedPresetsRevision }
            : {}),
        },
      },
    };
  }

  if (
    input.method === "preset.rename" ||
    input.method === "preset.delete" ||
    input.method === "preset.reorder"
  ) {
    const isRename = input.method === "preset.rename";
    const isReorder = input.method === "preset.reorder";
    const allowed = new Set([
      ...(isReorder ? ["presetIds"] : ["presetId"]),
      ...(isRename ? ["name"] : []),
      "expectedPresetsRevision",
      "dryRun",
    ]);
    const field = unknownField(input.params, allowed);
    if (field) return invalidParams(`$.params.${field}`, `Unknown parameter: ${field}.`);
    if (
      !isReorder &&
      (typeof input.params.presetId !== "string" || input.params.presetId.trim() === "")
    ) {
      return invalidParams("$.params.presetId", "presetId must be a non-empty string.");
    }
    if (isRename && typeof input.params.name !== "string") {
      return invalidParams("$.params.name", "name must be a string.");
    }
    if (isReorder && !Array.isArray(input.params.presetIds)) {
      return invalidParams("$.params.presetIds", "presetIds must be an array.");
    }
    if (
      input.params.expectedPresetsRevision !== undefined &&
      (!Number.isSafeInteger(input.params.expectedPresetsRevision) ||
        input.params.expectedPresetsRevision < 0)
    ) {
      return invalidParams(
        "$.params.expectedPresetsRevision",
        "expectedPresetsRevision must be a non-negative safe integer."
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
          ...(isReorder
            ? { presetIds: input.params.presetIds }
            : { presetId: input.params.presetId }),
          ...(isRename ? { name: input.params.name } : {}),
          ...(input.params.expectedPresetsRevision !== undefined
            ? { expectedPresetsRevision: input.params.expectedPresetsRevision }
            : {}),
          ...(input.params.dryRun !== undefined ? { dryRun: input.params.dryRun } : {}),
        },
      },
    };
  }

  if (
    input.method === "preset.save" ||
    input.method === "preset.update" ||
    input.method === "preset.apply"
  ) {
    const isSave = input.method === "preset.save";
    const targetKey = isSave ? "name" : "presetId";
    const field = unknownField(
      input.params,
      new Set([targetKey, "expectedWorkspaceRevision", "expectedPresetsRevision", "dryRun"])
    );
    if (field) return invalidParams(`$.params.${field}`, `Unknown parameter: ${field}.`);
    if (typeof input.params[targetKey] !== "string" || input.params[targetKey].trim() === "") {
      return invalidParams(`$.params.${targetKey}`, `${targetKey} must be a non-empty string.`);
    }
    for (const revisionKey of ["expectedWorkspaceRevision", "expectedPresetsRevision"]) {
      if (
        input.params[revisionKey] !== undefined &&
        (!Number.isSafeInteger(input.params[revisionKey]) || input.params[revisionKey] < 0)
      ) {
        return invalidParams(
          `$.params.${revisionKey}`,
          `${revisionKey} must be a non-negative safe integer.`
        );
      }
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
          [targetKey]: input.params[targetKey],
          ...(input.params.expectedWorkspaceRevision !== undefined
            ? { expectedWorkspaceRevision: input.params.expectedWorkspaceRevision }
            : {}),
          ...(input.params.expectedPresetsRevision !== undefined
            ? { expectedPresetsRevision: input.params.expectedPresetsRevision }
            : {}),
          ...(input.params.dryRun !== undefined ? { dryRun: input.params.dryRun } : {}),
        },
      },
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

  if (input.method === "settings.update") {
    const field = unknownField(
      input.params,
      new Set(["patch", "expectedSettingsRevision", "allowMeasurementRestart", "dryRun"])
    );
    if (field) return invalidParams(`$.params.${field}`, `Unknown parameter: ${field}.`);
    if (!isPlainJsonObject(input.params.patch)) {
      return invalidParams("$.params.patch", "patch must be a plain JSON object.");
    }
    if (
      input.params.expectedSettingsRevision !== undefined &&
      (!Number.isSafeInteger(input.params.expectedSettingsRevision) ||
        input.params.expectedSettingsRevision < 0)
    ) {
      return invalidParams(
        "$.params.expectedSettingsRevision",
        "expectedSettingsRevision must be a non-negative safe integer."
      );
    }
    if (
      input.params.allowMeasurementRestart !== undefined &&
      typeof input.params.allowMeasurementRestart !== "boolean"
    ) {
      return invalidParams(
        "$.params.allowMeasurementRestart",
        "allowMeasurementRestart must be a boolean."
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
          patch: input.params.patch,
          ...(input.params.expectedSettingsRevision !== undefined
            ? { expectedSettingsRevision: input.params.expectedSettingsRevision }
            : {}),
          ...(input.params.allowMeasurementRestart !== undefined
            ? { allowMeasurementRestart: input.params.allowMeasurementRestart }
            : {}),
          ...(input.params.dryRun !== undefined ? { dryRun: input.params.dryRun } : {}),
        },
      },
    };
  }

  if (input.method === "app.wait") {
    const revisionKeys = [
      "workspaceRevision",
      "presetsRevision",
      "settingsRevision",
      "transportRevision",
    ];
    const field = unknownField(input.params, new Set([...revisionKeys, "timeoutMs"]));
    if (field) return invalidParams(`$.params.${field}`, `Unknown parameter: ${field}.`);
    const supplied = revisionKeys.filter((key) => input.params[key] !== undefined);
    if (supplied.length === 0) {
      return invalidParams("$.params", "At least one revision baseline is required.");
    }
    for (const key of supplied) {
      if (!Number.isSafeInteger(input.params[key]) || input.params[key] < 0) {
        return invalidParams(`$.params.${key}`, `${key} must be a non-negative safe integer.`);
      }
    }
    const timeoutMs = input.params.timeoutMs ?? 30000;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 300000) {
      return invalidParams(
        "$.params.timeoutMs",
        "timeoutMs must be an integer from 100 to 300000."
      );
    }
    return {
      ok: true,
      request: {
        id: input.id,
        method: input.method,
        params: {
          ...Object.fromEntries(supplied.map((key) => [key, input.params[key]])),
          timeoutMs,
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
