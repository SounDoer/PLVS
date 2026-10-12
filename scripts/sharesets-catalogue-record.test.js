import { describe, expect, it } from "vitest";
import { validateSharesetsListingRecord } from "./sharesets-catalogue-record.mjs";

function listing(overrides = {}) {
  return {
    schemaVersion: 1,
    id: "broadcast-profile",
    slug: "broadcast-profile",
    type: "loudness",
    classification: "sharesets",
    title: "Broadcast Profile",
    summary: "A compact profile for broadcast checks.",
    descriptionMarkdown: "Designed for a **clear** reference. [Details](https://example.com).",
    references: [
      {
        publisher: "Example Standards Body",
        title: "Example Loudness Recommendation",
        edition: "Version 2.0 (2026)",
        url: "https://example.com/loudness",
        relevanceMarkdown: "Defines the target used by the Integrated rules.",
      },
    ],
    tags: ["Broadcast", "Loudness"],
    author: { name: "Example Author", url: "https://example.com" },
    releases: [
      {
        number: 1,
        publishedAt: "2026-09-25",
        status: "published",
        notesMarkdown: "Initial release.",
        artifact: "artifacts/broadcast-v1.plvsloudness",
        previews: [{ id: "profile-summary", path: "previews/broadcast-v1/profile-summary.png" }],
      },
    ],
    ...overrides,
  };
}

describe("Sharesets Listing and Release records", () => {
  it("normalizes the curated record without introducing per-Item licence metadata", () => {
    const result = validateSharesetsListingRecord(listing());
    expect(result).toMatchObject({
      id: "broadcast-profile",
      slug: "broadcast-profile",
      classification: "sharesets",
      author: { name: "Example Author", url: "https://example.com" },
      references: [
        expect.objectContaining({
          publisher: "Example Standards Body",
          edition: "Version 2.0 (2026)",
        }),
      ],
      releases: [{ number: 1, status: "published", withdrawalReason: null }],
    });
    expect(result).not.toHaveProperty("license");
    expect(result.releases[0]).not.toHaveProperty("license");
  });

  it("accepts a withdrawn immutable Release only with an explicit reason", () => {
    const raw = listing();
    raw.releases[0].status = "withdrawn";
    raw.releases[0].withdrawalReason = "The artifact contains an incorrect rule.";
    expect(validateSharesetsListingRecord(raw).releases[0]).toMatchObject({
      status: "withdrawn",
      withdrawalReason: "The artifact contains an incorrect rule.",
    });
  });

  it("accepts official content included with PLVS without inventing a downloadable Release", () => {
    const raw = listing({
      type: "themes",
      classification: "official",
      included: {
        sourceId: "plvs-dark",
        previews: [{ id: "semantic-overview", path: "previews/plvs-dark/semantic-overview.png" }],
      },
    });
    delete raw.releases;

    expect(validateSharesetsListingRecord(raw)).toMatchObject({
      included: { sourceId: "plvs-dark" },
      releases: [],
    });
  });

  it("rejects releases and sharesets classification on content included with PLVS", () => {
    expect(() =>
      validateSharesetsListingRecord(listing({ included: { sourceId: "plvs-dark", previews: [] } }))
    ).toThrowError(
      expect.objectContaining({
        issues: expect.arrayContaining([
          expect.objectContaining({ code: "includedSourceMustBeOfficial" }),
          expect.objectContaining({ code: "includedSourceHasReleases" }),
        ]),
      })
    );
  });

  it("rejects raw HTML and non-HTTPS Markdown links", () => {
    expect(() =>
      validateSharesetsListingRecord(
        listing({
          descriptionMarkdown: '<script src="https://example.com/x.js"></script>',
        })
      )
    ).toThrowError(
      expect.objectContaining({
        issues: expect.arrayContaining([expect.objectContaining({ code: "rawHtmlNotAllowed" })]),
      })
    );
    expect(() =>
      validateSharesetsListingRecord(listing({ descriptionMarkdown: "[bad](javascript:alert(1))" }))
    ).toThrowError(
      expect.objectContaining({
        issues: expect.arrayContaining([expect.objectContaining({ code: "unsafeMarkdownLink" })]),
      })
    );
  });

  it("rejects duplicate normalized tags and unsafe author URLs", () => {
    expect(() =>
      validateSharesetsListingRecord(
        listing({
          tags: ["Loudness", " loudness "],
          author: { name: "Example", url: "javascript:alert(1)" },
        })
      )
    ).toThrowError(
      expect.objectContaining({
        issues: expect.arrayContaining([
          expect.objectContaining({ code: "duplicateTag" }),
          expect.objectContaining({ code: "invalidAuthorUrl" }),
        ]),
      })
    );
  });

  it("rejects unsafe, duplicate, or unstructured references", () => {
    expect(() =>
      validateSharesetsListingRecord(
        listing({
          references: [
            {
              publisher: "Example",
              title: "First",
              url: "http://example.com/reference",
              relevanceMarkdown: "Relevant.",
            },
            {
              publisher: "Example",
              title: "Second",
              url: "https://example.com/reference",
              relevanceMarkdown: "<strong>Raw HTML</strong>",
            },
            {
              publisher: "Example",
              title: "Duplicate",
              url: "https://example.com/reference",
              relevanceMarkdown: "Relevant.",
            },
          ],
        })
      )
    ).toThrowError(
      expect.objectContaining({
        issues: expect.arrayContaining([
          expect.objectContaining({ code: "invalidReferenceUrl" }),
          expect.objectContaining({ code: "rawHtmlNotAllowed" }),
          expect.objectContaining({ code: "duplicateReferenceUrl" }),
        ]),
      })
    );
  });

  it("rejects mismatched artifact extensions, unsafe preview paths, and release-order drift", () => {
    const raw = listing();
    raw.releases = [
      { ...raw.releases[0], number: 2, artifact: "artifacts/wrong.plvstheme" },
      {
        ...raw.releases[0],
        number: 1,
        previews: [{ id: "profile-summary", path: "../outside.png" }],
      },
    ];
    expect(() => validateSharesetsListingRecord(raw)).toThrowError(
      expect.objectContaining({
        issues: expect.arrayContaining([
          expect.objectContaining({ code: "invalidArtifactPath" }),
          expect.objectContaining({ code: "invalidPreviewPath" }),
          expect.objectContaining({ code: "releaseOrder" }),
        ]),
      })
    );
  });

  it("rejects an Item-level licence field instead of silently accepting unsupported policy", () => {
    expect(() => validateSharesetsListingRecord(listing({ license: "MIT" }))).toThrowError(
      expect.objectContaining({
        issues: [expect.objectContaining({ code: "unknownRecordField", path: "$.license" })],
      })
    );
  });
});
