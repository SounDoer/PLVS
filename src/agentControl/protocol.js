import { VISUAL_RECORDING_TARGET_KINDS, normalizeVisualTarget } from "./visualControl.js";

const REQUEST_FIELDS = new Set(["jsonrpc", "id", "method", "params"]);
const TRANSPORT_ACTIONS = new Set([
  "transport.live.start",
  "transport.live.stop",
  "transport.file.analyze",
  "transport.file.reanalyze",
  "transport.file.stop",
]);
const LIBRARY_EXPORT_METHODS = new Set(["preset.export", "theme.export", "loudnessProfile.export"]);
const LIBRARY_IMPORT_METHODS = new Set(["preset.import", "theme.import", "loudnessProfile.import"]);
export const DEVICE_CONTROL_METHODS = Object.freeze([
  "device.list",
  "device.inspect",
  "device.select",
]);

export function isDeviceQuery(method) {
  return method === "device.list" || method === "device.inspect";
}

export function isDeviceMutation(method) {
  return method === "device.select";
}

export function isTransportAction(method) {
  return TRANSPORT_ACTIONS.has(method);
}

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

  if (input.method === "visual.describe") {
    const field = Object.keys(input.params)[0];
    if (field) return invalidParams(`$.params.${field}`, `Unknown parameter: ${field}.`);
    return {
      ok: true,
      request: { id: input.id, method: input.method, params: {} },
    };
  }

  if (input.method === "visual.screenshot") {
    const field = unknownField(input.params, new Set(["target", "expectedRevision"]));
    if (field) return invalidParams(`$.params.${field}`, `Unknown parameter: ${field}.`);
    const normalizedTarget = normalizeVisualTarget(input.params.target);
    if (!normalizedTarget.ok) {
      return invalidParams(`$.params.target${normalizedTarget.path}`, normalizedTarget.message);
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
    return {
      ok: true,
      request: {
        id: input.id,
        method: input.method,
        params: {
          target: normalizedTarget.target,
          ...(input.params.expectedRevision !== undefined
            ? { expectedRevision: input.params.expectedRevision }
            : {}),
        },
      },
    };
  }

  if (input.method === "visual.recording.start") {
    const field = unknownField(
      input.params,
      new Set(["target", "audio", "fps", "maxDurationSeconds", "expectedRevision"])
    );
    if (field) return invalidParams(`$.params.${field}`, `Unknown parameter: ${field}.`);
    const normalizedTarget = normalizeVisualTarget(input.params.target);
    if (!normalizedTarget.ok) {
      return invalidParams(`$.params.target${normalizedTarget.path}`, normalizedTarget.message);
    }
    if (!VISUAL_RECORDING_TARGET_KINDS.includes(normalizedTarget.target.kind)) {
      return invalidParams(
        "$.params.target.kind",
        "Recording target.kind must be one of: main, workspace."
      );
    }
    if (input.params.audio !== undefined && input.params.audio !== "none") {
      return invalidParams("$.params.audio", "audio must be none during silent recording.");
    }
    const fps = input.params.fps ?? 30;
    if (![15, 30, 60].includes(fps)) {
      return invalidParams("$.params.fps", "fps must be one of: 15, 30, 60.");
    }
    const maxDurationSeconds = input.params.maxDurationSeconds ?? 60;
    if (
      !Number.isInteger(maxDurationSeconds) ||
      maxDurationSeconds < 1 ||
      maxDurationSeconds > 1800
    ) {
      return invalidParams(
        "$.params.maxDurationSeconds",
        "maxDurationSeconds must be an integer from 1 through 1800."
      );
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
    return {
      ok: true,
      request: {
        id: input.id,
        method: input.method,
        params: {
          target: normalizedTarget.target,
          audio: "none",
          fps,
          maxDurationSeconds,
          ...(input.params.expectedRevision !== undefined
            ? { expectedRevision: input.params.expectedRevision }
            : {}),
        },
      },
    };
  }

  if (["visual.recording.inspect", "visual.recording.stop"].includes(input.method)) {
    const field = unknownField(input.params, new Set(["recordingId"]));
    if (field) return invalidParams(`$.params.${field}`, `Unknown parameter: ${field}.`);
    if (
      typeof input.params.recordingId !== "string" ||
      !/^rec-[0-9a-f]{32}$/.test(input.params.recordingId)
    ) {
      return invalidParams("$.params.recordingId", "recordingId must be an exact recording ID.");
    }
    return {
      ok: true,
      request: {
        id: input.id,
        method: input.method,
        params: { recordingId: input.params.recordingId },
      },
    };
  }

  if (input.method === "visual.recording.wait") {
    const field = unknownField(input.params, new Set(["recordingId", "timeoutMs"]));
    if (field) return invalidParams(`$.params.${field}`, `Unknown parameter: ${field}.`);
    if (
      typeof input.params.recordingId !== "string" ||
      !/^rec-[0-9a-f]{32}$/.test(input.params.recordingId)
    ) {
      return invalidParams("$.params.recordingId", "recordingId must be an exact recording ID.");
    }
    const timeoutMs = input.params.timeoutMs ?? 30000;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 300000) {
      return invalidParams(
        "$.params.timeoutMs",
        "timeoutMs must be an integer from 100 through 300000."
      );
    }
    return {
      ok: true,
      request: {
        id: input.id,
        method: input.method,
        params: { recordingId: input.params.recordingId, timeoutMs },
      },
    };
  }

  if (
    input.method === "app.capabilities" ||
    input.method === "app.inspect" ||
    input.method === "measurement.describe" ||
    input.method === "measurement.inspect" ||
    input.method === "view.describe" ||
    input.method === "view.inspect" ||
    input.method === "module.list" ||
    input.method === "axis.describe" ||
    input.method === "axis.inspect" ||
    input.method === "preset.list" ||
    input.method === "theme.list" ||
    input.method === "theme.inspect" ||
    input.method === "loudnessProfile.list" ||
    input.method === "config.export" ||
    input.method === "settings.describe" ||
    input.method === "settings.inspect" ||
    isDeviceQuery(input.method) ||
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

  if (input.method === "module.describe") {
    const field = unknownField(input.params, new Set(["moduleId"]));
    if (field) return invalidParams(`$.params.${field}`, `Unknown parameter: ${field}.`);
    if (typeof input.params.moduleId !== "string" || input.params.moduleId.trim() === "") {
      return invalidParams("$.params.moduleId", "moduleId must be a non-empty string.");
    }
    return {
      ok: true,
      request: {
        id: input.id,
        method: input.method,
        params: { moduleId: input.params.moduleId },
      },
    };
  }

  if (isDeviceMutation(input.method)) {
    const field = unknownField(
      input.params,
      new Set([
        "deviceId",
        "expectedRevision",
        "expectedGeneration",
        "allowMeasurementRestart",
        "dryRun",
      ])
    );
    if (field) return invalidParams(`$.params.${field}`, `Unknown parameter: ${field}.`);
    if (
      typeof input.params.deviceId !== "string" ||
      input.params.deviceId.trim() === "" ||
      Array.from(input.params.deviceId).length > 256
    ) {
      return invalidParams(
        "$.params.deviceId",
        "deviceId must be a non-empty string of at most 256 Unicode scalar values."
      );
    }
    const revisionError = validateExpectedRevision(input.params);
    if (revisionError) return revisionError;
    if (
      !Number.isSafeInteger(input.params.expectedGeneration) ||
      input.params.expectedGeneration < 0
    ) {
      return invalidParams(
        "$.params.expectedGeneration",
        "expectedGeneration must be a non-negative safe integer."
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
          deviceId: input.params.deviceId,
          expectedRevision: input.params.expectedRevision,
          expectedGeneration: input.params.expectedGeneration,
          ...(input.params.allowMeasurementRestart !== undefined
            ? { allowMeasurementRestart: input.params.allowMeasurementRestart }
            : {}),
          ...(input.params.dryRun !== undefined ? { dryRun: input.params.dryRun } : {}),
        },
      },
    };
  }

  if (input.method === "config.import") {
    const field = unknownField(
      input.params,
      new Set(["configuration", "expectedRevision", "dryRun"])
    );
    if (field) return invalidParams(`$.params.${field}`, `Unknown parameter: ${field}.`);
    if (!isPlainJsonObject(input.params.configuration)) {
      return invalidParams("$.params.configuration", "configuration must be a plain JSON object.");
    }
    const revisionError = validateExpectedRevision(input.params);
    if (revisionError) return revisionError;
    if (input.params.dryRun !== undefined && typeof input.params.dryRun !== "boolean") {
      return invalidParams("$.params.dryRun", "dryRun must be a boolean.");
    }
    return {
      ok: true,
      request: {
        id: input.id,
        method: input.method,
        params: {
          configuration: input.params.configuration,
          expectedRevision: input.params.expectedRevision,
          dryRun: input.params.dryRun === true,
        },
      },
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

  if (input.method === "loudnessProfile.describe") {
    const field = unknownField(input.params, new Set(["profileId"]));
    if (field) return invalidParams(`$.params.${field}`, `Unknown parameter: ${field}.`);
    if (
      typeof input.params.profileId !== "string" ||
      input.params.profileId.trim() === "" ||
      input.params.profileId === "off"
    ) {
      return invalidParams(
        "$.params.profileId",
        "profileId must be a non-empty Profile ID other than off."
      );
    }
    return {
      ok: true,
      request: {
        id: input.id,
        method: input.method,
        params: { profileId: input.params.profileId },
      },
    };
  }

  if (input.method === "theme.describe") {
    const field = unknownField(input.params, new Set(["themeId"]));
    if (field) return invalidParams(`$.params.${field}`, `Unknown parameter: ${field}.`);
    if (
      typeof input.params.themeId !== "string" ||
      input.params.themeId.trim() === "" ||
      input.params.themeId.length > 256
    ) {
      return invalidParams(
        "$.params.themeId",
        "themeId must be a non-empty string of at most 256 characters."
      );
    }
    return {
      ok: true,
      request: { id: input.id, method: input.method, params: { themeId: input.params.themeId } },
    };
  }

  const themeMutations = new Set([
    "theme.select",
    "theme.followSystem",
    "theme.create",
    "theme.update",
    "theme.rename",
    "theme.duplicate",
    "theme.delete",
    "theme.reorder",
  ]);
  if (themeMutations.has(input.method)) {
    const select = input.method === "theme.select";
    const create = input.method === "theme.create";
    const update = input.method === "theme.update";
    const rename = input.method === "theme.rename";
    const duplicate = input.method === "theme.duplicate";
    const reorder = input.method === "theme.reorder";
    const hasThemeId = select || update || rename || duplicate || input.method === "theme.delete";
    const allowed = new Set([
      ...(hasThemeId ? ["themeId"] : []),
      ...(create || update ? ["document"] : []),
      ...(rename || duplicate ? ["name"] : []),
      ...(reorder ? ["themeIds"] : []),
      "expectedRevision",
      "dryRun",
    ]);
    const field = unknownField(input.params, allowed);
    if (field) return invalidParams(`$.params.${field}`, `Unknown parameter: ${field}.`);
    if (
      hasThemeId &&
      (typeof input.params.themeId !== "string" ||
        input.params.themeId.trim() === "" ||
        input.params.themeId.length > 256)
    ) {
      return invalidParams(
        "$.params.themeId",
        "themeId must be a non-empty string of at most 256 characters."
      );
    }
    if ((create || update) && !isPlainJsonObject(input.params.document)) {
      return invalidParams("$.params.document", "document must be a plain JSON object.");
    }
    if (
      (rename || duplicate) &&
      (typeof input.params.name !== "string" ||
        input.params.name.trim() === "" ||
        input.params.name.length > 64)
    ) {
      return invalidParams(
        "$.params.name",
        "name must be a non-empty string of at most 64 characters."
      );
    }
    if (reorder && !Array.isArray(input.params.themeIds)) {
      return invalidParams("$.params.themeIds", "themeIds must be an array.");
    }
    const revisionError = validateExpectedRevision(input.params);
    if (revisionError) return revisionError;
    if (input.params.dryRun !== undefined && typeof input.params.dryRun !== "boolean") {
      return invalidParams("$.params.dryRun", "dryRun must be a boolean.");
    }
    return {
      ok: true,
      request: {
        id: input.id,
        method: input.method,
        params: {
          ...(hasThemeId ? { themeId: input.params.themeId } : {}),
          ...(create || update ? { document: input.params.document } : {}),
          ...(rename || duplicate ? { name: input.params.name } : {}),
          ...(reorder ? { themeIds: input.params.themeIds } : {}),
          expectedRevision: input.params.expectedRevision,
          ...(input.params.dryRun !== undefined ? { dryRun: input.params.dryRun } : {}),
        },
      },
    };
  }

  const loudnessProfileMutations = new Set([
    "loudnessProfile.select",
    "loudnessProfile.create",
    "loudnessProfile.update",
    "loudnessProfile.rename",
    "loudnessProfile.delete",
    "loudnessProfile.reorder",
  ]);
  if (loudnessProfileMutations.has(input.method)) {
    const create = input.method === "loudnessProfile.create";
    const update = input.method === "loudnessProfile.update";
    const rename = input.method === "loudnessProfile.rename";
    const reorder = input.method === "loudnessProfile.reorder";
    const select = input.method === "loudnessProfile.select";
    const hasProfileId = !create && !reorder;
    const allowed = new Set([
      ...(hasProfileId ? ["profileId"] : []),
      ...(create || update ? ["document"] : []),
      ...(rename ? ["name"] : []),
      ...(reorder ? ["profileIds"] : []),
      "expectedRevision",
      "dryRun",
    ]);
    const field = unknownField(input.params, allowed);
    if (field) return invalidParams(`$.params.${field}`, `Unknown parameter: ${field}.`);

    if (
      hasProfileId &&
      (typeof input.params.profileId !== "string" || input.params.profileId.trim() === "")
    ) {
      return invalidParams("$.params.profileId", "profileId must be a non-empty string.");
    }
    if (hasProfileId && !select && input.params.profileId === "off") {
      return invalidParams("$.params.profileId", "off is only valid for Profile selection.");
    }
    if ((create || update) && !isPlainJsonObject(input.params.document)) {
      return invalidParams("$.params.document", "document must be a plain JSON object.");
    }
    if (rename && typeof input.params.name !== "string") {
      return invalidParams("$.params.name", "name must be a string.");
    }
    if (reorder && !Array.isArray(input.params.profileIds)) {
      return invalidParams("$.params.profileIds", "profileIds must be an array.");
    }
    const revisionError = validateExpectedRevision(input.params);
    if (revisionError) return revisionError;
    if (input.params.dryRun !== undefined && typeof input.params.dryRun !== "boolean") {
      return invalidParams("$.params.dryRun", "dryRun must be a boolean.");
    }

    return {
      ok: true,
      request: {
        id: input.id,
        method: input.method,
        params: {
          ...(hasProfileId ? { profileId: input.params.profileId } : {}),
          ...(create || update ? { document: input.params.document } : {}),
          ...(rename ? { name: input.params.name } : {}),
          ...(reorder ? { profileIds: input.params.profileIds } : {}),
          expectedRevision: input.params.expectedRevision,
          ...(input.params.dryRun !== undefined ? { dryRun: input.params.dryRun } : {}),
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

  if (input.method === "view.update" || input.method === "view.reset") {
    const update = input.method === "view.update";
    const field = unknownField(
      input.params,
      new Set([...(update ? ["patch"] : []), "expectedRevision", "dryRun"])
    );
    if (field) return invalidParams(`$.params.${field}`, `Unknown parameter: ${field}.`);
    if (update && !isPlainJsonObject(input.params.patch)) {
      return invalidParams("$.params.patch", "patch must be a plain JSON object.");
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
          ...(update ? { patch: input.params.patch } : {}),
          expectedRevision: input.params.expectedRevision,
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

  if (input.method === "measurement.wait") {
    const field = unknownField(
      input.params,
      new Set(["afterGeneration", "afterSequence", "timeoutMs"])
    );
    if (field) return invalidParams(`$.params.${field}`, `Unknown parameter: ${field}.`);
    if (!Number.isSafeInteger(input.params.afterGeneration) || input.params.afterGeneration < 0) {
      return invalidParams(
        "$.params.afterGeneration",
        "afterGeneration must be a non-negative safe integer."
      );
    }
    if (
      input.params.afterSequence !== undefined &&
      (!Number.isSafeInteger(input.params.afterSequence) || input.params.afterSequence < 0)
    ) {
      return invalidParams(
        "$.params.afterSequence",
        "afterSequence must be a non-negative safe integer when provided."
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
        params: {
          afterGeneration: input.params.afterGeneration,
          ...(input.params.afterSequence !== undefined
            ? { afterSequence: input.params.afterSequence }
            : {}),
          timeoutMs,
        },
      },
    };
  }

  const transportCommands = new Set([
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
  if (transportCommands.has(input.method)) {
    const isAction = isTransportAction(input.method);
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
      ...(!isAction ? ["dryRun"] : []),
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
    if (
      !isAction &&
      input.params.dryRun !== undefined &&
      typeof input.params.dryRun !== "boolean"
    ) {
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
          ...(!isAction && input.params.dryRun !== undefined
            ? { dryRun: input.params.dryRun }
            : {}),
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

  if (LIBRARY_EXPORT_METHODS.has(input.method)) {
    const field = unknownField(input.params, new Set(["ids"]));
    if (field) return invalidParams(`$.params.${field}`, `Unknown parameter: ${field}.`);

    if (input.params.ids === undefined) {
      return {
        ok: true,
        request: { id: input.id, method: input.method, params: { ids: null } },
      };
    }
    // An explicit empty array is a caller asking for nothing, and is rejected rather than
    // quietly exporting the whole library.
    if (
      !Array.isArray(input.params.ids) ||
      input.params.ids.length === 0 ||
      input.params.ids.some((id) => typeof id !== "string" || id.trim() === "")
    ) {
      return invalidParams("$.params.ids", "ids must be a non-empty array of non-empty strings.");
    }
    return {
      ok: true,
      request: { id: input.id, method: input.method, params: { ids: input.params.ids } },
    };
  }

  if (LIBRARY_IMPORT_METHODS.has(input.method)) {
    const field = unknownField(input.params, new Set(["pack", "expectedRevision", "dryRun"]));
    if (field) return invalidParams(`$.params.${field}`, `Unknown parameter: ${field}.`);

    if (!isPlainJsonObject(input.params.pack)) {
      return invalidParams("$.params.pack", "pack must be a plain JSON object.");
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
          pack: input.params.pack,
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
