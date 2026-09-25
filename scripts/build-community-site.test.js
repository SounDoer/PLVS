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

function writeFixtureSource(directory, { status = "published" } = {}) {
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
          status,
          notesMarkdown: "Initial release.",
          artifact: "artifacts/broadcast.plvsloudness",
          previews: [
            { id: "profile-summary", path: "previews/summary.png" },
            { id: "profile-stats-example", path: "previews/stats.png" },
          ],
          ...(status === "withdrawn" ? { withdrawalReason: "Unsafe guidance." } : {}),
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

function writeAssembledSite(directory) {
  mkdirSync(join(directory, "docs"), { recursive: true });
  const html =
    '<nav>Before<!-- COMMUNITY_NAV_START --><a href="community/">Community</a><!-- COMMUNITY_NAV_END -->After</nav>';
  writeFileSync(join(directory, "index.html"), html);
  writeFileSync(join(directory, "docs", "index.html"), html.replace("community/", "../community/"));
}

describe("Community static site generator", () => {
  it("is part of release-bound landing site assembly", () => {
    const workflow = readFileSync(join(".github", "workflows", "deploy-landing.yml"), "utf8");
    expect(workflow).toContain(
      "node scripts/build-community-site.mjs community/catalogue _site/community _site"
    );
  });

  it("builds useful empty browse pages", async () => {
    const source = temporaryDirectory("plvs-community-empty-");
    const output = temporaryDirectory("plvs-community-output-");
    const site = temporaryDirectory("plvs-community-site-");
    writeFileSync(join(source, "manifest.json"), '{"schemaVersion":1,"listings":[]}');
    writeAssembledSite(site);

    await expect(
      buildCommunitySite({ contentDirectory: source, outputDirectory: output, siteDirectory: site })
    ).resolves.toMatchObject({ listingCount: 0, visibleListingCount: 0, pageCount: 4 });
    expect(readFileSync(join(output, "index.html"), "utf8")).toContain("Nothing published yet");
    expect(readFileSync(join(output, "themes", "index.html"), "utf8")).toContain("Themes");
    expect(readFileSync(join(site, "index.html"), "utf8")).not.toContain("Community");
    expect(readFileSync(join(site, "docs", "index.html"), "utf8")).not.toContain("Community");
  });

  it("builds browse, detail, download, and sealed preview files", async () => {
    const source = temporaryDirectory("plvs-community-source-");
    const output = temporaryDirectory("plvs-community-output-");
    writeFixtureSource(source);

    const result = await buildCommunitySite({ contentDirectory: source, outputDirectory: output });
    expect(result).toMatchObject({ listingCount: 1, visibleListingCount: 1, pageCount: 5 });
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

  it("hides a fully withdrawn Listing from browse while preserving its historical detail page", async () => {
    const source = temporaryDirectory("plvs-community-withdrawn-");
    const output = temporaryDirectory("plvs-community-output-");
    writeFixtureSource(source, { status: "withdrawn" });

    await expect(
      buildCommunitySite({ contentDirectory: source, outputDirectory: output })
    ).resolves.toMatchObject({ listingCount: 1, visibleListingCount: 0 });
    expect(readFileSync(join(output, "index.html"), "utf8")).not.toContain("Broadcast Safe");
    const detail = readFileSync(join(output, "loudness", "broadcast-safe", "index.html"), "utf8");
    expect(detail).toContain("Broadcast Safe");
    expect(detail).toContain("Withdrawn: Unsafe guidance.");
    expect(detail).not.toContain("Download Release 1");
  });
});
