/** Shared long-wait registry. */
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
        const result =
          waiter.kind === "revision" && revision !== waiter.afterRevision
            ? { outcome: "changed", matchedImmediately: false, revision }
            : waiter.kind === "file"
              ? waiter.read()
              : null;
        if (!result) continue;
        clearTimeout(waiter.timer);
        entries.delete(id);
        waiter.resolve(result);
      }
    },
  };
}
