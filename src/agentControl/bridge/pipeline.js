import { suggestNames } from "../nameSuggestions.js";
import { listUiTargets } from "../../uiNavigation/uiTargets.js";
import { isSceneOperationRefused } from "../../lib/sceneOperations.js";
import {
  isDevelopmentFixtureMethod,
  normalizeDevelopmentFixtureRequest,
} from "../developmentFixtureProtocol.js";
import {
  isDevelopmentPerformanceMethod,
  normalizeDevelopmentPerformanceRequest,
} from "../developmentPerformanceProtocol.js";
import {
  isDevelopmentUpdateMethod,
  normalizeDevelopmentUpdateRequest,
} from "../developmentUpdateProtocol.js";
import { agentControlRpcError, normalizeAgentControlRequest } from "../protocol.js";
import { WorkspaceLayoutError } from "../../workspace/workspaceLayout.js";
import { isCommitNotObserved, persistUnobservedCommit, semanticFailure } from "./failures.js";

/**
 * Whether the listener answers this method outside the serialized queue. Long waits, measurement
 * reads and visual capture must not sit behind a mutation, nor hold one up.
 *
 * @param {Readonly<Record<string, import("./types.js").HandlerEntry>>} table
 * @param {unknown} method
 */
export function isDirectLane(table, method) {
  return typeof method === "string" && table[method]?.lane === "direct";
}

/**
 * Holds every option the hook was handed, as of the latest React commit. A command reads it once
 * when it starts and again after each `await`.
 *
 * @param {import("./types.js").BridgeInputs} initial
 */
export function createLatestInputs(initial) {
  let latest = initial;
  return {
    get: () => latest,
    /** @param {import("./types.js").BridgeInputs} next */
    set(next) {
      latest = next;
    },
  };
}

/**
 * Everything one request goes through around its handler: normalization, the revision batch, the
 * Dock context, error mapping and batch cleanup. It knows no particular command.
 *
 * @param {{
 *   latestInputs: () => import("./types.js").BridgeInputs,
 *   clock: import("./types.js").BridgeContext["clock"],
 *   settlement: import("./types.js").BridgeContext["settlement"],
 *   waiters: import("./types.js").BridgeContext["waiters"],
 *   visual: import("./types.js").BridgeContext["visual"],
 *   table: Readonly<Record<string, import("./types.js").HandlerEntry>>,
 * }} core
 * @returns {(rawRequest: any, signal?: AbortSignal) => Promise<any>}
 */
export function createRequestProcessor({
  latestInputs,
  clock,
  settlement,
  waiters,
  visual,
  table,
}) {
  return async function processRequest(rawRequest, signal) {
    // The app state React had rendered when this request started. Handlers plan against it and
    // call `live()` after an `await` to see what has been rendered since.
    const snap = latestInputs();
    const developmentEnabled = snap.developmentFixtures?.enabled === true;
    const developmentFixtureRequest =
      developmentEnabled && isDevelopmentFixtureMethod(rawRequest?.method);
    const developmentPerformanceRequest =
      developmentEnabled && isDevelopmentPerformanceMethod(rawRequest?.method);
    const developmentUpdateRequest =
      snap.developmentUpdate?.enabled === true && isDevelopmentUpdateMethod(rawRequest?.method);
    const normalized = developmentFixtureRequest
      ? normalizeDevelopmentFixtureRequest(rawRequest)
      : developmentPerformanceRequest
        ? normalizeDevelopmentPerformanceRequest(rawRequest)
        : developmentUpdateRequest
          ? normalizeDevelopmentUpdateRequest(rawRequest)
          : normalizeAgentControlRequest(rawRequest);
    const requestId =
      normalized.ok && normalized.request.id
        ? normalized.request.id
        : typeof rawRequest?.id === "string"
          ? rawRequest.id
          : "";

    if (!normalized.ok) {
      return { requestId, error: agentControlRpcError(normalized.error) };
    }

    const { request } = normalized;
    const revisionBatch =
      request.method.startsWith("visual.") || request.params.expectedRevision === undefined
        ? null
        : clock.beginBatch();
    try {
      const entry = table[request.method];
      if (!entry) {
        // Unreachable while `handlers/coverage.test.js` passes: normalization admits only methods
        // the manifest lists, and the test holds the table to the manifest.
        throw semanticFailure(
          "methodNotFound",
          "$.method",
          `No handler is registered for ${request.method}.`,
          -32601
        );
      }
      // Dock panels share the Workspace panel mapping, which offers and keeps the Loudness reference
      // layer only when this is set; the bare Dock context never carried it.
      let dockRequestContext = {
        ...snap.dockContext,
        hasLoudnessReference: snap.hasLoudnessReference,
      };
      if (entry.monitorInventory && snap.dockContext.readMonitorInventory) {
        try {
          dockRequestContext = {
            ...dockRequestContext,
            ...(await snap.dockContext.readMonitorInventory()),
          };
        } catch (error) {
          throw semanticFailure(
            "commandFailed",
            "$",
            `Monitor inventory could not be read: ${error?.message || String(error)}`,
            -32603
          );
        }
      }
      return await entry.run({
        request,
        requestId,
        signal,
        snap,
        live: latestInputs,
        clock,
        settlement,
        waiters,
        visual,
        dockRequestContext,
        flush: snap.flush,
      });
    } catch (error) {
      // One place rather than nine: `isCommitNotObserved` is true only for the settlement
      // timeout, so every pre-commit failure -- validation, `revisionConflict`, `editorActive`,
      // a refused scene operation -- still reaches here without touching the disk.
      if (isCommitNotObserved(error)) {
        return {
          requestId,
          error: agentControlRpcError(await persistUnobservedCommit(error, snap.flush)),
        };
      }
      const semantic =
        error instanceof WorkspaceLayoutError
          ? semanticFailure(error.reason, error.path, error.message, -32602)
          : isSceneOperationRefused(error)
            ? semanticFailure(error.code, "$", error.message, -32040, {
                operation: error.operation,
                ...(Array.isArray(error.editors) ? { editors: error.editors } : {}),
                ...(typeof error.reason === "string" ? { reason: error.reason } : {}),
              })
            : error;
      return {
        requestId,
        error: agentControlRpcError(
          withUiTargetSuggestions(
            withPanelSuggestions(semantic, request, snap),
            request,
            latestInputs
          )
        ),
      };
    } finally {
      clock.endBatch(revisionBatch);
    }
  };
}

/**
 * A Panel ID that names no Workspace Panel gets the closest existing IDs and the full list, which
 * is short, so the caller can correct it without another round trip.
 */
function withPanelSuggestions(semantic, request, snap) {
  const panelId = request?.params?.panelId;
  const panelsById = snap?.workspace?.panelsById;
  if (semantic?.reason !== "panelNotFound" || typeof panelId !== "string" || !panelsById) {
    return semantic;
  }
  const availablePanelIds = Object.keys(panelsById);
  return {
    ...semantic,
    details: {
      ...semantic.details,
      suggestions: suggestNames(panelId, availablePanelIds),
      availablePanelIds,
    },
  };
}

/** A UI target ID that names no mounted control gets the closest mounted target IDs. */
function withUiTargetSuggestions(semantic, request, live) {
  const target = request?.params?.target ?? request?.params?.control;
  if (semantic?.reason !== "uiTargetNotFound" || typeof target !== "string") return semantic;
  let mounted = [];
  try {
    mounted = [
      ...listUiTargets().map(({ id }) => id),
      ...(live?.().pointerControl?.accessoryTargets?.() ?? []).map(({ id }) => id),
    ];
  } catch {
    return semantic;
  }
  const suggestions = suggestNames(target, mounted);
  if (suggestions.length === 0) return semantic;
  return { ...semantic, details: { ...semantic.details, suggestions } };
}
