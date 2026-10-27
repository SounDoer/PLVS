import { normalizePresets } from "../../hooks/usePresets.js";
import { normalizeRuleDocument } from "../../lib/loudnessProfileNormalize.js";
import { semanticFailure } from "../bridge/failures.js";
import {
  presetLibrarySignature,
  loudnessProfileStateSignature,
  activeLoudnessProfileId,
} from "../bridge/signatures.js";

function compactLoudnessProfileState(state, previewDocument = null) {
  const profiles = state.profiles.map(({ id, name }) => ({ id, name }));
  if (previewDocument) profiles.push({ id: null, name: previewDocument.name });
  return {
    profiles,
    activeId: previewDocument ? null : activeLoudnessProfileId(state.profiles, state.active),
  };
}

/** @param {import("../bridge/types.js").BridgeContext} ctx */
async function describe(ctx) {
  const { request, requestId, clock } = ctx;
  const { loudnessProfiles, loudnessActive } = ctx.snap;
  const index = loudnessProfiles.findIndex(({ id }) => id === request.params.profileId);
  if (index < 0) {
    throw semanticFailure(
      "loudnessProfileNotFound",
      "$.params.profileId",
      `Loudness Profile ${request.params.profileId} was not found.`,
      -32020
    );
  }
  const profile = normalizeRuleDocument(loudnessProfiles[index]);
  return {
    requestId,
    result: {
      revision: clock.current(),
      profile,
      active: activeLoudnessProfileId(loudnessProfiles, loudnessActive) === profile.id,
      index,
    },
  };
}

/** @param {import("../bridge/types.js").BridgeContext} ctx */
async function mutate(ctx) {
  const { request, requestId, clock, settlement, flush } = ctx;
  const { presets, loudnessProfile } = ctx.snap;
  const currentRevision = clock.current();
  if (request.params.expectedRevision !== currentRevision) {
    throw semanticFailure(
      "revisionConflict",
      "$.params.expectedRevision",
      `Loudness Profiles changed after revision ${request.params.expectedRevision}.`,
      -32004,
      { expectedRevision: request.params.expectedRevision, currentRevision }
    );
  }
  const control = loudnessProfile?.control;
  if (!control) {
    throw semanticFailure(
      "controlUnavailable",
      "$",
      "Loudness Profile Control is unavailable.",
      -32012
    );
  }
  if (request.method !== "loudnessProfile.reorder") {
    control.assertAllowed(request.method);
  }

  let planned =
    request.method === "loudnessProfile.select"
      ? control.planSelect(request.params.profileId)
      : request.method === "loudnessProfile.create"
        ? control.planCreate(request.params.document)
        : request.method === "loudnessProfile.update"
          ? control.planUpdate(request.params.profileId, request.params.document)
          : request.method === "loudnessProfile.rename"
            ? control.planRename(request.params.profileId, request.params.name)
            : request.method === "loudnessProfile.delete"
              ? control.planDelete(request.params.profileId)
              : control.planReorder(request.params.profileIds);
  if (planned.issues.length > 0) {
    const missing = planned.issues.find(({ code }) => code === "loudnessProfileNotFound");
    const permutation = planned.issues.find(({ code }) => code === "invalidPermutation");
    if (missing) {
      throw semanticFailure(
        "loudnessProfileNotFound",
        "$.params.profileId",
        missing.message,
        -32020
      );
    }
    if (permutation) {
      throw semanticFailure(
        "invalidPermutation",
        "$.params.profileIds",
        permutation.message,
        -32602,
        { issues: planned.issues }
      );
    }
    throw semanticFailure(
      "invalidProfile",
      request.method === "loudnessProfile.rename" ? "$.params.name" : "$.params.document",
      "The Loudness Profile document is invalid.",
      -32602,
      { issues: planned.issues }
    );
  }

  const profilePlan = () =>
    request.method === "loudnessProfile.select"
      ? { from: planned.from, to: planned.to }
      : request.method === "loudnessProfile.create"
        ? {
            document: planned.document,
            selectCreated: true,
            ...(planned.profile ? { profile: planned.profile } : {}),
          }
        : request.method === "loudnessProfile.delete"
          ? {
              deletedProfile: planned.deletedProfile,
              selectionFallsBackToOff: planned.selectionFallsBackToOff,
              affectedPresetIds: planned.affectedPresetIds,
            }
          : request.method === "loudnessProfile.reorder"
            ? { profileIds: planned.profileIds }
            : { profile: planned.profile };
  const dryRun = request.params.dryRun === true;
  const result = {
    dryRun,
    revision: currentRevision,
    changed: planned.changed.length > 0,
    warnings: planned.warnings,
    plan: profilePlan(),
    state: compactLoudnessProfileState(
      planned.loudnessProfiles,
      dryRun && request.method === "loudnessProfile.create" ? planned.document : null
    ),
  };
  if (dryRun || planned.changed.length === 0) return { requestId, result };

  const registerSettlement = (commitPlan) => {
    const expected = {
      loudnessProfile: loudnessProfileStateSignature(
        commitPlan.loudnessProfiles.profiles,
        commitPlan.loudnessProfiles.active
      ),
    };
    // The plan carries the stored Preset record; the watcher sees the Presets state the app renders.
    // They differ whenever the record holds something the app does not show -- an `activeId` naming
    // a Preset that is gone -- and a signature taken from the record would then describe a state no
    // render produces: the command times out on a commit that succeeded.
    const renderedPresets = commitPlan.presets ? normalizePresets(commitPlan.presets) : null;
    if (
      renderedPresets &&
      presetLibrarySignature(renderedPresets) !== presetLibrarySignature(presets)
    ) {
      expected.presets = presetLibrarySignature(renderedPresets);
    }
    const committed = settlement.arm("loudnessProfile", { expected, observed: new Set() });
    return committed;
  };

  let committed;
  if (request.method === "loudnessProfile.create") {
    planned = control.create(request.params.document);
    if (planned.issues.length > 0 || !planned.profile) {
      throw semanticFailure("commandFailed", "$", "Loudness Profile could not be created.", -32050);
    }
    committed = registerSettlement(planned);
  } else {
    committed = registerSettlement(planned);
    control.commit(planned);
  }
  result.plan = profilePlan();
  result.state = compactLoudnessProfileState(planned.loudnessProfiles);
  result.revision = await settlement.observed(
    "loudnessProfile",
    committed,
    "The Loudness Profile change"
  );
  try {
    await flush();
  } catch (error) {
    throw semanticFailure(
      "persistenceFailed",
      "$",
      `Loudness Profile committed but persistence failed: ${error?.message || String(error)}`,
      -32030,
      { stateCommitted: true, revision: result.revision }
    );
  }
  return { requestId, result };
}

/** @type {Record<string, import("../bridge/types.js").HandlerEntry>} */
export const loudnessProfileHandlers = {
  "loudnessProfile.describe": { run: describe },
  "loudnessProfile.select": { run: mutate },
  "loudnessProfile.create": { run: mutate },
  "loudnessProfile.update": { run: mutate },
  "loudnessProfile.rename": { run: mutate },
  "loudnessProfile.delete": { run: mutate },
  "loudnessProfile.reorder": { run: mutate },
};
