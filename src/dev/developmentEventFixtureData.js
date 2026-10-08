import packageInfo from "../../package.json";

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
  kind: "preset",
  document: Object.freeze({
    id: "development-event-fixture-preset",
    name: "Broadcast Dialogue",
  }),
});
