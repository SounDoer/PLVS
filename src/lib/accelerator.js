import { isMacOS } from "./platform.js";

const MOD_ORDER = ["CmdOrCtrl", "Alt", "Shift"];
const BARE_MODIFIER_KEYS = ["Control", "Meta", "Alt", "Shift", "OS", "Dead"];
const DISPLAY_SPECIAL = { Escape: "Esc" };

/**
 * Build a Tauri accelerator string from a KeyboardEvent-like object, or null if invalid.
 */
export function keyEventToAccelerator(e) {
  const key = e.key;
  if (typeof key !== "string" || BARE_MODIFIER_KEYS.includes(key)) return null;
  const mods = [];
  if (e.ctrlKey || e.metaKey) mods.push("CmdOrCtrl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  if (mods.length === 0) return null;
  let main;
  if (key === " ") main = "Space";
  else if (key.length === 1) main = key.toUpperCase();
  else main = key;
  return normalizeAccelerator([...mods, main].join("+"));
}

/**
 * @param {string} str
 */
export function normalizeAccelerator(str) {
  if (typeof str !== "string") return null;
  const parts = str.split("+");
  const mods = MOD_ORDER.filter((modifier) => parts.includes(modifier));
  const keys = parts.filter((part) => !MOD_ORDER.includes(part));
  const key = keys[0];
  if (
    mods.length === 0 ||
    keys.length !== 1 ||
    mods.length + 1 !== parts.length ||
    !key.trim() ||
    key !== key.trim() ||
    BARE_MODIFIER_KEYS.includes(key)
  )
    return null;
  return [...mods, key.length === 1 ? key.toUpperCase() : key].join("+");
}

/** The native macOS Quit menu owns this chord even when a WebView has focus. */
export function reservedAcceleratorLabel(accelerator, isMac = isMacOS()) {
  return isMac && normalizeAccelerator(accelerator) === "CmdOrCtrl+Q" ? "Quit PLVS" : null;
}

/**
 * @param {string} str
 */
export function formatAcceleratorForDisplay(str, { isMac = false } = {}) {
  if (typeof str !== "string") return "";
  return str
    .split("+")
    .map((p) => {
      if (p === "CmdOrCtrl") return isMac ? "⌘" : "Ctrl";
      if (p === "Alt") return isMac ? "⌥" : "Alt";
      if (p === "Shift") return isMac ? "⇧" : "Shift";
      return DISPLAY_SPECIAL[p] || p;
    })
    .join(isMac ? "" : "+");
}

/**
 * True when a KeyboardEvent-like object produces the configured chord.
 * @param {string} accel
 */
export function eventMatchesAccelerator(e, accel) {
  const key = keyEventToAccelerator(e);
  return key !== null && key === normalizeAccelerator(accel);
}
