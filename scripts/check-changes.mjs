import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Keep the website-only fast path deliberately narrow. Shared dependencies and the classifier
// itself require broader lanes.
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

const frontendFiles = new Set([
  ".nvmrc",
  ".prettierrc",
  "components.json",
  "eslint-plugin-plvs-adr-theme.js",
  "eslint.config.js",
  "index.html",
  "jsconfig.json",
  "sharesets-preview.html",
  "vite.config.js",
  "vitest.setup.js",
]);
const sharedDependencyFiles = new Set(["package.json", "package-lock.json"]);
const nativeFiles = new Set(["rust-toolchain.toml"]);
const classifierFiles = new Set(["scripts/check-changes.mjs", "scripts/check-changes.test.js"]);
const sharedPackageFiles = new Set([
  "package.json",
  "package-lock.json",
  "src-tauri/Cargo.toml",
  "src-tauri/Cargo.lock",
  "src-tauri/build.rs",
  "src-tauri/plvs-agent.json",
  "src-tauri/tauri.conf.json",
  "src-tauri/tauri.cli-sidecar.conf.json",
  "src-tauri/tauri.no-updater.conf.json",
  "scripts/build-plvs-cli.mjs",
  "scripts/fetch-ffmpeg-sidecar.mjs",
  "scripts/verify-license-assets.mjs",
]);
const sharedPackageSourcePattern = /^src-tauri\/src\/(?:doctor|cli_[^/]+|sidecar)\.rs$/;
const windowsPackageFiles = new Set([
  "src-tauri/tauri.windows.conf.json",
  "scripts/verify-windows-installer.ps1",
]);
const macosPackageFiles = new Set([
  "src-tauri/tauri.macos.conf.json",
  "scripts/verify-macos-dmg.sh",
]);
const linuxPackageFiles = new Set([
  "scripts/build-linux-deb.mjs",
  "scripts/generate-sidecar-fixtures.mjs",
  "scripts/verify-linux-deb-clean.sh",
  "scripts/verify-linux-deb.sh",
  "scripts/verify-linux-desktop.py",
]);
const contractRoots = [
  ".agents/",
  ".claude/",
  ".codex/",
  ".github/",
  ".superpowers/",
  "assets/",
  "docs/",
  "fixtures/",
  "licenses/",
  "scripts/",
  "sharesets/",
];
const contractFiles = new Set([
  ".editorconfig",
  ".gitattributes",
  ".gitignore",
  "AGENTS.md",
  "CHANGELOG.md",
  "CLAUDE.md",
  "CONTRIBUTING.md",
  "LICENSE",
  "README.md",
  "THIRD-PARTY-NOTICES.md",
]);

function isWebsitePath(path) {
  return (
    (path.startsWith("website/") &&
      !path.split("/").some((part) => part.startsWith(".")) &&
      /\.(?:html|css|js|json|svg|png|webp|jpg|jpeg|gif|ico|woff2?|txt)$/.test(path)) ||
    /^docs\/user\/.+\.md$/.test(path) ||
    (path.startsWith("scripts/") && websiteScripts.has(path.slice(8)))
  );
}

function laneForPath(path) {
  if (classifierFiles.has(path)) return { frontend: true, native: true, known: true };
  if (path.startsWith("src-tauri/") || nativeFiles.has(path)) {
    return { frontend: false, native: true, known: true };
  }
  if (path.startsWith("shared/")) return { frontend: true, native: true, known: true };
  if (path.startsWith("src/") || path.startsWith("public/") || frontendFiles.has(path)) {
    return { frontend: true, native: false, known: true };
  }
  // npm dependencies include the Tauri build CLI as well as frontend packages. Keep dependency
  // changes on the full lane until package checks provide a narrower independent safety net.
  if (sharedDependencyFiles.has(path)) return { frontend: true, native: true, known: true };
  if (isWebsitePath(path)) return { frontend: false, native: false, known: true };
  if (contractFiles.has(path) || contractRoots.some((root) => path.startsWith(root))) {
    return { frontend: false, native: false, known: true };
  }
  return { frontend: true, native: true, known: false };
}

function packageLanesForPath(path) {
  const all =
    classifierFiles.has(path) ||
    path === ".github/workflows/package-check.yml" ||
    sharedPackageFiles.has(path) ||
    sharedPackageSourcePattern.test(path);
  return {
    package_windows: all || windowsPackageFiles.has(path) || path.startsWith("src-tauri/nsis/"),
    package_macos: all || macosPackageFiles.has(path),
    package_linux:
      all ||
      linuxPackageFiles.has(path) ||
      path.startsWith("src-tauri/linux-update-installer/") ||
      /^src-tauri\/tauri\.linux-[^/]+\.conf\.json$/.test(path),
  };
}

const fullLanes = {
  contracts: true,
  frontend: true,
  native: true,
  package_windows: true,
  package_macos: true,
  package_linux: true,
};

export function classifyPaths(paths) {
  const files = [...new Set(paths)].sort();
  if (files.length && files.every(isWebsitePath)) {
    return {
      scope: "website",
      files,
      unknown: [],
      lanes: {
        contracts: false,
        frontend: false,
        native: false,
        package_windows: false,
        package_macos: false,
        package_linux: false,
      },
    };
  }
  let frontend = false;
  let native = false;
  let packageWindows = false;
  let packageMacos = false;
  let packageLinux = false;
  const unknown = [];
  for (const file of files) {
    const lane = laneForPath(file);
    frontend ||= lane.frontend;
    native ||= lane.native;
    const packages = packageLanesForPath(file);
    packageWindows ||= packages.package_windows;
    packageMacos ||= packages.package_macos;
    packageLinux ||= packages.package_linux;
    if (!lane.known) unknown.push(file);
  }
  if (!files.length) {
    return { scope: "native", files, unknown, lanes: { ...fullLanes } };
  }
  if (unknown.length) {
    packageWindows = true;
    packageMacos = true;
    packageLinux = true;
  }
  return {
    scope: native ? "native" : frontend ? "frontend" : "contracts",
    files,
    unknown,
    lanes: {
      contracts: true,
      frontend,
      native,
      package_windows: packageWindows,
      package_macos: packageMacos,
      package_linux: packageLinux,
    },
  };
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
      scope: "native",
      files: [],
      unknown: [],
      lanes: { ...fullLanes },
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
      result = {
        scope: "native",
        lanes: { ...fullLanes },
        reason: "Cannot refresh origin/main; using the full gate.",
      };
    }
  }
  result ??= inspectChanges({ base, head, working });
  console.log(JSON.stringify(result, null, 2));
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `scope=${result.scope}\n`);
    for (const lane of [
      "contracts",
      "frontend",
      "native",
      "package_windows",
      "package_macos",
      "package_linux",
    ]) {
      appendFileSync(process.env.GITHUB_OUTPUT, `${lane}=${result.lanes?.[lane] === true}\n`);
    }
  }
  if (run) {
    const command =
      result.scope === "website"
        ? "website:verify"
        : result.scope === "contracts"
          ? "check:contracts"
          : result.scope === "frontend"
            ? "check:frontend"
            : "check";
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
