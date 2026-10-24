import { isValidAccelerator } from "../lib/accelerator.js";

/** @typedef {{ accelerator: string | null, global: boolean }} KeyboardShortcutBinding */
/** @typedef {Record<string, KeyboardShortcutBinding>} KeyboardShortcuts */

export const KEYBOARD_SHORTCUT_ACTIONS = Object.freeze([
  Object.freeze({
    id: "toggleLiveCapture",
    label: "Start / Stop",
    defaultAccelerator: "CmdOrCtrl+1",
  }),
  Object.freeze({
    id: "toggleLiveSnapshot",
    label: "Live / Snapshot",
    defaultAccelerator: "CmdOrCtrl+2",
  }),
  Object.freeze({ id: "clear", label: "Clear", defaultAccelerator: "CmdOrCtrl+3" }),
]);

const PREVIOUS_DEFAULT_ACCELERATORS = Object.freeze({
  toggleLiveCapture: "CmdOrCtrl+Shift+Space",
  toggleLiveSnapshot: "CmdOrCtrl+Shift+L",
  clear: "CmdOrCtrl+K",
});

export const KEYBOARD_SHORTCUT_ACTION_IDS = Object.freeze(
  KEYBOARD_SHORTCUT_ACTIONS.map(({ id }) => id)
);

/** @type {Readonly<KeyboardShortcuts>} */
export const DEFAULT_KEYBOARD_SHORTCUTS = Object.freeze(
  Object.fromEntries(
    KEYBOARD_SHORTCUT_ACTIONS.map(({ id, defaultAccelerator }) => [
      id,
      Object.freeze({ accelerator: defaultAccelerator, global: false }),
    ])
  )
);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizedBinding(value, fallback) {
  if (!isObject(value)) return { ...fallback };
  const validConfiguredAccelerator =
    value.accelerator === null || isValidAccelerator(value.accelerator);
  const accelerator =
    value.accelerator === null
      ? null
      : validConfiguredAccelerator
        ? value.accelerator
        : fallback.accelerator;
  return {
    accelerator,
    global: accelerator === null || !validConfiguredAccelerator ? false : value.global === true,
  };
}

/**
 * Return the complete known shortcut map. Legacy Clear values are considered only when the new
 * object is absent, so an established new preference remains authoritative.
 * @param {unknown} value
 * @param {{ clearShortcut?: unknown, clearGlobal?: unknown }} [legacy]
 */
/** @returns {KeyboardShortcuts} */
export function normalizeKeyboardShortcuts(value, legacy = {}) {
  const source = isObject(value)
    ? value
    : {
        clear: {
          accelerator: legacy.clearShortcut,
          global: legacy.clearGlobal,
        },
      };
  /** @type {KeyboardShortcuts} */
  const normalized = {};
  const used = new Set();
  for (const { id } of KEYBOARD_SHORTCUT_ACTIONS) {
    let binding = normalizedBinding(source[id], DEFAULT_KEYBOARD_SHORTCUTS[id]);
    if (binding.accelerator === PREVIOUS_DEFAULT_ACCELERATORS[id]) {
      binding = { ...binding, accelerator: DEFAULT_KEYBOARD_SHORTCUTS[id].accelerator };
    }
    if (binding.accelerator !== null && used.has(binding.accelerator)) {
      const fallback = DEFAULT_KEYBOARD_SHORTCUTS[id];
      binding = used.has(fallback.accelerator)
        ? { accelerator: null, global: false }
        : { ...fallback };
    }
    if (binding.accelerator !== null) used.add(binding.accelerator);
    normalized[id] = binding;
  }
  return normalized;
}

/**
 * Return the label of another configured action using `accelerator`, or null.
 * @param {Record<string, { accelerator: string | null }>} shortcuts
 * @param {string} actionId
 * @param {string | null} accelerator
 */
export function configuredShortcutConflict(shortcuts, actionId, accelerator) {
  if (accelerator === null) return null;
  const conflict = KEYBOARD_SHORTCUT_ACTIONS.find(
    ({ id }) => id !== actionId && shortcuts[id]?.accelerator === accelerator
  );
  return conflict?.label ?? null;
}

export function keyboardShortcutAction(actionId) {
  return KEYBOARD_SHORTCUT_ACTIONS.find(({ id }) => id === actionId) ?? null;
}
