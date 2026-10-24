#!/usr/bin/env node
/**
 * Release capture acceptance runs on self-hosted runners on the maintainer's machines. A fork pull
 * request runs the workflow files it brings itself, so the workflows on `main` cannot keep it off
 * those runners; only the repository's approval setting can. Any weaker setting lets a returning
 * contributor's pull request run code there without approval.
 */
import { spawnSync } from "node:child_process";
import process from "node:process";
import { pathToFileURL } from "node:url";

export const REQUIRED_FORK_APPROVAL = "all_external_contributors";

/** Null when `policy` is the required setting, otherwise what is wrong. */
export function forkApprovalProblem(policy) {
  if (!policy) return "The fork pull request approval setting could not be read.";
  if (policy === REQUIRED_FORK_APPROVAL) return null;
  return (
    `Fork pull request approval is "${policy}"; self-hosted capture runners need ` +
    `"${REQUIRED_FORK_APPROVAL}" (docs/release-operations.md, "Home capture runners").`
  );
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const result = spawnSync(
    "gh",
    [
      "api",
      "repos/SounDoer/PLVS/actions/permissions/fork-pr-contributor-approval",
      "--jq",
      ".approval_policy",
    ],
    { encoding: "utf8" }
  );
  const problem = forkApprovalProblem(result.status === 0 ? result.stdout.trim() : "");
  if (problem) {
    console.error(problem);
    process.exit(1);
  }
  console.log(`Fork pull request approval: ${REQUIRED_FORK_APPROVAL}`);
}
