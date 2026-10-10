/** The long-wait registry: `app.wait`, `measurement.wait*` and `visual.recording.wait`. */
export function createWaiters() {
  /** @type {Map<string, any>} */
  const entries = new Map();
  return {
    entries,
    /**
     * Resolves every revision waiter whose `afterRevision` is no longer current.
     *
     * @param {number} revision
     */
    wakeRevision(revision) {
      for (const [id, waiter] of entries) {
        if (waiter.kind !== "revision") continue;
        if (revision === waiter.afterRevision) continue;
        clearTimeout(waiter.timer);
        entries.delete(id);
        waiter.resolve({ outcome: "changed", matchedImmediately: false, revision });
      }
    },
  };
}
