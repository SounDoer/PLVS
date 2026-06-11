const MOD_ORDER = ["CmdOrCtrl", "Alt", "Shift"];
const BARE_MODIFIER_KEYS = ["Control", "Meta", "Alt", "Shift", "OS", "Dead"];
const DISPLAY_SPECIAL = { Escape: "Esc" };

/** Build a Tauri accelerator string from a KeyboardEvent-like object, or null if invalid. */
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
  return [...mods, main].join("+");
}

export function isValidAccelerator(str) {
  if (typeof str !== "string" || !str.includes("+")) return false;
  const parts = str.split("+");
  const mods = parts.filter((p) => MOD_ORDER.includes(p));
  const keys = parts.filter((p) => !MOD_ORDER.includes(p));
  return mods.length >= 1 && keys.length === 1 && keys[0].length >= 1;
}

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
