import { DOMAIN_NAMES } from "./domains.js";
import { COMMIT_NOT_OBSERVED, semanticFailure, SETTLEMENT_TIMEOUT_MS } from "./failures.js";

/// One slot per observed domain, plus `library`: an import is settled by whichever library watcher
/// sees the write, so it cannot belong to a single domain.
export const SETTLEMENT_SLOTS = Object.freeze([...DOMAIN_NAMES, "library"]);

/**
 * Waits for a settlement, bounded by `SETTLEMENT_TIMEOUT_MS`.
 *
 * @param {Promise<any>} committed
 * @param {() => void} clear
 * @param {string} subject
 */
export function awaitSettlement(committed, clear, subject) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      clear();
      reject(
        semanticFailure(
          COMMIT_NOT_OBSERVED,
          "$",
          `${subject} was applied but the commit was not observed within ${SETTLEMENT_TIMEOUT_MS} ms.`,
          -32031,
          { stateCommitted: true }
        )
      );
    }, SETTLEMENT_TIMEOUT_MS);
    committed.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/**
 * Where a mutation parks what it is waiting for React to render.
 *
 * A settlement means "React rendered the committed state", not "the business function returned":
 * the mutation arms a slot before calling the business function, and the domain's watcher resolves
 * it when a commit shows the expected state. The slots come from the domain table, so a domain
 * cannot exist without one and unmount cannot miss one.
 *
 * @param {{ current: () => number }} clock
 */
export function createSettlementRegistry(clock) {
  /** @type {Map<string, any>} */
  const slots = new Map(SETTLEMENT_SLOTS.map((name) => [name, null]));
  const assertKnown = (name) => {
    if (!slots.has(name)) throw new Error(`Unknown settlement slot: ${name}`);
  };

  const registry = {
    /**
     * Parks an expectation and returns the promise its watcher resolves with the revision.
     *
     * @param {string} name
     * @param {Record<string, any>} expectation
     * @returns {Promise<number>}
     */
    arm(name, expectation) {
      assertKnown(name);
      return new Promise((resolve, reject) => {
        slots.set(name, { ...expectation, resolve, reject });
      });
    },
    /** @param {string} name */
    peek(name) {
      return slots.get(name) ?? null;
    },
    /** @param {string} name */
    clear(name) {
      assertKnown(name);
      slots.set(name, null);
    },
    /**
     * Empties the slot and resolves what was parked there with the current revision.
     *
     * @param {string} name
     */
    resolve(name) {
      const pending = slots.get(name);
      if (!pending) return;
      slots.set(name, null);
      pending.resolve(clock.current());
    },
    /**
     * `awaitSettlement` for a single slot, which it clears on timeout.
     *
     * @param {string} name
     * @param {Promise<any>} committed
     * @param {string} subject
     */
    observed(name, committed, subject) {
      return awaitSettlement(committed, () => registry.clear(name), subject);
    },
    /** @param {Error} error */
    rejectAll(error) {
      for (const [name, pending] of slots) {
        slots.set(name, null);
        pending?.reject(error);
      }
    },
  };
  return registry;
}
