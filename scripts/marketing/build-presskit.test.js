import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { createHash } from "node:crypto";
import { unzipSync } from "fflate";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { buildPressKit, currentPreviews, verifyQr, SITE_URL } from "./build-presskit.mjs";

const temporary = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "plvs-presskit-"));
  temporary.push(root);
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: "pipe" }).trim();
  const put = async (path, bytes) => {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), bytes);
  };
  const commit = () => {
    git("add", ".");
    git("commit", "-m", "fixture");
    return git("rev-parse", "HEAD");
  };
  git("init");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.com");
  const png = await sharp({ create: { width: 40, height: 24, channels: 3, background: "#d97700" } })
    .png()
    .toBuffer();
  const webp = await sharp(png).webp().toBuffer();
  await put(
    "website/index.html",
    '<img src="assets/app-icon.svg"><img src="assets/landing-hero.webp" srcset="assets/responsive/landing-hero-480.webp 480w">'
  );
  await put(
    "website/assets/app-icon.svg",
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><path fill="#d97700" d="M4 4h8v8H4z"/></svg>'
  );
  await put("website/assets/landing-hero.webp", webp);
  await put("website/assets/raw/landing-hero.png", png);
  await put(
    "sharesets/catalogue/manifest.json",
    JSON.stringify({ listings: ["listings/example.json"] })
  );
  const listing = {
    id: "example",
    type: "themes",
    title: "Example",
    releases: [{ status: "published", previews: [{ id: "workspace", path: "previews/r1.png" }] }],
  };
  await put("sharesets/catalogue/listings/example.json", JSON.stringify(listing));
  await put("sharesets/catalogue/previews/r1.png", png);
  const websiteSha = commit();
  listing.releases[0].previewRevisions = [
    { number: 2, previews: [{ id: "workspace", path: "previews/r2.png" }] },
  ];
  await put("sharesets/catalogue/listings/example.json", JSON.stringify(listing));
  await put("sharesets/catalogue/previews/r2.png", png);
  await put("website/assets/landing-hero.webp", await sharp(png).negate().webp().toBuffer());
  const contentSha = commit();
  const marker = { schemaVersion: 1, repository: "SounDoer/PLVS", websiteSha, contentSha };
  return { root, git, put, commit, png, webp, marker, listing };
}

describe("press kit", () => {
  it("uses separate published website and content commits, verifies QR codes and every ZIP entry", async () => {
    const { root, put, marker, png, webp } = await fixture();
    // Dirty local assets must never leak into an export of the published version.
    await put("website/assets/landing-hero.webp", "uncommitted image");
    const fetchImpl = async (url, options) => {
      expect(url).toMatch(/^https:\/\/plvs\.soundoer\.com\/publication\.json\?presskit=/);
      expect(options.headers["Cache-Control"]).toBe("no-cache");
      return { ok: true, json: async () => marker };
    };
    const result = await buildPressKit({ root, fetchImpl, now: new Date("2026-11-09T18:00:00Z") });
    expect(basename(result.directory)).toContain("2026-11-10");
    expect(result.imageCount).toBe(14);
    const manifest = JSON.parse(await readFile(join(result.directory, "manifest.json"), "utf8"));
    expect(manifest).toMatchObject({
      websiteSha: marker.websiteSha,
      contentSha: marker.contentSha,
      sourceMode: "published-website",
      generatorWorktreeDirty: true,
    });
    const extracted = unzipSync(await readFile(result.zipPath));
    expect(Object.keys(extracted)).toHaveLength(manifest.images.length + 3);
    const prefix = basename(result.directory) + "/";
    for (const record of manifest.images) {
      expect(
        createHash("sha256")
          .update(extracted[prefix + record.file])
          .digest("hex")
      ).toBe(record.sha256);
    }
    expect(Buffer.from(extracted[prefix + "03-Website-WebP/landing-hero.webp"])).toEqual(webp);
    expect(Buffer.from(extracted[prefix + "05-Original-Screenshots/landing-hero.png"])).toEqual(
      png
    );
    const preview = manifest.images.find(({ file }) => file.startsWith("06-Sharesets/"));
    expect(preview.source).toEqual({
      commit: marker.contentSha,
      path: "sharesets/catalogue/previews/r2.png",
    });
    expect(manifest.images.some(({ file }) => /responsive|r1\.png/.test(file))).toBe(false);
    for (const name of ["color", "black", "white"]) {
      const bytes = extracted[prefix + `01-Brand/plvs-icon-${name}.png`];
      expect(await sharp(bytes).metadata()).toMatchObject({
        width: 1024,
        height: 1024,
        hasAlpha: true,
      });
    }
    for (const [name, rgb] of [
      ["black", [0, 0, 0]],
      ["white", [255, 255, 255]],
    ]) {
      const { data, info } = await sharp(extracted[prefix + `01-Brand/plvs-icon-${name}.png`])
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const pixel = (512 * info.width + 512) * 4;
      expect([...data.subarray(pixel, pixel + 4)]).toEqual([...rgb, 255]);
      expect(data[3]).toBe(0);
    }
    for (const name of ["black-on-white", "white-on-dark"]) {
      for (const extension of ["svg", "png"]) {
        const bytes = extracted[prefix + `02-QR/website-qr-${name}.${extension}`];
        await expect(verifyQr(bytes)).resolves.toBeUndefined();
      }
    }
    expect(await readFile(join(result.directory, "README.txt"), "utf8")).toContain(SITE_URL);
  });

  it("supports an explicit offline commit and fails before exporting missing source images", async () => {
    const { root, put, commit, marker } = await fixture();
    const fetchImpl = () => {
      throw new Error("Offline mode contacted the network.");
    };
    const result = await buildPressKit({ root, ref: marker.websiteSha, fetchImpl });
    expect(result.contentSha).toBe(marker.websiteSha);
    await put(
      "website/index.html",
      '<img src="assets/landing-hero.webp"><img src="assets/missing.webp">'
    );
    const broken = commit();
    await expect(buildPressKit({ root, ref: broken, fetchImpl })).rejects.toThrow();
  });

  it("refuses an invalid publication marker and invalid QR imagery", async () => {
    const { root, png } = await fixture();
    await expect(
      buildPressKit({
        root,
        fetchImpl: async () => ({ ok: true, json: async () => ({ websiteSha: "main" }) }),
      })
    ).rejects.toThrow("Invalid website publication marker");
    await expect(
      buildPressKit({ root, fetchImpl: async () => ({ ok: false, status: 503 }) })
    ).rejects.toThrow("HTTP 503");
    await expect(verifyQr(png)).rejects.toThrow("did not decode");
  });

  it("selects latest published previews, included previews and excludes withdrawn releases", () => {
    const old = [{ id: "old" }],
      latest = [{ id: "latest" }];
    expect(
      currentPreviews({
        releases: [
          { status: "published", previews: old, previewRevisions: [{ previews: latest }] },
          { status: "withdrawn", previews: old },
        ],
      })
    ).toEqual(latest);
    expect(
      currentPreviews({ included: { previews: old, previewRevisions: [{ previews: latest }] } })
    ).toEqual(latest);
    expect(currentPreviews({ releases: [{ status: "withdrawn", previews: old }] })).toEqual([]);
  });
});
