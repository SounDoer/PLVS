import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildPack } from "../src/transfer/packShape.js";
import { buildSharesetsSite, detailGallery, previewLabel } from "./build-sharesets-site.mjs";

const temporaryDirectories = [];
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);
const THEME_PREVIEW_IDS = [
  "product-workspace-file",
  "product-multichannel-monitoring",
  "product-workspace-snapshot",
  "semantic-overview",
];

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

function writeFixtureSource(directory, { status = "published", statuses = [status] } = {}) {
  mkdirSync(join(directory, "listings"));
  mkdirSync(join(directory, "artifacts"));
  mkdirSync(join(directory, "previews"));
  const multiple = statuses.length > 1;
  const releases = statuses.map((releaseStatus, index) => {
    const number = index + 1;
    return {
      number,
      publishedAt: `2026-09-${24 + number}`,
      status: releaseStatus,
      notesMarkdown: `Release ${number}.`,
      artifact: multiple
        ? `artifacts/broadcast-v${number}.plvsloudness`
        : "artifacts/broadcast.plvsloudness",
      previews: [],
      ...(releaseStatus === "withdrawn" ? { withdrawalReason: "Unsafe guidance." } : {}),
    };
  });
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
      classification: "sharesets",
      title: "Broadcast Safe",
      summary: "A conservative broadcast profile.",
      descriptionMarkdown: "Designed for **broadcast delivery**.",
      references: [
        {
          publisher: "Example Standards Body",
          title: "Example Loudness Recommendation",
          edition: "Version 2.0 (2026)",
          url: "https://example.com/loudness",
          relevanceMarkdown: "Defines the **Integrated target** represented by this profile.",
        },
      ],
      tags: ["Broadcast", "Standard", "Dialogue", "Monitoring"],
      author: { name: "Example Author", url: "https://example.com" },
      releases,
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
  for (const release of releases) {
    mkdirSync(join(directory, release.artifact, ".."), { recursive: true });
    writeFileSync(join(directory, release.artifact), `${JSON.stringify(pack, null, 2)}\n`);
    for (const preview of release.previews) {
      mkdirSync(join(directory, preview.path, ".."), { recursive: true });
      writeFileSync(join(directory, preview.path), PNG);
    }
  }
}

function writeAssembledSite(directory) {
  mkdirSync(join(directory, "docs"), { recursive: true });
  const html =
    '<nav>Before<!-- SHARESETS_NAV_START --><a href="sharesets/">Sharesets</a><!-- SHARESETS_NAV_END -->After</nav>';
  writeFileSync(join(directory, "index.html"), html);
  writeFileSync(join(directory, "docs", "index.html"), html.replace("sharesets/", "../sharesets/"));
}

function writeBuiltinThemeSource(directory) {
  mkdirSync(join(directory, "previews", "plvs-dark"), { recursive: true });
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
      summary: "The built-in dark Theme for PLVS.",
      descriptionMarkdown: "A neutral reference Theme included with PLVS.",
      tags: ["Dark", "Built-in", "Neutral", "Balanced"],
      author: { name: "PLVS", url: "https://github.com/SounDoer/PLVS" },
      included: { sourceId: "plvs-dark", previews },
    })
  );
  for (const preview of previews) writeFileSync(join(directory, preview.path), PNG);
}

function writeBuiltinProfileSource(directory) {
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
      summary: "The default Loudness Profile included with PLVS.",
      descriptionMarkdown: "The default Loudness Profile included with PLVS.",
      tags: [],
      author: { name: "PLVS", url: "https://github.com/SounDoer/PLVS" },
      included: { sourceId: "default", previews: [] },
    })
  );
}

describe("Sharesets static site generator", () => {
  it("uses the fixed four-image Theme gallery order and plain-language labels", () => {
    const previews = [
      "semantic-overview",
      "product-workspace-file",
      "product-multichannel-monitoring",
      "product-workspace-snapshot",
    ].map((id) => ({ id }));

    const gallery = detailGallery("themes", previews);
    expect(gallery.map(({ id }) => id)).toEqual([
      "product-workspace-file",
      "product-multichannel-monitoring",
      "product-workspace-snapshot",
      "semantic-overview",
    ]);
    expect(gallery.map(previewLabel)).toEqual([
      "Workspace",
      "Multichannel Monitoring",
      "Snapshot",
      "Theme Colors",
    ]);
  });

  it.each([false, true])(
    "gates Sharesets links in the actual homepage and docs templates (published: %s)",
    async (published) => {
      const source = temporaryDirectory("plvs-sharesets-real-nav-source-");
      const site = temporaryDirectory("plvs-sharesets-real-nav-site-");
      const output = temporaryDirectory("plvs-sharesets-real-nav-output-");
      if (published) writeFixtureSource(source);
      else
        writeFileSync(
          join(source, "manifest.json"),
          JSON.stringify({ schemaVersion: 1, listings: [] })
        );
      mkdirSync(join(site, "docs"));
      writeFileSync(join(site, "index.html"), readFileSync("website/index.html"));
      writeFileSync(join(site, "docs", "index.html"), readFileSync("website/docs/template.html"));
      await buildSharesetsSite({
        contentDirectory: source,
        outputDirectory: output,
        siteDirectory: site,
      });
      const home = readFileSync(join(site, "index.html"), "utf8");
      const docs = readFileSync(join(site, "docs", "index.html"), "utf8");
      expect(readFileSync(join(site, "assets", "sharesets-detail.css"), "utf8")).toBe(
        readFileSync(join("website", "assets", "sharesets-detail.css"), "utf8")
      );
      expect(home.includes('href="sharesets/"')).toBe(published);
      expect(docs.includes('href="../sharesets/"')).toBe(published);
      expect(home.match(/<footer[\s\S]*?<\/footer>/)?.[0]).not.toContain('href="sharesets/"');
    }
  );

  it("is part of release-bound website assembly", () => {
    const workflow = readFileSync(join(".github", "workflows", "publish-site.yml"), "utf8");
    expect(workflow).toContain(
      "node scripts/build-website.mjs ../content-source/sharesets/catalogue ../_site"
    );
  });

  it("builds useful empty browse pages", async () => {
    const source = temporaryDirectory("plvs-sharesets-empty-");
    const output = temporaryDirectory("plvs-sharesets-output-");
    const site = temporaryDirectory("plvs-sharesets-site-");
    writeFileSync(join(source, "manifest.json"), '{"schemaVersion":1,"listings":[]}');
    writeAssembledSite(site);

    await expect(
      buildSharesetsSite({ contentDirectory: source, outputDirectory: output, siteDirectory: site })
    ).resolves.toMatchObject({ listingCount: 0, visibleListingCount: 0, pageCount: 4 });
    expect(readFileSync(join(output, "index.html"), "utf8")).toContain("Nothing published yet");
    expect(readFileSync(join(output, "themes", "index.html"), "utf8")).toContain("Themes");
    expect(readFileSync(join(site, "index.html"), "utf8")).not.toContain("Sharesets");
    expect(readFileSync(join(site, "docs", "index.html"), "utf8")).not.toContain("Sharesets");
  });

  it("builds browse, detail, download, and sealed preview files", async () => {
    const source = temporaryDirectory("plvs-sharesets-source-");
    const output = temporaryDirectory("plvs-sharesets-output-");
    const site = temporaryDirectory("plvs-sharesets-site-");
    writeFixtureSource(source);
    writeAssembledSite(site);

    const result = await buildSharesetsSite({
      contentDirectory: source,
      outputDirectory: output,
      siteDirectory: site,
    });
    expect(result).toMatchObject({ listingCount: 1, visibleListingCount: 1, pageCount: 5 });
    const root = readFileSync(join(output, "index.html"), "utf8");
    const detail = readFileSync(join(output, "loudness", "broadcast-safe", "index.html"), "utf8");
    expect(root).toContain("Broadcast Safe");
    expect(root).toContain("/sharesets/loudness/broadcast-safe/");
    expect(root).toContain("data-catalogue-search");
    expect(root).toContain('aria-label="Search Sharesets"');
    expect(root).not.toContain("<span>Search</span>");
    expect(root).toContain("/assets/site-tokens.css");
    expect(root).toContain('class="resource-card card"');
    expect(root).toContain(
      'data-tags="[&quot;Broadcast&quot;,&quot;Standard&quot;,&quot;Dialogue&quot;,&quot;Monitoring&quot;]"'
    );
    expect(root).toContain('aria-label="2 more tags: Dialogue, Monitoring">+2</span>');
    expect(root).not.toContain('data-catalogue-filter="type"');
    expect(detail).toContain("/assets/site-tokens.css");
    expect(detail).toContain("data-site-navigation");
    expect(root).toContain('data-metric="truePeak"');
    expect(detail).toContain("Designed for <strong>broadcast delivery</strong>.");
    expect(detail.indexOf("Designed for <strong>broadcast delivery</strong>.")).toBeGreaterThan(
      detail.indexOf("<h2>Details</h2>")
    );
    expect(
      detail.slice(detail.indexOf('<header class="theme-summary">'), detail.indexOf("</header>"))
    ).toContain("A conservative broadcast profile.");
    expect(
      detail.slice(detail.indexOf('<header class="theme-summary">'), detail.indexOf("</header>"))
    ).not.toContain("Designed for <strong>broadcast delivery</strong>.");
    expect(detail).toContain("Example Author");
    expect(detail.match(/ download>/g)).toHaveLength(1);
    expect(detail).toContain("−23 LUFS");
    expect(detail).toContain(
      '&gt; −1 dBTP → <span class="profile-rule-severity profile-rule-severity-fail">Fail</span>'
    );
    expect(detail).not.toContain("<h2>Compatibility</h2>");
    expect(detail).not.toContain("No bundled dependencies");
    expect(detail).toContain("Settings → Saved Items → Import…");
    expect(detail).toContain("<h2>Sources</h2>");
    expect(detail).toContain("Example Loudness Recommendation");
    expect(detail).toContain("Version 2.0 (2026)");
    expect(detail).toContain("Defines the <strong>Integrated target</strong>");
    expect(detail).toContain('href="https://example.com/loudness"');
    expect(root).toContain("example loudness recommendation");
    expect(detail).not.toContain("data-preview-gallery");
    expect(detail).not.toContain("<h3>Rules</h3>");
    expect(root).toContain('aria-label="Profile rule summary"');
    expect(detail.toLowerCase()).not.toContain("license");
    expect(
      readFileSync(join(output, "files", "broadcast", "v1", "broadcast.plvsloudness"), "utf8")
    ).toContain('"kind": "loudness-pack"');
    expect(readFileSync(join(site, "index.html"), "utf8")).toContain("Sharesets");
    expect(readFileSync(join(site, "docs", "index.html"), "utf8")).toContain("Sharesets");
  });

  it("presents built-in Themes as included content without download or import controls", async () => {
    const source = temporaryDirectory("plvs-sharesets-builtin-source-");
    const output = temporaryDirectory("plvs-sharesets-builtin-output-");
    writeBuiltinThemeSource(source);

    await expect(
      buildSharesetsSite({ contentDirectory: source, outputDirectory: output })
    ).resolves.toMatchObject({ listingCount: 1, visibleListingCount: 1 });
    const browse = readFileSync(join(output, "index.html"), "utf8");
    const detail = readFileSync(join(output, "themes", "plvs-dark", "index.html"), "utf8");
    expect(browse).toContain("PLVS Dark");
    expect(browse).toContain("/sharesets/files/plvs-dark/included/product-workspace-file.png");
    expect(detail).toContain("Included with PLVS");
    expect(detail).toContain("Availability");
    expect(detail).not.toContain("Copy Theme");
    expect(detail).not.toContain("data-copy-artifact");
    expect(detail).not.toContain(" download>");
    expect(detail).not.toContain("How to Use");
    expect(detail).not.toContain("Release History");
    expect(detail).not.toContain("File Checksum");
    expect(detail).not.toContain("File Size");
    expect(
      readFileSync(join(output, "files", "plvs-dark", "included", "semantic-overview.png"))
    ).toEqual(PNG);
  });

  it("renders the included Default Profile from its structured built-in rules", async () => {
    const source = temporaryDirectory("plvs-sharesets-default-profile-source-");
    const output = temporaryDirectory("plvs-sharesets-default-profile-output-");
    writeBuiltinProfileSource(source);

    await expect(
      buildSharesetsSite({ contentDirectory: source, outputDirectory: output })
    ).resolves.toMatchObject({ listingCount: 1, visibleListingCount: 1 });
    const browse = readFileSync(join(output, "index.html"), "utf8");
    const detail = readFileSync(join(output, "loudness", "default", "index.html"), "utf8");

    expect(browse).toContain('aria-label="Profile rule summary"');
    expect(detail).toContain("Included with PLVS");
    expect(detail).toContain("−23 LUFS");
    expect(detail).toContain(
      '&gt; −6 LUFS → <span class="profile-rule-severity profile-rule-severity-warn">Warn</span>'
    );
    expect(detail).toContain(
      '&gt; −1 dBTP → <span class="profile-rule-severity profile-rule-severity-fail">Fail</span>'
    );
    expect(detail).not.toContain(" download>");
    expect(detail).not.toContain('href="null"');
    expect(detail).not.toContain("How to Use");
    expect(detail).not.toContain("Release History");
    expect(detail).not.toContain("File Checksum");
  });

  it("keeps a partially withdrawn Listing visible and links only its published Release", async () => {
    const source = temporaryDirectory("plvs-sharesets-partial-");
    const output = temporaryDirectory("plvs-sharesets-output-");
    writeFixtureSource(source, { statuses: ["withdrawn", "published"] });

    await expect(
      buildSharesetsSite({ contentDirectory: source, outputDirectory: output })
    ).resolves.toMatchObject({ listingCount: 1, visibleListingCount: 1 });
    const browse = readFileSync(join(output, "index.html"), "utf8");
    const detail = readFileSync(join(output, "loudness", "broadcast-safe", "index.html"), "utf8");
    expect(browse).toContain("Broadcast Safe");
    expect(detail.match(/ download>/g)).toHaveLength(1);
    expect(detail).toContain('class="release-current">Current</span>');
    expect(detail).toContain("Withdrawn: Unsafe guidance.");
    expect(detail).not.toContain('href="/sharesets/files/broadcast/v1/broadcast-v1.plvsloudness"');
    expect(detail).toContain('href="/sharesets/files/broadcast/v2/broadcast-v2.plvsloudness"');
  });

  it("hides a fully withdrawn Listing from browse while preserving its historical detail page", async () => {
    const source = temporaryDirectory("plvs-sharesets-withdrawn-");
    const output = temporaryDirectory("plvs-sharesets-output-");
    writeFixtureSource(source, { status: "withdrawn" });

    await expect(
      buildSharesetsSite({ contentDirectory: source, outputDirectory: output })
    ).resolves.toMatchObject({ listingCount: 1, visibleListingCount: 0 });
    expect(readFileSync(join(output, "index.html"), "utf8")).not.toContain("Broadcast Safe");
    const detail = readFileSync(join(output, "loudness", "broadcast-safe", "index.html"), "utf8");
    expect(detail).toContain("Broadcast Safe");
    expect(detail).toContain("Withdrawn: Unsafe guidance.");
    expect(detail).not.toContain("Download Release 1");
  });
});
