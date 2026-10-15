/**
 * Dev apps in linked Git worktrees (ADR 0028).
 *
 * Several agents work in parallel, one linked worktree each. The main checkout keeps port 1420
 * and the ordinary dev app-data directory. A linked worktree gets its own Vite port and its own
 * app data under `.dev-data`, and the dev CLI run from it sees only the app started from it.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export const MAIN_DEV_PORT = 1420;
export const WORKTREE_PORTS = { first: 1430, last: 1499 };
export const DATA_DIRECTORY_NAME = ".dev-data";
export const APP_DATA_ROOT_ARG = "--plvs-test-app-data-root";

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.error) throw new Error(`Unable to run git: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

/** The directory every worktree of this repository shares. */
export function gitCommonDir(cwd = ROOT) {
  return resolve(git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]));
}

/** The worktree's root when `cwd` is in a linked worktree, otherwise null. */
export function linkedWorktreeRoot(cwd = ROOT) {
  const gitDir = resolve(git(cwd, ["rev-parse", "--absolute-git-dir"]));
  if (gitDir === gitCommonDir(cwd)) return null;
  return resolve(git(cwd, ["rev-parse", "--show-toplevel"]));
}

export function worktreeDataRoot(worktree) {
  return join(worktree, DATA_DIRECTORY_NAME);
}

/** Where the dev CLI finds the instances of an app started with `worktreeDataRoot`. */
export function worktreeCliIdentityRoot(worktree) {
  return join(worktreeDataRoot(worktree), "multi-instance");
}

/** Stable per path, so a worktree usually keeps its port across restarts. FNV-1a. */
export function preferredWorktreePort(worktree) {
  let hash = 0x811c9dc5;
  for (const char of resolve(worktree).toLowerCase()) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const span = WORKTREE_PORTS.last - WORKTREE_PORTS.first + 1;
  return WORKTREE_PORTS.first + (hash % span);
}

function bindable(port, host) {
  return new Promise((resolvePromise) => {
    const server = createServer();
    server.once("error", (error) => {
      // A machine without IPv6 cannot bind ::1; that host is then simply not in the way.
      resolvePromise(error.code === "EADDRNOTAVAIL" || error.code === "EAFNOSUPPORT");
    });
    server.listen({ port, host, exclusive: true }, () => server.close(() => resolvePromise(true)));
  });
}

/** Vite binds `localhost`, which resolves to either loopback address. */
export async function portIsFree(port) {
  return (await bindable(port, "127.0.0.1")) && (await bindable(port, "::1"));
}

export async function chooseWorktreePort(worktree, isFree = portIsFree) {
  const first = preferredWorktreePort(worktree);
  const span = WORKTREE_PORTS.last - WORKTREE_PORTS.first + 1;
  for (let offset = 0; offset < span; offset += 1) {
    const port = WORKTREE_PORTS.first + ((first - WORKTREE_PORTS.first + offset) % span);
    if (await isFree(port)) return port;
  }
  throw new Error(
    `No free dev server port in ${WORKTREE_PORTS.first}-${WORKTREE_PORTS.last} for ${worktree}.`
  );
}

/**
 * The Tauri config overlay that points the dev app at `port`. The CSP is derived from
 * `tauri.conf.json` rather than retyped, so the two cannot drift apart.
 */
export function worktreeTauriConfig(baseConfig, port) {
  const mainUrl = `http://localhost:${MAIN_DEV_PORT}`;
  if (baseConfig.build?.devUrl !== mainUrl) {
    throw new Error(`tauri.conf.json devUrl is no longer ${mainUrl}; update dev-worktree.mjs.`);
  }
  const devCsp = baseConfig.app?.security?.devCsp;
  if (typeof devCsp !== "string" || !devCsp.includes(`localhost:${MAIN_DEV_PORT}`)) {
    throw new Error(`tauri.conf.json devCsp no longer names localhost:${MAIN_DEV_PORT}.`);
  }
  return {
    build: { devUrl: `http://localhost:${port}` },
    app: {
      security: { devCsp: devCsp.replaceAll(`localhost:${MAIN_DEV_PORT}`, `localhost:${port}`) },
    },
  };
}

export function readBaseTauriConfig(root = ROOT) {
  return JSON.parse(readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8"));
}

/**
 * `tauri dev` arguments are `[tauri options] -- [cargo run options] -- [app arguments]`. Adds the
 * config overlay before the first separator and the data root among the app arguments. An
 * explicit data root from the caller wins.
 */
export function worktreeTauriDevArgs(args, { configPath, dataRoot }) {
  const firstSeparator = args.indexOf("--");
  const tauriOptions = firstSeparator === -1 ? args : args.slice(0, firstSeparator);
  const rest = firstSeparator === -1 ? [] : args.slice(firstSeparator);
  const withConfig = [...tauriOptions, "--config", configPath, ...rest];
  if (args.includes(APP_DATA_ROOT_ARG)) return withConfig;
  const separators = withConfig.filter((arg) => arg === "--").length;
  const padding = Array.from({ length: Math.max(0, 2 - separators) }, () => "--");
  return [...withConfig, ...padding, APP_DATA_ROOT_ARG, dataRoot];
}

/**
 * Points the dev CLI at this worktree's app. Run before spawning the CLI; a value the caller
 * already set wins. Returns the root in use, or null on the main checkout.
 */
export function scopeDevCliToWorktree(env = process.env, worktree = linkedWorktreeRoot()) {
  if (!worktree) return env.PLVS_TEST_IDENTITY_ROOT ?? null;
  env.PLVS_TEST_IDENTITY_ROOT ??= worktreeCliIdentityRoot(worktree);
  return env.PLVS_TEST_IDENTITY_ROOT;
}
