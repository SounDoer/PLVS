import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildPack } from "../src/transfer/packShape.js";
import {
  SharesetsSourceError,
  readSharesetsSource,
  validateSharesetsSourceManifest,
} from "./sharesets-catalogue-source.mjs";
import { validateSharesetsSourceDirectory } from "./validate-sharesets-source.mjs";

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
const THEME_PREVIEW_IDS = [
  "product-workspace-file",
  "product-multichannel-monitoring",
  "product-workspace-snapshot",
  "semantic-overview",
];

function artifact() {
  return `${JSON.stringify(buildPack("loudness", [PROFILE]), null, 2)}\n`;
}

function previewRecords() {
  return [];
}

function writePreviews(directory, records = previewRecords()) {
  for (const preview of records) {
    mkdirSync(join(directory, preview.path, ".."), { recursive: true });
    writeFileSync(join(directory, preview.path), PNG);
  }
}

function temporarySource() {
  const directory = mkdtempSync(join(tmpdir(), "plvs-sharesets-source-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("Sharesets Catalogue source boundary", () => {
  it("accepts the empty manifest used before the first curated Listing", async () => {
    const directory = temporarySource();
    writeFileSync(join(directory, "manifest.json"), '{"schemaVersion":1,"listings":[]}');

    await expect(validateSharesetsSourceDirectory(directory)).resolves.toMatchObject({
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

    await expect(readSharesetsSource(directory)).resolves.toMatchObject({
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
                previews: [],
              }),
            ],
          }),
        },
      ],
    });
  });

  it("resolves content included with PLVS directly from the built-in Theme registry", async () => {
    const directory = temporarySource();
    const previews = THEME_PREVIEW_IDS.map((id) => ({
      id,
      path: `previews/plvs-dark/${id}.png`,
    }));
    writeFileSync(
      join(directory, "manifest.json"),
      JSON.stringify({ schemaVersion: 1, listings: ["plvs-dark.json"] })
    );
    writeFileSync(
      join(directory, "plvs-dark.json"),
      JSON.stringify({
        schemaVersion: 1,
        id: "plvs-dark",
        slug: "plvs-dark",
        type: "themes",
        classification: "official",
        title: "PLVS Dark",
        summary: "The built-in dark Theme.",
        descriptionMarkdown: "Included with PLVS.",
        tags: ["Dark", "Built-in"],
        author: { name: "PLVS", url: "https://github.com/SounDoer/PLVS" },
        included: { sourceId: "plvs-dark", previews },
      })
    );
    writePreviews(directory, previews);

    await expect(readSharesetsSource(directory)).resolves.toMatchObject({
      listings: [
        {
          document: {
            included: {
              sourceId: "plvs-dark",
              metadata: {
                content: {
                  type: "themes",
                  itemId: "plvs-dark",
                  summary: { colorScheme: "dark" },
                },
              },
            },
            releases: [],
          },
        },
      ],
    });

    writeFileSync(join(directory, previews[0].path), "not a png");
    await expect(readSharesetsSource(directory)).rejects.toMatchObject({
      issues: [expect.objectContaining({ code: "invalidPreviewPng" })],
    });
  });

  it("resolves the built-in PLVS Default Loudness Profile from the product source", async () => {
    const directory = temporarySource();
    writeFileSync(
      join(directory, "manifest.json"),
      JSON.stringify({ schemaVersion: 1, listings: ["default.json"] })
    );
    writeFileSync(
      join(directory, "default.json"),
      JSON.stringify({
        schemaVersion: 1,
        id: "default-loudness-profile",
        slug: "default",
        type: "loudness",
        classification: "official",
        title: "PLVS Default",
        summary: "The built-in default profile.",
        descriptionMarkdown: "Included with PLVS.",
        tags: ["Built-in"],
        author: { name: "PLVS", url: "https://github.com/SounDoer/PLVS" },
        included: { sourceId: "default", previews: [] },
      })
    );

    await expect(readSharesetsSource(directory)).resolves.toMatchObject({
      listings: [
        {
          document: {
            included: {
              sourceId: "default",
              item: {
                id: "default",
                name: "PLVS Default",
                referenceLufs: -23,
                rules: [
                  { metricId: "momentary", op: ">", value: -6, severity: "warn" },
                  { metricId: "shortTerm", op: ">", value: -12, severity: "warn" },
                  { metricId: "integrated", op: ">", value: -16, severity: "warn" },
                  { metricId: "integrated", op: "<", value: -30, severity: "warn" },
                  { metricId: "lra", op: ">", value: 18, severity: "warn" },
                  { metricId: "truePeak", op: ">", value: -1, severity: "fail" },
                ],
              },
              previews: [],
              metadata: {
                content: {
                  type: "loudness",
                  itemId: "default",
                  summary: { referenceLufs: -23, ruleCount: 6 },
                },
              },
            },
            releases: [],
          },
        },
      ],
    });
  });

  it("resolves the built-in Default Preset from the product source", async () => {
    const directory = temporarySource();
    const previews = [{ id: "preset-workspace", path: "previews/default/preset-workspace.png" }];
    writeFileSync(
      join(directory, "manifest.json"),
      JSON.stringify({ schemaVersion: 1, listings: ["default-preset.json"] })
    );
    writeFileSync(
      join(directory, "default-preset.json"),
      JSON.stringify({
        schemaVersion: 1,
        id: "default-preset",
        slug: "default-preset",
        type: "presets",
        classification: "official",
        title: "Default",
        summary: "The built-in default Preset.",
        descriptionMarkdown: "Included with PLVS.",
        tags: ["Built-in"],
        author: { name: "PLVS", url: "https://github.com/SounDoer/PLVS" },
        included: { sourceId: "default", previews },
      })
    );
    writePreviews(directory, previews);

    await expect(readSharesetsSource(directory)).resolves.toMatchObject({
      listings: [
        {
          document: {
            included: {
              sourceId: "default",
              item: {
                id: "default",
                name: "Default",
                loudnessProfile: { dependencyId: "default" },
              },
              metadata: {
                content: {
                  type: "presets",
                  itemId: "default",
                  summary: { workspacePanelCount: 8, dockEnabled: false, dockPanelCount: 0 },
                },
                compatibility: { dependencyIds: ["default"] },
              },
            },
            releases: [],
          },
        },
      ],
    });
  });

  it("rejects an included source that is not built into PLVS", async () => {
    const directory = temporarySource();
    writeFileSync(
      join(directory, "manifest.json"),
      JSON.stringify({ schemaVersion: 1, listings: ["unknown.json"] })
    );
    writeFileSync(
      join(directory, "unknown.json"),
      JSON.stringify({
        schemaVersion: 1,
        id: "unknown",
        slug: "unknown",
        type: "themes",
        classification: "official",
        title: "Unknown",
        summary: "An unknown built-in Theme.",
        descriptionMarkdown: "Fixture.",
        tags: [],
        author: null,
        included: { sourceId: "unknown", previews: [] },
      })
    );

    await expect(readSharesetsSource(directory)).rejects.toMatchObject({
      issues: [expect.objectContaining({ code: "unknownIncludedSource" })],
    });
  });

  it("requires the exact generated preview set", async () => {
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
      classification: "sharesets",
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
          previews: [{ id: "unexpected", path: "unexpected.png" }],
        },
      ],
    };
    writeFileSync(join(directory, "listing.json"), JSON.stringify(listing));
    writeFileSync(join(directory, "example.plvsloudness"), artifact());
    writeFileSync(join(directory, "unexpected.png"), PNG);
    await expect(readSharesetsSource(directory)).rejects.toMatchObject({
      issues: [expect.objectContaining({ code: "previewSetMismatch" })],
    });

    listing.releases[0].previews = [];
    writeFileSync(join(directory, "listing.json"), JSON.stringify(listing));
    await expect(readSharesetsSource(directory)).resolves.toMatchObject({
      listings: [{ document: { releases: [{ previews: [] }] } }],
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
      classification: "sharesets",
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

    await expect(readSharesetsSource(directory)).rejects.toMatchObject({
      issues: [expect.objectContaining({ code: "missingArtifact" })],
    });

    listing.releases[0].artifact = "invalid.plvsloudness";
    writeFileSync(join(directory, "listing.json"), JSON.stringify(listing));
    writeFileSync(join(directory, "invalid.plvsloudness"), "not json\n");
    await expect(readSharesetsSource(directory)).rejects.toMatchObject({
      issues: expect.arrayContaining([
        expect.objectContaining({ path: expect.stringContaining(".artifact") }),
      ]),
    });

    listing.type = "themes";
    listing.releases[0].artifact = "wrong.plvstheme";
    writeFileSync(join(directory, "listing.json"), JSON.stringify(listing));
    writeFileSync(join(directory, "wrong.plvstheme"), artifact());
    await expect(readSharesetsSource(directory)).rejects.toMatchObject({
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
      classification: "sharesets",
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
    await expect(readSharesetsSource(directory)).rejects.toMatchObject({
      issues: [expect.objectContaining({ code: "duplicateListingId" })],
    });

    writeFileSync(
      join(directory, "two.json"),
      JSON.stringify(listing("other", "two", "SHARED.plvsloudness"))
    );
    await expect(readSharesetsSource(directory)).rejects.toMatchObject({
      issues: [expect.objectContaining({ code: "duplicateArtifactPath" })],
    });
  });

  it("rejects traversal, absolute, duplicate, and non-JSON Listing paths", () => {
    expect(() =>
      validateSharesetsSourceManifest({
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
    await expect(readSharesetsSource(missing)).rejects.toThrow(SharesetsSourceError);
    try {
      await readSharesetsSource(missing);
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
      await readSharesetsSource(invalid);
    } catch (error) {
      expect(error.issues[0].code).toBe("invalidSourceJson");
    }
  });
});
