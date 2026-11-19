export function isPlainJsonObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

/**
 * @param {string} reason
 * @param {string} path
 * @param {string} message
 * @param {number} code
 */
export function error(reason, path, message, code) {
  return { ok: false, error: { reason, path, message, code } };
}

export function unknownField(value, allowed) {
  return Object.keys(value).find((key) => !allowed.has(key));
}

/**
 * @param {string} path
 * @param {string} message
 */
export function invalidParams(path, message) {
  return error("invalidParams", path, message, -32602);
}

export function validateExpectedRevision(params) {
  if (params.expectedRevision === undefined) {
    return error(
      "revisionRequired",
      "$.params.expectedRevision",
      "expectedRevision is required for every mutation.",
      -32602
    );
  }
  if (!Number.isSafeInteger(params.expectedRevision) || params.expectedRevision < 0) {
    return invalidParams(
      "$.params.expectedRevision",
      "expectedRevision must be a non-negative safe integer."
    );
  }
  return null;
}
