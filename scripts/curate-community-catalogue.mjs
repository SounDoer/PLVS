#!/usr/bin/env node
import { constants } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { buildCommunitySite } from "./build-community-site.mjs";
import { readCommunitySource, readCommunitySourceRecords } from "./community-catalogue-source.mjs";
import { validateCommunitySourceUpdate } from "./community-catalogue-update.mjs";
import {
  buildPreviewPlanForArtifact,
  generateCommunityPreviews,
} from "./generate-community-previews.mjs";

export class CommunityCurationError extends Error {
  constructor(issues) {
    super("The Community Catalogue candidate cannot be curated safely.");
    this.name = "CommunityCurationError";
    this.code = "invalidCommunityCuration";
    this.issues = issues;
  }
}

const issue = (code, path, message, details) => ({
  severity: "error",
  code,
  path,
  message,
  ...(details ? { details } : {}),
});

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function inside(root, candidate) {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

function stableRecord(release) {
  return {
    number: release.number,
    publishedAt: release.publishedAt,
    notesMarkdown: release.notesMarkdown,
    artifact: release.artifact,
    previews: release.previews.map(({ id, path }) => ({ id, path })),
  };
}

async function bytesEqual(leftPath, rightPath) {
  try {
    const [left, right] = await Promise.all([readFile(leftPath), readFile(rightPath)]);
    return left.equals(right);
  } catch (_) {
    return false;
  }
}

async function oldReleaseBytesMatch(previousRoot, candidateRoot, previous, candidate) {
  if (
    !(await bytesEqual(
      resolve(previousRoot, previous.artifact),
      resolve(candidateRoot, candidate.artifact)
    ))
  ) {
    return false;
  }
  for (const previousPreview of previous.previews) {
    const candidatePreview = candidate.previews.find(({ id }) => id === previousPreview.id);
    if (
      !candidatePreview ||
      !(await bytesEqual(
        resolve(previousRoot, previousPreview.path),
        resolve(candidateRoot, candidatePreview.path)
      ))
    ) {
      return false;
    }
  }
  return true;
}

function changedCopyFields(previous, candidate) {
  return ["title", "summary", "descriptionMarkdown", "tags", "author"].filter(
    (field) => !same(previous[field], candidate[field])
  );
}

async function inspectCandidate(previous, candidate) {
  const issues = [];
  const additions = [];
  const withdrawals = [];
  const copyChanges = [];
  const candidateById = new Map(
    candidate.listings.map((listing) => [listing.document.id, listing])
  );
  const previousById = new Map(previous.listings.map((listing) => [listing.document.id, listing]));

  for (const previousEntry of previous.listings) {
    const previousListing = previousEntry.document;
    const candidateEntry = candidateById.get(previousListing.id);
    const listingPath = `$.listings[${previousListing.id}]`;
    if (!candidateEntry) {
      issues.push(issue("listingRemoved", listingPath, "A published Listing cannot be removed."));
      continue;
    }
    const candidateListing = candidateEntry.document;
    for (const field of ["slug", "type", "classification"]) {
      if (candidateListing[field] !== previousListing[field]) {
        issues.push(
          issue(
            "listingIdentityChanged",
            `${listingPath}.${field}`,
            `Published ${field} cannot change.`
          )
        );
      }
    }
    const fields = changedCopyFields(previousListing, candidateListing);
    if (fields.length > 0) copyChanges.push({ listingId: previousListing.id, fields });
    const candidateReleases = new Map(
      candidateListing.releases.map((release) => [release.number, release])
    );
    const maximum = Math.max(...previousListing.releases.map(({ number }) => number));
    for (const previousRelease of previousListing.releases) {
      const path = `${listingPath}.releases[${previousRelease.number}]`;
      const candidateRelease = candidateReleases.get(previousRelease.number);
      if (!candidateRelease) {
        issues.push(issue("releaseRemoved", path, "A published Release cannot be removed."));
        continue;
      }
      if (
        !same(stableRecord(previousRelease), stableRecord(candidateRelease)) ||
        !(await oldReleaseBytesMatch(
          previous.root,
          candidate.root,
          previousRelease,
          candidateRelease
        ))
      ) {
        issues.push(
          issue("releaseHistoryChanged", path, "Published Release records or bytes changed.")
        );
      }
      if (previousRelease.status === "withdrawn") {
        if (
          candidateRelease.status !== "withdrawn" ||
          candidateRelease.withdrawalReason !== previousRelease.withdrawalReason
        ) {
          issues.push(
            issue("withdrawalChanged", path, "A withdrawn Release cannot be restored or rewritten.")
          );
        }
      } else if (candidateRelease.status === "withdrawn") {
        withdrawals.push({
          listingId: previousListing.id,
          releaseNumber: previousRelease.number,
          reason: candidateRelease.withdrawalReason,
        });
      }
    }
    for (const release of candidateListing.releases) {
      if (previousListing.releases.some(({ number }) => number === release.number)) continue;
      if (release.number <= maximum) {
        issues.push(
          issue(
            "releaseInserted",
            `${listingPath}.releases[${release.number}]`,
            "A new Release must be above the previous highest number."
          )
        );
      } else {
        additions.push({
          listingId: candidateListing.id,
          listingType: candidateListing.type,
          release,
        });
      }
    }
  }

  for (const candidateEntry of candidate.listings) {
    if (previousById.has(candidateEntry.document.id)) continue;
    for (const release of candidateEntry.document.releases) {
      additions.push({
        listingId: candidateEntry.document.id,
        listingType: candidateEntry.document.type,
        release,
      });
    }
  }

  for (const addition of additions) {
    const path = `$.listings[${addition.listingId}].releases[${addition.release.number}]`;
    if (addition.release.status !== "published") {
      issues.push(issue("newReleaseWithdrawn", path, "A new Release must begin as published."));
      continue;
    }
    try {
      const { type, plan } = await buildPreviewPlanForArtifact(
        resolve(candidate.root, addition.release.artifact)
      );
      if (type !== addition.listingType) {
        issues.push(
          issue("artifactTypeMismatch", `${path}.artifact`, "Artifact and Listing types differ.")
        );
        continue;
      }
      const expectedIds = plan.assets.map(({ id }) => id).sort();
      const receivedIds = addition.release.previews.map(({ id }) => id).sort();
      if (!same(expectedIds, receivedIds)) {
        issues.push(
          issue(
            "previewSetMismatch",
            `${path}.previews`,
            "Preview IDs do not match the renderer contract.",
            {
              expectedIds,
              receivedIds,
            }
          )
        );
      }
      addition.plan = plan;
    } catch (error) {
      issues.push(
        issue(
          "invalidNewReleaseArtifact",
          `${path}.artifact`,
          error instanceof Error ? error.message : String(error)
        )
      );
    }
  }

  if (issues.length > 0) throw new CommunityCurationError(issues);
  return { additions, withdrawals, copyChanges };
}

async function assertNewOutput(path, label) {
  const output = resolve(path);
  const parent = dirname(output);
  const parentInfo = await lstat(parent).catch(() => null);
  if (!parentInfo?.isDirectory() || parentInfo.isSymbolicLink()) {
    throw new Error(`${label} parent must be an existing non-symlink directory.`);
  }
  if (await stat(output).catch(() => null)) throw new Error(`${label} must not already exist.`);
  return output;
}

async function assertSafeNewPreviewPath(root, relativePath) {
  const target = resolve(root, relativePath);
  if (!inside(root, target) || target === root)
    throw new Error("A preview path escaped the candidate root.");
  if (await stat(target).catch(() => null))
    throw new Error(`Preview output already exists: ${relativePath}`);
  let cursor = dirname(target);
  while (inside(root, cursor) && cursor !== root) {
    const info = await lstat(cursor).catch(() => null);
    if (info?.isSymbolicLink())
      throw new Error(`Preview path crosses a symbolic link: ${relativePath}`);
    cursor = dirname(cursor);
  }
  return target;
}

function publicReport(mode, previous, candidate, changes, reviewDirectory = null) {
  return {
    schemaVersion: 1,
    mode,
    publishedListingCount: previous.listings.length,
    candidateListingCount: candidate.listings.length,
    additions: changes.additions.map(({ listingId, listingType, release }) => ({
      listingId,
      type: listingType,
      releaseNumber: release.number,
      artifact: release.artifact,
      previews: release.previews,
    })),
    withdrawals: changes.withdrawals,
    copyChanges: changes.copyChanges,
    ...(reviewDirectory ? { reviewDirectory } : {}),
  };
}

function markdownReport(report) {
  const lines = ["# Community Curation Review", "", `Mode: ${report.mode}`, ""];
  for (const [title, entries, render] of [
    [
      "Additions",
      report.additions,
      (item) => `${item.listingId} Release ${item.releaseNumber} (${item.type})`,
    ],
    [
      "Withdrawals",
      report.withdrawals,
      (item) => `${item.listingId} Release ${item.releaseNumber}: ${item.reason}`,
    ],
    [
      "Listing Copy Changes",
      report.copyChanges,
      (item) => `${item.listingId}: ${item.fields.join(", ")}`,
    ],
  ]) {
    lines.push(`## ${title}`, "");
    lines.push(
      ...(entries.length > 0 ? entries.map((item) => `- ${render(item)}`) : ["- None"]),
      ""
    );
  }
  return `${lines.join("\n")}\n`;
}

export async function curateCommunityCatalogue({
  publishedDirectory,
  candidateDirectory,
  outputDirectory,
  write = false,
  generatePreviews = generateCommunityPreviews,
} = {}) {
  const published = await readCommunitySource(publishedDirectory);
  const candidate = await readCommunitySourceRecords(candidateDirectory);
  const changes = await inspectCandidate(published, candidate);
  if (!write) return publicReport("dry-run", published, candidate, changes);

  const output = await assertNewOutput(outputDirectory, "Review output");
  const candidateInfo = await lstat(candidate.root);
  if (!candidateInfo.isDirectory() || candidateInfo.isSymbolicLink()) {
    throw new Error("The candidate root must be a non-symlink directory.");
  }
  const previewTargets = [];
  for (const addition of changes.additions) {
    for (const preview of addition.release.previews) {
      previewTargets.push({
        addition,
        preview,
        target: await assertSafeNewPreviewPath(candidate.root, preview.path),
      });
    }
  }

  const staging = await mkdtemp(join(dirname(output), ".plvs-community-review-"));
  const generatedFiles = [];
  try {
    for (const addition of changes.additions) {
      const generatedRoot = await mkdtemp(join(tmpdir(), "plvs-community-curation-"));
      const generatedOutput = join(generatedRoot, "previews");
      try {
        await generatePreviews({
          artifactPath: resolve(candidate.root, addition.release.artifact),
          outputDirectory: generatedOutput,
        });
        for (const preview of addition.release.previews) {
          const target = previewTargets.find(
            (entry) => entry.addition === addition && entry.preview.id === preview.id
          ).target;
          await mkdir(dirname(target), { recursive: true });
          await copyFile(
            join(generatedOutput, `${preview.id}.png`),
            target,
            constants.COPYFILE_EXCL
          );
          generatedFiles.push(target);
        }
      } finally {
        await rm(generatedRoot, { recursive: true, force: true });
      }
    }
    await validateCommunitySourceUpdate(published.root, candidate.root);
    await buildCommunitySite({
      contentDirectory: candidate.root,
      outputDirectory: join(staging, "site"),
    });
    const report = publicReport("write", published, candidate, changes, output);
    await writeFile(join(staging, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
    await writeFile(join(staging, "report.md"), markdownReport(report));
    await rename(staging, output);
    return report;
  } catch (error) {
    await Promise.all(generatedFiles.map((path) => rm(path, { force: true })));
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

async function main(args) {
  const write = args[0] === "--write";
  const values = write ? args.slice(1) : args;
  if (values.length !== 3) {
    throw new Error(
      "Usage: npm run community:curate -- [--write] <published-directory> <candidate-directory> <new-review-output-directory>"
    );
  }
  const report = await curateCommunityCatalogue({
    publishedDirectory: values[0],
    candidateDirectory: values[1],
    outputDirectory: values[2],
    write,
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(
      `${JSON.stringify(
        {
          valid: false,
          code: error?.code ?? "communityCurationFailed",
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
