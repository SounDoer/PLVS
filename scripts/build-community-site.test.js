import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildPack } from "../src/transfer/packShape.js";
import { buildCommunitySite } from "./build-community-site.mjs";

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

function writeFixtureSource(directory) {
  mkdirSync(join(directory, "listings"));
  mkdirSync(join(directory, "artifacts"));
  mkdirSync(join(directory, "previews"));
  writeFileSync(
    join(directory, "manifest.json"),
    JSON.stringify({ schemaVersion: 1, listings: ["listings/broadcast.json"] })
  );
  writeFileSync(
    join(directory, "listings", "broadcast.json"),
    JSON.stringify({
      schemaVersion: 1,
      id: "broadcast",
      slug: "broadcast-safe",
      type: "loudness",
      classification: "community",
      title: "Broadcast Safe",
      summary: "A conservative broadcast profile.",
      descriptionMarkdown: "Designed for **broadcast delivery**.",
      tags: ["Broadcast"],
      author: { name: "Example Author", url: "https://example.com" },
      releases: [
        {
          number: 1,
          publishedAt: "2026-09-25",
          status: "published",
          notesMarkdown: "Initial release.",
          artifact: "artifacts/broadcast.plvsloudness",
          previews: [
            { id: "profile-summary", path: "previews/summary.png" },
            { id: "profile-stats-example", path: "previews/stats.png" },
          ],
        },
      ],
    })
  );
  const pack = buildPack("loudness", [
    {
      id: "broadcast",
      name: "Broadcast Safe",
      referenceLufs: -23,
      rules: [{ metricId: "truePeak", op: ">", value: -1, severity: "fail" }],
    },
  ]);
  writeFileSync(
    join(directory, "artifacts", "broadcast.plvsloudness"),
    `${JSON.stringify(pack, null, 2)}\n`
  );
  writeFileSync(join(directory, "previews", "summary.png"), PNG);
  writeFileSync(join(directory, "previews", "stats.png"), PNG);
}

describe("Community static site generator", () => {
  it("builds useful empty browse pages", async () => {
    const source = temporaryDirectory("plvs-community-empty-");
    const output = temporaryDirectory("plvs-community-output-");
    writeFileSync(join(source, "manifest.json"), '{"schemaVersion":1,"listings":[]}');

    await expect(
      buildCommunitySite({ contentDirectory: source, outputDirectory: output })
    ).resolves.toMatchObject({ listingCount: 0, pageCount: 4 });
    expect(readFileSync(join(output, "index.html"), "utf8")).toContain("Nothing published yet");
    expect(readFileSync(join(output, "themes", "index.html"), "utf8")).toContain("Themes");
  });

  it("builds browse, detail, download, and sealed preview files", async () => {
    const source = temporaryDirectory("plvs-community-source-");
    const output = temporaryDirectory("plvs-community-output-");
    writeFixtureSource(source);

    const result = await buildCommunitySite({ contentDirectory: source, outputDirectory: output });
    expect(result).toMatchObject({ listingCount: 1, pageCount: 5 });
    const root = readFileSync(join(output, "index.html"), "utf8");
    const detail = readFileSync(join(output, "loudness", "broadcast-safe", "index.html"), "utf8");
    expect(root).toContain("Broadcast Safe");
    expect(root).toContain("/community/loudness/broadcast-safe/");
    expect(root).toContain("data-catalogue-search");
    expect(root).toContain('data-metric="truePeak"');
    expect(detail).toContain("Designed for <strong>broadcast delivery</strong>.");
    expect(detail).toContain("Example Author");
    expect(detail).toContain("Download Release 1");
    expect(detail).toContain("Compatibility");
    expect(detail).toContain("No bundled dependencies");
    expect(detail).toContain("Import Shared Item…");
    expect(detail).toContain("/community/files/broadcast/v1/profile-summary.png");
    expect(detail.toLowerCase()).not.toContain("license");
    expect(readFileSync(join(output, "files", "broadcast", "v1", "profile-summary.png"))).toEqual(
      PNG
    );
    expect(
      readFileSync(join(output, "files", "broadcast", "v1", "broadcast.plvsloudness"), "utf8")
    ).toContain('"kind": "loudness-pack"');
  });
});
