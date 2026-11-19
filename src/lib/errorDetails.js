/**
 * @param {string} prefix
 * @param {unknown} error
 */
export function errorDetails(prefix, error) {
  return `${prefix}: ${errorMessage(error, null) || String(error)}`;
}

/** @param {unknown} error */
export function errorMessage(error, fallback) {
  return (typeof error === "string" ? error : /** @type {any} */ (error)?.message) || fallback;
}
