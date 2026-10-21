#!/usr/bin/env node
/**
 * Dispatch `release.yml` for the pushed tip of main once its push CI has succeeded.
 *
 * The checks here need the maintainer's own `gh` login: GITHUB_TOKEN can read neither the
 * self-hosted runner list nor the immutable-releases setting, so the workflow cannot do them itself.
 * A rig runner that is offline would otherwise make the release wait in the queue and then fail.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";

const REPOSITORY = "SounDoer/PLVS";
export const RIG_PLATFORMS = ["windows", "macos", "linux"];

/** Platforms with no online `plvs-rig` runner, from the runners API `runners` array. */
export function offlineRigPlatforms(runners) {
  const online = runners
    .filter((runner) => runner.status === "online")
    .map((runner) => runner.labels.map((label) => label.name.toLowerCase()))
    .filter((labels) => labels.includes("plvs-rig"));
  return RIG_PLATFORMS.filter((platform) => !online.some((labels) => labels.includes(platform)));
}

function capture(command, args) {
  return execFileSync(command, args, { encoding: "utf8" }).trim();
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function remoteMain() {
  return capture("git", ["ls-remote", "origin", "refs/heads/main"]).split(/\s/)[0];
}

function findCiRun(sha) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const id = capture("gh", [
      "run",
      "list",
      "--repo",
      REPOSITORY,
      "--workflow",
      "ci.yml",
      "--event",
      "push",
      "--commit",
      sha,
      "--limit",
      "1",
      "--json",
      "databaseId",
      "--jq",
      ".[0].databaseId // empty",
    ]);
    if (id) return id;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000);
  }
  return null;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const sha = capture("git", ["rev-parse", "HEAD"]);
  if (remoteMain() !== sha) fail(`HEAD ${sha} is not the pushed tip of origin/main. Push first.`);
  const version = JSON.parse(readFileSync("package.json", "utf8")).version;

  const runners = JSON.parse(
    capture("gh", ["api", `repos/${REPOSITORY}/actions/runners`, "--jq", ".runners"])
  );
  const offline = offlineRigPlatforms(runners);
  if (offline.length > 0) {
    fail(`No online plvs-rig runner for: ${offline.join(", ")}. Start it before dispatching.`);
  }
  console.log("Rig runners online: windows, macos, linux");

  const immutable = JSON.parse(
    capture("gh", [
      "api",
      "--header",
      "X-GitHub-Api-Version: 2026-03-10",
      `repos/${REPOSITORY}/immutable-releases`,
    ])
  );
  if (immutable.enabled !== true) fail("Enable release immutability before dispatching.");
  console.log("Release immutability: enabled");

  const runId = findCiRun(sha);
  if (!runId) fail(`No ci.yml push run appeared for ${sha}.`);
  console.log(`Waiting for ci.yml run ${runId}...`);
  spawnSync("gh", ["run", "watch", runId, "--repo", REPOSITORY, "--exit-status"], {
    stdio: "inherit",
  });
  const conclusion = capture("gh", [
    "run",
    "view",
    runId,
    "--repo",
    REPOSITORY,
    "--json",
    "conclusion",
    "--jq",
    ".conclusion",
  ]);
  if (conclusion !== "success") fail(`ci.yml run ${runId} concluded ${conclusion || "unknown"}.`);
  if (remoteMain() !== sha) fail("origin/main moved after CI verification.");

  execFileSync(
    "gh",
    [
      "workflow",
      "run",
      "release.yml",
      "--repo",
      REPOSITORY,
      "--ref",
      "main",
      "-f",
      `version=${version}`,
      "-f",
      `commit_sha=${sha}`,
      "-f",
      "confirm_immutable_releases=true",
    ],
    { stdio: "inherit" }
  );
  console.log(`Dispatched release.yml for v${version} at ${sha}.`);
  console.log("Watch it with: gh run list --workflow=release.yml --limit 1");
}
