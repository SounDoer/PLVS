// src/persistence/cleanupLegacyKeys.js
/**
 * One-shot, idempotent removal of pre-unification localStorage keys.
 * No migration: early users reset once (see the design spec, "Migration — none").
 * Wired into boot in Plan 2, after consumers read from the new domain stores.
 */
export const LEGACY_LOCALSTORAGE_KEYS = [
  "plvs.ui",
  "plvs:workspace:v3",
  "plvs:windowPinned",
  "plvs:closeAction",
  "plvs.captureDeviceId",
];

export function cleanupLegacyKeys() {
  if (typeof localStorage === "undefined") return;
  for (const key of LEGACY_LOCALSTORAGE_KEYS) {
    try {
      localStorage.removeItem(key);
    } catch (_) {}
  }
}
