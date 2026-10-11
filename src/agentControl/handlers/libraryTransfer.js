import {
  buildLibraryList,
  libraryFamily,
  planLibraryExport,
  planLibraryImport,
} from "../libraryTransfer.js";
import { PackValidationError } from "../../transfer/packShape.js";
import { BUILTIN_THEMES_V2 } from "../../theme/builtinThemesV2.js";
import { semanticFailure } from "../bridge/failures.js";
import { activeLoudnessProfileId } from "../bridge/signatures.js";

/** @param {import("../bridge/types.js").BridgeContext} ctx */
async function listExportOrImport(ctx) {
  const { request, requestId, clock, settlement, flush } = ctx;
  // The method table routes exactly the `<family>.<action>` methods registered below.
  const [family, action] = request.method.split(".");
  const { stateKey, notFoundCode } = libraryFamily(family);

  if (action === "list") {
    const entries = buildLibraryList(family);
    return {
      requestId,
      result: {
        revision: clock.current(),
        [stateKey]: entries,
        ...(family === "loudnessProfile" ? { activeId: activeLoudnessProfileId(entries) } : {}),
      },
    };
  }

  if (action === "export") {
    if (
      family === "theme" &&
      request.params.ids?.some((id) => Object.hasOwn(BUILTIN_THEMES_V2, id))
    ) {
      const builtinIds = request.params.ids.filter((id) => Object.hasOwn(BUILTIN_THEMES_V2, id));
      throw semanticFailure(
        "themeNotExportable",
        "$.params.ids",
        `Built-in Themes cannot be exported: ${builtinIds.join(", ")}.`,
        -32602,
        { themeIds: builtinIds }
      );
    }
    let planned;
    try {
      planned = planLibraryExport(family, request.params.ids);
    } catch (error) {
      // Pack V2 export is strict: an empty library or an unreadable stored item cannot
      // become a file this build would accept back.
      if (
        !(error instanceof PackValidationError) ||
        !["preset", "theme", "loudnessProfile"].includes(family)
      ) {
        throw error;
      }
      const reason = {
        preset: "presetNotExportable",
        theme: "themeNotExportable",
        loudnessProfile: "loudnessProfileNotExportable",
      }[family];
      throw semanticFailure(
        reason,
        "$.params",
        error.message,
        -32602,
        error.issues.length > 0 ? { issues: error.issues } : undefined
      );
    }
    if (planned.missingIds.length > 0) {
      throw semanticFailure(
        notFoundCode,
        "$.params.ids",
        `These ids are not in the library: ${planned.missingIds.join(", ")}.`,
        -32020,
        { missingIds: planned.missingIds }
      );
    }
    return {
      requestId,
      result: { revision: clock.current(), pack: planned.pack },
    };
  }

  // Import is deliberately not a scene operation: the merge only appends, moves no
  // selection and dirties no Preset, so it cannot destroy an open editor's draft. The
  // GUI's own Import buttons are not disabled by editor state either.
  const currentRevision = clock.current();
  if (
    request.params.expectedRevision !== undefined &&
    request.params.expectedRevision !== currentRevision
  ) {
    throw semanticFailure(
      "revisionConflict",
      "$.params.expectedRevision",
      `App state changed after revision ${request.params.expectedRevision}.`,
      -32004,
      { expectedRevision: request.params.expectedRevision, currentRevision }
    );
  }

  let planned;
  try {
    planned = planLibraryImport(family, request.params.pack);
  } catch (error) {
    if (!(error instanceof PackValidationError)) throw error;
    // The message is the one a recipient of a shared file needs -- which library the file
    // belongs to, or that it is a whole configuration -- so it is passed through verbatim.
    throw semanticFailure(
      "invalidPack",
      "$.params.pack",
      error.message,
      -32602,
      error.issues.length > 0 ? { issues: error.issues } : undefined
    );
  }

  const result = {
    dryRun: request.params.dryRun === true,
    revision: currentRevision,
    changed: planned.changed,
    warnings: planned.warnings,
    plan: planned.plan,
    state: { [stateKey]: buildLibraryList(family) },
  };
  if (result.dryRun || !planned.changed) {
    return { requestId, result };
  }

  const committed = settlement.arm("library", { families: planned.writes });
  planned.commit();
  result.state = { [stateKey]: buildLibraryList(family) };
  result.revision = await settlement.observed("library", committed, "The library import");
  try {
    await flush();
  } catch (error) {
    throw semanticFailure(
      "persistenceFailed",
      "$",
      `Library committed but persistence failed: ${error?.message || String(error)}`,
      -32030,
      { stateCommitted: true, revision: result.revision }
    );
  }
  return { requestId, result };
}

/** @type {Record<string, import("../bridge/types.js").HandlerEntry>} */
export const libraryTransferHandlers = {
  "loudnessProfile.list": { run: listExportOrImport },
  "preset.export": { run: listExportOrImport },
  "theme.export": { run: listExportOrImport },
  "loudnessProfile.export": { run: listExportOrImport },
  "preset.import": { run: listExportOrImport },
  "theme.import": { run: listExportOrImport },
  "loudnessProfile.import": { run: listExportOrImport },
};
