#!/usr/bin/env node
/**
 * Confirms that `npm run smoke:capture` left complete evidence for one exact commit and platform.
 *
 * A self-hosted runner keeps earlier runs in its workspace, so the newest file on disk is not
 * necessarily this run's. Only evidence naming the requested SHA and platform counts.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const PLATFORMS = ["windows", "macos", "linux"];

function readEvidence(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/** Returns the newest complete capture evidence for `sha` on `platform`, or throws. */
export function findCaptureEvidence({ root, sha, platform }) {
  const directory = join(root, "artifacts", "capture-smoke", sha.slice(0, 8));
  const runs = existsSync(directory)
    ? readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isDirectory())
    : [];
  const matches = runs
    .map((entry) => join(directory, entry.name, "result.json"))
    .map((path) => ({ path, evidence: readEvidence(path) }))
    .filter(
      ({ evidence }) =>
        evidence?.domain === "capture" &&
        evidence.sourceSha === sha &&
        evidence.platform?.os === platform
    )
    .sort((a, b) => Date.parse(b.evidence.endedAt) - Date.parse(a.evidence.endedAt));
  if (matches.length === 0) throw new Error(`No capture evidence for ${platform} at ${sha}`);
  const newest = matches[0];
  if (newest.evidence.summary !== "complete") {
    throw new Error(`Capture evidence for ${platform} at ${sha} is ${newest.evidence.summary}`);
  }
  return newest;
}

function parseArguments(args) {
  const value = (flag) => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const sha = value("--sha");
  const platform = value("--platform");
  if (!/^[0-9a-f]{40}$/.test(sha ?? "") || !PLATFORMS.includes(platform)) {
    throw new Error(
      "Usage: node scripts/verify-capture-evidence.mjs --sha <40-hex> --platform <windows|macos|linux>"
    );
  }
  return { sha, platform };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const { sha, platform } = parseArguments(process.argv.slice(2));
    console.log(findCaptureEvidence({ root: process.cwd(), sha, platform }).path);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
