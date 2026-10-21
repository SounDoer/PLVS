/**
 * @param {string} reason
 * @param {string} path
 * @param {string} message
 * @param {number} code
 */
export function semanticFailure(reason, path, message, code, details) {
  return { reason, path, message, code, ...(details ? { details } : {}) };
}

const VISUAL_ERROR_REASONS = new Set([
  "visualUnavailable",
  "screenCapturePermissionRequired",
  "targetUnavailable",
  "panelNotFound",
  "panelNotVisible",
  "revisionConflict",
  "uiGenerationConflict",
  "renderNotSettled",
  "captureBusy",
  "captureFailed",
  "artifactWriteFailed",
  "recordingNotFound",
  "audioUnavailable",
  "recordingFailed",
  "recordingEncoderUnavailable",
  "artifactExpired",
  "waitLimitReached",
]);

export function visualSemanticFailure(error) {
  const reason = VISUAL_ERROR_REASONS.has(error?.reason) ? error.reason : "captureFailed";
  const messages = {
    visualUnavailable: "Visual capture is unavailable on this platform.",
    screenCapturePermissionRequired: "Screen Recording permission is required.",
    targetUnavailable: "The requested visual target is unavailable.",
    panelNotFound: "The requested Panel does not exist.",
    panelNotVisible: "The requested Panel is not currently rendered.",
    revisionConflict: "The Agent Control revision changed before capture.",
    uiGenerationConflict: "The visible UI changed before capture.",
    renderNotSettled: "The visual target did not settle before the capture deadline.",
    captureBusy: "A screenshot is already in progress.",
    captureFailed: "The rendered PLVS surface could not be captured.",
    artifactWriteFailed: "The screenshot artifact could not be written.",
    recordingNotFound: "The recording ID is unknown.",
    audioUnavailable: "The requested recording audio source is unavailable.",
    recordingFailed: "The visual recording failed.",
    recordingEncoderUnavailable:
      "Linux visual recording needs the distribution FFmpeg with the encoders in details.missingEncoders. Install it with `sudo apt install ffmpeg`, then restart PLVS.",
    artifactExpired: "The recording artifact has expired or disappeared.",
    waitLimitReached: "The visual recording wait limit is full.",
  };
  return semanticFailure(reason, "$", messages[reason], -32080, error?.details);
}

/// A settlement waits only for React to render a change that has already been applied, so anything
/// near a second means the predicate will never match. Kept well under the broker's own budget so
/// the caller gets this specific failure instead of a transport timeout.
export const SETTLEMENT_TIMEOUT_MS = 5000;

/// Bounds a whole queued command, execution included.
///
/// Settlement is bounded above, but the business function a mutation awaits before it is not, and a
/// promise there that never settles blocks the serialized queue just the same. Kept below the
/// broker's `DEFAULT_RESPONSE_TIMEOUT` (10 s) so the caller gets this stated failure rather than a
/// transport timeout. The abandoned command may still finish later, and the failure says so.
export const QUEUED_REQUEST_TIMEOUT_MS = 8000;

/// Bounds a settlement wait.
///
/// Without this a predicate that can never match hangs the request forever - and because commands
/// share one serialized queue, every later command hangs behind it and the whole control channel is
/// dead until the app restarts. A timeout turns that into one failed command with a stated cause.
export const COMMIT_NOT_OBSERVED = "commitNotObserved";

export function isCommitNotObserved(error) {
  return error?.reason === COMMIT_NOT_OBSERVED;
}

/// Persists the write a settlement timeout is reporting on, and says in the failure whether that
/// worked.
///
/// Every mutation handler writes its state first and calls `flush()` only after the settlement, so
/// a timeout used to skip persistence entirely: the change was live in memory, absent from
/// `plvs-settings.json`, and the failure still said `stateCommitted: true`. Three hand-made themes
/// were lost that way. The failure stays `commitNotObserved` -- that React never observed the
/// commit is the more informative fact, and calling it `persistenceFailed` would bury it -- so
/// `persisted` is what tells the two outcomes apart.
export async function persistUnobservedCommit(error, flush) {
  try {
    await flush();
  } catch (persistenceError) {
    return {
      ...error,
      message: `${error.message} Persisting it then failed: ${persistenceError?.message || String(persistenceError)}.`,
      details: { ...error.details, persisted: false },
    };
  }
  return {
    ...error,
    message: `${error.message} The change was persisted.`,
    details: { ...error.details, persisted: true },
  };
}

export const WAIT_CANCELLED = Symbol("waitCancelled");
