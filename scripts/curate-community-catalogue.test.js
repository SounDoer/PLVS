import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildPack } from "../src/transfer/packShape.js";
import { curateCommunityCatalogue } from "./curate-community-catalogue.mjs";

const temporaryDirectories = [];
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

function temporaryDirectory(label) {
  const directory = mkdtempSync(join(tmpdir(), label));
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
  { title = "Broadcast", releases = [release(1)], omitNewPreviews = false } = {}
) {
  mkdirSync(join(directory, "listings"), { recursive: true });
  mkdirSync(join(directory, "artifacts"), { recursive: true });
  writeFileSync(
    join(directory, "manifest.json"),
    JSON.stringify({ schemaVersion: 1, listings: ["listings/broadcast.json"] })
  );
  writeFileSync(
    join(directory, "listings", "broadcast.json"),
    JSON.stringify({
      schemaVersion: 1,
      id: "broadcast",
      slug: "broadcast",
      type: "loudness",
      classification: "official",
      title,
      summary: "A broadcast profile.",
      descriptionMarkdown: "Maintainer-curated content.",
      tags: ["Broadcast"],
      author: null,
      releases: releases.map(({ record }) => record),
    })
  );
  for (const [index, { record, referenceLufs }] of releases.entries()) {
    const pack = buildPack("loudness", [
      {
        id: `broadcast-${record.number}`,
        name: "Broadcast",
        referenceLufs,
        rules: [{ metricId: "truePeak", op: ">", value: -1, severity: "fail" }],
      },
    ]);
    writeFileSync(join(directory, record.artifact), `${JSON.stringify(pack, null, 2)}\n`);
    if (omitNewPreviews && index === releases.length - 1 && releases.length > 1) continue;
    for (const preview of record.previews) {
      mkdirSync(join(directory, preview.path, ".."), { recursive: true });
      writeFileSync(join(directory, preview.path), PNG);
    }
  }
}

async function fakeGenerate({ outputDirectory }) {
  mkdirSync(outputDirectory);
  writeFileSync(join(outputDirectory, "profile-summary.png"), PNG);
  writeFileSync(join(outputDirectory, "profile-stats-example.png"), PNG);
  writeFileSync(join(outputDirectory, "preview-result.json"), "{}\n");
}

describe("Community curator workflow", () => {
  it("plans additions and copy edits without writing during the default dry run", async () => {
    const published = temporaryDirectory("plvs-curate-published-");
    const candidate = temporaryDirectory("plvs-curate-candidate-");
    const outputParent = temporaryDirectory("plvs-curate-output-");
    const output = join(outputParent, "review");
    writeSource(published);
    writeSource(candidate, {
      title: "Broadcast Delivery",
      releases: [release(1), release(2, { referenceLufs: -24 })],
      omitNewPreviews: true,
    });

    const report = await curateCommunityCatalogue({
      publishedDirectory: published,
      candidateDirectory: candidate,
      outputDirectory: output,
    });

    expect(report).toMatchObject({
      mode: "dry-run",
      additions: [{ listingId: "broadcast", releaseNumber: 2 }],
      copyChanges: [{ listingId: "broadcast", fields: ["title"] }],
    });
    expect(existsSync(join(candidate, "previews", "v2", "profile-summary.png"))).toBe(false);
    expect(existsSync(output)).toBe(false);
  });

  it("generates only new Release previews and creates a review site plus reports", async () => {
    const published = temporaryDirectory("plvs-curate-published-");
    const candidate = temporaryDirectory("plvs-curate-candidate-");
    const outputParent = temporaryDirectory("plvs-curate-output-");
    const output = join(outputParent, "review");
    writeSource(published);
    writeSource(candidate, {
      releases: [release(1), release(2, { referenceLufs: -24 })],
      omitNewPreviews: true,
    });
    const generatePreviews = vi.fn(fakeGenerate);

    await expect(
      curateCommunityCatalogue({
        publishedDirectory: published,
        candidateDirectory: candidate,
        outputDirectory: output,
        write: true,
        generatePreviews,
      })
    ).resolves.toMatchObject({ mode: "write", additions: [{ releaseNumber: 2 }] });

    expect(generatePreviews).toHaveBeenCalledTimes(1);
    expect(readFileSync(join(candidate, "previews", "v1", "profile-summary.png"))).toEqual(PNG);
    expect(readFileSync(join(candidate, "previews", "v2", "profile-summary.png"))).toEqual(PNG);
    expect(readFileSync(join(output, "site", "index.html"), "utf8")).toContain("Broadcast");
    expect(JSON.parse(readFileSync(join(output, "report.json"), "utf8"))).toMatchObject({
      additions: [{ listingId: "broadcast", releaseNumber: 2 }],
    });
    expect(readFileSync(join(output, "report.md"), "utf8")).toContain("broadcast Release 2");
  });

  it("refuses old Release mutation before invoking the renderer", async () => {
    const published = temporaryDirectory("plvs-curate-published-");
    const candidate = temporaryDirectory("plvs-curate-candidate-");
    const outputParent = temporaryDirectory("plvs-curate-output-");
    writeSource(published);
    writeSource(candidate, { releases: [release(1, { referenceLufs: -24 })] });
    const generatePreviews = vi.fn(fakeGenerate);

    await expect(
      curateCommunityCatalogue({
        publishedDirectory: published,
        candidateDirectory: candidate,
        outputDirectory: join(outputParent, "review"),
        write: true,
        generatePreviews,
      })
    ).rejects.toMatchObject({
      issues: [expect.objectContaining({ code: "releaseHistoryChanged" })],
    });
    expect(generatePreviews).not.toHaveBeenCalled();
  });

  it("removes newly copied previews when final sealing fails", async () => {
    const published = temporaryDirectory("plvs-curate-published-");
    const candidate = temporaryDirectory("plvs-curate-candidate-");
    const outputParent = temporaryDirectory("plvs-curate-output-");
    const output = join(outputParent, "review");
    writeSource(published);
    writeSource(candidate, {
      releases: [release(1), release(2, { referenceLufs: -24 })],
      omitNewPreviews: true,
    });
    const generateInvalidPreviews = async ({ outputDirectory }) => {
      mkdirSync(outputDirectory);
      writeFileSync(join(outputDirectory, "profile-summary.png"), "not a png");
      writeFileSync(join(outputDirectory, "profile-stats-example.png"), "not a png");
    };

    await expect(
      curateCommunityCatalogue({
        publishedDirectory: published,
        candidateDirectory: candidate,
        outputDirectory: output,
        write: true,
        generatePreviews: generateInvalidPreviews,
      })
    ).rejects.toMatchObject({ code: "invalidCommunitySource" });

    expect(existsSync(join(candidate, "previews", "v2", "profile-summary.png"))).toBe(false);
    expect(existsSync(join(candidate, "previews", "v2", "profile-stats-example.png"))).toBe(false);
    expect(existsSync(output)).toBe(false);
  });

  it("reports a one-way withdrawal without regenerating previews", async () => {
    const published = temporaryDirectory("plvs-curate-published-");
    const candidate = temporaryDirectory("plvs-curate-candidate-");
    const outputParent = temporaryDirectory("plvs-curate-output-");
    writeSource(published);
    writeSource(candidate, {
      releases: [release(1, { status: "withdrawn", withdrawalReason: "Incorrect guidance." })],
    });
    const generatePreviews = vi.fn(fakeGenerate);

    const report = await curateCommunityCatalogue({
      publishedDirectory: published,
      candidateDirectory: candidate,
      outputDirectory: join(outputParent, "review"),
      write: true,
      generatePreviews,
    });

    expect(report.withdrawals).toEqual([
      { listingId: "broadcast", releaseNumber: 1, reason: "Incorrect guidance." },
    ]);
    expect(generatePreviews).not.toHaveBeenCalled();
  });
});
