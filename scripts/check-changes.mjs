import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Keep this deliberately narrow. Shared dependencies and the classifier itself require full CI.
const websiteScripts = new Set([
  "build-website.mjs",
  "validate-website.mjs",
  "validate-website.test.mjs",
  "dev-website.mjs",
  "build-user-docs.mjs",
  "build-user-docs.test.mjs",
  "build-sharesets-site.mjs",
  "build-sharesets-site.test.js",
  "site-components.mjs",
  "profile-presentation.test.js",
  "preset-presentation.mjs",
  "preset-presentation.test.js",
  "websiteReleaseLinks.test.js",
]);

export function classifyPaths(paths) {
  const files = [...new Set(paths)].sort();
  const unknown = files.filter(
    (path) =>
      !(
        (path.startsWith("website/") &&
          !path.split("/").some((part) => part.startsWith(".")) &&
          /\.(?:html|css|js|json|svg|png|webp|jpg|jpeg|gif|ico|woff2?|txt)$/.test(path)) ||
        /^docs\/user\/.+\.md$/.test(path) ||
        (path.startsWith("scripts/") && websiteScripts.has(path.slice(8)))
      )
  );
  return { scope: files.length && !unknown.length ? "website" : "full", files, unknown };
}

export function inspectChanges({ base, head = "HEAD", working = true, cwd = process.cwd() }) {
  const git = (...args) =>
    execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  try {
    const baseSha = git("rev-parse", "--verify", `${base}^{commit}`).trim();
    const headSha = git("rev-parse", "--verify", `${head}^{commit}`).trim();
    git("merge-base", "--is-ancestor", baseSha, headSha);
    const files = git("diff", "--name-only", "--no-renames", "-z", baseSha, headSha).split("\0");
    // Include every pending commit, including changes subsequently reverted within the push.
    for (const commit of git("rev-list", `${baseSha}..${headSha}`)
      .trim()
      .split(/\s+/)
      .filter(Boolean)) {
      files.push(
        ...git(
          "diff-tree",
          "--root",
          "-m",
          "-r",
          "--no-commit-id",
          "--name-only",
          "--no-renames",
          "-z",
          commit
        ).split("\0")
      );
    }
    if (working) {
      // Index and worktree must be checked separately: unstaged edits can undo a staged change.
      files.push(
        ...git("diff", "--cached", "--name-only", "--no-renames", "-z", "HEAD").split("\0")
      );
      files.push(...git("diff", "--name-only", "--no-renames", "-z").split("\0"));
      files.push(...git("ls-files", "--others", "--exclude-standard", "-z").split("\0"));
    }
    return { ...classifyPaths(files.filter(Boolean)), base: baseSha, head: headSha };
  } catch (error) {
    return {
      scope: "full",
      files: [],
      unknown: [],
      reason: `Cannot establish change range: ${error.message}`,
    };
  }
}

function main(args) {
  let base;
  let head = "HEAD";
  let working = true;
  let run = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--base") base = args[++i];
    else if (args[i] === "--head") head = args[++i];
    else if (args[i] === "--committed-only") working = false;
    else if (args[i] === "--run") run = true;
    else throw new Error(`Unknown argument: ${args[i]}`);
  }
  let result;
  if (!base) {
    try {
      execFileSync("git", ["fetch", "origin", "main"], { stdio: "pipe" });
      base = "origin/main";
    } catch {
      result = { scope: "full", reason: "Cannot refresh origin/main; using the full gate." };
    }
  }
  result ??= inspectChanges({ base, head, working });
  console.log(JSON.stringify(result, null, 2));
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, `scope=${result.scope}\n`);
  if (run) {
    const command = result.scope === "website" ? "website:verify" : "check";
    // Only fixed script names enter cmd.exe; no revision or path is interpolated into a shell.
    const child =
      process.platform === "win32"
        ? spawnSync("cmd.exe", ["/d", "/s", "/c", `npm run ${command}`], { stdio: "inherit" })
        : spawnSync("npm", ["run", command], { stdio: "inherit" });
    if (child.error) throw child.error;
    process.exitCode = child.status ?? 1;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  main(process.argv.slice(2));
