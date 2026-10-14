import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const shaPattern = /^[0-9a-f]{40}$/;
export function validateWebsiteMarker(marker, repository) {
  if (
    marker?.schemaVersion !== 1 ||
    marker.repository !== repository ||
    !shaPattern.test(marker.websiteSha ?? "") ||
    !shaPattern.test(marker.contentSha ?? "")
  ) {
    throw new Error("Invalid website publication marker; recover the exact published identity.");
  }
  return marker;
}

export function requireSuccessfulCI(runs, sha) {
  const run = runs.find(
    (run) =>
      run.head_sha === sha &&
      run.event === "push" &&
      run.status === "completed" &&
      run.conclusion === "success"
  );
  if (!run)
    throw new Error(
      `No successful completed CI push run for ${sha}. Wait for CI before deployment.`
    );
  return run;
}

export async function resolveWebsiteBaseline(response, repository, bootstrap) {
  if (response.status === 404 && shaPattern.test(bootstrap ?? "")) return bootstrap;
  if (response.status === 200) {
    if (bootstrap) throw new Error("A live marker exists; a bootstrap override is not allowed.");
    return validateWebsiteMarker(await response.json(), repository).websiteSha;
  }
  throw new Error(
    `Cannot read website publication marker (HTTP ${response.status}). Recover a missing marker's exact website SHA from the previous successful deployment artifact before using the bootstrap argument.`
  );
}

const gh = (...args) => execFileSync("gh", args, { encoding: "utf8" }).trim();
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const api = (path) => JSON.parse(gh("api", path));

async function main(args) {
  const repository =
    process.env.GITHUB_REPOSITORY ||
    gh("repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner");
  if (args[0] === "gate" && args.length === 1) {
    const ref = process.env.WEBSITE_REF;
    if (!/^(?:main|[0-9a-f]{40}|v\d+\.\d+\.\d+)$/.test(ref ?? ""))
      throw new Error("Use main, an exact SHA, or a stable release tag.");
    const sha = api(`repos/${repository}/commits/${ref}`).sha;
    if (!shaPattern.test(sha)) throw new Error("Cannot resolve exact website commit.");
    const runs = api(
      `repos/${repository}/actions/workflows/ci.yml/runs?head_sha=${sha}&event=push&status=success&per_page=100`
    ).workflow_runs;
    requireSuccessfulCI(runs, sha);
    appendFileSync(process.env.GITHUB_OUTPUT, `sha=${sha}\n`);
    console.log(`Verified CI for website commit ${sha}`);
    return;
  }
  if (args[0] !== "review" || args.length > 3)
    throw new Error(
      "Usage: website-publication.mjs review [candidate-ref] [verified-bootstrap-sha] | gate"
    );
  const candidate = git("rev-parse", "--verify", `${args[1] || "HEAD"}^{commit}`);
  const host = readFileSync("website/CNAME", "utf8").trim();
  if (!/^[a-z0-9.-]+$/i.test(host)) throw new Error("Invalid website host.");
  const response = await fetch(`https://${host}/publication.json?review=${Date.now()}`, {
    signal: AbortSignal.timeout(30_000),
    redirect: "error",
    headers: { "Cache-Control": "no-cache" },
  });
  const baseline = await resolveWebsiteBaseline(response, repository, args[2]);
  const release = api(`repos/${repository}/releases/latest`).tag_name;
  git("fetch", "origin", baseline);
  git("fetch", "origin", `refs/tags/${release}:refs/tags/${release}`);
  const changedFiles = git("diff", "--name-only", "--no-renames", baseline, candidate)
    .split("\n")
    .filter(Boolean);
  const guideChangesSinceRelease = git("diff", "--name-only", release, candidate, "--", "docs/user")
    .split("\n")
    .filter(Boolean);
  console.log(
    JSON.stringify(
      {
        repository,
        baseline,
        candidate,
        latestRelease: release,
        changedFiles,
        guideChangesSinceRelease,
        reviewRequired:
          "Review the complete diff from baseline to candidate, including generated guide and shared inputs. Guide differences from the latest release need semantic review for unshipped features before dispatch. This report does not authorize publication.",
      },
      null,
      2
    )
  );
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
