#!/usr/bin/env node
/**
 * Pre-release checklist: verifies versions match and CHANGELOG has a non-empty section
 * for the current version before tagging.
 * Usage: node scripts/preflight-release.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let ok = true;

function pass(msg) { console.log(`  ✅ ${msg}`); }
function fail(msg) { console.log(`  ❌ ${msg}`); ok = false; }

// 1. Version consistency
console.log("\nChecking versions…");
try {
  execSync("node scripts/verify-versions.mjs", { cwd: root, stdio: "pipe" });
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  pass(`Versions consistent (${pkg.version})`);
} catch (e) {
  fail(e.stderr?.toString().trim() || "Version mismatch — run: node scripts/bump-version.mjs <version>");
}

// 2. CHANGELOG has section for this version
console.log("\nChecking CHANGELOG…");
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
    fail(`"${header}" section is empty — add release notes before tagging`);
  } else {
    pass(`CHANGELOG has [${version}] section`);
  }
}

// 3. No uncommitted changes
console.log("\nChecking git status…");
try {
  const status = execSync("git status --porcelain", { cwd: root }).toString().trim();
  if (status) {
    fail(`Uncommitted changes:\n${status.split("\n").map(l => "      " + l).join("\n")}`);
  } else {
    pass("Working tree clean");
  }
} catch {
  fail("Could not run git status");
}

// 4. Tag does not already exist
console.log("\nChecking tag…");
try {
  const tags = execSync("git tag", { cwd: root }).toString().trim().split("\n");
  const tag = `v${version}`;
  if (tags.includes(tag)) {
    fail(`Tag ${tag} already exists — was this version already released?`);
  } else {
    pass(`Tag v${version} not yet created`);
  }
} catch {
  fail("Could not list git tags");
}

// Result
console.log("");
if (ok) {
  console.log(`✅ Ready to release v${version}:`);
  console.log(`   git tag v${version} && git push origin v${version}`);
} else {
  console.log("❌ Fix the issues above before tagging.");
  process.exit(1);
}
