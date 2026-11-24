import { mixInputs } from "../../lib/mixRouting.js";
import { semanticFailure } from "../bridge/failures.js";
import { mixDraftDocument, publicMixDocument } from "../mixDraftControl.js";
import { assertExpectedRevision } from "./shared.js";

/** @param {import("../bridge/types.js").BridgeContext} ctx */
async function mixControl(ctx) {
  const { request, requestId, clock, live, settlement } = ctx;
  const current = live();
  const owner = current.device?.sourceMixes;
  if (!owner?.supported)
    throw semanticFailure("surfaceUnavailable", "$.method", "Mixes are unavailable.", -32042);
  if (request.method === "mix.list") {
    return {
      requestId,
      result: {
        revision: clock.current(),
        activeId:
          owner.list.find(({ id }) => id === current.device.snapshot?.requestedId)?.id ?? null,
        mixes: owner.list.map((mix) =>
          publicMixDocument(mixDraftDocument({ ...mix, inputs: mixInputs(mix) }))
        ),
      },
    };
  }

  const revision = assertExpectedRevision(ctx, "The Mix library", { required: true });
  if (current.uiNavigation?.inspectUi?.()?.activeBlockingEditors?.length || owner.draft)
    throw semanticFailure(
      "editorActive",
      "$",
      "Close the open editor before changing saved Mixes.",
      -32042
    );
  if (current.device.runtimeUnavailable)
    throw semanticFailure(
      "transitionInProgress",
      "$",
      "Mix changes are unavailable during an update.",
      -32081
    );
  const { mixId, name, dryRun } = request.params;
  const mix = owner.list.find(({ id }) => id === mixId);
  if (!mix)
    throw semanticFailure(
      "deviceNotFound",
      "$.params.mixId",
      "The requested Mix was not found.",
      -32060
    );
  const deleting = request.method === "mix.delete";
  const changed = deleting || mix.name !== name;
  const result = {
    revision,
    dryRun: dryRun === true,
    changed,
    mixId,
    ...(deleting ? {} : { name }),
  };
  if (dryRun || !changed) return { requestId, result };

  const committed = settlement.arm("mixLibrary", {
    matches: (list) =>
      deleting
        ? list && !list.some(({ id }) => id === mixId)
        : list?.some((item) => item.id === mixId && item.name === name),
  });
  try {
    const next = deleting ? await owner.remove(mix, true) : await owner.renameSaved(mix, name);
    if (!next)
      throw semanticFailure("transitionInProgress", "$", "The Mix library is busy.", -32081);
  } catch (error) {
    settlement.clear("mixLibrary");
    if (error?.reason) throw error;
    throw semanticFailure("persistenceFailed", "$", error?.message || String(error), -32030);
  }
  result.revision = await settlement.observed("mixLibrary", committed, "The Mix library change");
  return { requestId, result };
}

export const mixHandlers = {
  "mix.list": { run: mixControl },
  "mix.rename": { run: mixControl },
  "mix.delete": { run: mixControl },
};
