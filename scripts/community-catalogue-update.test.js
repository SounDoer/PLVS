import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildPack } from "../src/transfer/packShape.js";
import { validateCommunitySourceUpdate } from "./community-catalogue-update.mjs";

const temporaryDirectories = [];
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), "plvs-community-update-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function release(number, { status = "published", withdrawalReason, referenceLufs = -23 } = {}) {
  return {
    record: {
      number,
      publishedAt: `2026-09-${24 + number}`,
      status,
      notesMarkdown: `Release ${number}.`,
      artifact: `artifacts/broadcast-v${number}.plvsloudness`,
      previews: [
        { id: "profile-summary", path: `previews/v${number}/profile-summary.png` },
        { id: "profile-stats-example", path: `previews/v${number}/profile-stats-example.png` },
      ],
      ...(withdrawalReason ? { withdrawalReason } : {}),
    },
    referenceLufs,
  };
}

function writeSource(
  directory,
  {
    title = "Broadcast",
    slug = "broadcast",
    classification = "official",
    releases = [release(1)],
    empty = false,
  } = {}
) {
  mkdirSync(join(directory, "listings"), { recursive: true });
  mkdirSync(join(directory, "artifacts"), { recursive: true });
  mkdirSync(join(directory, "previews"), { recursive: true });
  writeFileSync(
    join(directory, "manifest.json"),
    JSON.stringify({ schemaVersion: 1, listings: empty ? [] : ["listings/broadcast.json"] })
  );
  if (empty) return;
  writeFileSync(
    join(directory, "listings", "broadcast.json"),
    JSON.stringify({
      schemaVersion: 1,
      id: "broadcast",
      slug,
      type: "loudness",
      classification,
      title,
      summary: "A broadcast profile.",
      descriptionMarkdown: "Maintainer-curated content.",
      tags: ["Broadcast"],
      author: null,
      releases: releases.map(({ record }) => record),
    })
  );
  for (const { record, referenceLufs } of releases) {
    const pack = buildPack("loudness", [
      {
        id: "broadcast",
        name: "Broadcast",
        referenceLufs,
        rules: [{ metricId: "truePeak", op: ">", value: -1, severity: "fail" }],
      },
    ]);
    writeFileSync(join(directory, record.artifact), `${JSON.stringify(pack, null, 2)}\n`);
    for (const preview of record.previews) {
      mkdirSync(join(directory, preview.path, ".."), { recursive: true });
      writeFileSync(join(directory, preview.path), PNG);
    }
  }
}

describe("Community Catalogue update policy", () => {
  it("allows Listing copy edits and an appended published Release", async () => {
    const previous = temporaryDirectory();
    const candidate = temporaryDirectory();
    writeSource(previous);
    writeSource(candidate, {
      title: "Broadcast Delivery",
      releases: [release(1), release(2, { referenceLufs: -24 })],
    });

    await expect(validateCommunitySourceUpdate(previous, candidate)).resolves.toEqual({
      valid: true,
      previousListingCount: 1,
      candidateListingCount: 1,
    });
  });

  it("allows a one-way withdrawal while preserving the exact Release", async () => {
    const previous = temporaryDirectory();
    const candidate = temporaryDirectory();
    writeSource(previous);
    writeSource(candidate, {
      releases: [release(1, { status: "withdrawn", withdrawalReason: "Superseded guidance." })],
    });

    await expect(validateCommunitySourceUpdate(previous, candidate)).resolves.toMatchObject({
      valid: true,
    });
  });

  it("rejects Listing or Release deletion and stable identity changes", async () => {
    const previous = temporaryDirectory();
    const removed = temporaryDirectory();
    const renamed = temporaryDirectory();
    writeSource(previous);
    writeSource(removed, { empty: true });
    writeSource(renamed, { slug: "renamed", classification: "community" });

    await expect(validateCommunitySourceUpdate(previous, removed)).rejects.toMatchObject({
      issues: [expect.objectContaining({ code: "listingRemoved" })],
    });
    await expect(validateCommunitySourceUpdate(previous, renamed)).rejects.toMatchObject({
      issues: expect.arrayContaining([expect.objectContaining({ code: "listingIdentityChanged" })]),
    });
  });

  it("rejects replacement bytes, Release copy edits, insertion, and restoration", async () => {
    const previous = temporaryDirectory();
    const replaced = temporaryDirectory();
    const previousWithGap = temporaryDirectory();
    const inserted = temporaryDirectory();
    const withdrawn = temporaryDirectory();
    const restored = temporaryDirectory();
    writeSource(previous);
    writeSource(replaced, { releases: [release(1, { referenceLufs: -24 })] });
    writeSource(previousWithGap, { releases: [release(1), release(3)] });
    writeSource(inserted, { releases: [release(1), release(2), release(3)] });
    writeSource(withdrawn, {
      releases: [release(1, { status: "withdrawn", withdrawalReason: "Withdrawn." })],
    });
    writeSource(restored);

    await expect(validateCommunitySourceUpdate(previous, replaced)).rejects.toMatchObject({
      issues: [expect.objectContaining({ code: "releaseHistoryChanged" })],
    });
    await expect(validateCommunitySourceUpdate(previousWithGap, inserted)).rejects.toMatchObject({
      issues: [expect.objectContaining({ code: "releaseInserted" })],
    });
    await expect(validateCommunitySourceUpdate(withdrawn, restored)).rejects.toMatchObject({
      issues: [expect.objectContaining({ code: "withdrawalChanged" })],
    });
  });
});
