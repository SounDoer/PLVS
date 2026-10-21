#!/usr/bin/env node
/**
 * Dispatch `preview-build.yml` for the exact pushed commit of the current branch.
 *
 * Usage: npm run preview:dispatch -- [all|windows|macos|linux]   (default: all)
 *
 * The workflow builds whatever SHA it is given, so this refuses a dirty tree or a commit the
 * remote branch does not point at: testers must receive exactly the commit that was reviewed.
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import process from "node:process";
import { pathToFileURL } from "node:url";

const REPOSITORY = "SounDoer/PLVS";
export const PREVIEW_PLATFORMS = ["all", "windows", "macos", "linux"];

/** The requested platform from the script arguments; `all` when none is given. */
export function parsePreviewPlatform(args) {
  if (args.length > 1) throw new Error("Pass at most one platform.");
  const platform = args[0] ?? "all";
  if (!PREVIEW_PLATFORMS.includes(platform)) {
    throw new Error(`Unknown platform "${platform}". Use one of: ${PREVIEW_PLATFORMS.join(", ")}.`);
  }
  return platform;
}

/** A request id matching the workflow's `^[A-Za-z0-9_-]{6,32}$` rule. */
export function newRequestId() {
  return randomBytes(6).toString("hex");
}

/** The SHA a `git ls-remote` line names, or null when the branch is absent on the remote. */
export function remoteBranchSha(lsRemoteOutput) {
  const line = lsRemoteOutput.trim();
  return line ? line.split(/\s/)[0] : null;
}

function capture(command, args) {
  return execFileSync(command, args, { encoding: "utf8" }).trim();
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function findRun(sha, requestId) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const runs = JSON.parse(
      capture("gh", [
        "run",
        "list",
        "--repo",
        REPOSITORY,
        "--workflow",
        "preview-build.yml",
        "--commit",
        sha,
        "--event",
        "workflow_dispatch",
        "--limit",
        "20",
        "--json",
        "databaseId,displayTitle,url",
      ])
    );
    const run = runs.find((candidate) => candidate.displayTitle.includes(`(${requestId})`));
    if (run) return run;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000);
  }
  return null;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  let platform;
  try {
    platform = parsePreviewPlatform(process.argv.slice(2));
  } catch (error) {
    fail(error.message);
  }
  const branch = capture("git", ["branch", "--show-current"]);
  if (!branch) fail("Preview builds require a checked-out branch.");
  if (capture("git", ["status", "--porcelain"])) {
    fail("Commit or discard working-tree changes before building a Preview.");
  }
  const sha = capture("git", ["rev-parse", "HEAD"]);
  const remoteSha = remoteBranchSha(
    capture("git", ["ls-remote", "origin", `refs/heads/${branch}`])
  );
  if (!remoteSha) fail(`Push ${branch} before building a Preview.`);
  if (remoteSha !== sha) {
    fail(`origin/${branch} is ${remoteSha}, not HEAD ${sha}. Push the exact Preview commit first.`);
  }

  const requestId = newRequestId();
  execFileSync(
    "gh",
    [
      "workflow",
      "run",
      "preview-build.yml",
      "--repo",
      REPOSITORY,
      "--ref",
      branch,
      "-f",
      `commit_sha=${sha}`,
      "-f",
      `request_id=${requestId}`,
      "-f",
      `platform=${platform}`,
    ],
    { stdio: "inherit" }
  );
  console.log(`Dispatched preview-build.yml: platform=${platform} ${branch} @ ${sha}`);
  console.log(`Request id: ${requestId}`);

  const run = findRun(sha, requestId);
  if (!run) {
    fail(
      `No run appeared yet. Find it with: gh run list --workflow=preview-build.yml --commit ${sha} --event workflow_dispatch (title contains ${requestId})`
    );
  }
  console.log(`Run ${run.databaseId}: ${run.url}`);
  console.log(`Watch it with: gh run watch ${run.databaseId} --repo ${REPOSITORY} --exit-status`);
  console.log(`On success the Preview is tagged preview-${sha.slice(0, 7)}-${run.databaseId}.`);
}
