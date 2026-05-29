#!/usr/bin/env node
/**
 * Extract the CHANGELOG section for a semver tag (e.g. v0.0.11 -> ## [0.0.11]) to a file for GitHub Releases.
 * Usage: node scripts/changelog-release-body.mjs <tag> <outfile.md>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const tagArg = process.argv[2] ?? "";
const outFile = process.argv[3] ?? "";
const semver = tagArg.replace(/^v/i, "").trim();
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const changelogPath = join(root, "CHANGELOG.md");

if (!semver || !outFile) {
  console.error("Usage: node scripts/changelog-release-body.mjs <tag> <outfile.md>");
  process.exit(1);
}

const changelog = readFileSync(changelogPath, "utf8");
const headerNeedle = `## [${semver}]`;
const idx = changelog.indexOf(headerNeedle);
let body;
if (idx === -1) {
  body = [
    `## PLVS v${semver}`,
    "",
    `See [CHANGELOG.md](https://github.com/SounDoer/PLVS/blob/main/CHANGELOG.md) on \`main\` for the full history.`,
    "",
    "_No dedicated section found for this tag in CHANGELOG.md — add \`## [${semver}]\` before tagging._",
  ].join("\n");
} else {
  const lineEnd = changelog.indexOf("\n", idx);
  const afterHeader =
    lineEnd === -1 ? changelog.slice(idx + headerNeedle.length) : changelog.slice(lineEnd + 1);
  const nextIdx = afterHeader.search(/\n## \[/);
  body = (nextIdx === -1 ? afterHeader : afterHeader.slice(0, nextIdx)).trim();
}

writeFileSync(outFile, `${body}\n`, "utf8");
