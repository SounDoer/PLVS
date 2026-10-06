import { errorDetails } from "./errorDetails.js";
import { isSceneOperationRefused } from "./sceneOperations.js";

/**
 * A refused scene operation is not a failure to report as one -- the guard did its job. Say what
 * the user has to do instead, and keep the technical detail for everything else.
 *
 * @param {(kind: string, text: string, details?: string) => void} raiseNotice
 * @param {unknown} error
 * @param {string} fallbackMessage
 * @param {string} detailPrefix
 */
export function reportSceneOperationError(raiseNotice, error, fallbackMessage, detailPrefix) {
  if (isSceneOperationRefused(error)) {
    raiseNotice("error", /** @type {Error} */ (error).message);
    return;
  }
  raiseNotice("error", fallbackMessage, errorDetails(detailPrefix, error));
}
