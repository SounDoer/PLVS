import { DOCK_MAX_HEIGHT, DOCK_MIN_HEIGHT } from "../../dock/dockSizing.js";
import {
  invalidParams,
  isPlainJsonObject,
  unknownField,
  validateExpectedRevision,
} from "./common.js";

export function normalizeDockRequest(input) {
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
    "dock.layout.reset",
    "dock.panel.update",
    "dock.panel.reset",
  ]);
  if (dockMutations.has(input.method)) {
    const enter = input.method === "dock.enter";
    const layout = input.method === "dock.layout.apply";
    const panel = input.method.startsWith("dock.panel.");
    const update = input.method === "dock.panel.update";
    const allowed = new Set([
      ...(enter ? ["edge", "monitor", "reserveSpace", "aboveFullScreen", "height"] : []),
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
      input.params.aboveFullScreen !== undefined &&
      typeof input.params.aboveFullScreen !== "boolean"
    ) {
      return invalidParams("$.params.aboveFullScreen", "aboveFullScreen must be a boolean.");
    }
    if (
      input.params.height !== undefined &&
      (!Number.isInteger(input.params.height) ||
        input.params.height < DOCK_MIN_HEIGHT ||
        input.params.height > DOCK_MAX_HEIGHT)
    ) {
      return invalidParams(
        "$.params.height",
        `height must be an integer from ${DOCK_MIN_HEIGHT} to ${DOCK_MAX_HEIGHT}.`
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

  return null;
}
