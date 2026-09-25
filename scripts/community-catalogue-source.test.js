import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildPack } from "../src/transfer/packShape.js";
import {
  CommunitySourceError,
  readCommunitySource,
  validateCommunitySourceManifest,
} from "./community-catalogue-source.mjs";
import { validateCommunitySourceDirectory } from "./validate-community-source.mjs";

const temporaryDirectories = [];
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);
const PROFILE = {
  id: "broadcast",
  name: "Broadcast",
  referenceLufs: -23,
  rules: [{ metricId: "truePeak", op: ">", value: -1, severity: "fail" }],
};

function artifact() {
  return `${JSON.stringify(buildPack("loudness", [PROFILE]), null, 2)}\n`;
}

function previewRecords(prefix = "previews/example") {
  return [
    { id: "profile-summary", path: `${prefix}/profile-summary.png` },
    { id: "profile-stats-example", path: `${prefix}/profile-stats-example.png` },
  ];
}

function writePreviews(directory, records = previewRecords()) {
  for (const preview of records) {
    mkdirSync(join(directory, preview.path, ".."), { recursive: true });
    writeFileSync(join(directory, preview.path), PNG);
  }
}

function temporarySource() {
  const directory = mkdtempSync(join(tmpdir(), "plvs-community-source-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("Community Catalogue source boundary", () => {
  it("accepts the empty manifest used before the first curated Listing", async () => {
    const directory = temporarySource();
    writeFileSync(join(directory, "manifest.json"), '{"schemaVersion":1,"listings":[]}');

    await expect(validateCommunitySourceDirectory(directory)).resolves.toMatchObject({
      valid: true,
      schemaVersion: 1,
      listingCount: 0,
      listingPaths: [],
    });
  });

  it("loads the same normalized source from an arbitrary external directory", async () => {
    const directory = temporarySource();
    mkdirSync(join(directory, "listings"));
    mkdirSync(join(directory, "artifacts"));
    writeFileSync(
      join(directory, "manifest.json"),
      JSON.stringify({ schemaVersion: 1, listings: ["listings/example.json"] })
    );
    writeFileSync(
      join(directory, "listings", "example.json"),
      JSON.stringify({
        schemaVersion: 1,
        id: "example",
        slug: "example",
        type: "loudness",
        classification: "official",
        title: "Example",
        summary: "An example Theme.",
        descriptionMarkdown: "A fixture Listing.",
        tags: [],
        author: null,
        releases: [
          {
            number: 1,
            publishedAt: "2026-09-25",
            status: "published",
            notesMarkdown: "Initial release.",
            artifact: "artifacts/example.plvsloudness",
            previews: previewRecords(),
          },
        ],
      })
    );
    writeFileSync(join(directory, "artifacts", "example.plvsloudness"), artifact());
    writePreviews(directory);

    await expect(readCommunitySource(directory)).resolves.toMatchObject({
      manifest: { schemaVersion: 1, listings: ["listings/example.json"] },
      listings: [
        {
          sourcePath: "listings/example.json",
          document: expect.objectContaining({
            id: "example",
            type: "loudness",
            releases: [
              expect.objectContaining({
                metadata: expect.objectContaining({
                  content: expect.objectContaining({ type: "loudness", itemId: "broadcast" }),
                }),
                previews: [
                  expect.objectContaining({
                    id: "profile-summary",
                    mediaType: "image/png",
                    sha256: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
                  }),
                  expect.objectContaining({ id: "profile-stats-example" }),
                ],
              }),
            ],
          }),
        },
      ],
    });
  });

  it("requires the exact generated preview set and valid PNG bytes", async () => {
    const directory = temporarySource();
    writeFileSync(
      join(directory, "manifest.json"),
      JSON.stringify({ schemaVersion: 1, listings: ["listing.json"] })
    );
    const listing = {
      schemaVersion: 1,
      id: "example",
      slug: "example",
      type: "loudness",
      classification: "community",
      title: "Example",
      summary: "An example.",
      descriptionMarkdown: "Fixture.",
      tags: [],
      author: null,
      releases: [
        {
          number: 1,
          publishedAt: "2026-09-25",
          status: "published",
          notesMarkdown: "Initial.",
          artifact: "example.plvsloudness",
          previews: [{ id: "profile-summary", path: "summary.png" }],
        },
      ],
    };
    writeFileSync(join(directory, "listing.json"), JSON.stringify(listing));
    writeFileSync(join(directory, "example.plvsloudness"), artifact());
    writeFileSync(join(directory, "summary.png"), PNG);
    await expect(readCommunitySource(directory)).rejects.toMatchObject({
      issues: [expect.objectContaining({ code: "previewSetMismatch" })],
    });

    listing.releases[0].previews = previewRecords();
    writeFileSync(join(directory, "listing.json"), JSON.stringify(listing));
    writePreviews(directory);
    writeFileSync(join(directory, listing.releases[0].previews[0].path), "not a png");
    await expect(readCommunitySource(directory)).rejects.toMatchObject({
      issues: [expect.objectContaining({ code: "invalidPreviewPng" })],
    });
  });

  it("rejects missing, invalid, and type-mismatched Release artifacts", async () => {
    const directory = temporarySource();
    writeFileSync(
      join(directory, "manifest.json"),
      JSON.stringify({ schemaVersion: 1, listings: ["listing.json"] })
    );
    const listing = {
      schemaVersion: 1,
      id: "example",
      slug: "example",
      type: "loudness",
      classification: "community",
      title: "Example",
      summary: "An example.",
      descriptionMarkdown: "Fixture.",
      tags: [],
      author: null,
      releases: [
        {
          number: 1,
          publishedAt: "2026-09-25",
          status: "published",
          notesMarkdown: "Initial.",
          artifact: "missing.plvsloudness",
          previews: [],
        },
      ],
    };
    writeFileSync(join(directory, "listing.json"), JSON.stringify(listing));

    await expect(readCommunitySource(directory)).rejects.toMatchObject({
      issues: [expect.objectContaining({ code: "missingArtifact" })],
    });

    listing.releases[0].artifact = "invalid.plvsloudness";
    writeFileSync(join(directory, "listing.json"), JSON.stringify(listing));
    writeFileSync(join(directory, "invalid.plvsloudness"), "not json\n");
    await expect(readCommunitySource(directory)).rejects.toMatchObject({
      issues: expect.arrayContaining([
        expect.objectContaining({ path: expect.stringContaining(".artifact") }),
      ]),
    });

    listing.type = "themes";
    listing.releases[0].artifact = "wrong.plvstheme";
    writeFileSync(join(directory, "listing.json"), JSON.stringify(listing));
    writeFileSync(join(directory, "wrong.plvstheme"), artifact());
    await expect(readCommunitySource(directory)).rejects.toMatchObject({
      issues: [expect.objectContaining({ code: "artifactTypeMismatch" })],
    });
  });

  it("rejects duplicate Listing identities and reused artifact paths", async () => {
    const directory = temporarySource();
    writeFileSync(
      join(directory, "manifest.json"),
      JSON.stringify({ schemaVersion: 1, listings: ["one.json", "two.json"] })
    );
    const listing = (id, slug, artifactPath) => ({
      schemaVersion: 1,
      id,
      slug,
      type: "loudness",
      classification: "community",
      title: id,
      summary: "An example.",
      descriptionMarkdown: "Fixture.",
      tags: [],
      author: null,
      releases: [
        {
          number: 1,
          publishedAt: "2026-09-25",
          status: "published",
          notesMarkdown: "Initial.",
          artifact: artifactPath,
          previews: previewRecords(`${id}-previews`),
        },
      ],
    });
    writeFileSync(join(directory, "shared.plvsloudness"), artifact());
    writePreviews(directory, previewRecords("same-previews"));
    writeFileSync(
      join(directory, "one.json"),
      JSON.stringify(listing("same", "one", "shared.plvsloudness"))
    );
    writeFileSync(
      join(directory, "two.json"),
      JSON.stringify(listing("same", "two", "other.plvsloudness"))
    );
    await expect(readCommunitySource(directory)).rejects.toMatchObject({
      issues: [expect.objectContaining({ code: "duplicateListingId" })],
    });

    writeFileSync(
      join(directory, "two.json"),
      JSON.stringify(listing("other", "two", "SHARED.plvsloudness"))
    );
    await expect(readCommunitySource(directory)).rejects.toMatchObject({
      issues: [expect.objectContaining({ code: "duplicateArtifactPath" })],
    });
  });

  it("rejects traversal, absolute, duplicate, and non-JSON Listing paths", () => {
    expect(() =>
      validateCommunitySourceManifest({
        schemaVersion: 1,
        listings: ["../outside.json", "C:/absolute.json", "listing.txt", "same.json", "same.json"],
      })
    ).toThrowError(
      expect.objectContaining({
        issues: expect.arrayContaining([
          expect.objectContaining({ code: "invalidListingPath" }),
          expect.objectContaining({ code: "duplicateListingPath" }),
        ]),
      })
    );
  });

  it("reports missing and invalid referenced files with stable issue codes", async () => {
    const missing = temporarySource();
    writeFileSync(
      join(missing, "manifest.json"),
      JSON.stringify({ schemaVersion: 1, listings: ["missing.json"] })
    );
    await expect(readCommunitySource(missing)).rejects.toThrow(CommunitySourceError);
    try {
      await readCommunitySource(missing);
    } catch (error) {
      expect(error.issues[0].code).toBe("missingSourceFile");
    }

    const invalid = temporarySource();
    writeFileSync(
      join(invalid, "manifest.json"),
      JSON.stringify({ schemaVersion: 1, listings: ["invalid.json"] })
    );
    writeFileSync(join(invalid, "invalid.json"), "not json");
    try {
      await readCommunitySource(invalid);
    } catch (error) {
      expect(error.issues[0].code).toBe("invalidSourceJson");
    }
  });
});
