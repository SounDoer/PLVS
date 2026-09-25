import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readCommunitySource } from "./community-catalogue-source.mjs";

export class CommunityUpdateError extends Error {
  constructor(issues) {
    super("The Community Catalogue update rewrites published history.");
    this.name = "CommunityUpdateError";
    this.code = "invalidCommunityUpdate";
    this.issues = issues;
  }
}

function issue(code, path, message, details) {
  return { severity: "error", code, path, message, ...(details ? { details } : {}) };
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function stableRelease(release) {
  return {
    number: release.number,
    publishedAt: release.publishedAt,
    notesMarkdown: release.notesMarkdown,
    artifact: release.artifact,
    artifactSha256: release.metadata.artifact.sha256,
    contentHash: release.metadata.content.contentHash,
    previews: release.previews.map(({ id, path, sha256 }) => ({ id, path, sha256 })),
  };
}

function validateReleaseHistory(previous, candidate, listingId, issues) {
  const candidateByNumber = new Map(candidate.releases.map((release) => [release.number, release]));
  const previousMaximum = Math.max(...previous.releases.map(({ number }) => number));

  for (const previousRelease of previous.releases) {
    const path = `$.listings[${listingId}].releases[${previousRelease.number}]`;
    const candidateRelease = candidateByNumber.get(previousRelease.number);
    if (!candidateRelease) {
      issues.push(
        issue("releaseRemoved", path, `Published Release ${previousRelease.number} was removed.`)
      );
      continue;
    }
    if (!same(stableRelease(previousRelease), stableRelease(candidateRelease))) {
      issues.push(
        issue(
          "releaseHistoryChanged",
          path,
          `Published Release ${previousRelease.number} metadata or bytes changed.`
        )
      );
    }
    if (previousRelease.status === "withdrawn") {
      if (
        candidateRelease.status !== "withdrawn" ||
        candidateRelease.withdrawalReason !== previousRelease.withdrawalReason
      ) {
        issues.push(
          issue(
            "withdrawalChanged",
            path,
            `Withdrawn Release ${previousRelease.number} cannot be restored or rewritten.`
          )
        );
      }
    } else if (candidateRelease.status !== "published" && candidateRelease.status !== "withdrawn") {
      issues.push(
        issue(
          "invalidStatusTransition",
          path,
          "A published Release may only remain published or be withdrawn."
        )
      );
    }
  }

  for (const candidateRelease of candidate.releases) {
    if (
      candidateByNumber.has(candidateRelease.number) &&
      candidateRelease.number <= previousMaximum
    ) {
      if (!previous.releases.some(({ number }) => number === candidateRelease.number)) {
        issues.push(
          issue(
            "releaseInserted",
            `$.listings[${listingId}].releases[${candidateRelease.number}]`,
            "A new Release must be appended above the previous highest number."
          )
        );
      }
      continue;
    }
    if (candidateRelease.number > previousMaximum && candidateRelease.status !== "published") {
      issues.push(
        issue(
          "newReleaseWithdrawn",
          `$.listings[${listingId}].releases[${candidateRelease.number}]`,
          "A newly appended Release must begin as published."
        )
      );
    }
  }
}

export async function validateCommunitySourceUpdate(previousDirectory, candidateDirectory) {
  const [previous, candidate] = await Promise.all([
    readCommunitySource(previousDirectory),
    readCommunitySource(candidateDirectory),
  ]);
  const candidateById = new Map(candidate.listings.map(({ document }) => [document.id, document]));
  const issues = [];

  for (const { document: previousListing } of previous.listings) {
    const candidateListing = candidateById.get(previousListing.id);
    const path = `$.listings[${previousListing.id}]`;
    if (!candidateListing) {
      issues.push(
        issue("listingRemoved", path, `Published Listing ${previousListing.id} was removed.`)
      );
      continue;
    }
    for (const field of ["slug", "type", "classification"]) {
      if (candidateListing[field] !== previousListing[field]) {
        issues.push(
          issue(
            "listingIdentityChanged",
            `${path}.${field}`,
            `Published Listing ${field} cannot change.`,
            { previous: previousListing[field], candidate: candidateListing[field] }
          )
        );
      }
    }
    validateReleaseHistory(previousListing, candidateListing, previousListing.id, issues);
  }

  if (issues.length > 0) throw new CommunityUpdateError(issues);
  return {
    valid: true,
    previousListingCount: previous.listings.length,
    candidateListingCount: candidate.listings.length,
  };
}

async function main(args) {
  if (args.length !== 2) {
    throw new Error(
      "Usage: npm run community:update:check -- <previous-directory> <candidate-directory>"
    );
  }
  const result = await validateCommunitySourceUpdate(args[0], args[1]);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(
      `${JSON.stringify(
        {
          valid: false,
          code: error?.code ?? "communityUpdateValidationFailed",
          message: error instanceof Error ? error.message : String(error),
          issues: Array.isArray(error?.issues) ? error.issues : [],
        },
        null,
        2
      )}\n`
    );
    process.exitCode = 1;
  });
}
