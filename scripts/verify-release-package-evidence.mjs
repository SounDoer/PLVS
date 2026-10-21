#!/usr/bin/env node
/**
 * Confirms that a release-package smoke directory is complete evidence for one exact commit,
 * platform and package: every scenario passed, and each saved screenshot or recording still has
 * the size and SHA-256 the app reported.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { sha256File, validateAcceptanceEvidence } from "./acceptance-evidence.mjs";
import { REQUIRED_SCENARIOS } from "./release-package-smoke.mjs";

const PLATFORMS = ["windows", "macos", "linux"];

export function verifyReleasePackageEvidence({ directory, sha, platform }) {
  const path = join(directory, "result.json");
  if (!existsSync(path)) throw new Error(`No release-package evidence at ${path}`);
  const evidence = validateAcceptanceEvidence(JSON.parse(readFileSync(path, "utf8")));
  if (evidence.tool.name !== "release-package-smoke") {
    throw new Error(`${path} is ${evidence.tool.name} evidence`);
  }
  if (evidence.sourceSha !== sha)
    throw new Error(`${path} names ${evidence.sourceSha}, not ${sha}`);
  if (evidence.platform.os !== platform) throw new Error(`${path} is for ${evidence.platform.os}`);
  if (evidence.summary !== "complete")
    throw new Error(`Release-package smoke is ${evidence.summary}`);
  const ids = evidence.scenarios.map((scenario) => scenario.id);
  if (ids.join() !== REQUIRED_SCENARIOS.join())
    throw new Error("The evidence covers other scenarios");
  const kinds = new Set(evidence.artifacts.map((artifact) => artifact.kind));
  for (const kind of ["image/png", "video/mp4"]) {
    if (!kinds.has(kind)) throw new Error(`The evidence holds no ${kind}`);
  }
  for (const artifact of evidence.artifacts) {
    const file = join(directory, artifact.file);
    if (!existsSync(file)) throw new Error(`Missing evidence file ${artifact.file}`);
    if (statSync(file).size !== artifact.bytes || sha256File(file) !== artifact.sha256) {
      throw new Error(`${artifact.file} differs from its recorded size or SHA-256`);
    }
  }
  return evidence;
}

function parseArguments(args) {
  const value = (flag) => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const directory = value("--dir");
  const sha = value("--sha");
  const platform = value("--platform");
  if (!directory || !/^[0-9a-f]{40}$/.test(sha ?? "") || !PLATFORMS.includes(platform)) {
    throw new Error(
      "Usage: node scripts/verify-release-package-evidence.mjs --dir <evidence> --sha <40-hex> --platform <windows|macos|linux>"
    );
  }
  return { directory, sha, platform };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const evidence = verifyReleasePackageEvidence(parseArguments(process.argv.slice(2)));
    console.log(
      `Verified ${evidence.package.file} (${evidence.package.sha256}) on ${evidence.platform.os}.`
    );
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
