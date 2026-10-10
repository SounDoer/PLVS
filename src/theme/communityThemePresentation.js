import { validatePortableTheme } from "./portableTheme.js";

/**
 * One centrally owned app-release mapping per portable semantic contract. Each minimum is the
 * first release that shipped the contract. A contract still in development may stay null;
 * `scripts/check-release-state.mjs` refuses to release the current one until it is filled in.
 */
export const COMMUNITY_THEME_COMPATIBILITY = Object.freeze({
  "1:3": Object.freeze({
    minimumAppVersion: "0.18.0",
    maximumAppVersion: null,
  }),
  "1:4": Object.freeze({
    minimumAppVersion: "0.19.0",
    maximumAppVersion: null,
  }),
});

function compatibilityKey(document) {
  return `${document.formatVersion}:${document.semanticsVersion}`;
}

/**
 * @param {string} value
 */
function validVersion(value) {
  return typeof value === "string" && /^\d+\.\d+\.\d+$/.test(value);
}

/** Build the exact Dark/Light and compatibility copy consumed by a community Theme page. */
/**
 * Build the exact Dark/Light and compatibility copy consumed by a community Theme page.
 * @param {any} raw
 * @param {{ compatibility?: Record<string, { minimumAppVersion: string | null, maximumAppVersion: string | null }> }} [options]
 */
export function buildCommunityThemePresentation(
  raw,
  { compatibility = COMMUNITY_THEME_COMPATIBILITY } = {}
) {
  const document = validatePortableTheme(raw);
  const key = compatibilityKey(document);
  const range = compatibility[key] ?? null;
  const minimumAppVersion = range?.minimumAppVersion ?? null;
  const maximumAppVersion = range?.maximumAppVersion ?? null;
  const resolved = validVersion(minimumAppVersion);
  let compatibilityLabel = null;
  if (resolved && validVersion(maximumAppVersion)) {
    compatibilityLabel = `Works with PLVS ${minimumAppVersion}-${maximumAppVersion}`;
  } else if (resolved) {
    compatibilityLabel = `Requires PLVS ${minimumAppVersion} or later`;
  }

  return {
    appearance: {
      colorScheme: document.colorScheme,
      label: document.colorScheme === "dark" ? "Dark Theme" : "Light Theme",
    },
    compatibility: {
      status: resolved ? "resolved" : "pending-release",
      minimumAppVersion,
      maximumAppVersion: validVersion(maximumAppVersion) ? maximumAppVersion : null,
      label: compatibilityLabel,
      formatVersion: document.formatVersion,
      semanticsVersion: document.semanticsVersion,
      technicalLabel: `Theme Format ${document.formatVersion} · Semantics ${document.semanticsVersion}`,
    },
  };
}

/** A public page cannot ship vague compatibility copy while the release mapping is unresolved. */
/**
 * A public page cannot ship vague compatibility copy while the release mapping is unresolved.
 */
export function requireResolvedCommunityThemePresentation(raw, options) {
  const presentation = buildCommunityThemePresentation(raw, options);
  if (presentation.compatibility.status !== "resolved") {
    const error = /** @type {Error & { code?: string }} */ (
      new Error("The minimum compatible PLVS release has not been assigned.")
    );
    error.name = "CommunityThemeCompatibilityError";
    error.code = "minimumAppVersionPending";
    throw error;
  }
  return presentation;
}
