import { isValidAccelerator } from "../lib/accelerator.js";

/** Read-only reference list of the app's existing keyboard shortcuts. */
export const KEYBOARD_SHORTCUTS = [
  { id: "settings", label: "Open settings", keys: "CmdOrCtrl+," },
  { id: "fullscreen", label: "Fullscreen panel", keys: "1 – 6" },
  { id: "exitFullscreen", label: "Exit fullscreen", keys: "Escape" },
  { id: "startStop", label: "Start / Stop", keys: "Space" },
];

/** In-app shortcuts that are real (modifier-bearing) accelerators a custom combo could shadow. */
const RESERVED = KEYBOARD_SHORTCUTS.filter((s) => isValidAccelerator(s.keys));

/** Label of the in-app shortcut equal to `accel`, or null when there is no conflict. */
export function reservedComboConflict(accel) {
  const hit = RESERVED.find((s) => s.keys === accel);
  return hit ? hit.label : null;
}
