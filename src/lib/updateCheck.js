/**
 * Update check backed by tauri-plugin-updater, comparing against the
 * latest.json manifest published with each GitHub Release. Package signatures are verified
 * by the native updater before installation; the manifest itself is not signed.
 */
import { check } from "@tauri-apps/plugin-updater";

export const RELEASES_URL = "https://github.com/SounDoer/PLVS/releases/latest";

/**
 * Check for an update.
 * Returns { hasUpdate, latestVersion, releaseUrl, update } where `update` is
 * the raw plugin handle (needed to actually install it), or null on failure.
 */
export async function checkForUpdate() {
  try {
    const update = await check();
    if (!update) {
      return { hasUpdate: false, latestVersion: null, releaseUrl: RELEASES_URL, update: null };
    }
    return {
      hasUpdate: true,
      latestVersion: update.version,
      releaseNotes: update.body ?? "",
      releaseUrl: RELEASES_URL,
      update,
    };
  } catch {
    return null;
  }
}
