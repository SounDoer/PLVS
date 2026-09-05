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

function validateExpectedRevision(params) {
  if (params.expectedRevision === undefined) {
    return error(
      "revisionRequired",
      "$.params.expectedRevision",
      "expectedRevision is required for every mutation.",
      -32602
    );
  }
  if (!Number.isSafeInteger(params.expectedRevision) || params.expectedRevision < 0) {
    return invalidParams(
      "$.params.expectedRevision",
      "expectedRevision must be a non-negative safe integer."
    );
  }
  return null;
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
    input.method === "settings.inspect" ||
    input.method === "transport.inspect" ||
    input.method === "dock.describe" ||
    input.method === "dock.inspect"
  ) {
    const field = Object.keys(input.params)[0];
    if (field) return invalidParams(`$.params.${field}`, `Unknown parameter: ${field}.`);
    return {
      ok: true,
      request: { id: input.id, method: input.method, params: {} },
    };
  }

  if (input.method === "preset.describe") {
    const field = unknownField(input.params, new Set(["presetId"]));
    if (field) return invalidParams(`$.params.${field}`, `Unknown parameter: ${field}.`);
    if (typeof input.params.presetId !== "string" || input.params.presetId.trim() === "") {
      return invalidParams("$.params.presetId", "presetId must be a non-empty string.");
    }
    return {
      ok: true,
      request: {
        id: input.id,
        method: input.method,
        params: {
          presetId: input.params.presetId,
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
      "expectedRevision",
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
    const revisionError = validateExpectedRevision(input.params);
    if (revisionError) return revisionError;
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
          ...(input.params.expectedRevision !== undefined
            ? { expectedRevision: input.params.expectedRevision }
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
    const field = unknownField(input.params, new Set([targetKey, "expectedRevision", "dryRun"]));
    if (field) return invalidParams(`$.params.${field}`, `Unknown parameter: ${field}.`);

    if (typeof input.params[targetKey] !== "string" || input.params[targetKey].trim() === "") {
      return invalidParams(`$.params.${targetKey}`, `${targetKey} must be a non-empty string.`);
    }
    for (const revisionKey of ["expectedRevision"]) {
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
    const revisionError = validateExpectedRevision(input.params);
    if (revisionError) return revisionError;
    return {
      ok: true,
      request: {
        id: input.id,
        method: input.method,
        params: {
          [targetKey]: input.params[targetKey],
          ...(input.params.expectedRevision !== undefined
            ? { expectedRevision: input.params.expectedRevision }
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
    const revisionError = validateExpectedRevision(input.params);
    if (revisionError) return revisionError;
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
      new Set(["patch", "expectedRevision", "allowMeasurementRestart", "dryRun"])
    );
    if (field) return invalidParams(`$.params.${field}`, `Unknown parameter: ${field}.`);

    if (!isPlainJsonObject(input.params.patch)) {
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
    const revisionError = validateExpectedRevision(input.params);
    if (revisionError) return revisionError;
    return {
      ok: true,
      request: {
        id: input.id,
        method: input.method,
        params: {
          patch: input.params.patch,
          ...(input.params.expectedRevision !== undefined
            ? { expectedRevision: input.params.expectedRevision }
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
    const field = unknownField(input.params, new Set(["afterRevision", "timeoutMs"]));
    if (field) return invalidParams(`$.params.${field}`, `Unknown parameter: ${field}.`);
    if (!Number.isSafeInteger(input.params.afterRevision) || input.params.afterRevision < 0) {
      return invalidParams(
        "$.params.afterRevision",
        "afterRevision must be a non-negative safe integer."
      );
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
        params: { afterRevision: input.params.afterRevision, timeoutMs },
      },
    };
  }

  const transportMutations = new Set([
    "transport.source.live",
    "transport.source.file",
    "transport.live.start",
    "transport.live.stop",
    "transport.live.clear",
    "transport.file.analyze",
    "transport.file.reanalyze",
    "transport.file.stop",
    "transport.file.select",
    "transport.file.remove",
    "transport.file.clear",
  ]);
  if (transportMutations.has(input.method)) {
    const needsPath = input.method === "transport.file.analyze";
    const needsSession = [
      "transport.file.reanalyze",
      "transport.file.stop",
      "transport.file.select",
      "transport.file.remove",
    ].includes(input.method);
    const allowsStopFileAnalysis = ["transport.source.live", "transport.live.start"].includes(
      input.method
    );
    const allowed = new Set([
      ...(needsPath ? ["path"] : []),
      ...(needsSession ? ["sessionId"] : []),
      ...(allowsStopFileAnalysis ? ["allowStopFileAnalysis"] : []),
      "expectedRevision",
      "dryRun",
    ]);
    const field = unknownField(input.params, allowed);
    if (field) return invalidParams(`$.params.${field}`, `Unknown parameter: ${field}.`);

    const targetKey = needsPath ? "path" : needsSession ? "sessionId" : null;
    if (
      targetKey &&
      (typeof input.params[targetKey] !== "string" || input.params[targetKey].trim() === "")
    ) {
      return invalidParams(`$.params.${targetKey}`, `${targetKey} must be a non-empty string.`);
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
    if (
      input.params.allowStopFileAnalysis !== undefined &&
      typeof input.params.allowStopFileAnalysis !== "boolean"
    ) {
      return invalidParams(
        "$.params.allowStopFileAnalysis",
        "allowStopFileAnalysis must be a boolean."
      );
    }
    if (input.params.dryRun !== undefined && typeof input.params.dryRun !== "boolean") {
      return invalidParams("$.params.dryRun", "dryRun must be a boolean.");
    }
    const revisionError = validateExpectedRevision(input.params);
    if (revisionError) return revisionError;
    return {
      ok: true,
      request: {
        id: input.id,
        method: input.method,
        params: {
          ...(targetKey ? { [targetKey]: input.params[targetKey] } : {}),
          ...(input.params.expectedRevision !== undefined
            ? { expectedRevision: input.params.expectedRevision }
            : {}),
          ...(input.params.allowStopFileAnalysis !== undefined
            ? { allowStopFileAnalysis: input.params.allowStopFileAnalysis }
            : {}),
          ...(input.params.dryRun !== undefined ? { dryRun: input.params.dryRun } : {}),
        },
      },
    };
  }

  if (input.method === "dock.panel.describe") {
    const field = unknownField(input.params, new Set(["panelId"]));
    if (field) return invalidParams(`$.params.${field}`, `Unknown parameter: ${field}.`);
    if (typeof input.params.panelId !== "string" || input.params.panelId.trim() === "") {
      return invalidParams("$.params.panelId", "panelId must be a non-empty string.");
    }
    return {
      ok: true,
      request: { id: input.id, method: input.method, params: { panelId: input.params.panelId } },
    };
  }

  const dockMutations = new Set([
    "dock.enter",
    "dock.exit",
    "dock.layout.apply",
    "dock.panel.update",
    "dock.panel.reset",
  ]);
  if (dockMutations.has(input.method)) {
    const enter = input.method === "dock.enter";
    const layout = input.method === "dock.layout.apply";
    const panel = input.method.startsWith("dock.panel.");
    const update = input.method === "dock.panel.update";
    const allowed = new Set([
      ...(enter ? ["edge", "monitor", "reserveSpace", "height"] : []),
      ...(layout ? ["layout"] : []),
      ...(panel ? ["panelId"] : []),
      ...(update ? ["patch"] : []),
      "expectedRevision",
      "dryRun",
    ]);
    const field = unknownField(input.params, allowed);
    if (field) return invalidParams(`$.params.${field}`, `Unknown parameter: ${field}.`);

    if (layout && !isPlainJsonObject(input.params.layout)) {
      return invalidParams("$.params.layout", "layout must be a plain JSON object.");
    }
    if (panel && (typeof input.params.panelId !== "string" || input.params.panelId.trim() === "")) {
      return invalidParams("$.params.panelId", "panelId must be a non-empty string.");
    }
    if (update && !isPlainJsonObject(input.params.patch)) {
      return invalidParams("$.params.patch", "patch must be a plain JSON object.");
    }
    if (input.params.edge !== undefined && !["top", "bottom"].includes(input.params.edge)) {
      return invalidParams("$.params.edge", "edge must be top or bottom.");
    }
    if (
      input.params.monitor !== undefined &&
      (typeof input.params.monitor !== "string" || input.params.monitor.trim() === "")
    ) {
      return invalidParams("$.params.monitor", "monitor must be a non-empty string.");
    }
    if (input.params.reserveSpace !== undefined && typeof input.params.reserveSpace !== "boolean") {
      return invalidParams("$.params.reserveSpace", "reserveSpace must be a boolean.");
    }
    if (
      input.params.height !== undefined &&
      (!Number.isInteger(input.params.height) ||
        input.params.height < 56 ||
        input.params.height > 160)
    ) {
      return invalidParams("$.params.height", "height must be an integer from 56 to 160.");
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
    const revisionError = validateExpectedRevision(input.params);
    if (revisionError) return revisionError;
    return {
      ok: true,
      request: {
        id: input.id,
        method: input.method,
        params: Object.fromEntries(
          Object.keys(input.params).map((key) => [key, input.params[key]])
        ),
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
    const revisionError = validateExpectedRevision(input.params);
    if (revisionError) return revisionError;
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
    const revisionError = validateExpectedRevision(input.params);
    if (revisionError) return revisionError;
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
