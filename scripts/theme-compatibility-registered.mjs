/**
 * Does the portable Theme contract this build writes have a minimum app version on record?
 *
 * Release-only on purpose. Between releases the semantics may move ahead of the table, because
 * nobody knows yet which version will ship them; the release gate is the first moment the answer
 * exists, and the last moment it is cheap to write down.
 */
import { COMMUNITY_THEME_COMPATIBILITY } from "../src/theme/communityThemePresentation.js";
import {
  PORTABLE_THEME_FORMAT_VERSION,
  PORTABLE_THEME_SEMANTICS_VERSION,
} from "../src/theme/portableTheme.js";

const VERSION = /^\d+\.\d+\.\d+$/;

function isNewer(a, b) {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) return left[i] > right[i];
  }
  return false;
}

export function checkThemeCompatibilityRegistered({
  appVersion,
  compatibility = COMMUNITY_THEME_COMPATIBILITY,
  formatVersion = PORTABLE_THEME_FORMAT_VERSION,
  semanticsVersion = PORTABLE_THEME_SEMANTICS_VERSION,
}) {
  const key = `${formatVersion}:${semanticsVersion}`;
  const where = "COMMUNITY_THEME_COMPATIBILITY (src/theme/communityThemePresentation.js)";
  const minimum = compatibility[key]?.minimumAppVersion ?? null;
  if (minimum === null) {
    return {
      ok: false,
      message: `Theme contract "${key}" has no minimumAppVersion in ${where} - set it to "${appVersion}" if this release is the first to ship it`,
    };
  }
  if (typeof minimum !== "string" || !VERSION.test(minimum)) {
    return {
      ok: false,
      message: `Theme contract "${key}" has minimumAppVersion ${JSON.stringify(minimum)} in ${where} - expected a version such as "${appVersion}"`,
    };
  }
  if (isNewer(minimum, appVersion)) {
    return {
      ok: false,
      message: `Theme contract "${key}" requires PLVS ${minimum} in ${where}, which is newer than the ${appVersion} being released`,
    };
  }
  return { ok: true, message: `Theme contract "${key}" requires PLVS ${minimum} or later` };
}
