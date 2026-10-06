/**
 * Hands a test double to typed code.
 *
 * A double is rarely the real thing: a recording canvas context carries arrays the real one does
 * not have, a tray stub implements two of a dozen methods. Where the double is only a subset of
 * the real type, prefer a JSDoc cast to that type, which still checks the fields the test does
 * write. Use this where the shapes genuinely differ and a cast would be refused.
 *
 * The result takes whatever type the receiving position expects, so nothing past the hand-over
 * loses its type the way it would behind `any`.
 *
 * @template T
 * @param {unknown} double
 * @returns {T}
 */
export function standIn(double) {
  return /** @type {T} */ (double);
}
