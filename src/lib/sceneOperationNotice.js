import { errorDetails } from "./errorDetails.js";
import { isSceneOperationRefused } from "./sceneOperations.js";

/**
 * A refused scene operation is not a failure to report as one -- the guard did its job. Say what
 * the user has to do instead, and keep the technical detail for everything else.
 *
 * @param {(kind: string, text: string, details?: string, options?: {helpTopic?: string}) => void} raiseNotice
 * @param {unknown} error
 * @param {string} fallbackMessage
 * @param {string} detailPrefix
 * @param {string} [helpTopic]
 */
export function reportSceneOperationError(
  raiseNotice,
  error,
  fallbackMessage,
  detailPrefix,
  helpTopic
) {
  if (isSceneOperationRefused(error)) {
    raiseNotice("error", /** @type {Error} */ (error).message);
    return;
  }
  const details = errorDetails(detailPrefix, error);
  if (helpTopic) raiseNotice("error", fallbackMessage, details, { helpTopic });
  else raiseNotice("error", fallbackMessage, details);
}
