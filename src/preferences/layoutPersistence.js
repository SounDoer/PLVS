/**
 * @returns {boolean} Whether the OS / browser reports dark as the preferred color scheme.
 * Defaults to `true` when `matchMedia` is unavailable (matches the former app default look).
 */
export function readSystemPrefersDark() {
  if (typeof window === "undefined" || !window.matchMedia) return true;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}
