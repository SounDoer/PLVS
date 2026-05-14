/**
 * Persist float webview size and top-left position in the same app store as device prefs.
 * Stored values are **logical** px (DPI-scaled) with `v: 2`. Legacy entries without `v` are
 * treated as **physical** px (pre-fix) and converted on load using the main window's scale factor.
 * Initial `width`/`height` in `WindowOptions` are logical and match `inner` client size; position
 * uses outer top-left, matching `outerPosition` in logical form.
 */
import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "./env.js";

const STORE_FILE = "audiometer-settings.json";
const STORE_KEY = "floatWindowBoundsV1";
/** Stored bounds format version. */
const BOUNDS_V2 = 2;

const POS_MIN = -20000;
const POS_MAX = 20000;

/** @type {Record<string, { width: number; height: number } | undefined>} */
const DEFAULTS = {
  peak: { width: 480, height: 520 },
  loudness: { width: 720, height: 600 },
  spectrum: { width: 560, height: 500 },
  vector: { width: 520, height: 520 },
};

/**
 * @param {number} n
 * @returns {number}
 */
function clampPos(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(POS_MIN, Math.min(POS_MAX, Math.round(n)));
}

/**
 * @param {number} n
 * @returns {number}
 */
function roundLogical(n) {
  return Math.round(n * 100) / 100;
}

/**
 * @param {string} kind
 * @returns {Promise<{ width: number; height: number; x?: number; y?: number }>}
 */
export async function loadFloatWindowBounds(kind) {
  const fallback = DEFAULTS[kind] || DEFAULTS.peak;
  if (!isTauri()) {
    return { ...fallback };
  }
  try {
    const { Store } = await import("@tauri-apps/plugin-store");
    const store = await Store.load(STORE_FILE);
    const root = await store.get(STORE_KEY);
    if (
      root &&
      typeof root === "object" &&
      !Array.isArray(root) &&
      root[kind] &&
      typeof root[kind] === "object" &&
      typeof root[kind].width === "number" &&
      typeof root[kind].height === "number"
    ) {
      const e = root[kind];
      const isV2 = e.v === BOUNDS_V2;
      let w = e.width;
      let h = e.height;
      let x = e.x;
      let y = e.y;

      if (!isV2) {
        const factor = await getCurrentWindow().scaleFactor();
        const lsz = new PhysicalSize(Math.round(e.width), Math.round(e.height)).toLogical(factor);
        w = lsz.width;
        h = lsz.height;
        if (typeof e.x === "number" && typeof e.y === "number") {
          const lp = new PhysicalPosition(Math.round(e.x), Math.round(e.y)).toLogical(factor);
          x = lp.x;
          y = lp.y;
        }
      }

      const wc = Math.max(200, Math.min(5000, roundLogical(w)));
      const hc = Math.max(200, Math.min(5000, roundLogical(h)));
      const out = { width: wc, height: hc };
      if (
        typeof x === "number" &&
        typeof y === "number" &&
        Number.isFinite(x) &&
        Number.isFinite(y)
      ) {
        out.x = clampPos(roundLogical(x));
        out.y = clampPos(roundLogical(y));
      }
      return out;
    }
  } catch {
    /* fall through */
  }
  return { ...fallback };
}

/**
 * Merges one panel's bounds into the store object and saves.
 * @param {string} kind
 * @param {{ width: number; height: number; x?: number; y?: number; v?: number }} size
 *   Logical pixels; set `v: 2` when writing (see BOUNDS_V2).
 * @returns {Promise<void>}
 */
export async function saveFloatWindowBounds(kind, size) {
  if (!isTauri()) return;
  const w = Math.max(200, Math.min(5000, roundLogical(size.width)));
  const h = Math.max(200, Math.min(5000, roundLogical(size.height)));
  const entry = { width: w, height: h, v: BOUNDS_V2 };
  if (
    typeof size.x === "number" &&
    typeof size.y === "number" &&
    Number.isFinite(size.x) &&
    Number.isFinite(size.y)
  ) {
    entry.x = clampPos(roundLogical(size.x));
    entry.y = clampPos(roundLogical(size.y));
  }
  try {
    const { Store } = await import("@tauri-apps/plugin-store");
    const store = await Store.load(STORE_FILE);
    const raw = await store.get(STORE_KEY);
    const prev = raw && typeof raw === "object" && !Array.isArray(raw) ? { ...raw } : {};
    const next = { ...prev, [kind]: entry };
    await store.set(STORE_KEY, next);
    await store.save();
  } catch {
    /* ignore */
  }
}

export { DEFAULTS as FLOAT_DEFAULT_BOUNDS };

/** Returns the current Tauri window handle. Use this instead of importing directly from \`@tauri-apps/api/window\`. */
export function getCurrentFloatWindow() {
  return getCurrentWindow();
}
