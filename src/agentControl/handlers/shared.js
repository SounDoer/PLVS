import { semanticFailure } from "../bridge/failures.js";
import { buildDeviceInspection } from "../deviceControl.js";

/**
 * The revision check every mutation starts with.
 *
 * @param {import("../bridge/types.js").BridgeContext} ctx
 * @param {string} subject  What the message says changed, e.g. "Settings".
 * @param {{ required?: boolean, details?: boolean }} [options]  `required` rejects an absent
 *   `expectedRevision` as a conflict; `details: false` omits the revisions from the failure.
 * @returns {number} the current revision
 */
export function assertExpectedRevision(ctx, subject, { required = false, details = true } = {}) {
  const currentRevision = ctx.clock.current();
  const { expectedRevision } = ctx.request.params;
  if ((required || expectedRevision !== undefined) && expectedRevision !== currentRevision) {
    throw semanticFailure(
      "revisionConflict",
      "$.params.expectedRevision",
      `${subject} changed after revision ${expectedRevision}.`,
      -32004,
      details ? { expectedRevision, currentRevision } : undefined
    );
  }
  return currentRevision;
}

export function panelResultPreset(presets, changed) {
  const activeId = typeof presets?.activeId === "string" ? presets.activeId : null;
  return {
    activeId,
    dirty: presets?.dirty === true || (activeId !== null && changed.length > 0),
  };
}

export function viewResultPreset(presets, changed) {
  return {
    activeId: typeof presets?.activeId === "string" ? presets.activeId : null,
    dirty: presets?.dirty === true || changed.length > 0,
  };
}

export function deviceInspection(device, requestedId = device?.snapshot?.requestedId) {
  return buildDeviceInspection(
    { ...device.snapshot, requestedId },
    {
      ...device.live,
      usingRequestedSelection:
        requestedId === device.snapshot.requestedId
          ? device.live?.usingRequestedSelection
          : device.live?.state === "running",
    }
  );
}
