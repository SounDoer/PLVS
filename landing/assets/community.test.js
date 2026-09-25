import { describe, expect, it } from "vitest";
import { matchesCatalogueCard } from "./community.js";

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
