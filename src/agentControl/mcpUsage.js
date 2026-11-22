import { useSyncExternalStore } from "react";

/**
 * The last chat app that used PLVS through `plvs-cli mcp`, for the status line under MCP Setup.
 * Held in memory only: it resets when PLVS restarts and is never persisted or sent anywhere.
 *
 * @typedef {{ client: string, at: number }} McpUsage
 */

/** @type {McpUsage | null} */
let current = null;
const listeners = new Set();

/**
 * @param {string} client
 * @param {number} [at]
 */
export function recordMcpUsage(client, at = Date.now()) {
  current = { client, at };
  for (const listener of listeners) listener();
}

/** @returns {McpUsage | null} */
export function getMcpUsage() {
  return current;
}

/** Test hook: forget the recorded use. */
export function resetMcpUsage() {
  current = null;
  for (const listener of listeners) listener();
}

/** @param {() => void} listener */
function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** @returns {McpUsage | null} */
export function useMcpUsage() {
  return useSyncExternalStore(subscribe, getMcpUsage, getMcpUsage);
}
