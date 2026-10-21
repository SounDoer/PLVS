import packageInfo from "../../package.json";
import sharesetsPresetText from "../../sharesets/catalogue/artifacts/essential-monitoring-v1.plvspreset?raw";
import sharesetsProfileText from "../../sharesets/catalogue/artifacts/spotify-v1.plvsloudness?raw";

export const DEVELOPMENT_CRASH_REPORT = Object.freeze({
  schemaVersion: 1,
  id: "development-event-fixture-crash-report",
  createdAt: "2026-10-08T10:00:00Z",
  sessionId: "development-event-fixture",
  kind: "rust_panic",
  app: { version: packageInfo.version, os: "Windows", arch: "x86_64" },
  error: { message: "The audio service stopped unexpectedly." },
  logs: ["development fixture: deterministic crash report preview"],
});

export const DEVELOPMENT_UPDATE = Object.freeze({
  releaseNotes:
    "### Development fixture\n\n- Safer UI navigation\n- Deterministic screenshot review",
  update: { version: "99.0.0-development-fixture" },
});

export const DEVELOPMENT_LIBRARY_CONFLICT = Object.freeze({
  kind: "theme",
  document: Object.freeze({
    id: "custom-development-event-fixture-theme",
    name: "Development Fixture Theme",
  }),
});

/**
 * A real Sharesets Preset carrying a real Loudness Profile as its bundled dependency, under
 * fixture-only IDs so every row reviews as an addition and the "Also Included" section shows.
 */
export function developmentImportPackText() {
  const pack = JSON.parse(sharesetsPresetText);
  const [profile] = JSON.parse(sharesetsProfileText).items;
  const profileId = "development-fixture-loudness-profile";
  pack.items[0].id = "development-fixture-preset";
  pack.items[0].loudnessProfile = { dependencyId: profileId };
  pack.dependencies = [{ kind: "loudness-profile", items: [{ ...profile, id: profileId }] }];
  return JSON.stringify(pack);
}
