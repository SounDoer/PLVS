import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CommunitySourceError,
  readCommunitySource,
  validateCommunitySourceManifest,
} from "./community-catalogue-source.mjs";
import { validateCommunitySourceDirectory } from "./validate-community-source.mjs";

const temporaryDirectories = [];

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
    writeFileSync(
      join(directory, "manifest.json"),
      JSON.stringify({ schemaVersion: 1, listings: ["listings/example.json"] })
    );
    writeFileSync(join(directory, "listings", "example.json"), '{"id":"example"}');

    await expect(readCommunitySource(directory)).resolves.toMatchObject({
      manifest: { schemaVersion: 1, listings: ["listings/example.json"] },
      listings: [{ sourcePath: "listings/example.json", document: { id: "example" } }],
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
