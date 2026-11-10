#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";
import QRCode from "qrcode";
import jsQR from "jsqr";
import sharp from "sharp";
import { zipSync, unzipSync } from "fflate";
import { validateWebsiteMarker } from "../website-publication.mjs";

const ROOT = resolve(import.meta.dirname, "../..");
export const SITE_URL = "https://plvs.soundoer.com/";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const escapeHtml = (text) =>
  String(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");

function safePath(path) {
  if (
    !/^[a-zA-Z0-9_./-]+$/.test(path) ||
    path.startsWith("/") ||
    path.split("/").some((part) => part === ".." || part === "." || part === "")
  ) {
    throw new Error(`Unsafe media path: ${path}`);
  }
  return path;
}

export function currentPreviews(listing) {
  const owner =
    listing.included ??
    [...(listing.releases ?? [])].reverse().find((release) => release.status === "published");
  if (!owner) return [];
  return (owner.previewRevisions?.at(-1) ?? owner).previews ?? [];
}

export async function verifyQr(bytes) {
  // Decode the delivered image, including its actual polarity and quiet zone.
  const { data, info } = await sharp(bytes)
    .resize({ width: 384, kernel: "nearest" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const result = jsQR(new Uint8ClampedArray(data), info.width, info.height, {
    inversionAttempts: "attemptBoth",
  });
  if (result?.data !== SITE_URL)
    throw new Error("Website QR code did not decode to the canonical website URL.");
}

export async function buildPressKit({
  root = ROOT,
  ref,
  outputRoot = join(root, "artifacts/presskit"),
  now = new Date(),
  fetchImpl = fetch,
} = {}) {
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: root,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  const commit = (value) =>
    git("rev-parse", "--verify", "--end-of-options", `${value}^{commit}`).toString().trim();
  let websiteSha, contentSha;
  if (ref) {
    websiteSha = contentSha = commit(ref);
  } else {
    const response = await fetchImpl(`${SITE_URL}publication.json?presskit=${Date.now()}`, {
      headers: { "Cache-Control": "no-cache" },
      signal: AbortSignal.timeout(30_000),
      redirect: "error",
    });
    if (!response.ok)
      throw new Error(
        `Cannot read the published website version (HTTP ${response.status}); use --ref only when an explicit version is intended.`
      );
    const marker = validateWebsiteMarker(await response.json(), "SounDoer/PLVS");
    ({ websiteSha, contentSha } = marker);
    for (const sha of new Set([websiteSha, contentSha])) {
      try {
        commit(sha);
      } catch {
        git("fetch", "origin", sha);
      }
      if (commit(sha) !== sha) throw new Error(`Cannot resolve published commit ${sha}.`);
    }
  }
  const source = (sha, path) => git("show", `${sha}:${safePath(path)}`);
  const json = (sha, path) => JSON.parse(source(sha, path).toString("utf8"));
  const files = new Map();
  const images = [];
  async function addImage(file, bytes, label, provenance) {
    safePath(file);
    if (files.has(file)) throw new Error(`Duplicate press kit image: ${file}`);
    const { width, height } = await sharp(bytes).metadata();
    if (!width || !height) throw new Error(`Invalid image: ${file}`);
    files.set(file, bytes);
    images.push({
      file,
      label,
      width,
      height,
      bytes: bytes.length,
      sha256: sha256(bytes),
      ...provenance,
    });
  }
  const iconPath = "website/assets/app-icon.svg";
  const icon = source(websiteSha, iconPath);
  for (const [name, color] of [
    ["color", null],
    ["black", "#000000"],
    ["white", "#ffffff"],
  ]) {
    let svg = icon;
    if (color) {
      const document = new JSDOM(icon.toString(), { contentType: "image/svg+xml" }).window.document;
      document.documentElement.setAttribute("fill", color);
      for (const element of document.querySelectorAll("[fill], [stroke]")) {
        for (const attr of ["fill", "stroke"]) {
          if (element.hasAttribute(attr) && element.getAttribute(attr) !== "none")
            element.setAttribute(attr, color);
        }
      }
      svg = Buffer.from(document.documentElement.outerHTML);
    }
    const provenance = {
      source: { commit: websiteSha, path: iconPath },
      processing: color ? `Monochrome ${color}; original geometry preserved` : "Original SVG",
    };
    await addImage(`01-Brand/plvs-icon-${name}.svg`, svg, `PLVS Icon / ${name}`, provenance);
    await addImage(
      `01-Brand/plvs-icon-${name}.png`,
      await sharp(svg).resize(1024, 1024).png().toBuffer(),
      `PLVS Icon / ${name} / PNG`,
      { ...provenance, processing: `${provenance.processing}; transparent 1024 px PNG` }
    );
  }
  for (const [name, dark, light] of [
    ["black-on-white", "#000000", "#ffffff"],
    ["white-on-dark", "#ffffff", "#101010"],
  ]) {
    const options = { errorCorrectionLevel: "M", margin: 4, scale: 32, color: { dark, light } };
    const svg = Buffer.from(await QRCode.toString(SITE_URL, { ...options, type: "svg" }));
    const png = await QRCode.toBuffer(SITE_URL, { ...options, type: "png" });
    await verifyQr(png);
    await verifyQr(await sharp(svg, { density: 576 }).png().toBuffer());
    for (const [ext, bytes] of [
      ["svg", svg],
      ["png", png],
    ]) {
      await addImage(`02-QR/website-qr-${name}.${ext}`, bytes, `Website QR / ${name}`, {
        target: SITE_URL,
        processing:
          "Generated with error correction M and a four-module quiet zone; decoded and verified",
      });
    }
  }

  const html = source(websiteSha, "website/index.html").toString("utf8");
  const document = new JSDOM(html).window.document;
  const screenshots = [
    ...new Set(
      [...document.querySelectorAll("img[src]")]
        .map((img) => img.getAttribute("src"))
        .filter((path) => /^assets\/.+\.webp$/.test(path) && !path.startsWith("assets/responsive/"))
    ),
  ];
  if (!screenshots.includes("assets/landing-hero.webp"))
    throw new Error("Published homepage is missing its product hero.");
  for (const path of screenshots) {
    const bytes = source(websiteSha, `website/${path}`);
    const name = basename(path, ".webp");
    const provenance = {
      source: { commit: websiteSha, path: `website/${path}` },
      processing: "Original website WebP",
    };
    await addImage(`03-Website-WebP/${name}.webp`, bytes, name, provenance);
    await addImage(`04-Website-PNG/${name}.png`, await sharp(bytes).png().toBuffer(), name, {
      ...provenance,
      processing: "PNG conversion of website WebP; no recovered detail or upscaling",
    });
  }
  const originals = git("ls-tree", "-r", "--name-only", websiteSha, "--", "website/assets/raw")
    .toString()
    .trim()
    .split("\n")
    .filter((path) => path.endsWith(".png"));
  if (!originals.length) throw new Error("Published website has no original PNG screenshots.");
  for (const path of originals) {
    await addImage(
      `05-Original-Screenshots/${path.slice("website/assets/raw/".length)}`,
      source(websiteSha, path),
      basename(path, ".png"),
      { source: { commit: websiteSha, path }, processing: "Original PNG" }
    );
  }
  const catalogue = json(contentSha, "sharesets/catalogue/manifest.json");
  if (!Array.isArray(catalogue.listings) || !catalogue.listings.length)
    throw new Error("Missing published Catalogue listings.");
  for (const path of catalogue.listings) {
    const listing = json(contentSha, `sharesets/catalogue/${safePath(path)}`);
    for (const preview of currentPreviews(listing)) {
      const mediaPath = safePath(preview.path);
      if (!mediaPath.startsWith("previews/") || !mediaPath.endsWith(".png"))
        throw new Error(`Invalid Catalogue preview: ${mediaPath}`);
      await addImage(
        `06-Sharesets/${listing.type}/${listing.id}/${preview.id}.png`,
        source(contentSha, `sharesets/catalogue/${mediaPath}`),
        `${listing.title} / ${preview.id}`,
        {
          source: { commit: contentSha, path: `sharesets/catalogue/${mediaPath}` },
          processing: "Current published content's latest preview revision",
        }
      );
    }
  }
  const builtAt = now.toISOString();
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(now);
  const lock = JSON.parse(await readFile(join(ROOT, "package-lock.json"), "utf8"));
  const manifest = {
    schemaVersion: 1,
    builtAt,
    website: SITE_URL,
    sourceMode: ref ? "explicit-ref" : "published-website",
    websiteSha,
    contentSha,
    generatorSha: commit("HEAD"),
    generatorWorktreeDirty: Boolean(git("status", "--porcelain").toString().trim()),
    tools: Object.fromEntries(
      ["sharp", "qrcode", "jsqr", "fflate"].map((name) => [
        name,
        lock.packages[`node_modules/${name}`].version,
      ])
    ),
    images,
  };
  files.set("manifest.json", Buffer.from(JSON.stringify(manifest, null, 2) + "\n"));
  files.set(
    "README.txt",
    Buffer.from(
      `PLVS PRESS KIT\nPrepared: ${date} (Asia/Shanghai)\n\nPLVS (read as plus) is a free and open-source real-time audio metering desktop app.\nWebsite: ${SITE_URL}\nProject: https://github.com/SounDoer/PLVS\n\nSTART HERE\nOpen index.html to browse all images.\nUse 04-Website-PNG/landing-hero.png for a general product image.\nUse 02-QR/website-qr-black-on-white for general QR use; the white-on-dark variant is for dark artwork. Both include their background and quiet zone. Do not crop the border.\nWhite icons have transparent backgrounds; place them on a dark surface.\n\nCONTENTS\n01-Brand: Color, black and white app icons in SVG and transparent 1024 px PNG.\n02-QR: Two verified QR variants in SVG and high-resolution PNG. No tracking or URL shortener.\n03-Website-WebP: Full-size homepage display images, without responsive duplicates.\n04-Website-PNG: PNG conversions for design-tool compatibility. Converting WebP does not recover lost detail.\n05-Original-Screenshots: Original PNG screenshots; prefer these where available.\n06-Sharesets: Current published content's latest previews. Historical releases and revisions are omitted.\n\nPROVENANCE\nSource mode: ${manifest.sourceMode}\nWebsite commit: ${websiteSha}\nCatalogue commit: ${contentSha}\nGenerator commit: ${manifest.generatorSha}\nThe manifest records source paths, image dimensions, SHA-256 hashes and processing. Screenshots are not retouched or upscaled. This export introduces no new asset license terms.\n`
    )
  );
  const groups = [...new Set(images.map((image) => image.file.split("/")[0]))];
  files.set(
    "index.html",
    Buffer.from(
      `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PLVS Press Kit</title><style>body{font:16px system-ui;margin:32px;background:#f4f4f4;color:#222;line-height:1.5}h1{margin-bottom:8px}section{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(280px,100%),1fr));gap:20px}figure{margin:0;padding:16px;background:white;border-radius:8px}img{width:100%;height:210px;object-fit:contain;background:#888}figcaption{padding-top:10px;overflow-wrap:anywhere}small{color:#555}a{color:#15549a}nav{display:flex;flex-wrap:wrap;gap:16px}</style><h1>PLVS Press Kit</h1><p>${escapeHtml(date)} · <a href="README.txt">Read Me</a> · <a href="manifest.json">Asset Manifest</a></p><p>Source: ${escapeHtml(manifest.sourceMode)} · Website ${websiteSha.slice(0, 8)} · Catalogue ${contentSha.slice(0, 8)}</p><nav>${groups.map((group) => `<a href="#${group}">${group}</a>`).join("")}</nav>${groups
        .map(
          (group) =>
            `<h2 id="${group}">${group}</h2><section>${images
              .filter((image) => image.file.startsWith(group + "/"))
              .map(
                (image) =>
                  `<figure><a href="${escapeHtml(image.file)}"><img loading="lazy" src="${escapeHtml(image.file)}" alt="${escapeHtml(image.label)}"></a><figcaption>${escapeHtml(image.label)}<br><small>${image.width} × ${image.height} · ${(image.bytes / 1024).toFixed(0)} KB<br>${escapeHtml(image.file)}</small></figcaption></figure>`
              )
              .join("")}</section>`
        )
        .join("")}</html>`
    )
  );

  await mkdir(outputRoot, { recursive: true });
  const directory = await mkdtemp(
    join(outputRoot, `PLVS-Press-Kit-${date}-${websiteSha.slice(0, 8)}-`)
  );
  const name = basename(directory);
  const archive = zipSync(
    Object.fromEntries([...files].map(([path, bytes]) => [`${name}/${path}`, bytes])),
    { level: 6 }
  );
  const extracted = unzipSync(archive);
  if (Object.keys(extracted).length !== files.size) throw new Error("ZIP file count mismatch.");
  for (const [path, bytes] of files) {
    if (sha256(extracted[`${name}/${path}`]) !== sha256(bytes))
      throw new Error(`ZIP checksum mismatch: ${path}`);
    await mkdir(dirname(join(directory, path)), { recursive: true });
    await writeFile(join(directory, path), bytes);
  }
  const zipPath = `${directory}.zip`;
  await writeFile(zipPath, archive, { flag: "wx" });
  if (sha256(await readFile(zipPath)) !== sha256(archive))
    throw new Error("Written ZIP checksum mismatch.");
  return {
    directory,
    zipPath,
    websiteSha,
    contentSha,
    imageCount: images.length,
    zipBytes: archive.length,
    qrVerified: true,
  };
}

async function main(args) {
  if (args.length === 1 && args[0] === "--help") {
    console.log(
      "Usage: npm run presskit [-- --ref <commit>]\nDefault: export exact published website and Catalogue commits. --ref: export one local Git commit without querying the live website."
    );
    return;
  }
  if (args.length && (args.length !== 2 || args[0] !== "--ref" || !args[1]))
    throw new Error("Usage: npm run presskit [-- --ref <commit>]");
  console.log(JSON.stringify(await buildPressKit({ ref: args[1] }), null, 2));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
