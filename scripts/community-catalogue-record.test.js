import { describe, expect, it } from "vitest";
import { validateCommunityListingRecord } from "./community-catalogue-record.mjs";

function listing(overrides = {}) {
  return {
    schemaVersion: 1,
    id: "broadcast-profile",
    slug: "broadcast-profile",
    type: "loudness",
    classification: "community",
    title: "Broadcast Profile",
    summary: "A compact profile for broadcast checks.",
    descriptionMarkdown: "Designed for a **clear** reference. [Details](https://example.com).",
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

describe("Community Listing and Release records", () => {
  it("normalizes the curated record without introducing per-Item licence metadata", () => {
    const result = validateCommunityListingRecord(listing());
    expect(result).toMatchObject({
      id: "broadcast-profile",
      slug: "broadcast-profile",
      classification: "community",
      author: { name: "Example Author", url: "https://example.com" },
      releases: [{ number: 1, status: "published", withdrawalReason: null }],
    });
    expect(result).not.toHaveProperty("license");
    expect(result.releases[0]).not.toHaveProperty("license");
  });

  it("accepts a withdrawn immutable Release only with an explicit reason", () => {
    const raw = listing();
    raw.releases[0].status = "withdrawn";
    raw.releases[0].withdrawalReason = "The artifact contains an incorrect rule.";
    expect(validateCommunityListingRecord(raw).releases[0]).toMatchObject({
      status: "withdrawn",
      withdrawalReason: "The artifact contains an incorrect rule.",
    });
  });

  it("rejects raw HTML and non-HTTPS Markdown links", () => {
    expect(() =>
      validateCommunityListingRecord(
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
      validateCommunityListingRecord(listing({ descriptionMarkdown: "[bad](javascript:alert(1))" }))
    ).toThrowError(
      expect.objectContaining({
        issues: expect.arrayContaining([expect.objectContaining({ code: "unsafeMarkdownLink" })]),
      })
    );
  });

  it("rejects duplicate normalized tags and unsafe author URLs", () => {
    expect(() =>
      validateCommunityListingRecord(
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
    expect(() => validateCommunityListingRecord(raw)).toThrowError(
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
    expect(() => validateCommunityListingRecord(listing({ license: "MIT" }))).toThrowError(
      expect.objectContaining({
        issues: [expect.objectContaining({ code: "unknownRecordField", path: "$.license" })],
      })
    );
  });
});
