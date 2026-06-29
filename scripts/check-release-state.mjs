#!/usr/bin/env node
/**
 * Fast release-state checklist: verifies the current version is internally
 * consistent, documented, cleanly committed, and not already tagged.
 *
 * This intentionally does not run the full test suite. Use
 * `npm run release:preflight` for the complete local pre-tag gate.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let ok = true;

function pass(msg) {
  console.log(`  OK ${msg}`);
}

function fail(msg) {
  console.log(`  FAIL ${msg}`);
  ok = false;
}

function output(command) {
  return execSync(command, { cwd: root, stdio: ["ignore", "pipe", "pipe"] })
    .toString()
    .trim();
}

console.log("\nChecking versions...");
try {
  execSync("node scripts/verify-versions.mjs", { cwd: root, stdio: "pipe" });
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  pass(`Versions consistent (${pkg.version})`);
} catch (e) {
  fail(
    e.stderr?.toString().trim() ||
      "Version mismatch - run: node scripts/bump-version.mjs <version>",
  );
}

console.log("\nChecking CHANGELOG...");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const version = pkg.version;
const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8");
const header = `## [${version}]`;
const idx = changelog.indexOf(header);
if (idx === -1) {
  fail(`No "${header}" section found in CHANGELOG.md`);
} else {
  const lineEnd = changelog.indexOf("\n", idx);
  const afterHeader = lineEnd === -1 ? "" : changelog.slice(lineEnd + 1);
  const nextIdx = afterHeader.search(/\n## \[/);
  const body = (nextIdx === -1 ? afterHeader : afterHeader.slice(0, nextIdx)).trim();
  if (!body) {
    fail(`"${header}" section is empty - add release notes before tagging`);
  } else {
    pass(`CHANGELOG has [${version}] section`);
  }
}

console.log("\nChecking git status...");
try {
  const status = output("git status --porcelain");
  if (status) {
    fail(`Uncommitted changes:\n${status.split("\n").map((l) => "      " + l).join("\n")}`);
  } else {
    pass("Working tree clean");
  }
} catch {
  fail("Could not run git status");
}

console.log("\nChecking tag...");
try {
  const tag = `v${version}`;
  const localTags = output("git tag").split("\n").filter(Boolean);
  if (localTags.includes(tag)) {
    fail(`Local tag ${tag} already exists - was this version already released?`);
  } else {
    pass(`Local tag ${tag} not yet created`);
  }

  try {
    const remoteTag = output(`git ls-remote --tags origin refs/tags/${tag}`);
    if (remoteTag) {
      fail(`Remote tag ${tag} already exists on origin`);
    } else {
      pass(`Remote tag ${tag} not found on origin`);
    }
  } catch {
    fail(`Could not check whether ${tag} exists on origin`);
  }
} catch {
  fail("Could not list git tags");
}

console.log("");
if (ok) {
  console.log(`OK Ready for the full release gate for v${version}:`);
  console.log("   npm run release:preflight");
} else {
  console.log("FAIL Fix the issues above before tagging.");
  process.exit(1);
}
