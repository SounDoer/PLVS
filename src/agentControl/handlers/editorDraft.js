import { describeEditorDraft, planEditorDraftPatch } from "../editorDraftControl.js";
import { semanticFailure, SETTLEMENT_TIMEOUT_MS, COMMIT_NOT_OBSERVED } from "../bridge/failures.js";
import { themeStateSignature, loudnessProfileStateSignature } from "../bridge/signatures.js";

const EDITOR_DRAFT_SETTLEMENT_TIMEOUT_MS = 500;

async function settleEditorDraftObservation({
  editorDraft,
  uiNavigation,
  kind,
  surfaceId,
  decisionSurfaceId = null,
  discarded = false,
}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= EDITOR_DRAFT_SETTLEMENT_TIMEOUT_MS) {
    const ui = uiNavigation.inspectUi();
    if (discarded) {
      const gone = !ui.surfaces.some(
        (surface) => surface.surfaceId === surfaceId || surface.surfaceId === decisionSurfaceId
      );
      if (gone) return { ui, snapshot: null };
    } else {
      const snapshot = editorDraft.inspect(kind, surfaceId);
      const surface = ui.surfaces.find((candidate) => candidate.surfaceId === surfaceId);
      if (
        surface &&
        (surface.dirty === true) === (snapshot.dirty === true) &&
        (surface.stale === true) === (snapshot.stale === true)
      ) {
        return { ui, snapshot };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw semanticFailure(
    "draftNotSettled",
    "$.params.surfaceId",
    "The editor accepted the action but its public UI observation did not settle in time.",
    -32043,
    { surfaceId, stateCommitted: true }
  );
}

/** @param {import("../bridge/types.js").BridgeContext} ctx */
async function describe(ctx) {
  const { request, requestId, clock } = ctx;
  const kind = request.params.kind === "loudness-profile" ? "loudnessProfile" : "theme";
  return {
    requestId,
    result: {
      revision: clock.current(),
      ...describeEditorDraft(kind),
    },
  };
}

/** @param {import("../bridge/types.js").BridgeContext} ctx */
async function inspect(ctx) {
  const { request, requestId, clock } = ctx;
  const { uiNavigation, editorDraft } = ctx.snap;
  const kind = request.params.kind === "loudness-profile" ? "loudnessProfile" : "theme";
  if (!editorDraft?.inspect || !uiNavigation?.inspectUi) {
    throw semanticFailure(
      "surfaceUnavailable",
      "$.method",
      "Editor draft control is unavailable in the current app state.",
      -32042
    );
  }
  try {
    const snapshot = editorDraft.inspect(kind, request.params.surfaceId);
    const ui = uiNavigation.inspectUi();
    const surface = ui.surfaces.find(({ surfaceId }) => surfaceId === request.params.surfaceId);
    if (!surface) {
      throw semanticFailure(
        "editorDraftNotFound",
        "$.params.surfaceId",
        "The requested editor draft is no longer open.",
        -32042
      );
    }
    const { id: _internalId, ...document } = snapshot.document;
    return {
      requestId,
      result: {
        revision: clock.current(),
        uiGeneration: ui.uiGeneration,
        draftGeneration: snapshot.draftGeneration,
        kind,
        surfaceId: request.params.surfaceId,
        dirty: snapshot.dirty === true,
        stale: snapshot.stale === true,
        history: {
          canUndo: snapshot.canUndo === true,
          canRedo: snapshot.canRedo === true,
        },
        target: surface.target,
        document,
      },
    };
  } catch (error) {
    if (typeof error?.reason === "string") throw error;
    if (error?.code === undefined) throw error;
    throw semanticFailure(error.code, "$.params.surfaceId", error.message, -32042, error.details);
  }
}

/** @param {import("../bridge/types.js").BridgeContext} ctx */
async function act(ctx) {
  const { request, requestId, clock, flush, live } = ctx;
  const { uiNavigation, editorDraft } = ctx.snap;
  const kind = request.params.kind === "loudness-profile" ? "loudnessProfile" : "theme";
  const currentRevision = clock.current();
  if (request.params.expectedRevision !== currentRevision) {
    throw semanticFailure(
      "revisionConflict",
      "$.params.expectedRevision",
      `App state changed after revision ${request.params.expectedRevision}.`,
      -32004,
      { expectedRevision: request.params.expectedRevision, currentRevision }
    );
  }
  if (!editorDraft?.inspect || !uiNavigation?.inspectUi) {
    throw semanticFailure(
      "surfaceUnavailable",
      "$.method",
      "Editor draft control is unavailable in the current app state.",
      -32042
    );
  }
  const uiBefore = uiNavigation.inspectUi();
  if (request.params.expectedUiGeneration !== uiBefore.uiGeneration) {
    throw semanticFailure(
      "uiGenerationConflict",
      "$.params.expectedUiGeneration",
      "The visible UI changed after it was inspected.",
      -32042,
      {
        expectedUiGeneration: request.params.expectedUiGeneration,
        currentUiGeneration: uiBefore.uiGeneration,
      }
    );
  }
  const isDiscard = request.method === "editorDraft.discard";
  const expectedTopSurfaceId = isDiscard
    ? request.params.decisionSurfaceId
    : request.params.surfaceId;
  if (uiBefore.topSurfaceId !== expectedTopSurfaceId) {
    throw semanticFailure(
      "uiConflict",
      isDiscard ? "$.params.decisionSurfaceId" : "$.params.surfaceId",
      "Another UI surface is above the requested editor action.",
      -32042,
      { surfaceId: expectedTopSurfaceId }
    );
  }
  try {
    const before = editorDraft.inspect(kind, request.params.surfaceId);
    if (before.draftGeneration !== request.params.expectedDraftGeneration) {
      throw semanticFailure(
        "draftGenerationConflict",
        "$.params.expectedDraftGeneration",
        "The editor draft changed after it was inspected.",
        -32043,
        {
          expectedDraftGeneration: request.params.expectedDraftGeneration,
          currentDraftGeneration: before.draftGeneration,
        }
      );
    }
    if (!isDiscard && before.stale) {
      throw semanticFailure(
        "draftStale",
        "$.params.surfaceId",
        "The editor source changed while this draft was open.",
        -32043
      );
    }

    if (request.method === "editorDraft.save") {
      const saved = editorDraft.save(
        kind,
        request.params.surfaceId,
        request.params.expectedDraftGeneration
      );
      const expectedSignature =
        kind === "theme"
          ? themeStateSignature(saved.state)
          : loudnessProfileStateSignature(saved.state.profiles, saved.state.active);
      const deadline = Date.now() + SETTLEMENT_TIMEOUT_MS;
      let uiAfter;
      while (true) {
        uiAfter = uiNavigation.inspectUi();
        const observedSignature =
          kind === "theme" ? live().themeSignature : live().loudnessSignature;
        if (
          observedSignature === expectedSignature &&
          !uiAfter.surfaces.some(({ surfaceId }) => surfaceId === request.params.surfaceId) &&
          !uiAfter.activeBlockingEditors?.includes(kind)
        )
          break;
        if (Date.now() >= deadline) {
          throw semanticFailure(
            saved.changed ? COMMIT_NOT_OBSERVED : "draftNotSettled",
            "$",
            "The editor Save was accepted but its final state was not observed. Inspect before retrying.",
            -32031,
            {
              stateCommitted: saved.changed,
              savedId: saved.savedId,
              revision: clock.current(),
            }
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 16));
      }
      if (saved.changed) {
        try {
          await flush();
        } catch (error) {
          throw semanticFailure(
            "persistenceFailed",
            "$",
            `Draft saved in memory but persistence failed: ${error?.message || String(error)}`,
            -32030,
            {
              stateCommitted: true,
              savedId: saved.savedId,
              revision: clock.current(),
            }
          );
        }
      }
      const { id: _savedId, ...document } = saved.document;
      return {
        requestId,
        result: {
          action: request.method,
          status: "completed",
          changed: saved.changed,
          revision: clock.current(),
          uiGeneration: uiAfter.uiGeneration,
          kind,
          surfaceId: request.params.surfaceId,
          savedId: saved.savedId,
          document,
        },
      };
    }

    let changed = true;
    if (request.method === "editorDraft.patch") {
      const planned = planEditorDraftPatch(kind, before.document, request.params.patch);
      if (planned.issues.length > 0) {
        throw semanticFailure(
          "invalidDraftPatch",
          "$.params.patch",
          "The editor draft patch is invalid.",
          -32602,
          { issues: planned.issues }
        );
      }
      changed = planned.changed;
      if (changed) editorDraft.commit(kind, request.params.surfaceId, planned.document);
    } else if (request.method === "editorDraft.undo") {
      editorDraft.history(kind, request.params.surfaceId, "undo");
    } else if (request.method === "editorDraft.redo") {
      editorDraft.history(kind, request.params.surfaceId, "redo");
    } else {
      editorDraft.discard(
        kind,
        request.params.surfaceId,
        request.params.decisionSurfaceId,
        request.params.expectedDraftGeneration
      );
    }

    if (isDiscard) {
      const { ui: uiAfter } = await settleEditorDraftObservation({
        editorDraft,
        uiNavigation,
        kind,
        surfaceId: request.params.surfaceId,
        decisionSurfaceId: request.params.decisionSurfaceId,
        discarded: true,
      });
      return {
        requestId,
        result: {
          changed: true,
          action: request.method,
          revision: clock.current(),
          uiGeneration: uiAfter.uiGeneration,
          kind,
          surfaceId: request.params.surfaceId,
          discarded: true,
        },
      };
    }
    const settled = changed
      ? await settleEditorDraftObservation({
          editorDraft,
          uiNavigation,
          kind,
          surfaceId: request.params.surfaceId,
        })
      : { ui: uiBefore, snapshot: before };
    const uiAfter = settled.ui;
    const after = settled.snapshot;
    const { id: _internalId, ...document } = after.document;
    return {
      requestId,
      result: {
        changed,
        action: request.method,
        revision: clock.current(),
        uiGeneration: uiAfter.uiGeneration,
        draftGeneration: after.draftGeneration,
        kind,
        surfaceId: request.params.surfaceId,
        dirty: after.dirty === true,
        stale: after.stale === true,
        history: {
          canUndo: after.canUndo === true,
          canRedo: after.canRedo === true,
        },
        document,
      },
    };
  } catch (error) {
    if (typeof error?.reason === "string") throw error;
    if (typeof error?.code !== "string") throw error;
    throw semanticFailure(error.code, "$.params.surfaceId", error.message, -32043, error.details);
  }
}

/** @type {Record<string, import("../bridge/types.js").HandlerEntry>} */
export const editorDraftHandlers = {
  "editorDraft.describe": { run: describe },
  "editorDraft.inspect": { run: inspect },
  "editorDraft.patch": { run: act },
  "editorDraft.undo": { run: act },
  "editorDraft.redo": { run: act },
  "editorDraft.discard": { run: act },
  "editorDraft.save": { run: act },
};
