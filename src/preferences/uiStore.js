/**
 * Single adapter over the persisted `plvs.ui` localStorage blob.
 *
 * Owns the mechanics only — reading, safe parsing, read-merge-write, legacy-key
 * stripping, and the cross-window `storage` event (ADR 0002 §14). Field defaults,
 * validation, and semantics stay with their domain modules (themeResolve,
 * panelControls, useSettings).
 *
 * @see docs/adr/0002-theme-id-and-appearance.md §6, §14
 */

import { UI_PREFERENCES } from "./data.js";

function storageKey(prefs) {
  return prefs?.layoutPersistKey ?? UI_PREFERENCES.layoutPersistKey;
}

/** Legacy top-level channel keys superseded by `panelControls`; dropped on every write. */
export function stripLegacyChannelPreferenceKeys(persisted) {
  const next =
    persisted && typeof persisted === "object" && !Array.isArray(persisted) ? { ...persisted } : {};
  delete next.vectorscopePairX;
  delete next.vectorscopePairY;
  delete next.spectrumChannelType;
  delete next.spectrumChannelX;
  delete next.spectrumChannelY;
  delete next.spectrumChannelCh;
  delete next.channelLayout;
  return next;
}

/**
 * Reads and parses the persisted blob.
 * @returns {Record<string, unknown>} the parsed object, or `{}` when absent/corrupt.
 */
export function readUiState(prefs) {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(storageKey(prefs));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    return {};
  } catch (_) {
    return {};
  }
}

/**
 * Reads the latest blob, merges `partial` over it, strips legacy keys, and writes back.
 * The single read-merge-write path so disjoint writers cannot clobber each other.
 */
export function patchUiState(partial, prefs) {
  if (typeof localStorage === "undefined") return;
  try {
    const merged = stripLegacyChannelPreferenceKeys({ ...readUiState(prefs), ...partial });
    localStorage.setItem(storageKey(prefs), JSON.stringify(merged));
  } catch (_) {}
}

/**
 * Subscribes to cross-window changes of the blob via the `storage` event.
 * @returns {() => void} unsubscribe
 */
export function subscribeUiState(fn, prefs) {
  if (typeof window === "undefined") return () => {};
  const key = storageKey(prefs);
  const onStorage = (e) => {
    // `key === null` is a localStorage.clear(); treat as relevant.
    if (e.key !== key && e.key !== null) return;
    fn();
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}
