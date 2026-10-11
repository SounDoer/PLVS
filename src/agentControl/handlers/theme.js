import { BUILTIN_THEMES_V2 } from "../../theme/builtinThemesV2.js";
import { listThemeSummaries } from "../../theme/themeLibrary.js";
import { semanticFailure } from "../bridge/failures.js";
import { themeStateSignature } from "../bridge/signatures.js";

function compactThemeState(state) {
  return {
    appearance: state.appearance,
    themes: listThemeSummaries(state),
  };
}

/**
 * @param {string} method
 */
function themePlanResult(method, planned) {
  if (method === "theme.select" || method === "theme.followSystem") {
    return {
      previousAppearance: planned.previousAppearance,
      appearance: planned.appearance,
    };
  }
  if (method === "theme.create") {
    return {
      document: planned.document,
      selectCreated: true,
      ...(planned.theme ? { theme: planned.theme } : {}),
    };
  }
  if (method === "theme.duplicate") {
    return {
      source: planned.source,
      name: planned.name,
      selectCreated: true,
      ...(planned.theme ? { theme: planned.theme } : {}),
    };
  }
  if (method === "theme.delete") {
    return {
      deletedTheme: planned.deletedTheme,
      ...(planned.fallbackThemeId ? { fallbackThemeId: planned.fallbackThemeId } : {}),
    };
  }
  if (method === "theme.reorder") return { themeIds: planned.themeIds };
  return { theme: planned.theme };
}

/** @param {import("../bridge/types.js").BridgeContext} ctx */
async function inspectOrList(ctx) {
  const { request, requestId, clock, live } = ctx;
  const currentTheme = live().themeState;
  return {
    requestId,
    result: {
      revision: clock.current(),
      appearance: currentTheme.appearance,
      ...(request.method === "theme.list" ? { themes: listThemeSummaries(currentTheme) } : {}),
    },
  };
}

/** @param {import("../bridge/types.js").BridgeContext} ctx */
async function describe(ctx) {
  const { request, requestId, clock, live } = ctx;
  const currentTheme = live().themeState;
  const builtin = BUILTIN_THEMES_V2[request.params.themeId];
  const index = currentTheme.themes.findIndex(({ id }) => id === request.params.themeId);
  const document = builtin ?? (index >= 0 ? currentTheme.themes[index] : null);
  if (!document) {
    throw semanticFailure(
      "themeNotFound",
      "$.params.themeId",
      `Theme ${request.params.themeId} was not found.`,
      -32020
    );
  }
  return {
    requestId,
    result: {
      revision: clock.current(),
      theme: structuredClone(document),
      kind: builtin ? "builtin" : "custom",
      active: currentTheme.appearance.resolvedThemeId === document.id,
      index: builtin ? null : index,
    },
  };
}

/** @param {import("../bridge/types.js").BridgeContext} ctx */
async function mutate(ctx) {
  const { request, requestId, clock, settlement, flush, live } = ctx;
  const currentRevision = clock.current();
  if (request.params.expectedRevision !== currentRevision) {
    throw semanticFailure(
      "revisionConflict",
      "$.params.expectedRevision",
      `Themes changed after revision ${request.params.expectedRevision}.`,
      -32004,
      { expectedRevision: request.params.expectedRevision, currentRevision }
    );
  }
  const control = live().themeControl;
  if (!control) {
    throw semanticFailure("controlUnavailable", "$", "Theme Control is unavailable.", -32012);
  }
  if (request.method !== "theme.reorder") control.assertAllowed(request.method);

  const dryRun = request.params.dryRun === true;
  const makeId = () => `custom-${crypto.randomUUID()}`;
  const planned =
    request.method === "theme.select"
      ? control.planSelect(request.params.themeId)
      : request.method === "theme.followSystem"
        ? control.planFollowSystem()
        : request.method === "theme.create"
          ? control.planCreate(request.params.document, dryRun ? undefined : { makeId })
          : request.method === "theme.update"
            ? control.planUpdate(request.params.themeId, request.params.document)
            : request.method === "theme.rename"
              ? control.planRename(request.params.themeId, request.params.name)
              : request.method === "theme.duplicate"
                ? control.planDuplicate(
                    request.params.themeId,
                    request.params.name,
                    dryRun ? undefined : { makeId }
                  )
                : request.method === "theme.delete"
                  ? control.planDelete(request.params.themeId)
                  : control.planReorder(request.params.themeIds);

  if (planned.issues.length > 0) {
    const first = planned.issues[0];
    const paths = {
      themeNotFound: "$.params.themeId",
      themeNotMutable: "$.params.themeId",
      invalidPermutation: "$.params.themeIds",
      invalidName: "$.params.name",
    };
    const codes = {
      themeNotFound: -32020,
      themeNotMutable: -32602,
      invalidPermutation: -32602,
      invalidName: -32602,
    };
    const reason = paths[first.code] ? first.code : "invalidTheme";
    throw semanticFailure(
      reason,
      paths[first.code] ?? "$.params.document",
      reason === "invalidTheme" ? "The Theme document is invalid." : first.message,
      codes[first.code] ?? -32602,
      { issues: planned.issues }
    );
  }

  const result = {
    dryRun,
    revision: currentRevision,
    changed: planned.changed.length > 0,
    warnings: planned.warnings,
    plan: themePlanResult(request.method, planned),
    state: compactThemeState(planned.state),
  };
  if (dryRun || planned.changed.length === 0) return { requestId, result };

  const committed = settlement.arm("theme", {
    signature: themeStateSignature(planned.state),
  });
  control.commit(planned);
  result.revision = await settlement.observed("theme", committed, "The Theme change");
  result.state = compactThemeState(live().themeState);
  try {
    await flush();
  } catch (error) {
    throw semanticFailure(
      "persistenceFailed",
      "$",
      `Theme committed but persistence failed: ${error?.message || String(error)}`,
      -32030,
      { stateCommitted: true, revision: result.revision }
    );
  }
  return { requestId, result };
}

/** @type {Record<string, import("../bridge/types.js").HandlerEntry>} */
export const themeHandlers = {
  "theme.inspect": { run: inspectOrList },
  "theme.list": { run: inspectOrList },
  "theme.describe": { run: describe },
  "theme.select": { run: mutate },
  "theme.followSystem": { run: mutate },
  "theme.create": { run: mutate },
  "theme.update": { run: mutate },
  "theme.rename": { run: mutate },
  "theme.duplicate": { run: mutate },
  "theme.delete": { run: mutate },
  "theme.reorder": { run: mutate },
};
