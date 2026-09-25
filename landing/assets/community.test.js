import { describe, expect, it, vi } from "vitest";
import { copyCommunityArtifact, matchesCatalogueCard } from "./community.js";

const card = {
  search: "broadcast safe conservative broadcast profile",
  type: "loudness",
  module: "loudness|stats",
  metric: "truePeak|integrated",
  scheme: "",
  feature: "",
  dependency: "",
};

describe("Community Catalogue search", () => {
  it("searches normalized Listing copy and tags", () => {
    expect(matchesCatalogueCard(card, "SAFE", {})).toBe(true);
    expect(matchesCatalogueCard(card, "podcast", {})).toBe(false);
  });

  it("combines machine-derived filters and treats empty choices as inactive", () => {
    expect(matchesCatalogueCard(card, "", { type: "loudness", metric: "truePeak" })).toBe(true);
    expect(matchesCatalogueCard(card, "", { type: "themes", metric: "" })).toBe(false);
  });
});

describe("Community Theme copy", () => {
  it("copies the exact downloaded artifact text", async () => {
    const writeText = vi.fn();
    await copyCommunityArtifact("/theme.plvstheme", {
      fetchImpl: async () => ({ ok: true, text: async () => "portable theme" }),
      clipboard: { writeText },
    });
    expect(writeText).toHaveBeenCalledWith("portable theme");
  });
});
