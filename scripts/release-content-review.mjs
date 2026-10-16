import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const REVIEW_PATH = "docs/release-content-review.json";
export const REVIEW_AREAS = ["userGuide", "readme", "website", "screenshots"];

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).trim();
}

function fingerprint(cwd, revision) {
  const entries = git(cwd, "ls-tree", "-r", "-z", revision)
    .split("\0")
    .filter((entry) => entry && entry.slice(entry.indexOf("\t") + 1) !== REVIEW_PATH);
  return createHash("sha256").update(entries.join("\0")).digest("hex");
}

export function contentSnapshot(cwd) {
  if (git(cwd, "rev-parse", "--is-shallow-repository") !== "false") {
    throw new Error("Release content review requires full git history and stable release tags.");
  }
  if (
    git(
      cwd,
      "status",
      "--porcelain",
      "--untracked-files=all",
      "--",
      ".",
      `:(exclude)${REVIEW_PATH}`
    )
  ) {
    throw new Error(
      "Commit candidate changes before reviewing release content (only the review record may be dirty)."
    );
  }
  const baselineTag = git(cwd, "tag", "--merged", "HEAD", "--sort=-version:refname")
    .split("\n")
    .find((tag) => /^v\d+\.\d+\.\d+$/.test(tag));
  if (!baselineTag)
    throw new Error(
      "No stable release baseline found; fetch the stable release tags before review."
    );
  return {
    version: JSON.parse(git(cwd, "show", "HEAD:package.json")).version,
    baselineTag,
    baselineRevision: git(cwd, "rev-parse", `${baselineTag}^{commit}`),
    candidateRevision: git(cwd, "rev-parse", "HEAD"),
    contentSha256: fingerprint(cwd, "HEAD"),
  };
}

export function checkContentReview(cwd) {
  const snapshot = contentSnapshot(cwd);
  const record = JSON.parse(readFileSync(resolve(cwd, REVIEW_PATH), "utf8"));
  if (record.schemaVersion !== 1) throw new Error("Review schemaVersion must be 1.");
  for (const key of ["version", "baselineTag", "baselineRevision", "contentSha256"]) {
    if (record[key] !== snapshot[key])
      throw new Error(`Release content review is stale: ${key}. Re-review the candidate.`);
  }
  if (!/^[0-9a-f]{40}$/.test(record.candidateRevision ?? ""))
    throw new Error("Invalid reviewed candidate revision.");
  git(cwd, "merge-base", "--is-ancestor", record.candidateRevision, "HEAD");
  if (fingerprint(cwd, record.candidateRevision) !== snapshot.contentSha256) {
    throw new Error("Reviewed candidate content differs from the release candidate.");
  }
  for (const area of REVIEW_AREAS) {
    const decision = record.reviews?.[area];
    if (!["updated", "unchanged"].includes(decision?.status))
      throw new Error(`Complete the ${area} review.`);
    if (typeof decision.rationale !== "string" || !decision.rationale.trim())
      throw new Error(`${area} needs a rationale.`);
    if (
      !Array.isArray(decision.evidence) ||
      !decision.evidence.length ||
      decision.evidence.some((item) => typeof item !== "string" || !item.trim())
    ) {
      throw new Error(
        `${area} needs review evidence (paths, comparisons or screenshots inspected).`
      );
    }
  }
  return snapshot;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const command = process.argv[2];
    if (command === "snapshot") {
      console.log(
        JSON.stringify(
          {
            schemaVersion: 1,
            ...contentSnapshot(process.cwd()),
            reviews: Object.fromEntries(
              REVIEW_AREAS.map((area) => [area, { status: "pending", rationale: "", evidence: [] }])
            ),
          },
          null,
          2
        )
      );
    } else if (command === "check") {
      checkContentReview(process.cwd());
      console.log("Release content review matches the candidate.");
    } else throw new Error("Usage: release-content-review.mjs snapshot | check");
  } catch (error) {
    console.error(`Release content review failed: ${error.message}`);
    process.exitCode = 1;
  }
}
