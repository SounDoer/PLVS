/**
 * jsdom has no `matchMedia`, and theme settings read it on mount. Install a fixed answer before
 * rendering anything that mounts the settings owner.
 *
 * @param {boolean} [prefersDark]
 */
export function stubMatchMedia(prefersDark = true) {
  window.matchMedia = /** @type {typeof window.matchMedia} */ (
    /** @type {unknown} */ (
      (/** @type {string} */ query) => ({
        matches: prefersDark,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      })
    )
  );
}
