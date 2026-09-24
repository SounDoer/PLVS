import { validatePortableTheme } from "./portableTheme.js";

/**
 * One centrally owned app-release mapping per portable semantic contract. The first public release
 * is intentionally unresolved until release planning chooses the version that actually ships it.
 */
export const COMMUNITY_THEME_COMPATIBILITY = Object.freeze({
  "1:1": Object.freeze({
    minimumAppVersion: null,
    maximumAppVersion: null,
  }),
});

function compatibilityKey(document) {
  return `${document.formatVersion}:${document.semanticsVersion}`;
}

function validVersion(value) {
  return typeof value === "string" && /^\d+\.\d+\.\d+$/.test(value);
}

/** Build the exact Dark/Light and compatibility copy consumed by a community Theme page. */
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
export function requireResolvedCommunityThemePresentation(raw, options) {
  const presentation = buildCommunityThemePresentation(raw, options);
  if (presentation.compatibility.status !== "resolved") {
    const error = new Error("The minimum compatible PLVS release has not been assigned.");
    error.name = "CommunityThemeCompatibilityError";
    error.code = "minimumAppVersionPending";
    throw error;
  }
  return presentation;
}
