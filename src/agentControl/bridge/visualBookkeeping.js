/**
 * What the bridge remembers about visual capture between requests: the abort controller of each
 * screenshot or recording start in flight (so a cancel can reach it), the recordings it started
 * (so unmount can stop them and the Transport and Device watchers can report audio changes), and
 * whether a screenshot is running, since only one may.
 */
export function createVisualBookkeeping() {
  return {
    /** @type {Map<string, AbortController>} */
    captures: new Map(),
    /** @type {Map<string, any>} */
    recordings: new Map(),
    captureActive: { current: false },
  };
}
