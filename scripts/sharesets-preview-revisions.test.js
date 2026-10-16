import { mkdtemp, mkdir, writeFile, readFile, cp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { buildPack } from "../src/transfer/packShape.js";
import { DEFAULT_WORKSPACE_STATE } from "../src/workspace/constants.js";
import { readSharesetsSource } from "./sharesets-catalogue-source.mjs";
import { validateSharesetsListingRecord } from "./sharesets-catalogue-record.mjs";
import { validateSharesetsSourceUpdate } from "./sharesets-catalogue-update.mjs";
import { curateSharesetsCatalogue } from "./curate-sharesets-catalogue.mjs";
import { buildSharesetsSite } from "./build-sharesets-site.mjs";

const roots = [];
const png = await sharp({ create: { width: 1, height: 1, channels: 4, background: "black" } })
  .png()
  .toBuffer();
const revisedPng = await sharp({ create: { width: 1, height: 1, channels: 4, background: "red" } })
  .png()
  .toBuffer();
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function directory() {
  const root = await mkdtemp(join(tmpdir(), "plvs-preview-revisions-"));
  roots.push(root);
  return root;
}
const preview = (path) => ({ id: "preset-workspace", path });
const revision = (number = 1) => ({
  number,
  publishedAt: "2026-10-16",
  previews: [preview(`revision-${number}.png`)],
});
const owner = (listing) => listing.included ?? listing.releases[0];
async function save(root, listing) {
  await writeFile(join(root, "listing.json"), JSON.stringify(listing, null, 2));
}
async function fixture({ included = false, revised = false } = {}) {
  const root = await directory();
  const content = included
    ? { sourceId: "default", previews: [preview("original.png")] }
    : {
        number: 1,
        publishedAt: "2026-10-14",
        status: "published",
        notesMarkdown: "Initial release.",
        artifact: "preset.plvspreset",
        previews: [preview("original.png")],
      };
  if (revised) content.previewRevisions = [revision()];
  const listing = {
    schemaVersion: 1,
    id: "monitor",
    slug: "monitor",
    type: "presets",
    classification: "official",
    title: "Monitor",
    summary: "Monitoring preset.",
    descriptionMarkdown: "Monitoring preset.",
    tags: [],
    author: null,
    ...(included ? { included: content } : { releases: [content] }),
  };
  await writeFile(
    join(root, "manifest.json"),
    JSON.stringify({ schemaVersion: 1, listings: ["listing.json"] })
  );
  await save(root, listing);
  await writeFile(join(root, "original.png"), png);
  if (revised) await writeFile(join(root, "revision-1.png"), revisedPng);
  const pack = buildPack("presets", [
    {
      id: "monitor",
      name: "Monitor",
      ...structuredClone(DEFAULT_WORKSPACE_STATE),
      dock: { enabled: false },
      loudnessProfileActive: "off",
    },
  ]);
  await writeFile(join(root, "preset.plvspreset"), `${JSON.stringify(pack, null, 2)}\n`);
  return { root, listing };
}

describe("independent Sharesets preview revisions", () => {
  it.each([false, true])(
    "shows latest images while retaining content identity and original image URLs (included=%s)",
    async (included) => {
      const previous = await fixture({ included });
      const candidate = await fixture({ included, revised: true });
      await expect(
        validateSharesetsSourceUpdate(previous.root, candidate.root)
      ).resolves.toMatchObject({ valid: true });
      const source = await readSharesetsSource(candidate.root);
      const content = owner(source.listings[0].document);
      expect(content.previews[0].path).toBe("original.png");
      expect(content.previewRevisions[0].previews[0].sha256).not.toBe(content.previews[0].sha256);
      const output = await directory();
      await buildSharesetsSite({ contentDirectory: candidate.root, outputDirectory: output });
      const html = await readFile(join(output, "presets/monitor/index.html"), "utf8");
      const base = `files/monitor/${included ? "included" : "v1"}`;
      expect(html).toContain(`/sharesets/${base}/previews/r1/preset-workspace.png`);
      expect(await readFile(join(output, base, "preset-workspace.png"))).toEqual(png);
      expect(await readFile(join(output, base, "previews/r1/preset-workspace.png"))).toEqual(
        revisedPng
      );
      expect(html).not.toContain("Release 2");
      if (!included) {
        expect(html).toContain("/sharesets/files/monitor/v1/preset.plvspreset");
        expect(await readFile(join(output, base, "preset.plvspreset"))).toEqual(
          await readFile(join(previous.root, "preset.plvspreset"))
        );
      }
    }
  );

  it.each(["remove", "date", "bytes", "insert"])(
    "rejects a published revision mutation: %s",
    async (mutation) => {
      const previous = await fixture({ revised: true });
      const candidate = await fixture({ revised: true });
      const content = owner(candidate.listing);
      if (mutation === "remove") delete content.previewRevisions;
      if (mutation === "date") content.previewRevisions[0].publishedAt = "2026-10-17";
      if (mutation === "bytes") await writeFile(join(candidate.root, "revision-1.png"), png);
      if (mutation === "insert") {
        owner(previous.listing).previewRevisions[0].number = 2;
        await save(previous.root, previous.listing);
        content.previewRevisions.push({ ...revision(2), previews: [preview("revision-2.png")] });
        await writeFile(join(candidate.root, "revision-2.png"), revisedPng);
      }
      await save(candidate.root, candidate.listing);
      await expect(
        validateSharesetsSourceUpdate(previous.root, candidate.root)
      ).rejects.toMatchObject({
        issues: expect.arrayContaining([
          expect.objectContaining({
            code:
              mutation === "insert" ? "previewRevisionInserted" : "previewRevisionHistoryChanged",
          }),
        ]),
      });
    }
  );

  it.each([false, true])(
    "protects original preview bytes even when a revision is displayed (included=%s)",
    async (included) => {
      const previous = await fixture({ included });
      const candidate = await fixture({ included, revised: true });
      await writeFile(join(candidate.root, "original.png"), revisedPng);
      await expect(
        validateSharesetsSourceUpdate(previous.root, candidate.root)
      ).rejects.toMatchObject({
        issues: expect.arrayContaining([
          expect.objectContaining({
            code: included ? "includedPreviewHistoryChanged" : "releaseHistoryChanged",
          }),
        ]),
      });
    }
  );

  it("requires distinct paths and the complete artifact-derived preview set", async () => {
    const candidate = await fixture({ revised: true });
    const content = owner(candidate.listing);
    content.previewRevisions[0].previews[0].path = "original.png";
    await save(candidate.root, candidate.listing);
    await expect(readSharesetsSource(candidate.root)).rejects.toMatchObject({
      issues: expect.arrayContaining([expect.objectContaining({ code: "duplicatePreviewPath" })]),
    });
    content.previewRevisions[0].previews = [{ id: "wrong-view", path: "revision-1.png" }];
    await save(candidate.root, candidate.listing);
    await expect(readSharesetsSource(candidate.root)).rejects.toMatchObject({
      issues: expect.arrayContaining([expect.objectContaining({ code: "previewSetMismatch" })]),
    });
  });

  it.each([0, 1.5, "1"])("rejects invalid revision number %s", async (number) => {
    const { listing } = await fixture({ revised: true });
    owner(listing).previewRevisions[0].number = number;
    expect(() => validateSharesetsListingRecord(listing)).toThrow();
  });

  it.each([false, true])(
    "curates a preview revision without adding a Release (included=%s)",
    async (included) => {
      const previous = await fixture({ included });
      const candidate = await fixture({ included });
      owner(candidate.listing).previewRevisions = [revision()];
      await save(candidate.root, candidate.listing);
      const outputDirectory = join(await directory(), "review");
      const args = {
        publishedDirectory: previous.root,
        candidateDirectory: candidate.root,
        outputDirectory,
      };
      const dryRun = await curateSharesetsCatalogue(args);
      expect(dryRun.additions).toEqual([]);
      expect(dryRun.previewUpdates).toMatchObject([
        { listingId: "monitor", releaseNumber: included ? null : 1, previewRevision: 1 },
      ]);
      const generated = [];
      await curateSharesetsCatalogue({
        ...args,
        write: true,
        generatePreviews: async (args) => {
          generated.push(args);
          await mkdir(args.outputDirectory);
          await writeFile(join(args.outputDirectory, "preset-workspace.png"), revisedPng);
        },
      });
      expect(generated).toHaveLength(1);
      expect(generated[0]).toHaveProperty(included ? "builtinPresetId" : "artifactPath");
      await expect(
        validateSharesetsSourceUpdate(previous.root, candidate.root)
      ).resolves.toMatchObject({ valid: true });
      const after = await directory();
      await cp(candidate.root, after, { recursive: true });
      await writeFile(join(after, "revision-1.png"), png);
      await expect(
        curateSharesetsCatalogue({
          publishedDirectory: candidate.root,
          candidateDirectory: after,
          outputDirectory,
        })
      ).rejects.toMatchObject({
        issues: expect.arrayContaining([
          expect.objectContaining({ code: "previewRevisionHistoryChanged" }),
        ]),
      });
    }
  );
});
