/**
 * @param {string} prefix
 * @param {unknown} error
 */
export function errorDetails(prefix, error) {
  return `${prefix}: ${/** @type {any} */ (error)?.message || String(error)}`;
}
